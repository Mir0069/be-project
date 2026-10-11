import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
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
from extraction.zoho_note_summarizer import summarize_zoho_notes
from listener.extraction_schema import Stage0ExtractionMessage
from utils.io_utils import context_as_dict, format_context_to_str

logger = logging.getLogger("gfs.extraction_listener")

# ── This listener handles Stage 0 (BEGIN_EXTRACTION) and PROJECT_CRM_CONTEXT messages — Stage 1-6 lives in rules_worker.py ──
MESSAGE_WAIT_SECONDS      = 10                                      # how long receive_messages() blocks waiting for a new message
RECONNECT_WAIT_SECONDS    = 10                                      # pause before retrying after an unexpected crash
FASTAPI_BASE_URL: str     = os.getenv("FASTAPI_BASE_URL", "http://localhost:8000")   # where /process-payload lives
FASTAPI_CALL_TIMEOUT: int = int(os.getenv("FASTAPI_CALL_TIMEOUT", "3000"))           # generous — extraction can take minutes
MAX_LOCK_RENEWAL_SECONDS  = 7200  # 2 hours — keeps the Service Bus lock alive during long (5-10 min) extractions
APP_BASE_URL = os.getenv("APP_BASE_URL", "").rstrip("/")            # backend base URL, used to build result endpoint URLs
_PERMANENT_HTTP_STATUSES: set[int] = {400, 415, 422}                # these HTTP codes mean "never retry", others mean "try again"


def _stage0_result_url(project_id: str) -> str:
    # Stage 0 posts its result to its own dedicated endpoint (not the shared Stage 1-6 webhook)
    return f"{APP_BASE_URL}/api/v1/proposals/{project_id}/stages/0/run"


# Dedup guard for CRM context — prevents triple-processing from duplicate messages
import time as _time
_crm_dedup_cache: dict = {}  # "project_id:snapshot hash" -> timestamp
_CRM_DEDUP_WINDOW = 60  # seconds


