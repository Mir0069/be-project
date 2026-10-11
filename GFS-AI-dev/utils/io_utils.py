import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


_SENSITIVE_KEY_RE = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|token|secret|password|connectionstring|sas)\b\s*[:=]\s*([^\s,;]+)"
)


def atomic_write_text(path: str | os.PathLike[str], content: str, encoding: str = "utf-8") -> Path:
    """Write text to disk via a temp file and atomic replace."""
    target_path = Path(path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(prefix=f".{target_path.name}.", suffix=".tmp", dir=str(target_path.parent))
    try:
        with os.fdopen(fd, "w", encoding=encoding) as handle:
            handle.write(content)
        os.replace(tmp_name, target_path)
    except Exception:
        try:
            os.remove(tmp_name)
        except FileNotFoundError:
            pass
        raise

    return target_path


def atomic_write_json(path: str | os.PathLike[str], payload: Any, *, ensure_ascii: bool = False, indent: int = 2, default: Any = None) -> Path:
    """Serialize JSON and write it atomically."""
    if default is None:
        default = str
    return atomic_write_text(path, json.dumps(payload, ensure_ascii=ensure_ascii, indent=indent, default=default))


def redact_sensitive_text(text: str | None) -> str:
    """Mask common secret-like values in free-form text before logging."""
    if not text:
        return ""

    def _replace(match: re.Match[str]) -> str:
        return f"{match.group(1)}=[REDACTED]"

    return _SENSITIVE_KEY_RE.sub(_replace, text)


def format_context_to_str(context: Any) -> str | None:
    """Safely convert string, dict, list or primitive context objects into formatted string."""
    if context is None:
        return None
    if isinstance(context, str):
        return context
    if isinstance(context, (dict, list)):
        try:
            return json.dumps(context, indent=2, default=str)
        except Exception:
            return str(context)
    return str(context)


def context_as_dict(context: Any) -> dict | None:
    """The backend's BEGIN_EXTRACTION context as a dict, whether it arrived parsed or as JSON text."""
    if isinstance(context, dict):
        return context
    if isinstance(context, str) and context.lstrip().startswith("{"):
        try:
            parsed = json.loads(context)
        except (TypeError, ValueError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _note_line(note: dict) -> str:
    author = note.get("author") or "unknown"
    at = f" ({note['at']})" if note.get("at") else ""
    return f"Zoho note by {author}{at}: {(note.get('content') or '').strip()}"


def format_revision_context(context: Any) -> str | None:
    """
    Context for the revision patcher, with the change the estimator approved
    first and older history marked as background. Without this every email in
    the project read as a fresh instruction and old ones won over the new note.
    Context that carries no approved change is formatted as before.
    """
    ctx = context_as_dict(context)
    if ctx is None:
        return format_context_to_str(context)

    source = (ctx.get("triggerSource") or "").upper() or None
    notes = [n for n in (ctx.get("zohoNotes") or []) if isinstance(n, dict) and (n.get("content") or "").strip()]
    emails = [e for e in (ctx.get("emails") or []) if isinstance(e, dict) and (e.get("body") or "").strip()]

    instruction: list[str] = []
    if (ctx.get("changeSummary") or "").strip():
        instruction.append(f"Approved change: {ctx['changeSummary'].strip()}")
    if notes and source in (None, "ZOHO"):
        instruction.append(_note_line(notes[-1]))
        notes = notes[:-1]
    if emails and source == "EMAIL":
        newest = emails[0]
        instruction.append(f"Email from {newest.get('from') or 'unknown'}: {newest['body'].strip()}")
        emails = emails[1:]
    if not instruction:
        return format_context_to_str(context)

    background: list[str] = []
    if (ctx.get("zohoDescription") or "").strip():
        background.append(f"Zoho description: {ctx['zohoDescription'].strip()}")
    background += [_note_line(n) for n in notes]
    background += [f"Teams chat summary: {s.strip()}" for s in (ctx.get("teamsChatSummaries") or []) if isinstance(s, str) and s.strip()]
    background += [
        f"Teams meeting '{m.get('subject') or 'untitled'}': {(m.get('summary') or '').strip()}"
        for m in (ctx.get("teamsMeetingSummaries") or []) if isinstance(m, dict) and (m.get("summary") or "").strip()
    ]
    background += [
        f"Email from {e.get('from') or 'unknown'} ({e.get('at') or 'undated'}) '{e.get('subject') or ''}': {e['body'].strip()}"
        for e in emails
    ]

    lines = ["RETRIGGER INSTRUCTION — the change the estimator approved. Apply the changes stated here:"]
    lines += [f"- {line}" for line in instruction]
    if background:
        lines.append("")
        lines.append("BACKGROUND — older project history, newest first. Context only: never re-apply it; "
                     "where it disagrees with the instruction, the instruction wins.")
        lines += [f"- {line}" for line in background]
    return "\n".join(lines)


def round_floats(obj: Any, decimals: int = 2) -> Any:
    """
    Recursively round floating-point numbers in dicts, lists, and tuples to `decimals` decimal places (default: 2).
    Booleans, integers, strings, None, and other types are left untouched.
    """
    if isinstance(obj, float):
        return round(obj, decimals)
    elif isinstance(obj, dict):
        return {k: round_floats(v, decimals) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [round_floats(v, decimals) for v in obj]
    elif isinstance(obj, tuple):
        return tuple(round_floats(v, decimals) for v in obj)
    return obj


def sanitize_vtt_and_zoho_text(text: str | None) -> str | None:
    """
    Sanitizes raw transcript text, VTT subtitle formatting, and Zoho CRM wrapper strings.
    Strips:
    - Zoho wrapper prefixes like 'Latest note by <user>: "WEBVTT...' (but NOT 'Zoho was updated.' reasoning)
    - WEBVTT headers, NOTE blocks, and standalone cue index numbers
    - Timestamp lines like '00:00:00.000 --> 00:00:05.800' or '00:00.000 --> 00:05.800'
    - Inline VTT formatting tags like <v Speaker>, <c>, </c>
    Returns clean speaker text.
    
    NOTE: 'Zoho was updated.' is preserved as it's legitimate reasoning text, not a wrapper.
    """
    if not text or not isinstance(text, str):
        return text

    # Remove Zoho sync wrapper prefixes (including multiline 'Zoho was updated.\nLatest note by...')
    cleaned = re.sub(r'(?im)^\s*zoho\s+was\s+updated\.?\s*', '', text)
    cleaned = re.sub(r'(?im)^\s*latest\s+note\s+by\s+[^:]+:\s*"?', '', cleaned)
    if cleaned.endswith('"'):
        cleaned = cleaned[:-1]

    lines = cleaned.splitlines()
    clean_lines = []

    for line in lines:
        stripped = line.strip()

        # Skip WEBVTT headers or NOTE blocks
        if stripped.startswith("WEBVTT") or stripped.startswith("NOTE"):
            continue

        # Skip VTT/SRT timestamp lines (e.g. 00:00:00.000 --> 00:00:05.800)
        if re.match(r"^\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}", stripped):
            continue

        # Skip pure numeric cue indexes
        if re.match(r"^\d+$", stripped):
            continue

        # Remove inline HTML/VTT speaker tags
        stripped = re.sub(r"<[^>]+>", "", stripped).strip()

        if stripped:
            clean_lines.append(stripped)

    return "\n".join(clean_lines)


