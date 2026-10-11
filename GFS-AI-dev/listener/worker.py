# listener/worker.py
# ─────────────────────────────────────────────────────────────────────────────
# Azure Service Bus listener for EMAIL_PROPOSAL messages only.
#
#   EMAIL_PROPOSAL
#       → classify_service_bus_message()
#       → send_classifier_result()          (POST /api/v1/outlook/ai-result)
#       → complete / abandon / dead-letter
#
######## NEW ########
# NEW_PROJECT / DOCUMENT_EXTRACTION / STAGE_N_APPROVED_START_N+1 handling
# has moved to listener/extraction_worker.py, reading from a separate
# queue (AZURE_SERVICE_BUS_EXTRACTION_STAGE_QUEUE_NAME). Per team decision,
# this listener is email-only again. If a non-EMAIL_PROPOSAL jobType shows
# up on this queue it's a misrouted message and gets dead-lettered by the
# "else" branch below — it does not get processed here.
######## END NEW ########
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import json
import logging
from typing import Any, Dict, Optional

from azure.servicebus import (
    AutoLockRenewer,
    ServiceBusClient,
    ServiceBusReceivedMessage,
    ServiceBusReceiver,
)
from azure.servicebus.exceptions import MessageAlreadySettled, MessageLockLostError
from pydantic import ValidationError

from classifier.classifier import (
    build_classifier_webhook_payload,
    classify_service_bus_message,
)
from listener.message_schema import IncomingMessage
from services.backend_webhook import send_classifier_result

logger = logging.getLogger("gfs.listener")

# ── Configuration ─────────────────────────────────────────────────────────────

MESSAGE_WAIT_SECONDS      = 10
RECONNECT_WAIT_SECONDS    = 10
MAX_LOCK_RENEWAL_SECONDS  = 7200  # 2 hours
MAX_CONCURRENT_MESSAGES   = 3     # Limit active threads to prevent OOM / rate limit errors

_PERMANENT_HTTP_STATUSES: set[int] = {400, 415, 422}


# ── Async entry point ─────────────────────────────────────────────────────────

async def run_listener(
    connection_string: str,
    queue_name: str,
) -> None:
    logger.info(
        "Email listener starting | queue=%s",
        queue_name,
    )

    while True:
        try:
            await asyncio.to_thread(
                _blocking_loop,
                connection_string,
                queue_name,
            )
        except asyncio.CancelledError:
            logger.info("Email listener received shutdown signal. Exiting cleanly.")
            break
        except Exception as exc:
            logger.error(
                "Email listener loop exited unexpectedly: %s — reconnecting in %ds",
                exc,
                RECONNECT_WAIT_SECONDS,
                exc_info=True,
            )
            await asyncio.sleep(RECONNECT_WAIT_SECONDS)


# ── Blocking receive loop ─────────────────────────────────────────────────────

def _blocking_loop(connection_string: str, queue_name: str) -> None:
    import threading
    import time
    
    semaphore = threading.Semaphore(MAX_CONCURRENT_MESSAGES)
    
    with ServiceBusClient.from_connection_string(
        conn_str=connection_string,
        logging_enable=False,
    ) as client:
        with AutoLockRenewer() as renewer:
            with client.get_queue_receiver(queue_name=queue_name) as receiver:

                logger.info("Connected to Service Bus | queue=%s | concurrency_limit=%d", queue_name, MAX_CONCURRENT_MESSAGES)

                while True:
                    # Block until a worker slot is free
                    semaphore.acquire()
                    
                    try:
                        messages = receiver.receive_messages(
                            max_message_count=1,
                            max_wait_time=MESSAGE_WAIT_SECONDS,
                        )
                    except Exception as e:
                        logger.error("Error receiving messages: %s — retrying in 2 seconds", e)
                        semaphore.release()
                        time.sleep(2)
                        continue
                        
                    if not messages:
                        semaphore.release()
                        continue
                        
                    message = messages[0]
                    
                    def worker_task(msg):
                        try:
                            _process_single_message(
                                receiver=receiver,
                                renewer=renewer,
                                message=msg,
                            )
                        finally:
                            semaphore.release()
                            
                    threading.Thread(
                        target=worker_task,
                        args=(message,),
                        daemon=True
                    ).start()


# ── Single message handler ────────────────────────────────────────────────────