def _crm_payload_fingerprint(payload: Any) -> str:
    """Stable hash of a CRM snapshot, so dedup tells identical messages from new edits."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def _is_duplicate_crm_snapshot(project_id: str, payload: Any, now: float) -> bool:
    """True when this exact snapshot was handled inside the window; records it otherwise."""
    for key, seen in list(_crm_dedup_cache.items()):
        if now - seen >= _CRM_DEDUP_WINDOW:
            del _crm_dedup_cache[key]
    key = f"{project_id}:{_crm_payload_fingerprint(payload)}"
    if key in _crm_dedup_cache:
        return True
    _crm_dedup_cache[key] = now
    return False

def _crm_context_update_url(project_id: str) -> str:
    # PROJECT_CRM_CONTEXT updates project description via the project workspace endpoint
    return f"{APP_BASE_URL}/api/v1/project-workspace/{project_id}"


async def run_extraction_listener(connection_string: str, queue_name: str, worker_id: int = 0) -> None:
    # Entry point called by main.py — spawned multiple times (different worker_id) for concurrency
    logger.info("Extraction listener starting | worker=%d | queue=%s", worker_id, queue_name)
    while True:  # outer loop: if the connection drops or something crashes, reconnect instead of dying
        try:
            # the Service Bus SDK here is synchronous, so run the actual loop in a worker thread
            await asyncio.to_thread(_blocking_loop, connection_string, queue_name, worker_id)
        except asyncio.CancelledError:
            # this means main.py is shutting the app down — exit cleanly, don't treat as an error
            logger.info("Extraction listener [worker=%d] shutdown signal received.", worker_id)
            break
        except Exception as exc:
            # anything else is unexpected — log it, wait, and try to reconnect rather than crashing the process
            logger.error("Extraction listener [worker=%d] crashed: %s — reconnecting in %ds",
                         worker_id, exc, RECONNECT_WAIT_SECONDS, exc_info=True)
            await asyncio.sleep(RECONNECT_WAIT_SECONDS)


def _blocking_loop(connection_string: str, queue_name: str, worker_id: int) -> None:
    # Opens one Service Bus connection + one receiver, then loops forever pulling messages one at a time
    with ServiceBusClient.from_connection_string(conn_str=connection_string, logging_enable=False) as client:
        with AutoLockRenewer() as renewer:  # keeps message locks alive in the background so long jobs don't time out
            with client.get_queue_receiver(queue_name=queue_name) as receiver:
                logger.info("Connected to Service Bus | worker=%d | queue=%s", worker_id, queue_name)
                while True:
                    # pulls at most 1 message, waits up to MESSAGE_WAIT_SECONDS if the queue is empty
                    messages = receiver.receive_messages(max_message_count=1, max_wait_time=MESSAGE_WAIT_SECONDS)
                    if not messages:
                        continue  # queue was empty for the whole wait window — just poll again
                    for message in messages:
                        _process_single_message(receiver, renewer, message, worker_id)


def _process_single_message(receiver: ServiceBusReceiver, renewer: AutoLockRenewer,
                             message: ServiceBusReceivedMessage, worker_id: int) -> None:
    # Step 1: read the raw message bytes off the wire
    try:
        body = b"".join(message.body).decode("utf-8")
    except Exception as exc:
        # message body itself is unreadable — can't even inspect it, so let it retry rather than dead-lettering blind
        logger.error("[worker=%d] Cannot read message body — abandoning | error=%s", worker_id, exc)
        _safe_abandon(receiver, message)
        return

    # Step 2: parse the JSON
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        # malformed JSON will never fix itself on retry — dead-letter it immediately
        logger.error("[worker=%d] Invalid JSON — dead lettering | error=%s", worker_id, exc)
        _safe_dead_letter(receiver, message, "InvalidJSON", str(exc))
        return

    # Step 3: check if this is a PROJECT_CRM_CONTEXT message before Stage 0 validation
    if data.get("trigger") == "PROJECT_CRM_CONTEXT":
        _handle_crm_context(receiver, renewer, message, data, worker_id)
        return

    # Step 4: validate the JSON matches the Stage 0 schema exactly
    try:
        parsed = Stage0ExtractionMessage(**data)
    except ValidationError as exc:
        # this queue only ever carries Stage 0 messages — anything else means a publisher config bug upstream
        logger.error("[worker=%d] Not a valid Stage 0 message — dead lettering | error=%s", worker_id, exc)
        _safe_dead_letter(receiver, message, "ValidationFailed", str(exc))
        return

    # correlationId is the unique ID tying this message to logs/traces across the whole pipeline
    log_id = parsed.correlationId
    logger.info("[worker=%d] Message validated | log_id=%s | trigger=%s", worker_id, log_id, parsed.trigger)

    # Step 5: tell Azure to keep renewing this message's lock while we process it (can take minutes)
    try:
        renewer.register(receiver=receiver, renewable=message, max_lock_renewal_duration=MAX_LOCK_RENEWAL_SECONDS)
    except Exception as exc:
        # not fatal on its own — worst case the lock eventually expires and Azure redelivers the message later
        logger.warning("[worker=%d] Lock renewal failed — proceeding | log_id=%s | error=%s", worker_id, log_id, exc)

    # Step 6: actually run the extraction pipeline via FastAPI, then push the result to the backend
    pipeline_succeeded, permanent_failure, failure_reason = _handle_stage0(parsed, log_id)

    # Step 7: tell Service Bus what happened to this message
    if pipeline_succeeded:
        _safe_complete(receiver, message, log_id)          # done — remove from queue permanently
    elif permanent_failure:
        _safe_dead_letter(receiver, message, "PermanentFailure", failure_reason or "Permanent failure")  # never retry this
    else:
        _safe_abandon(receiver, message)  # transient issue — put it back on the queue for another attempt


def _handle_crm_context(receiver: ServiceBusReceiver, renewer: AutoLockRenewer,
                         message: ServiceBusReceivedMessage, data: Dict[str, Any], worker_id: int) -> None:
    # Handle PROJECT_CRM_CONTEXT messages — update project description and notes from Zoho
    project_id = data.get("projectId")
    if not project_id:
        logger.error("[worker=%d] PROJECT_CRM_CONTEXT missing projectId — dead lettering", worker_id)
        _safe_dead_letter(receiver, message, "MissingProjectId", "projectId field is required")
        return

    payload = data.get("payload", {})

    # Dedup: skip the same snapshot seen within the last 60s. Keyed by content,
    # so a second, different note edit inside the window is still processed.
    if _is_duplicate_crm_snapshot(project_id, payload, _time.monotonic()):
        logger.info("[worker=%d] CRM context dedup — project_id=%s same snapshot within %ds, skipping",
                    worker_id, project_id, _CRM_DEDUP_WINDOW)
        _safe_complete(receiver, message, f"crm-context-dedup:{project_id}")
        return
    description = payload.get("description")  # can be null
    notes = payload.get("notes", [])  # can be empty array
    emitted_at = data.get("emittedAt")

    logger.info("[worker=%d] Processing PROJECT_CRM_CONTEXT | project_id=%s | description=%s | notes=%d",
                worker_id, project_id, "present" if description else "null", len(notes))

    # Process the Zoho CRM context using the existing project/context update flow
    pipeline_succeeded, permanent_failure, failure_reason = _handle_crm_context_update(
        project_id, description, notes, emitted_at, worker_id
    )

    # Settle the message based on processing result
    if pipeline_succeeded:
        _safe_complete(receiver, message, f"crm-context:{project_id}")
    elif permanent_failure:
        _safe_dead_letter(receiver, message, "PermanentFailure", failure_reason or "Permanent failure")
    else:
        _safe_abandon(receiver, message)


def _handle_crm_context_update(project_id: str, description: Optional[str], 
                                notes: list, emitted_at: Optional[str], 
                                worker_id: int) -> tuple[bool, bool, Optional[str]]:
    # Update project description via backend API
    # Notes are for AI context and are fetched from Zoho as needed, not stored locally
    url = _crm_context_update_url(project_id)
    
    # Build the update payload
    update_body = {}
    if description is not None:
        update_body["description"] = description
    
    logger.info("[worker=%d] Updating project description | project_id=%s | description_present=%s | notes_count=%d",
                worker_id, project_id, "yes" if description else "no", len(notes))
    
    # Log note details for debugging (notes are for AI context, not local storage)
    for i, note in enumerate(notes):
        logger.debug("[worker=%d] Note %d | author=%s | email=%s | created=%s | content_preview=%s",
                     worker_id, i, note.get("author"), note.get("authorEmail"), 
                     note.get("createdAt"), note.get("content", "")[:50])

    # Try to update backend, but don't fail the message if it doesn't work
    # Backend team owns the project workspace endpoint — AI just logs and moves on
    if update_body:
        headers = _get_auth_headers(f"crm-context:{project_id}")
        try:
            response = _requests.patch(url, json=update_body, headers=headers, timeout=30)
            logger.info("[worker=%d] CRM context update response | project_id=%s | status=%d",
                        worker_id, project_id, response.status_code)
            if response.status_code not in (200, 201):
                logger.warning("[worker=%d] CRM context backend update returned %d — continuing (backend team owns this endpoint)",
                              worker_id, response.status_code)
        except Exception as exc:
            logger.warning("[worker=%d] CRM context backend update failed: %s — continuing", worker_id, exc)

    # The note is context only until the estimator approves it: the approval
    # sends BEGIN_EXTRACTION, and that run applies it and attaches its summary.
    # Patching here changed the proposal before anyone approved the note.
    logger.info("[worker=%d] CRM context noted; changes apply after approval | project_id=%s | description=%s | notes=%d",
                worker_id, project_id, "yes" if update_body.get("description") else "no", len(notes))
    return True, False, None


def _handle_stage0(parsed: Stage0ExtractionMessage, log_id: str) -> tuple[bool, bool, Optional[str]]:
    # Orchestrates Stage 0: call FastAPI to run extraction, then post the result to the backend.
    # Returns (succeeded, is_permanent_failure, failure_reason) — used by the caller to settle the message.
    project_id = parsed.projectId

    raw_context = getattr(parsed.payload, "context", None)
    context_str = format_context_to_str(raw_context)

    # builds the request body FastAPI's /process-payload endpoint expects for BEGIN_EXTRACTION
    fastapi_request = {
        "message_id": parsed.correlationId,
        "project_id": project_id,
        "trigger": "BEGIN_EXTRACTION",
        "subject": parsed.payload.subject,
        "sender": parsed.payload.sender,
        "context": context_str,
        "documents": [
            # each document carries a fresh, short-lived SAS URL — FastAPI downloads directly from these
            {"documentId": d.documentId, "originalName": d.originalName, "blobUrl": d.blobUrl}
            for d in (parsed.payload.documents or [])
        ],
    }

    logger.info("Calling FastAPI /process-payload | log_id=%s | project_id=%s | docs=%d",
                log_id, project_id, len(parsed.payload.documents or []))

    # this call can take 5-10 minutes — FASTAPI_CALL_TIMEOUT must be generous enough to allow that
    fastapi_response, error = _call_fastapi(fastapi_request, log_id)
    if error is not None:
        return error  # FastAPI was unreachable or timed out — already shaped as (False, permanent, reason)

    # translates the HTTP status code into permanent-vs-transient failure, or None if it's a normal 200
    checked = _check_fastapi_response(fastapi_response, log_id)
    if checked is not None:
        return checked

    try:
        fastapi_result = fastapi_response.json()
    except Exception as exc:
        # got a 200 but the body wasn't valid JSON — treat as transient, something's wrong on the FastAPI side
        return False, False, f"Invalid JSON from FastAPI: {exc}"

    extraction_status = fastapi_result.get("status", "UNKNOWN")
    extraction_output = fastapi_result.get("output")

    if extraction_status == "FAILED":
        # extraction pipeline itself threw an error — could be a flaky external API call, worth retrying
        return False, False, fastapi_result.get("error", "Unknown extraction error")

    if extraction_status == "NO_DOCUMENTS":
        # If context is present in payload, this was a text-only retrigger — do NOT dead letter!
        if getattr(parsed.payload, "context", None):
            if extraction_output is not None:
                logger.info("Stage 0 extraction complete with text-only context | log_id=%s", log_id)
                _attach_zoho_note_summary(extraction_output, raw_context, log_id)
                return _send_stage0_result(project_id, log_id, "EXTRACTION_DONE", extraction_output)

            error_text = fastapi_result.get("error", "NO_DOCUMENTS with no output")
            logger.warning("Stage 0 produced no output | log_id=%s | error=%s", log_id, error_text)
            return False, False, error_text
        return False, True, fastapi_result.get("error", "No documents found")

    if extraction_output is None:
        # status looked fine but there's no actual data — treat conservatively as retryable
        return False, False, "FastAPI output was null"

    logger.info("Stage 0 extraction complete | log_id=%s", log_id)
    _attach_zoho_note_summary(extraction_output, raw_context, log_id)
    # extraction succeeded — now push the extracted fields to the backend so the estimator can review them
    return _send_stage0_result(project_id, log_id, "EXTRACTION_DONE", extraction_output)


def _call_fastapi(fastapi_request: Dict[str, Any], log_id: str):
    # Makes the actual HTTP call to FastAPI's /process-payload. Network-level failures are handled here;
    # HTTP-status-level failures (4xx/5xx) are handled separately by _check_fastapi_response.
    try:
        t_start = time.monotonic()
        fastapi_response = _requests.post(f"{FASTAPI_BASE_URL}/process-payload",
                                           json=fastapi_request, timeout=FASTAPI_CALL_TIMEOUT)
        logger.info("FastAPI responded | log_id=%s | status=%d | duration=%.2fs",
                    log_id, fastapi_response.status_code, time.monotonic() - t_start)
        return fastapi_response, None
    except _requests.Timeout:
        # took longer than FASTAPI_CALL_TIMEOUT — treat as transient, worth retrying
        return None, (False, False, f"FastAPI timeout after {FASTAPI_CALL_TIMEOUT}s")
    except _requests.ConnectionError as exc:
        # FastAPI process is down/unreachable — also transient, it may come back up
        return None, (False, False, f"FastAPI connection error: {exc}")


def _check_fastapi_response(fastapi_response, log_id: str):
    # Converts an HTTP status code into a settlement decision.
    # Returns None if the caller should proceed to parse the response body (i.e. status was 200).
    if fastapi_response.status_code in _PERMANENT_HTTP_STATUSES:
        # 400/415/422 mean the request itself was invalid — retrying with the same payload will always fail
        return False, True, f"HTTP {fastapi_response.status_code}: {_safe_body(fastapi_response)}"
    if fastapi_response.status_code != 200:
        # anything else non-200 (e.g. 500) is assumed transient — server hiccup, safe to retry
        return False, False, f"HTTP {fastapi_response.status_code}: {_safe_body(fastapi_response)}"
    return None  # 200 OK — nothing wrong at the HTTP level, caller should now parse the JSON body


def _safe_body(response) -> str:
    # best-effort extraction of a useful error message from the response, falls back to raw text
    try:
        return response.json().get("detail", response.text)
    except Exception:
        return response.text


def _get_auth_headers(log_id: str) -> Dict[str, str]:
    # Fetches a bearer token for calling the backend. If auth is unavailable, sends the request
    # unauthenticated rather than failing outright — the backend may or may not actually enforce auth.
    try:
        from services.auth import get_access_token
        return {"Authorization": f"Bearer {get_access_token()}", "Content-Type": "application/json"}
    except Exception as exc:
        logger.warning("No auth token — sending unauthenticated | log_id=%s | error=%s", log_id, exc)
        return {"Content-Type": "application/json"}


def _attach_zoho_note_summary(output: Any, raw_context: Any, log_id: str) -> None:
    """After an approved Zoho note, attach the AI's summary of it as stage_1.crm_note_summary."""
    ctx = context_as_dict(raw_context) or {}
    is_zoho = (ctx.get("triggerSource") or "").upper() == "ZOHO" or log_id.startswith("zohoCrmContext:")
    notes, description = ctx.get("zohoNotes") or [], ctx.get("zohoDescription")
    if not is_zoho or not isinstance(output, dict) or not (notes or description):
        return
    try:
        result = summarize_zoho_notes(notes, description)
    except Exception as exc:
        logger.warning("Zoho AI summary failed | log_id=%s | error=%s", log_id, exc)
        return
    if not (result.get("ok") and result.get("summary")):
        return
    output.setdefault("stage_1", {})["crm_note_summary"] = {
        "value": result["summary"],
        "confidence": float(result.get("confidence") or 0.8),
        "reasoning": [result["summary"]],
        "flags": [],
        "status": "NEEDS_REVIEW",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": "ai_zoho_summary",
    }


