import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, Optional

import requests as _requests
from azure.servicebus import (
    AutoLockRenewer,
    ServiceBusClient,
    ServiceBusReceivedMessage,
    ServiceBusReceiver,
)
from azure.servicebus.exceptions import MessageAlreadySettled, MessageLockLostError
from pydantic import ValidationError

from extraction.spec_codes import sanitize_result_units
from listener.extraction_schema import StageApprovedMessage

logger = logging.getLogger("gfs.rules_listener")

# ── This listener handles Stage 1-6 approvals ONLY, on its own queue ──
# Split out from the extraction listener so fast rules-engine jobs (seconds) never wait
# behind slow Stage 0 extraction jobs (5-10 min) sharing the same consumer.
MESSAGE_WAIT_SECONDS      = 10
RECONNECT_WAIT_SECONDS    = 10
FASTAPI_BASE_URL: str     = os.getenv("FASTAPI_BASE_URL", "http://localhost:8000")
FASTAPI_CALL_TIMEOUT: int = int(os.getenv("FASTAPI_CALL_TIMEOUT", "3000"))
MAX_LOCK_RENEWAL_SECONDS  = 7200
APP_BASE_URL = os.getenv("APP_BASE_URL", "").rstrip("/")
_PERMANENT_HTTP_STATUSES: set[int] = {400, 415, 422}


def _stage_result_url(project_id: str) -> str:
    # every Stage 1-6 result (including Stage 6/Excel) goes to the same shared stage-result webhook
    return f"{APP_BASE_URL}/api/v1/proposals/webhooks/{project_id}/ai-stage-result"


async def run_rules_listener(connection_string: str, queue_name: str, worker_id: int = 0) -> None:
    # Entry point called by main.py — spawned multiple times for concurrency, and can run at a much
    # higher concurrency than the extraction listener since each job here is cheap (seconds, no external calls)
    logger.info("Rules listener starting | worker=%d | queue=%s", worker_id, queue_name)
    while True:
        try:
            await asyncio.to_thread(_blocking_loop, connection_string, queue_name, worker_id)
        except asyncio.CancelledError:
            logger.info("Rules listener [worker=%d] shutdown signal received.", worker_id)
            break
        except Exception as exc:
            logger.error("Rules listener [worker=%d] crashed: %s — reconnecting in %ds",
                         worker_id, exc, RECONNECT_WAIT_SECONDS, exc_info=True)
            await asyncio.sleep(RECONNECT_WAIT_SECONDS)


def _blocking_loop(connection_string: str, queue_name: str, worker_id: int) -> None:
    # Same pattern as the extraction listener: one connection, one receiver, loop forever
    with ServiceBusClient.from_connection_string(conn_str=connection_string, logging_enable=False) as client:
        with AutoLockRenewer() as renewer:
            with client.get_queue_receiver(queue_name=queue_name) as receiver:
                logger.info("Connected to Service Bus | worker=%d | queue=%s", worker_id, queue_name)
                while True:
                    messages = receiver.receive_messages(max_message_count=1, max_wait_time=MESSAGE_WAIT_SECONDS)
                    if not messages:
                        continue
                    for message in messages:
                        _process_single_message(receiver, renewer, message, worker_id)