def _process_single_message(
    receiver: ServiceBusReceiver,
    renewer:  AutoLockRenewer,
    message:  ServiceBusReceivedMessage,
) -> None:
    # ── Step 1: Read body ─────────────────────────────────────────────────────
    try:
        body = b"".join(message.body).decode("utf-8")
    except Exception as exc:
        logger.error("Cannot read message body — abandoning | error=%s", exc)
        _safe_abandon(receiver, message)
        return

    # ── Step 2: Parse JSON ────────────────────────────────────────────────────
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        logger.error(
            "Invalid JSON — dead lettering | error=%s | body=%r", exc, body
        )
        _safe_dead_letter(receiver, message, "InvalidJSON", str(exc))
        return

    # ── Step 3: Validate schema ───────────────────────────────────────────────
    try:
        parsed = IncomingMessage(**data)
    except ValidationError as exc:
        logger.error(
            "Schema validation failed — dead lettering | error=%s", exc
        )
        _safe_dead_letter(receiver, message, "ValidationFailed", str(exc))
        return

    logger.info(
        "Message validated | correlationId=%s | jobType=%s",
        parsed.correlationId,
        parsed.jobType,
    )

    # ── Step 4: Register lock renewal ─────────────────────────────────────────
    try:
        renewer.register(
            receiver=receiver,
            renewable=message,
            max_lock_renewal_duration=MAX_LOCK_RENEWAL_SECONDS,
        )
        logger.debug(
            "Lock renewal registered | correlationId=%s", parsed.correlationId
        )
    except Exception as exc:
        logger.warning(
            "Lock renewal registration failed — proceeding | "
            "correlationId=%s | error=%s",
            parsed.correlationId,
            exc,
        )

    # ── Step 5: Route on jobType ──────────────────────────────────────────────
    pipeline_succeeded = False
    permanent_failure  = False
    failure_reason: Optional[str] = None

    if parsed.jobType == "EMAIL_PROPOSAL":
        pipeline_succeeded, permanent_failure, failure_reason = _handle_email_proposal(
            data=data,
            correlation_id=parsed.correlationId,
        )

    else:
        # Unknown/misrouted jobType — dead-letter, no point retrying
        logger.error(
            "Unknown jobType on email queue — dead lettering | jobType=%s | correlationId=%s",
            parsed.jobType,
            parsed.correlationId,
        )
        _safe_dead_letter(
            receiver,
            message,
            reason="UnknownJobType",
            description=f"No handler for jobType={parsed.jobType!r} on the email queue",
        )
        return

    # ── Step 6: Settle ────────────────────────────────────────────────────────
    if pipeline_succeeded:
        _safe_complete(receiver, message, parsed.correlationId)
    elif permanent_failure:
        _safe_dead_letter(
            receiver,
            message,
            reason="PermanentFailure",
            description=failure_reason or "Permanent failure",
        )
    else:
        _safe_abandon(receiver, message)


# ── Handler: EMAIL_PROPOSAL ───────────────────────────────────────────────────

def _handle_email_proposal(
    data:           Dict[str, Any],
    correlation_id: str,
) -> tuple[bool, bool, Optional[str]]:
    """
    Existing email classification flow — unchanged from before.
    Returns (pipeline_succeeded, permanent_failure, failure_reason).
    """
    try:
        logger.info(
            "Running classifier | correlationId=%s", correlation_id
        )

        classification_result = classify_service_bus_message(data)

        logger.info(
            "Classifier complete | correlationId=%s | classification=%s | confidence=%.2f",
            correlation_id,
            classification_result["classification"],
            classification_result["confidence"],
        )

        webhook_payload = build_classifier_webhook_payload(data, classification_result)

        logger.info(
            "Sending classifier result | correlationId=%s", correlation_id
        )

        response = send_classifier_result(webhook_payload)

        logger.info(
            "Backend responded | correlationId=%s | status=%d",
            correlation_id,
            response.status_code,
        )

        if response.status_code == 200:
            return True, False, None

        if response.status_code in _PERMANENT_HTTP_STATUSES:
            logger.error(
                "Permanent backend failure | correlationId=%s | status=%d | body=%s",
                correlation_id,
                response.status_code,
                response.text,
            )
            return False, True, response.text

        logger.error(
            "Transient backend failure | correlationId=%s | status=%d | body=%s",
            correlation_id,
            response.status_code,
            response.text,
        )
        return False, False, response.text

    except Exception as exc:
        logger.exception(
            "Classifier/backend webhook failed | correlationId=%s",
            correlation_id,
        )
        return False, False, str(exc)


# ── Settlement helpers ────────────────────────────────────────────────────────

def _safe_complete(
    receiver:       ServiceBusReceiver,
    message:        ServiceBusReceivedMessage,
    correlation_id: str,
) -> None:
    try:
        receiver.complete_message(message)
        logger.info("Message completed | correlationId=%s", correlation_id)
    except MessageLockLostError:
        logger.error(
            "complete_message failed — lock expired | correlationId=%s | "
            "pipeline succeeded but Azure not notified — message will re-deliver",
            correlation_id,
        )
    except MessageAlreadySettled:
        logger.warning(
            "Message already settled | correlationId=%s", correlation_id
        )
    except Exception as exc:
        logger.error(
            "complete_message failed | correlationId=%s | error=%s",
            correlation_id,
            exc,
        )


def _safe_abandon(
    receiver: ServiceBusReceiver,
    message:  ServiceBusReceivedMessage,
) -> None:
    try:
        receiver.abandon_message(message)
        logger.info("Message abandoned — will be re-delivered")
    except MessageAlreadySettled:
        logger.warning("Abandon called on already-settled message — ignoring")
    except Exception as exc:
        logger.error("abandon_message failed: %s", exc)


def _safe_dead_letter(
    receiver:    ServiceBusReceiver,
    message:     ServiceBusReceivedMessage,
    reason:      str,
    description: str,
) -> None:
    try:
        receiver.dead_letter_message(
            message,
            reason=reason,
            error_description=description,
        )
        logger.info("Message dead-lettered | reason=%s", reason)
    except MessageAlreadySettled:
        logger.warning(
            "Dead-letter called on already-settled message — ignoring"
        )
    except Exception as exc:
        logger.error("dead_letter_message failed: %s", exc)