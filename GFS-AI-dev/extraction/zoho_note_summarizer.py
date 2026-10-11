# extraction/zoho_note_summarizer.py
# ─────────────────────────────────────────────────────────────────────────────
# AI-only summarization of Zoho CRM notes for approval reasoning / AI Insight.
# The summary text itself is produced solely by the LLM. The only
# deterministic step is lightweight transcript stripping (timestamps, WEBVTT
# headers) to keep token usage down — it never selects or truncates sentences.
# On LLM failure callers must fall back to a generic message, never to a raw
# note quote (which is what leaked VTT transcripts into the UI).
# ─────────────────────────────────────────────────────────────────────────────
import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("gfs.zoho_note_summarizer")

# Token/cost guard for the LLM input. Notes beyond this are truncated —
# the summary still comes from the AI, just over a shorter input.
MAX_INPUT_CHARS = 8000

_TIMESTAMP_RANGE = re.compile(
    r"\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{1,3}\s*-->\s*"
    r"\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{1,3}"
)
_TIMESTAMP_SINGLE = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{1,3}\b")
_CUE_ID = re.compile(r"\b[0-9a-f]{6,}/\d+-\d+\b", re.IGNORECASE)


def _strip_transcript_formatting(text: str) -> str:
    """Remove VTT/transcript markup to save tokens. Content untouched."""
    lines = []
    for line in (text or "").replace("\r", "\n").split("\n"):
        t = line.strip()
        if not t:
            continue
        if t.upper().startswith("WEBVTT") or t.upper().startswith("NOTE"):
            continue
        if t.upper().startswith("KIND:"):
            continue
        if re.fullmatch(r"\d+", t):
            continue
        if "-->" in t and not _TIMESTAMP_RANGE.sub("", t).strip():
            continue  # timestamp-only line
        lines.append(line)
    text = " ".join(lines)
    text = re.sub(r"<[^>]+>", " ", text)
    text = _TIMESTAMP_RANGE.sub(" ", text)
    text = _TIMESTAMP_SINGLE.sub(" ", text)
    text = _CUE_ID.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def summarize_zoho_notes(
    notes: List[Dict[str, Any]],
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Summarize Zoho notes + description with the LLM (AI-only).

    Returns {"summary": str, "confidence": float, "ok": bool}.
    On any failure ok=False and summary="" — the caller must use a generic
    message, never a raw note quote.
    """
    items: List[str] = []
    if description and description.strip():
        items.append(f"[Project Description]: {description.strip()[:2000]}")
    for note in notes or []:
        content = (note.get("content") or "").strip()
        if not content:
            continue
        author = note.get("author") or "unknown"
        items.append(f"[{author}]: {_strip_transcript_formatting(content)}")

    if not items:
        return {"summary": "", "confidence": 0.0, "ok": False}

    combined = "\n".join(items)
    if len(combined) > MAX_INPUT_CHARS:
        combined = combined[:MAX_INPUT_CHARS] + "\n[truncated for length]"

    from extraction.vision_client import call_vision_batch
    from prompts.prompt_loader import load_prompt

    try:
        system_prompt = load_prompt("10.zoho_note_summary.md")
    except Exception as exc:
        logger.warning("Zoho note summary prompt missing: %s", exc)
        return {"summary": "", "confidence": 0.0, "ok": False}

    user_prompt = f"PROJECT DESCRIPTION AND ZOHO NOTES:\n{combined}"
    result = call_vision_batch(
        image_blocks=[],
        prompt=system_prompt + "\n\n" + user_prompt,
        max_completion_tokens=1024,
    )
    if not result.get("ok") or not result.get("text"):
        logger.warning("Zoho note summary LLM failed: %s", result.get("error"))
        return {"summary": "", "confidence": 0.0, "ok": False}

    try:
        text = result["text"].strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        parsed = json.loads(text)
        summary = str(parsed.get("summary") or "").strip()
        try:
            confidence = float(parsed.get("confidence", 0.8))
        except (TypeError, ValueError):
            confidence = 0.8
        if not summary or summary.lower() == "no actionable information in zoho notes.":
            return {"summary": summary, "confidence": confidence, "ok": True}
        # Single-line reasoning text: no newlines, no raw timestamps.
        summary = re.sub(r"\s+", " ", summary)
        summary = _TIMESTAMP_RANGE.sub("", summary).strip()
        return {"summary": summary, "confidence": max(0.0, min(1.0, confidence)), "ok": True}
    except (json.JSONDecodeError, KeyError, AttributeError) as exc:
        logger.warning("Zoho note summary parse failed: %s", exc)
        return {"summary": "", "confidence": 0.0, "ok": False}