def _process_single_message(receiver: ServiceBusReceiver, renewer: AutoLockRenewer,
                             message: ServiceBusReceivedMessage, worker_id: int) -> None:
    # Step 1: read the raw message bytes
    try:
        body = b"".join(message.body).decode("utf-8")
    except Exception as exc:
        logger.error("[worker=%d] Cannot read message body — abandoning | error=%s", worker_id, exc)
        _safe_abandon(receiver, message)
        return

    # Step 2: parse JSON
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        logger.error("[worker=%d] Invalid JSON — dead lettering | error=%s", worker_id, exc)
        _safe_dead_letter(receiver, message, "InvalidJSON", str(exc))
        return

    # Step 3: validate against the Stage 1-6 schema — this queue never carries Stage 0 messages
    try:
        parsed = StageApprovedMessage(**data)
    except ValidationError as exc:
        # if this fires, a publisher somewhere is sending to the wrong queue
        logger.error("[worker=%d] Not a valid stage-approval message — dead lettering | error=%s", worker_id, exc)
        _safe_dead_letter(receiver, message, "ValidationFailed", str(exc))
        return

    # no correlationId on these messages — fall back to idempotencyKey, or build one from project+trigger
    log_id = parsed.idempotencyKey or f"{parsed.projectId}:{parsed.trigger}"
    logger.info("[worker=%d] Message validated | log_id=%s | trigger=%s", worker_id, log_id, parsed.trigger)

    # Step 4: keep the message lock alive while processing (usually only seconds here, but cheap insurance)
    try:
        renewer.register(receiver=receiver, renewable=message, max_lock_renewal_duration=MAX_LOCK_RENEWAL_SECONDS)
    except Exception as exc:
        logger.warning("[worker=%d] Lock renewal failed — proceeding | log_id=%s | error=%s", worker_id, log_id, exc)

    # Step 5: run the rules engine for this stage via FastAPI, then push the result to the backend
    pipeline_succeeded, permanent_failure, failure_reason = _handle_stage_approval(parsed, log_id)

    # Step 6: settle the message based on what happened
    if pipeline_succeeded:
        _safe_complete(receiver, message, log_id)
    elif permanent_failure:
        _safe_dead_letter(receiver, message, "PermanentFailure", failure_reason or "Permanent failure")
    else:
        _safe_abandon(receiver, message)


def _handle_stage_approval(parsed: StageApprovedMessage, log_id: str) -> tuple[bool, bool, Optional[str]]:
    # Orchestrates a single Stage 1-6 approval: call FastAPI's rules engine, then post the result.
    project_id = parsed.projectId
    target_stage = parsed.targetStage  # an int from 2 to 6 or "EXCEL" (Stage 6 Excel cell mapping)

    if str(target_stage).upper() == "EXCEL":
        target_stage_num = 6
        fastapi_trigger = "STAGE_5_APPROVED_START_6"
    else:
        target_stage_num = int(target_stage)
        fastapi_trigger = f"STAGE_{target_stage_num - 1}_APPROVED_START_{target_stage_num}"

    fastapi_request = {
        "message_id": log_id,
        "project_id": project_id,
        "trigger": fastapi_trigger,
        "unified_doc": None,  # sending None forces FastAPI to load the current doc from MongoDB itself
        "idempotency_key": parsed.idempotencyKey,
    }

    logger.info("Calling FastAPI /process-payload | log_id=%s | project_id=%s | trigger=%s",
                log_id, project_id, fastapi_trigger)

    # this call is expected to be fast (seconds) — rules engine is pure CPU/logic, no external API calls
    fastapi_response, error = _call_fastapi(fastapi_request, log_id)
    if error is not None:
        return error

    checked = _check_fastapi_response(fastapi_response, log_id)
    if checked is not None:
        return checked

    try:
        fastapi_result = fastapi_response.json()
    except Exception as exc:
        return False, False, f"Invalid JSON from FastAPI: {exc}"

    stage_status = fastapi_result.get("status", "UNKNOWN")
    stage_output = fastapi_result.get("output")

    if stage_status == "FAILED":
        # something went wrong in the rules engine logic itself — worth retrying in case it's transient
        return False, False, fastapi_result.get("error", "Unknown pipeline error")

    if stage_status == "NO_DOCUMENTS":
        # e.g. the unified doc wasn't found in MongoDB for this project — retrying won't fix a missing doc
        return False, True, fastapi_result.get("error", "Unified document not found")

    if stage_output is None:
        return False, False, "FastAPI output was null"

    logger.info("Stage %s complete | log_id=%s", target_stage_num, log_id)
    # push the computed fields (or, for Stage 6, the Excel cell dict) to the backend
    return _send_stage_result(project_id, log_id, target_stage_num, "SUCCESS", stage_output)


