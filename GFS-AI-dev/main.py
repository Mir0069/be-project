import asyncio
import logging
import os
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv

load_dotenv()  # reads .env into os.environ before anything below reads config from it

from listener.worker            import run_listener
from listener.extraction_worker import run_extraction_listener
from listener.rules_worker      import run_rules_listener
from listener.teams_worker      import run_teams_listener

from api.fastapi_app import app  # the actual FastAPI app with all HTTP routes already defined

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("gfs.main")

# Suppress verbose internal Azure AMQP connection state and keepalive retries
logging.getLogger("azure.servicebus").setLevel(logging.WARNING)
logging.getLogger("azure.core").setLevel(logging.WARNING)
logging.getLogger("uamqp").setLevel(logging.WARNING)

SERVICE_BUS_CONNECTION_STRING = os.getenv("AZURE_SERVICE_BUS_CONNECTION_STRING")

EMAIL_QUEUE_NAME = os.getenv("AZURE_SERVICE_BUS_QUEUE_NAME", "ai-ocr-ingestion")  # EMAIL_PROPOSAL messages

# Stage 0 only — heavy/slow, external-API-bound jobs (Azure Document Intelligence, OpenAI Vision)
EXTRACTION_STAGE_QUEUE_NAME = os.getenv("AZURE_SERVICE_BUS_EXTRACTION_STAGE_QUEUE_NAME", "ai-stage-trigger")
EXTRACTION_STAGE_DLQ_NAME   = os.getenv("AZURE_SERVICE_BUS_EXTRACTION_STAGE_DLQ_NAME", "ai-stage-trigger-dlq")

# Stage 1-6 only — reuses an existing env var name, cheap/fast rules-engine jobs
_env_rules_queue = os.getenv("AZURE_SERVICE_BUS_EXTRACTION_RESULT_QUEUE_NAME")
if _env_rules_queue:
    RULES_QUEUE_NAME = _env_rules_queue
    logger.info("Rules queue configured from environment: %s", RULES_QUEUE_NAME)
else:
    RULES_QUEUE_NAME = "ai-stage-result"
    logger.warning(
        "AZURE_SERVICE_BUS_EXTRACTION_RESULT_QUEUE_NAME not set in environment. "
        "Falling back to default queue: %s",
        RULES_QUEUE_NAME,
    )
RULES_DLQ_NAME   = os.getenv("AZURE_SERVICE_BUS_EXTRACTION_RESULT_DLQ_NAME", "ai-stage-result-dlq")

TEAMS_QUEUE_NAME = os.getenv("AZURE_SERVICE_BUS_TEAMS_QUEUE_NAME", "teams-ai-integration")

# how many parallel workers to run per queue — tune these based on real load and rate limits
EXTRACTION_WORKER_CONCURRENCY = int(os.getenv("EXTRACTION_WORKER_CONCURRENCY", "3"))   # keep low — bound by OpenAI/DI rate limits + memory
RULES_WORKER_CONCURRENCY      = int(os.getenv("RULES_WORKER_CONCURRENCY", "10"))       # safe to run higher — cheap CPU-only work

# spare threads on top of the listener count, for any other asyncio.to_thread call in the app
LISTENER_THREAD_HEADROOM = int(os.getenv("LISTENER_THREAD_HEADROOM", "8"))

