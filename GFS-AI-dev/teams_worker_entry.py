# teams_worker_entry.py
# ─────────────────────────────────────────────────────────────────────────────
# Standalone entry point for the Teams summary worker.
# No FastAPI. No HTTP port. Just listens to ai-teams-queue forever.
#
# Start command: python teams_worker_entry.py
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("gfs.teams-entry")


async def main():
    from listener.teams_worker import run_teams_listener

    conn_str   = os.environ.get("AZURE_SERVICE_BUS_CONNECTION_STRING")
    queue_name = os.environ.get("AZURE_SERVICE_BUS_TEAMS_QUEUE_NAME","teams-ai-integration")

    if not conn_str:
        raise RuntimeError(
            "AZURE_SERVICE_BUS_CONNECTION_STRING is not set in environment."
        )

    logger.info("Teams worker starting | queue=%s", queue_name)
    await run_teams_listener(
        connection_string=conn_str,
        queue_name=queue_name,
    )


if __name__ == "__main__":
    asyncio.run(main())