def _call_fastapi(fastapi_request: Dict[str, Any], log_id: str):
    # same network-failure handling pattern as the extraction listener
    try:
        t_start = time.monotonic()
        fastapi_response = _requests.post(f"{FASTAPI_BASE_URL}/process-payload",
                                           json=fastapi_request, timeout=FASTAPI_CALL_TIMEOUT)
        logger.info("FastAPI responded | log_id=%s | status=%d | duration=%.2fs",
                    log_id, fastapi_response.status_code, time.monotonic() - t_start)
        return fastapi_response, None
    except _requests.Timeout:
        return None, (False, False, f"FastAPI timeout after {FASTAPI_CALL_TIMEOUT}s")
    except _requests.ConnectionError as exc:
        return None, (False, False, f"FastAPI connection error: {exc}")


def _check_fastapi_response(fastapi_response, log_id: str):
    # same permanent-vs-transient classification as the extraction listener
    if fastapi_response.status_code in _PERMANENT_HTTP_STATUSES:
        return False, True, f"HTTP {fastapi_response.status_code}: {_safe_body(fastapi_response)}"
    if fastapi_response.status_code != 200:
        return False, False, f"HTTP {fastapi_response.status_code}: {_safe_body(fastapi_response)}"
    return None


def _safe_body(response) -> str:
    try:
        return response.json().get("detail", response.text)
    except Exception:
        return response.text


def _get_auth_headers(log_id: str) -> Dict[str, str]:
    # same auth pattern as the extraction listener — falls back to unauthenticated rather than hard-failing
    try:
        from services.auth import get_access_token
        return {"Authorization": f"Bearer {get_access_token()}", "Content-Type": "application/json"}
    except Exception as exc:
        logger.warning("No auth token — sending unauthenticated | log_id=%s | error=%s", log_id, exc)
        return {"Content-Type": "application/json"}


def _send_stage_result(project_id: str, log_id: str, stage: int, status: str,
                        fields_to_show: Dict[str, Any]) -> tuple[bool, bool, Optional[str]]:
    # posts the stage's computed fields to the shared ai-stage-result webhook on the backend
    url = _stage_result_url(project_id)
    changed = sanitize_result_units(fields_to_show)
    if changed:
        logger.info("Normalized %d unit spec value(s) to backend codes | log_id=%s", changed, log_id)
    body = {"stage": stage, "status": status, "fields_to_show": fields_to_show}
    logger.info("Sending Stage %s result | log_id=%s | url=%s", stage, log_id, url)
    return _post_result(url, body, log_id)


def _post_result(url: str, body: Dict[str, Any], log_id: str) -> tuple[bool, bool, Optional[str]]:
    headers = _get_auth_headers(log_id)
    try:
        response = _requests.post(url, json=body, headers=headers, timeout=30)
        logger.info("Result POST response | log_id=%s | status=%d", log_id, response.status_code)
        if response.status_code in (200, 201):
            return True, False, None
        if response.status_code in _PERMANENT_HTTP_STATUSES:
            return False, True, f"Result POST HTTP {response.status_code}: {response.text}"
        return False, False, f"Result POST HTTP {response.status_code}: {response.text}"
    except _requests.Timeout:
        return False, False, "Result POST timeout"
    except _requests.ConnectionError as exc:
        return False, False, f"Result POST connection error: {exc}"
    except Exception as exc:
        logger.exception("Result POST failed | log_id=%s", log_id)
        return False, False, str(exc)


# ── Settlement helpers — identical semantics to the extraction listener ──────────────────
def _safe_complete(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage, log_id: str) -> None:
    try:
        receiver.complete_message(message)
        logger.info("Message completed | log_id=%s", log_id)
    except MessageLockLostError:
        logger.error("Lock expired before complete — will re-deliver | log_id=%s", log_id)
    except MessageAlreadySettled:
        pass
    except Exception as exc:
        logger.error("complete_message failed | log_id=%s | error=%s", log_id, exc)


def _safe_abandon(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage) -> None:
    try:
        receiver.abandon_message(message)
    except MessageAlreadySettled:
        pass
    except Exception as exc:
        logger.error("abandon_message failed: %s", exc)


def _safe_dead_letter(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage, reason: str, description: str) -> None:
    try:
        receiver.dead_letter_message(message, reason=reason, error_description=description)
        logger.info("Message dead-lettered | reason=%s", reason)
    except MessageAlreadySettled:
        pass
    except Exception as exc:
        logger.error("dead_letter_message failed: %s", exc)