def _send_stage0_result(project_id: str, log_id: str, status: str, fields: Dict[str, Any]) -> tuple[bool, bool, Optional[str]]:
    # Posts the completed V3 unified schema to the backend's Stage 0 result endpoint
    changed = sanitize_result_units(fields)
    if changed:
        logger.info("Normalized %d unit spec value(s) to backend codes | log_id=%s", changed, log_id)
    url = _stage0_result_url(project_id)
    body = {"stage": 0, "status": status, "fields": fields}
    logger.info("Sending Stage 0 result | log_id=%s | url=%s", log_id, url)
    return _post_result(url, body, log_id)


def _post_result(url: str, body: Dict[str, Any], log_id: str) -> tuple[bool, bool, Optional[str]]:
    # Shared HTTP POST logic for sending any result payload to the backend, with the same
    # permanent-vs-transient failure classification used for the FastAPI call above.
    headers = _get_auth_headers(log_id)
    try:
        response = _requests.post(url, json=body, headers=headers, timeout=30)
        logger.info("Result POST response | log_id=%s | status=%d", log_id, response.status_code)
        if response.status_code in (200, 201):
            return True, False, None  # backend accepted the result — message can be completed
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


# ── Settlement helpers: plain Azure Service Bus SDK semantics only ──────────────────────
# complete = done forever · abandon = retry later · dead_letter = never retry, needs manual review