# save a reference to FastAPI's original startup/shutdown logic so we can still run it inside our wrapper below
_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def _lifespan_with_all_listeners(application):
    # This replaces the app's lifespan so that, in addition to normal FastAPI startup/shutdown,
    # all four listener types are started as background tasks and cleaned up together on shutdown.
    async with _original_lifespan(application):

        all_tasks: list[asyncio.Task] = []  # tracks every listener task so we can cancel them all later

        # Every run_*_listener parks a thread FOREVER via asyncio.to_thread, which uses the event
        # loop's DEFAULT ThreadPoolExecutor. That default is min(32, os.cpu_count() + 4), which is
        # 8 on this node, but we create 1 + EXTRACTION + RULES + 1 = 15 permanently-blocking
        # listener threads. The ones created last (rules workers 4-9 and the Teams listener) never
        # got a thread, so they logged "starting" and then silently never connected to Service Bus.
        # Size the executor to the listener count instead. These threads are I/O-blocked waiting on
        # Service Bus, not CPU-bound, so extra threads cost essentially nothing.
        listener_thread_count = 1 + EXTRACTION_WORKER_CONCURRENCY + RULES_WORKER_CONCURRENCY + 1
        logger.info(
            "Sizing thread pool for listeners | listeners=%d | max_workers=%d",
            listener_thread_count, listener_thread_count + LISTENER_THREAD_HEADROOM,
        )
        asyncio.get_running_loop().set_default_executor(
            ThreadPoolExecutor(
                max_workers=listener_thread_count + LISTENER_THREAD_HEADROOM,
                thread_name_prefix="sb-listener",
            )
        )

        if SERVICE_BUS_CONNECTION_STRING:  # skip starting any listeners if Service Bus isn't configured at all

            # ── Email listener — single worker, low message volume expected ──
            logger.info("Starting email listener | queue=%s", EMAIL_QUEUE_NAME)
            all_tasks.append(asyncio.create_task(
                run_listener(connection_string=SERVICE_BUS_CONNECTION_STRING, queue_name=EMAIL_QUEUE_NAME),
                name="email-listener",
            ))

            # ── Extraction listener pool — Stage 0 only, deliberately small concurrency ──
            # Azure Service Bus supports multiple "competing consumers" reading the same queue —
            # each message still only ever goes to exactly one of them.
            logger.info("Starting extraction listener pool | queue=%s | concurrency=%d",
                        EXTRACTION_STAGE_QUEUE_NAME, EXTRACTION_WORKER_CONCURRENCY)
            for i in range(EXTRACTION_WORKER_CONCURRENCY):
                all_tasks.append(asyncio.create_task(
                    run_extraction_listener(
                        connection_string=SERVICE_BUS_CONNECTION_STRING,
                        queue_name=EXTRACTION_STAGE_QUEUE_NAME,
                        worker_id=i,  # just for log correlation between workers, no functional difference
                    ),
                    name=f"extraction-listener-{i}",
                ))

            # ── Rules listener pool — Stage 1-6 only, safe to run with higher concurrency ──
            logger.info("Starting rules listener pool | queue=%s | concurrency=%d",
                        RULES_QUEUE_NAME, RULES_WORKER_CONCURRENCY)
            for i in range(RULES_WORKER_CONCURRENCY):
                all_tasks.append(asyncio.create_task(
                    run_rules_listener(
                        connection_string=SERVICE_BUS_CONNECTION_STRING,
                        queue_name=RULES_QUEUE_NAME,
                        worker_id=i,
                    ),
                    name=f"rules-listener-{i}",
                ))

            # ── Teams listener — separate queue, separate schema, unrelated to the two above ──
            logger.info("Starting Teams listener | queue=%s", TEAMS_QUEUE_NAME)
            all_tasks.append(asyncio.create_task(
                run_teams_listener(connection_string=SERVICE_BUS_CONNECTION_STRING, queue_name=TEAMS_QUEUE_NAME),
                name="teams-listener",
            ))
        else:
            # app still runs and serves HTTP requests fine — it just won't process any queue messages
            logger.warning("AZURE_SERVICE_BUS_CONNECTION_STRING not set — no listeners started.")

        try:
            yield  # control returns here while the app is up and all listener tasks run in the background
        finally:
            # this block runs on shutdown (e.g. container stopping) — make sure nothing is left hanging
            logger.info("Shutting down — cancelling %d listener task(s)...", len(all_tasks))
            for task in all_tasks:
                task.cancel()  # signals each listener's run_*_listener loop to exit via CancelledError
            if all_tasks:
                # waits for every task to actually finish cancelling before letting shutdown proceed
                results = await asyncio.gather(*all_tasks, return_exceptions=True)
                for task, result in zip(all_tasks, results):
                    # CancelledError here is expected/normal; anything else is worth knowing about
                    if isinstance(result, Exception) and not isinstance(result, asyncio.CancelledError):
                        logger.error("%s raised during shutdown: %s", task.get_name(), result)
            logger.info("All listeners shut down.")


# swap in our wrapped lifespan — the app still serves all its existing HTTP routes unchanged
app.router.lifespan_context = _lifespan_with_all_listeners
