import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests as _requests
from azure.servicebus import (
    AutoLockRenewer,
    ServiceBusClient,
    ServiceBusReceivedMessage,
    ServiceBusReceiver,
)
from azure.servicebus.exceptions import MessageAlreadySettled, MessageLockLostError
from pydantic import BaseModel, Field, field_validator
from openai import OpenAI

logger = logging.getLogger("gfs.teams-worker")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration

MESSAGE_WAIT_SECONDS     = 10
RECONNECT_WAIT_SECONDS   = 10
MAX_LOCK_RENEWAL_SECONDS = 7200   # 2 hours

TEAMS_QUEUE_NAME: str = os.getenv("AZURE_SERVICE_BUS_TEAMS_QUEUE_NAME", "teams-ai-integration")

AZURE_API_KEY    = (os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_KEY", "")).strip()
AZURE_BASE_URL   = (os.getenv("AZURE_OPENAI_BASE_URL") or os.getenv("AZURE_OPENAI_ENDPOINT") or "https://openaikeyforgfs.openai.azure.com/openai/v1/").strip()
AZURE_DEPLOYMENT = (os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT") or "gpt-5").strip()

# gpt-5 reasoning models spend max_completion_tokens on reasoning BEFORE the
# visible answer. 1000 was too low for long meeting/transcript prompts — the
# budget got exhausted on reasoning and the model returned finish_reason="length"
# with empty/None content (the meeting-summary "null json" bug). Give generous
# headroom; override via env if needed.
GPT_MAX_COMPLETION_TOKENS = int(os.getenv("GPT_MAX_COMPLETION_TOKENS", "4000"))

APP_BASE_URL      = os.getenv("APP_BASE_URL", "").rstrip("/")

TEAMS_WEBHOOK_PATH = "/api/v1/teams/ai-result"

MAX_FILE_BYTES     = 50 * 1024 * 1024   # 50 MB
BLOB_TIMEOUT       = (10, 120)           # connect 10s, read 120s

_PERMANENT_HTTP_STATUSES: set[int] = {400, 415, 422}


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schema — mirrors the backend outbound envelope exactly
# ─────────────────────────────────────────────────────────────────────────────

class TeamRef(BaseModel):
    id:   str
    name: str


class ChannelRef(BaseModel):
    id:   str
    name: str


class ChatMessage(BaseModel):
    messageId: str
    from_:     Optional[str] = Field(None, alias="from")
    fromId:    Optional[str] = Field(None, alias="fromId")
    text:      str           = ""
    html:      Optional[str] = None
    createdAt: str
    replyToId: Optional[str] = None
    webUrl:    Optional[str] = None

    class Config:
        # "from" is a reserved word in Python — backend sends "from"
        # Pydantic alias handles this
        populate_by_name = True

    @classmethod
    def model_validate(cls, obj, *args, **kwargs):
        if isinstance(obj, dict) and "from" in obj:
            obj = dict(obj)
            obj["from_"] = obj.pop("from")
        return super().model_validate(obj, *args, **kwargs)


class DocumentEntry(BaseModel):
    documentId:   str
    originalName: str
    documentType: str           = "other"
    role:         str           = "shared-file"
    mimeType:     Optional[str] = None
    byteSize:     int           = 0
    blobUrl:      str
    sharedBy:     Optional[str] = None
    sharedAt:     Optional[str] = None

    @field_validator("blobUrl")
    @classmethod
    def must_start_with_http(cls, v: str) -> str:
        if not v.startswith("http"):
            raise ValueError(f"blobUrl must start with http(s): {v!r}")
        return v


class ChatPayload(BaseModel):
    delta:     bool                  = True
    messages:  List[ChatMessage]     = []
    documents: List[DocumentEntry]   = []


class MeetingPayload(BaseModel):
    meetingId:     Optional[str]          = None
    subject:       Optional[str]          = None
    startDateTime: Optional[str]          = None
    participants:  List[str]              = []
    messages:      List[ChatMessage]      = []
    documents:     List[DocumentEntry]    = []


class TeamsPayloadBody(BaseModel):
    source:    str           = "teams"
    projectId: str
    sentAt:    str
    team:      TeamRef
    channel:   ChannelRef
    chat:      ChatPayload   = ChatPayload()
    meetings:  List[MeetingPayload] = []


class TeamsIncomingMessage(BaseModel):
    jobType:       str
    correlationId: str
    payload:       TeamsPayloadBody

    @field_validator("jobType")
    @classmethod
    def must_be_teams_proposal(cls, v: str) -> str:
        if v != "TEAMS_PROPOSAL":
            raise ValueError(f"Expected jobType=TEAMS_PROPOSAL, got {v!r}")
        return v




# ─────────────────────────────────────────────────────────────────────────────
# Blob downloader
# ─────────────────────────────────────────────────────────────────────────────

def _download_blob(doc: DocumentEntry, dest_dir: Path) -> Optional[Path]:
    """
    Download one blob to dest_dir.
    Returns Path on success, None on permanent failure (404/403/empty).
    Raises on transient failure (timeout, connection error).
    """
    safe_name = f"{doc.documentId}_{doc.originalName}"
    dest_path = dest_dir / safe_name

    logger.info(
        "Downloading blob | documentId=%s | name=%s",
        doc.documentId,
        doc.originalName,
    )

    response = _requests.get(
        doc.blobUrl,
        timeout=BLOB_TIMEOUT,
        stream=True,
    )

    if response.status_code == 404:
        logger.error("Blob not found (404) | documentId=%s", doc.documentId)
        return None

    if response.status_code == 403:
        logger.error(
            "Blob access denied (403 — SAS expired?) | documentId=%s",
            doc.documentId,
        )
        return None

    response.raise_for_status()

    written = 0
    with dest_path.open("wb") as fh:
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            written += len(chunk)
            if written > MAX_FILE_BYTES:
                dest_path.unlink(missing_ok=True)
                logger.error(
                    "Blob exceeds 50MB limit | documentId=%s",
                    doc.documentId,
                )
                return None
            fh.write(chunk)

    if written == 0:
        dest_path.unlink(missing_ok=True)
        logger.error("Blob is empty | documentId=%s", doc.documentId)
        return None

    logger.info(
        "Blob downloaded | documentId=%s | size=%.1f KB",
        doc.documentId,
        written / 1024,
    )
    return dest_path


# ─────────────────────────────────────────────────────────────────────────────
# File text extractor
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text_from_file(file_path: Path, role: str) -> str:
    """
    Extract plain text from a downloaded file.
    Supports: .txt, .vtt (transcript), .pdf (basic text layer)
    Returns empty string if extraction fails.
    """
    suffix = file_path.suffix.lower()

    # Plain text and transcripts — read directly
    if suffix in {".txt", ".vtt"}:
        try:
            raw = file_path.read_text(encoding="utf-8", errors="replace")

            # If VTT format, strip timestamps and cue markers
            if suffix == ".vtt" or (suffix == ".txt" and role == "transcript"):
                return _parse_vtt_or_transcript(raw)

            return raw.strip()
        except Exception as exc:
            logger.warning(
                "Failed to read text file | file=%s | error=%s",
                file_path.name,
                exc,
            )
            return ""

    # PDF — extract text layer
    if suffix == ".pdf":
        try:
            import fitz   # PyMuPDF
            doc  = fitz.open(str(file_path))
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
            return text.strip()
        except Exception as exc:
            logger.warning(
                "PDF text extraction failed | file=%s | error=%s",
                file_path.name,
                exc,
            )
            return ""

    logger.warning(
        "No text extractor for file type | file=%s | suffix=%s",
        file_path.name,
        suffix,
    )
    return ""


def _parse_vtt_or_transcript(content: str) -> str:
    """
    Strip VTT timestamps, cue markers, and metadata.
    Works on both .vtt and transcript .txt files that contain timestamp lines.
    Returns clean speaker text.
    """
    lines      = content.splitlines()
    text_lines = []

    for line in lines:
        line = line.strip()

        # Skip WEBVTT header
        if line.startswith("WEBVTT"):
            continue

        # Skip NOTE blocks
        if line.startswith("NOTE"):
            continue

        # Skip timestamp lines: 00:00:01.000 --> 00:00:04.000
        if re.match(
            r"^\d{1,2}:\d{2}:\d{2}[\.,]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[\.,]\d{3}",
            line,
        ):
            continue

        # Skip pure cue index numbers
        if re.match(r"^\d+$", line):
            continue

        # Skip empty lines
        if not line:
            continue

        # Remove inline VTT tags like <v Speaker>, <c>, </c>
        line = re.sub(r"<[^>]+>", "", line).strip()

        if line:
            text_lines.append(line)

    return "\n".join(text_lines)


# ─────────────────────────────────────────────────────────────────────────────
# GPT summariser
# ─────────────────────────────────────────────────────────────────────────────

def _get_openai_client() -> OpenAI:
    if not AZURE_API_KEY:
        raise RuntimeError(
            "Azure OpenAI API key not set. "
            "Set AZURE_OPENAI_API_KEY in environment."
        )
    return OpenAI(api_key=AZURE_API_KEY, base_url=AZURE_BASE_URL)

from prompts.prompt_loader import load_prompt


def _build_chat_prompt(
    channel_name: str,
    messages: List[ChatMessage],
    document_texts: List[Dict[str, str]],
) -> str:
    """Build GPT prompt for channel chat summarisation."""
    template = load_prompt("3.teams_chat.md")
    # NOTE: .replace() instead of .format() — the template contains a literal
    # JSON schema example (curly braces around "summary"/"confidence") that
    # .format() misparses as format placeholders, raising KeyError on every
    # call. .replace() only touches the one token we actually mean to fill in,
    # so it's safe regardless of what other brace-containing content (JSON
    # examples, code blocks, etc.) ends up in the template file later.
    base_instructions = template.replace("{channel_name}", channel_name)
    parts = [
        base_instructions,
        "",
        "=== CHAT MESSAGES ===",
    ]

    if messages:
        for msg in messages:
            sender = msg.from_ or "Unknown"
            parts.append(f"[{msg.createdAt}] {sender}: {msg.text}")
    else:
        parts.append("(no chat messages)")

    if document_texts:
        parts.append("")
        parts.append("=== SHARED DOCUMENTS ===")
        for doc in document_texts:
            parts.append(f"--- {doc['name']} ---")
            parts.append(doc["text"][:3000])   # cap per document

    return "\n".join(parts)


def _build_meeting_prompt(
    meeting: MeetingPayload,
    document_texts: List[Dict[str, str]],
) -> str:
    """Build GPT prompt for meeting summarisation."""
    subject = meeting.subject or "Teams Meeting"
    started = meeting.startDateTime or "unknown time"
    participants = ", ".join(meeting.participants) if meeting.participants else "unknown"

    template = load_prompt("4.teams_meeting.md")
    # Same .replace()-not-.format() fix as _build_chat_prompt above — the
    # meeting template almost certainly carries the same JSON schema example
    # with literal braces, which would raise the identical KeyError.
    base_instructions = (
        template
        .replace("{subject}", subject)
        .replace("{started}", started)
        .replace("{participants}", participants)
    )
    parts = [
        base_instructions,
        "",
    ]

    # Meeting transcript (highest priority — most complete record)
    transcript_texts = [d for d in document_texts if d.get("role") == "transcript"]
    if transcript_texts:
        parts.append("=== MEETING TRANSCRIPT ===")
        for t in transcript_texts:
            parts.append(t["text"][:8000])   # transcripts can be long
        parts.append("")

    # Meeting chat messages
    if meeting.messages:
        parts.append("=== IN-MEETING CHAT ===")
        for msg in meeting.messages:
            sender = msg.from_ or "Unknown"
            parts.append(f"[{msg.createdAt}] {sender}: {msg.text}")
        parts.append("")

    # Shared documents (non-transcript)
    shared_docs = [d for d in document_texts if d.get("role") != "transcript"]
    if shared_docs:
        parts.append("=== SHARED DOCUMENTS ===")
        for doc in shared_docs:
            parts.append(f"--- {doc['name']} ---")
            parts.append(doc["text"][:3000])

    return "\n".join(parts)


def _call_gpt(prompt: str) -> Dict[str, Any]:
    """
    Call Azure OpenAI and parse the JSON response.
    Returns dict with summary and confidence.
    Never raises on a missing/None/non-object response — always returns a dict so
    the caller can still POST a result (otherwise the whole message is abandoned
    and the backend job is stuck at status=SENT).
    """
    client = _get_openai_client()

    response = client.chat.completions.create(
        model=AZURE_DEPLOYMENT,
        messages=[
            {
                "role":    "system",
                "content": "You are a precise summarisation engine for GFS project communications. Always respond with valid JSON only.",
            },
            {
                "role":    "user",
                "content": prompt,
            },
        ],
        max_completion_tokens=GPT_MAX_COMPLETION_TOKENS,
        reasoning_effort="medium",
    )

    choice = response.choices[0]
    # content is None when a reasoning model hits the token cap
    # (finish_reason="length") — guard before .strip() so we never crash.
    raw = (choice.message.content or "").strip()

    if not raw:
        logger.warning(
            "GPT returned empty content | finish_reason=%s | usage=%s — "
            "reasoning budget likely exhausted; raise GPT_MAX_COMPLETION_TOKENS",
            getattr(choice, "finish_reason", "?"),
            getattr(response, "usage", None),
        )
        return {"summary": "", "confidence": 0.0}

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        result = json.loads(raw)
        # json.loads("null") -> None; a bare array/number is also valid JSON.
        # Guard so result.get(...) can't raise AttributeError.
        if not isinstance(result, dict):
            raise ValueError(f"expected a JSON object, got {type(result).__name__}")
        return {
            "summary":    str(result.get("summary") or ""),
            "confidence": float(result.get("confidence", 0.5)),
        }
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.warning("GPT returned non-object JSON (%s) — using raw text as summary", exc)
        return {
            "summary":    raw[:500],
            "confidence": 0.3,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Webhook sender
# ─────────────────────────────────────────────────────────────────────────────

def _send_teams_webhook(payload: Dict[str, Any]) -> _requests.Response:
    """
    POST the AI result to the backend webhook.
    POST /api/v1/teams/ai-result

    This route is UNAUTHENTICATED by design — it is secured by the opaque
    correlationId, which must resolve to an existing TeamsAiJob. Do NOT log in
    here. The previous get_access_token() call did a full backend login per
    message (15s timeout); when that login timed out the finished summary was
    discarded and the message re-delivered, re-running GPT on every retry until
    it dead-lettered.
    """
    url = f"{APP_BASE_URL}{TEAMS_WEBHOOK_PATH}"

    headers = {
        "Content-Type": "application/json",
    }
    logger.info(
        "Sending Teams webhook | correlationId=%s | url=%s",
        payload.get("correlationId"),
        url,
    )

    response = _requests.post(
        url,
        json=payload,
        headers=headers,
        timeout=30,
    )

    logger.info(
        "Teams webhook response | correlationId=%s | status=%d",
        payload.get("correlationId"),
        response.status_code,
    )

    response.raise_for_status()
    return response


# ─────────────────────────────────────────────────────────────────────────────
# Core processing function
# ─────────────────────────────────────────────────────────────────────────────

def _process_teams_message(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full processing pipeline for one TEAMS_PROPOSAL message.

    1. Parse into typed schema
    2. Download all blobs
    3. Extract text from each file
    4. Summarise channel chat (if new messages)
    5. Summarise each meeting independently
    6. Build and return the inbound callback payload

    Returns the webhook payload dict.
    """
    t_total = time.monotonic()

    message        = TeamsIncomingMessage(**data)
    correlation_id = message.correlationId
    payload        = message.payload
    project_id     = payload.projectId

    logger.info(
        "Processing TEAMS_PROPOSAL | correlationId=%s | projectId=%s | "
        "chat_messages=%d | meetings=%d",
        correlation_id,
        project_id,
        len(payload.chat.messages),
        len(payload.meetings),
    )

    # ── Download all blobs into a temp directory ──────────────────────────────
    temp_dir  = Path(tempfile.mkdtemp(prefix=f"gfs_teams_{correlation_id[:8]}_"))
    results   = []

    try:
        # Collect ALL documents from chat and all meetings into one download pass
        all_chat_docs: List[DocumentEntry] = payload.chat.documents

        # Per-meeting documents keyed by meetingId
        meeting_docs: Dict[str, List[DocumentEntry]] = {}
        for meeting in payload.meetings:
            mid = meeting.meetingId or f"meeting_{payload.meetings.index(meeting)}"
            meeting_docs[mid] = meeting.documents

        # Download chat documents
        chat_doc_texts: List[Dict[str, str]] = []
        for doc in all_chat_docs:
            file_path = _download_blob(doc, temp_dir)
            if file_path is None:
                continue
            text = _extract_text_from_file(file_path, doc.role)
            if text:
                chat_doc_texts.append({
                    "name": doc.originalName,
                    "text": text,
                    "role": doc.role,
                })

        # Download meeting documents per meeting
        meeting_doc_texts: Dict[str, List[Dict[str, str]]] = {}
        for mid, docs in meeting_docs.items():
            meeting_doc_texts[mid] = []
            for doc in docs:
                file_path = _download_blob(doc, temp_dir)
                if file_path is None:
                    continue
                text = _extract_text_from_file(file_path, doc.role)
                if text:
                    meeting_doc_texts[mid].append({
                        "name": doc.originalName,
                        "text": text,
                        "role": doc.role,
                    })

        # ── Summarise channel chat ────────────────────────────────────────────
        has_new_chat = bool(payload.chat.messages) or bool(chat_doc_texts)

        if has_new_chat:
            logger.info(
                "Summarising channel chat | correlationId=%s | "
                "messages=%d | docs=%d",
                correlation_id,
                len(payload.chat.messages),
                len(chat_doc_texts),
            )

            chat_prompt  = _build_chat_prompt(
                channel_name   = payload.channel.name,
                messages       = payload.chat.messages,
                document_texts = chat_doc_texts,
            )
            chat_result  = _call_gpt(chat_prompt)

            results.append({
                "target":     "chat",
                "summary":    chat_result["summary"],
                "confidence": chat_result["confidence"],
            })

            logger.info(
                "Chat summary complete | correlationId=%s | confidence=%.2f",
                correlation_id,
                chat_result["confidence"],
            )

        # ── Summarise each meeting ────────────────────────────────────────────
        for meeting in payload.meetings:
            mid = meeting.meetingId or f"meeting_{payload.meetings.index(meeting)}"
            doc_texts = meeting_doc_texts.get(mid, [])

            has_meeting_content = (
                bool(meeting.messages)
                or bool(doc_texts)
            )

            if not has_meeting_content:
                logger.info(
                    "Meeting has no content — skipping | meetingId=%s",
                    mid,
                )
                continue

            logger.info(
                "Summarising meeting | correlationId=%s | meetingId=%s | "
                "chat_messages=%d | docs=%d",
                correlation_id,
                mid,
                len(meeting.messages),
                len(doc_texts),
            )

            meeting_prompt = _build_meeting_prompt(
                meeting        = meeting,
                document_texts = doc_texts,
            )
            meeting_result = _call_gpt(meeting_prompt)

            results.append({
                "target":     "meeting",
                "meetingId":  mid,
                "summary":    meeting_result["summary"],
                "confidence": meeting_result["confidence"],
            })

            logger.info(
                "Meeting summary complete | correlationId=%s | meetingId=%s | confidence=%.2f",
                correlation_id,
                mid,
                meeting_result["confidence"],
            )

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.debug("Temp directory cleaned up")

    # ── Determine readiness state ─────────────────────────────────────────────
    # NEEDS_INFO if all confidences are below 0.6 or no results produced
    if results:
        avg_confidence = sum(r["confidence"] for r in results) / len(results)
        readiness_state = "READY" if avg_confidence >= 0.6 else "NEEDS_INFO"
    else:
        readiness_state = "NEEDS_INFO"

    total_seconds = time.monotonic() - t_total

    webhook_payload = {
        "correlationId":  correlation_id,
        "projectId":      project_id,
        "readinessState": readiness_state,
        "results":        results,
        "timing": {
            "total_seconds": round(total_seconds, 2),
        },
    }

    logger.info(
        "Teams processing complete | correlationId=%s | results=%d | "
        "readinessState=%s | duration=%.2fs",
        correlation_id,
        len(results),
        readiness_state,
        total_seconds,
    )

    return webhook_payload


# ─────────────────────────────────────────────────────────────────────────────
# Service Bus listener
# ─────────────────────────────────────────────────────────────────────────────

async def run_teams_listener(
    connection_string: str,
    queue_name: str,
) -> None:
    """
    Async entry point. Runs forever.
    Called from teams_worker.py standalone or from FastAPI lifespan.
    """
    logger.info(
        "Teams listener starting | queue=%s",
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
            logger.info("Teams listener shutting down cleanly.")
            break

        except Exception as exc:
            logger.error(
                "Teams listener crashed: %s — reconnecting in %ds",
                exc,
                RECONNECT_WAIT_SECONDS,
                exc_info=True,
            )
            await asyncio.sleep(RECONNECT_WAIT_SECONDS)


def _blocking_loop(
    connection_string: str,
    queue_name: str,
) -> None:
    """Blocking receive loop. Runs in a thread pool thread."""

    with ServiceBusClient.from_connection_string(
        conn_str=connection_string,
        logging_enable=False,
    ) as client:

        with AutoLockRenewer() as renewer:

            with client.get_queue_receiver(queue_name=queue_name) as receiver:

                logger.info("Teams listener connected | queue=%s", queue_name)

                while True:
                    messages = receiver.receive_messages(
                        max_message_count=1,
                        max_wait_time=MESSAGE_WAIT_SECONDS,
                    )

                    if not messages:
                        continue

                    for message in messages:
                        _process_single_message(
                            receiver=receiver,
                            renewer=renewer,
                            message=message,
                        )


def _process_single_message(
    receiver: ServiceBusReceiver,
    renewer:  AutoLockRenewer,
    message:  ServiceBusReceivedMessage,
) -> None:
    """
    Full lifecycle of one TEAMS_PROPOSAL message:

        read → parse JSON → validate schema
        → register lock renewal
        → process (download + extract + GPT)
        → send webhook
        → complete / dead-letter / abandon
    """

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
        logger.error("Invalid JSON — dead lettering | error=%s", exc)
        _safe_dead_letter(receiver, message, "InvalidJSON", str(exc))
        return

    # ── Step 3: Validate schema ───────────────────────────────────────────────
    try:
        validated = TeamsIncomingMessage(**data)
    except Exception as exc:
        logger.error("Schema validation failed — dead lettering | error=%s", exc)
        _safe_dead_letter(receiver, message, "ValidationFailed", str(exc))
        return

    correlation_id = validated.correlationId
    project_id = validated.payload.projectId

    logger.info(
        "Message validated | correlationId=%s | projectId=%s | "
        "chat_messages=%d | meetings=%d",
        correlation_id,
        project_id,
        len(validated.payload.chat.messages),
        len(validated.payload.meetings),
    )

    # ── Step 4: Register lock renewal ─────────────────────────────────────────
    # Teams processing can be slow — multiple blob downloads + GPT calls
    try:
        renewer.register(
            receiver=receiver,
            renewable=message,
            max_lock_renewal_duration=MAX_LOCK_RENEWAL_SECONDS,
        )
        logger.debug("Lock renewal registered | correlationId=%s", correlation_id)
    except Exception as exc:
        logger.warning(
            "Lock renewal registration failed — proceeding | "
            "correlationId=%s | error=%s",
            correlation_id,
            exc,
        )

    # ── Step 5: Process ───────────────────────────────────────────────────────
    pipeline_succeeded = False
    permanent_failure  = False
    failure_reason: Optional[str] = None

    try:
        webhook_payload = _process_teams_message(data)

    except (_requests.Timeout, _requests.ConnectionError) as exc:
        # Blob download network failure — transient, retry
        failure_reason = f"Network error during blob download: {exc}"
        logger.error(
            "Transient network error — abandoning | correlationId=%s | error=%s",
            correlation_id,
            exc,
        )

    except Exception as exc:
        failure_reason = str(exc)
        logger.exception(
            "Teams processing failed — abandoning | correlationId=%s",
            correlation_id,
        )

    else:
        # ── Step 6: Send webhook ──────────────────────────────────────────────
        try:
            response = _send_teams_webhook(webhook_payload)

            if response.status_code == 200:
                pipeline_succeeded = True
                # The backend raises a pending approval from these summaries; nothing changes until it is approved.

            elif response.status_code in _PERMANENT_HTTP_STATUSES:
                permanent_failure = True
                failure_reason = f"HTTP {response.status_code}: {response.text}"
                logger.error(
                    "Permanent webhook failure — dead lettering | "
                    "correlationId=%s | status=%d",
                    correlation_id,
                    response.status_code,
                )

            else:
                failure_reason = f"HTTP {response.status_code}: {response.text}"
                logger.error(
                    "Transient webhook failure — abandoning | "
                    "correlationId=%s | status=%d",
                    correlation_id,
                    response.status_code,
                )

        except (_requests.Timeout, _requests.ConnectionError) as exc:
            failure_reason = f"Webhook network error: {exc}"
            logger.error(
                "Webhook unreachable — abandoning | correlationId=%s | error=%s",
                correlation_id,
                exc,
            )

        except Exception as exc:
            failure_reason = str(exc)
            logger.exception(
                "Webhook send failed — abandoning | correlationId=%s",
                correlation_id,
            )

    # ── Step 7: Settle ────────────────────────────────────────────────────────
    if pipeline_succeeded:
        _safe_complete(receiver, message, correlation_id)
    elif permanent_failure:
        _safe_dead_letter(
            receiver,
            message,
            reason="PermanentFailure",
            description=failure_reason or "Permanent failure",
        )
    else:
        _safe_abandon(receiver, message)


# ─────────────────────────────────────────────────────────────────────────────
# Settlement helpers
# ─────────────────────────────────────────────────────────────────────────────

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
            "Lock expired at complete — message will re-deliver | "
            "correlationId=%s",
            correlation_id,
        )
    except MessageAlreadySettled:
        logger.warning("Already settled | correlationId=%s", correlation_id)
    except Exception as exc:
        logger.error("complete_message failed | error=%s", exc)


def _safe_abandon(
    receiver: ServiceBusReceiver,
    message:  ServiceBusReceivedMessage,
) -> None:
    try:
        receiver.abandon_message(message)
        logger.info("Message abandoned — will re-deliver")
    except MessageAlreadySettled:
        logger.warning("Already settled on abandon — ignoring")
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
        logger.warning("Already settled on dead-letter — ignoring")
    except Exception as exc:
        logger.error("dead_letter_message failed: %s", exc)