def _safe_complete(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage, log_id: str) -> None:
    try:
        receiver.complete_message(message)
        logger.info("Message completed | log_id=%s", log_id)
    except MessageLockLostError:
        # our pipeline actually succeeded, but we took too long to tell Azure — message will be redelivered
        # and the whole thing will run again, which is wasteful but not incorrect (assuming idempotent downstream)
        logger.error("Lock expired before complete — will re-deliver | log_id=%s", log_id)
    except MessageAlreadySettled:
        pass  # something else already completed/abandoned/dead-lettered this message — nothing to do
    except Exception as exc:
        logger.error("complete_message failed | log_id=%s | error=%s", log_id, exc)


def _safe_abandon(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage) -> None:
    try:
        receiver.abandon_message(message)  # releases the lock immediately so another worker can pick it up sooner
    except MessageAlreadySettled:
        pass
    except Exception as exc:
        logger.error("abandon_message failed: %s", exc)


def _safe_dead_letter(receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage, reason: str, description: str) -> None:
    try:
        # moves the message to the queue's dead-letter sub-queue — Azure creates/manages this automatically
        receiver.dead_letter_message(message, reason=reason, error_description=description)
        logger.info("Message dead-lettered | reason=%s", reason)
    except MessageAlreadySettled:
        pass
    except Exception as exc:
        logger.error("dead_letter_message failed: %s", exc)