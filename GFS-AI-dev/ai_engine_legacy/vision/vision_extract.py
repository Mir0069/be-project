"""
vision_extract.py
-----------------
GFS-AI Phase-2 Vision Extraction — Structured JSON output per PDF.

Walks a project folder, selects customer-provided PDFs (lead sheets +
Customer Provided Info & Project drawings), renders pages via PyMuPDF (fitz),
sends image batches to the Azure OpenAI vision model, and writes one
structured JSON file per PDF.

KEY FEATURES
------------
- Parallel processing   : ThreadPoolExecutor with configurable max_workers.
                          A Semaphore caps concurrent live API calls so we
                          do not burst past the Azure TPM/RPM quota.
- Rate-limit safety     : Exponential backoff on HTTP 429; reads the
                          retry-after-ms response header when present.
- Checkpoint / resume   : After each batch a .checkpoint.json is written.
                          Re-running the script picks up from the last
                          completed batch — no pages are re-processed.
- Merged output         : Multi-batch PDFs (>40 pages) produce ONE merged
                          JSON file (arrays concatenated; nulls in scalar
                          fields filled from later batches).
- macOS safety          : __MACOSX metadata folders and ._* resource forks
                          are automatically skipped.

USAGE
-----
  python vision_extract.py "<project_folder>"
  python vision_extract.py "<project_folder>" --dry-run
  python vision_extract.py "<project_folder>" --max-workers 5
  python vision_extract.py "<project_folder>" --output-dir "D:\\my_outputs"

REQUIREMENTS
------------
  pip install openai python-dotenv pymupdf
  No Poppler required — rendering uses PyMuPDF (fitz) directly.
  PyMuPDF renders pages to in-memory PNG bytes (no disk I/O).

ENV VARS  (.env file or real environment variables)
---------
  AZURE_OPENAI_KEY or AZURE_OPENAI_API_KEY
  AZURE_OPENAI_ENDPOINT          (full endpoint ending in /openai/v1)
  AZURE_OPENAI_CHAT_DEPLOYMENT   (deployment name, e.g. gpt-5-2)
"""

import argparse
import base64
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from utils.io_utils import atomic_write_json

# Force UTF-8 output on Windows (default terminal is cp1252 which cannot
# encode characters like →, —, –, ≤ used in docstrings and print statements).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

# All Azure OpenAI API calls are routed through vision_client, which owns
# the endpoint config, retry logic, and exponential back-off.
from ai_engine.vision.vision_client import call_vision_batch as _api_call_vision_batch, resize_image_bytes

load_dotenv()

# ============================================================
# CONFIG
# ============================================================

# Used only for the pre-flight guard in run() — actual API calls use vision_client.py
AZURE_API_KEY = os.getenv("AZURE_OPENAI_KEY") or os.getenv("AZURE_OPENAI_API_KEY", "")

DEFAULT_OUTPUT_DIR   = Path(r"D:\GFS-Ai\experiments\extraction_lab\vision_json_output")
RENDER_DPI           = 200
MAX_IMAGES_PER_CALL  = 40      # Azure hard limit is 50; 40 gives a safety margin
DEFAULT_MAX_WORKERS  = 3
MAX_RETRY_ATTEMPTS   = 3
RATE_LIMIT_BASE_WAIT = 5       # seconds; doubles on each retry

# ── Folder-path keywords that indicate GFS-internal content (case-insensitive).
# Applied to the *folder path*, never to file names.
INTERNAL_FOLDER_KEYWORDS = [
    "__macosx",               # macOS metadata folder — always skip
    "approved documents",
    "shop drawing",
    "engineering",
    "glass",
    "install",
    "shipping",
    "payments",
    "tax information",
    "invoices",
    "purchase orders",
    "production correspondence",
    "transmittal",
    "worksheets and quotes",
    "emails",
    "pictures",
    "change orders",
    "bol",
    "sales receipt",
    "shipping pictures",
]

SYSTEM_INSTRUCTION = (
    "You are a JSON extraction engine specialising in architectural and glass-flooring "
    "project drawings. Output ONLY a single valid JSON object. "
    "No markdown code fences, no backticks, no preamble, no trailing commentary. "
    "Begin your response with { and end with }."
)

# ============================================================
# EXTRACTION PROMPT  (the schema is embedded verbatim so the
# model always knows the exact expected structure)
# ============================================================

_SCHEMA_TEMPLATE = """\
{
  "gfs_fields": {
    "product_series":          "<Series 1000|Series 2000|Series 3000|E-Frame|Custom|null>",
    "product_type":            "<GLASS_ONLY|SKYLIGHT|INTERIOR_FLOOR|null>",
    "unit_type":               "<skylight|glass_floor|balcony|stair_tread|null>",
    "panel_configuration":     "<SINGLE_PANEL|MULTI_PANEL|null>",
    "opening_size":            "<quoted exactly as seen, e.g. '20\\" x 30\\"'|null>",
    "glass_spec":              "<e.g. 'low iron tempered laminated, Tahoe Satin anti-slip'|null>",
    "glass_supplier":          "<supplier name if visible|null>",
    "quantity":                "<integer or null>",
    "interlayer":              "<SG|PVB|null>",
    "thermal_break":           "<true|false|null>",
    "thermal_break_material":  "<e.g. 'Koralath'|null>",
    "installation_type":       "<PEDESTAL|RECESSED|DECK_PERIMETER|CURB_MOUNTED|flush|through_bolt|null>",
    "factory_glazed":          "<true|false|null>",
    "walkable":                "<true|false|null>",
    "project_address":         "<full address if visible|null>",
    "customer_name":           "<name if visible|null>",
    "notes_from_customer":     "<any customer-written notes or requests|null>",
    "project_architect":       "<architect firm name and contact if visible|null>",
    "revision_dates":          ["<list of revision entries, e.g. '2024.11.15 ISSUED FOR CONSTRUCTION'>"],
    "sheet_ids":               ["<list of all sheet numbers seen, e.g. 'A-110', 'A-202', 'A-501'>"]
  },
  "dimensions": [
    {
      "value":            "<exact quoted string, e.g. \\"4\\'-9 1/2\\\\\\"\\">",
      "unit":             "<feet-inches|inches|feet|mm|meters|square-feet|square-inches>",
      "context":          "<what this dimension describes, e.g. 'skylight opening width'>",
      "sheet_number":     "<e.g. 'A-500'|null>",
      "file":             "<filename>",
      "page":             "<1-based page number within this PDF>",
      "location_on_sheet":"<rough location, e.g. 'upper left', 'title block', 'section detail right side'>",
      "category":         "<linear|area|elevation|floor_elevation|ceiling_height|floor_to_floor|scale|appliance|structural_member>",
      "verify_in_field":  "<true if VIF tag present on drawing, else false>",
      "confidence":       "<high|medium|low>",
      "confidence_note":  "<explain if medium/low, else null>"
    }
  ],
  "labels_and_callouts": [
    {
      "text":             "<exact text as seen on drawing>",
      "sheet_number":     "<e.g. 'A-500'|null>",
      "file":             "<filename>",
      "page":             "<1-based page number>",
      "location_on_sheet":"<rough location>",
      "category":         "<framing|fastener|material|spec|glass|structural|waterproofing|general>",
      "confidence":       "<high|medium|low>"
    }
  ],
  "structural_summary": {
    "system_description":      "<plain-language: what structure/system is shown>",
    "attachment_point":        "<where the glass floor or skylight attaches/connects>",
    "load_bearing_elements":   ["<list of structural/load-bearing items>"],
    "non_structural_elements": ["<list of finish/decorative elements>"],
    "confidence":              "<high|medium|low>",
    "confidence_note":         "<explain confidence level>"
  },
  "confidence_summary": [
    {
      "topic":      "<what this confidence note covers>",
      "confidence": "<high|medium|low>",
      "note":       "<explanation>"
    }
  ],
  "extraction_warnings": ["<any warnings about legibility, missing geometry, etc.>"]
}"""

EXTRACTION_PROMPT_TEMPLATE = """\
You are reviewing a PDF from a glass floor or skylight installation project managed \
by Glass Flooring Systems (GFS). The document is classified as: {source_type_label}.

File:                {pdf_name}
Pages in this batch: {batch_pages_desc}
{batch_note}
{raw_text_block}

TASK — Extract EVERY piece of information visible in these pages and return it as a \
single JSON object matching the schema below EXACTLY.

RULES
-----
1. DIMENSIONS are the highest priority. Capture EVERY numeric dimension, size, area, \
elevation, ceiling height, floor-to-floor height, scale callout, or measurement you \
can see — including tiny tags, schedules, detail callouts, and table entries.
2. Quote every value EXACTLY as it appears on the drawing \
(e.g. "4'-9 1/2\\"" not "4.79 ft"). Do not convert or normalise fractions.
3. If a dimension is tagged VIF or VERIFY on the drawing, set "verify_in_field": true.
4. Capture ALL sheet numbers seen across all pages (e.g. "A-110", "A-501") \
into gfs_fields.sheet_ids as a list.
5. Capture floor/story elevation benchmarks (e.g. "FIRST FLOOR FF EL: +5'-4 1/4\"", \
"DOB PERMITTED HEIGHT EL: +46'-4 1/2\"", "T.O. STEEL EL: ...") as dimensions \
with category "floor_elevation".
6. Capture all GFS-specific product information: product series, glass type/spec, \
opening sizes, quantities, thermal requirements, installation type, supplier names, \
walkability, factory glazed status.
7. Capture project metadata visible in any title block or stamp: \
architect firm/contact into gfs_fields.project_architect; \
all revision entries (date + description) into gfs_fields.revision_dates.
8. For labels_and_callouts: capture structural notes, glass notes, framing notes, \
material specs, waterproofing details, fastener callouts, product names, and any \
other text not already captured as a dimension.
9. OCR garbling: if a value looks like OCR noise (e.g. "4'-714\"" instead of \
"4'-7 1/4\""), quote it EXACTLY as printed, set confidence to "low", and explain \
your suspicion in confidence_note (e.g. "OCR garbled; likely 4'-7 1/4\"").
10. If something is unclear or inferred rather than read directly, \
set confidence to "low" or "medium" with explanation in confidence_note.
11. Set fields to null (or empty list []) if not found — do NOT invent values.
12. Use extraction_warnings for anything that affected your ability to read the sheet \
(e.g. "Page 4 text too small", "Batch contains no drawing geometry").
13. If this batch contains no drawing geometry (only cover pages, emails, etc.), \
return the full schema with empty arrays, fill gfs_fields from any text present, \
and add a warning to extraction_warnings.

REQUIRED JSON SCHEMA
--------------------
{schema}
"""


def _build_prompt(
    source_type: str,
    pdf_name: str,
    batch_index: int,
    total_batches: int,
    batch_page_nums: list,
    raw_text_block: str = "",
) -> str:
    """Return the extraction prompt string for one batch."""
    source_type_label = (
        "LEAD SHEET — a customer-written email or brief containing project requirements"
        if source_type == "lead_sheet"
        else "CUSTOMER-PROVIDED DRAWING — architectural or engineering drawing from the customer"
    )

    if len(batch_page_nums) == 1:
        pages_desc = f"page {batch_page_nums[0]}"
    else:
        pages_desc = f"pages {batch_page_nums[0]}–{batch_page_nums[-1]}"

    batch_note = ""
    if total_batches > 1:
        batch_note = (
            f"NOTE: This PDF has {total_batches} batches total (page count exceeds "
            f"the per-request image limit). This is batch {batch_index} of {total_batches}. "
            f"You are only seeing {pages_desc} in this call. "
            f"Extract everything you can; results will be merged with other batches.\n"
        )

    return EXTRACTION_PROMPT_TEMPLATE.format(
        source_type_label=source_type_label,
        pdf_name=pdf_name,
        batch_pages_desc=pages_desc,
        batch_note=batch_note,
        raw_text_block=raw_text_block,
        schema=_SCHEMA_TEMPLATE,
    )


# ============================================================
# FILE SELECTION
# ============================================================

def _path_contains_internal_keyword(path_str: str) -> bool:
    """True if any segment of the path matches a GFS-internal folder keyword."""
    lower = path_str.lower()
    return any(kw in lower for kw in INTERNAL_FOLDER_KEYWORDS)


def _path_is_customer_provided(path_str: str) -> bool:
    """True if the path is inside a 'Customer Provided Info...' folder."""
    return "customer provided" in path_str.lower()


def find_extraction_pdfs(project_folder: Path) -> list:
    """
    Walk the project folder and return a list of (pdf_path, source_type) tuples
    for all PDFs that should be sent to the vision model.

    source_type is one of: "lead_sheet", "customer_drawing".

    Rules
    -----
    Rule 1 — Lead sheets:
        .pdf files directly in the project root folder (no subfolders) whose
        file name contains "lead" (case-insensitive).

    Rule 2 — Customer drawings:
        All .pdf files (recursively) under any subfolder whose path contains
        "customer provided" (case-insensitive), provided that folder is not
        also inside a GFS-internal folder.

    The two rules are checked independently so a file cannot be tagged twice.
    """
    results = []
    seen_paths = set()

    # Rule 1 — lead sheets at the project root (not in any subfolder)
    for f in project_folder.iterdir():
        if (
            f.is_file()
            and f.suffix.lower() == ".pdf"
            and "lead" in f.name.lower()
        ):
            results.append((f, "lead_sheet"))
            seen_paths.add(f)

    # Rule 2 — customer drawings (recursive under customer-provided folders)
    for f in project_folder.rglob("*.pdf"):
        if not f.is_file() or f in seen_paths:
            continue
        # Skip macOS resource forks (._filename) regardless of folder
        if f.name.startswith("._"):
            continue
        full_path_str = str(f)
        # Skip if __macosx appears anywhere in the full path
        if "__macosx" in full_path_str.lower():
            continue
        parent_str = str(f.parent)
        if _path_is_customer_provided(parent_str) and not _path_contains_internal_keyword(parent_str):
            results.append((f, "customer_drawing"))
            seen_paths.add(f)

    return results


# ============================================================
# PDF RENDERING  (pdf2image / Poppler)
# ============================================================

def render_pdf_to_images(pdf_path: Path, dpi: int = RENDER_DPI) -> list:
    """
    Render every page of a PDF to an in-memory PNG using PyMuPDF (fitz),
    and also extract each page's raw embedded text layer.

    The raw text comes straight from the PDF's text layer (page.get_text()),
    not from reading pixels — so for vector PDFs, small labels that are
    illegible in the rendered image may still be present here as clean,
    exact text, completely bypassing the vision model's resolution limits.
    This mirrors the approach in vision_drawing_test.py (render_pdf_pages).

    Trade-offs vs pdf2image/Poppler:
      PyMuPDF (fitz)  — no extra install, renders to memory, very fast.
                         Slightly lower fidelity on complex vector PDFs.
      pdf2image       — requires Poppler binary on PATH. Uses the same render
                         engine as Adobe, best fidelity for architectural sheets.
                         Adds a system-level dependency.
    For now: PyMuPDF is used because Poppler is not installed in this env.
    Switch to pdf2image later by swapping this function only.

    Returns
    -------
    list of (png_bytes: bytes, page_number: int, raw_text: str)
        page_number is 1-indexed.
        raw_text is the page's embedded text layer (empty string if scanned).
    """
    import fitz  # PyMuPDF

    zoom = dpi / 72          # PyMuPDF internal unit is 72 points/inch
    mat  = fitz.Matrix(zoom, zoom)
    doc  = fitz.open(str(pdf_path))
    out  = []
    try:
        for page_num, page in enumerate(doc, start=1):
            pix       = page.get_pixmap(matrix=mat)
            png_bytes = pix.tobytes("png")
            raw_text  = page.get_text()   # PDF text layer — empty for scanned pages
            out.append((png_bytes, page_num, raw_text))
    finally:
        doc.close()
    return out


# ============================================================
# CHUNKING
# ============================================================

def chunk_pages(pages: list, max_images: int = MAX_IMAGES_PER_CALL) -> list:
    """Split a flat list of (png_bytes, page_num, raw_text) triples into batches of at most max_images."""
    chunks, current = [], []
    for page in pages:
        if len(current) >= max_images:
            chunks.append(current)
            current = []
        current.append(page)
    if current:
        chunks.append(current)
    return chunks


def _build_raw_text_block(batch_pages: list,
                          max_chars_per_page: int = 3000,
                          max_total_chars: int = 12000) -> str:
    """
    Build the raw PDF text block to inject into the extraction prompt.

    Mirrors build_raw_text_block() in vision_drawing_test.py, with added
    character caps to prevent prompt bloat on densely-annotated drawings.

    max_chars_per_page : truncate each page's text at this many characters.
    max_total_chars    : if the combined block exceeds this, truncate and note it.

    batch_pages is a list of (png_bytes, page_num, raw_text) triples.
    If none of the pages have a real text layer, returns a note saying so.
    """
    sections = []
    for _, page_num, raw_text in batch_pages:
        text = raw_text.strip()
        if not text:
            continue
        if len(text) > max_chars_per_page:
            text = text[:max_chars_per_page] + f"\n... [truncated — {len(raw_text.strip()) - max_chars_per_page} more chars]"
        sections.append(f"--- page {page_num} ---\n{text}")

    if not sections:
        return (
            "RAW TEXT FROM PDF (none found — these pages likely have no real text "
            "layer, e.g. scanned images):"
        )

    header = (
        "RAW TEXT EXTRACTED DIRECTLY FROM THE PDF FILES "
        "(this comes from the actual PDF text layer, not from reading the image — "
        "if a number here looks like it matches something illegible in the rendered "
        "image, trust this text over the pixels; note this text has no layout/position "
        "info, so use the image to figure out where on the sheet each value belongs):"
    )
    body = "\n\n".join(sections)
    if len(body) > max_total_chars:
        body = body[:max_total_chars] + f"\n\n... [total raw text truncated at {max_total_chars} chars]"
    return header + "\n\n" + body


# ============================================================
# VISION API CALLER  (multi-image batch)
# ============================================================

def _encode_image_block(png_bytes: bytes) -> dict:
    """Convert raw PNG bytes into an OpenAI image_url content block, resizing if needed."""
    resized = resize_image_bytes(png_bytes, "image/png")
    b64 = base64.b64encode(resized).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
    }


def _extract_json_substring(text: str) -> str:
    """Extract the outermost JSON object from text (first { to last })."""
    first = text.find("{")
    last  = text.rfind("}")
    if first != -1 and last != -1 and last >= first:
        return text[first: last + 1]
    return text


# ============================================================
# RESULT MERGING
# ============================================================

def _empty_gfs_fields() -> dict:
    """Return a gfs_fields dict with all values set to None / empty list."""
    return {
        "product_series":         None,
        "unit_type":              None,
        "opening_size":           None,
        "glass_spec":             None,
        "glass_supplier":         None,
        "quantity":               None,
        "interlayer":             None,
        "thermal_break":          None,
        "thermal_break_material": None,
        "installation_type":      None,
        "factory_glazed":         None,
        "walkable":               None,
        "project_address":        None,
        "customer_name":          None,
        "notes_from_customer":    None,
        "project_architect":      None,
        "revision_dates":         [],
        "sheet_ids":              [],
    }


def _empty_accumulated() -> dict:
    """Return a fresh accumulated-results dict ready for merging."""
    return {
        "gfs_fields":          _empty_gfs_fields(),
        "dimensions":          [],
        "labels_and_callouts": [],
        "structural_summary":  None,
        "confidence_summary":  [],
        "extraction_warnings": [],
    }


def _merge_gfs_fields(base: dict, incoming: dict) -> dict:
    """
    Fill null/empty slots in base with non-null values from incoming.
    Scalar fields: fill if None.
    List fields (revision_dates, sheet_ids): append unique items.
    Never overwrites existing non-null scalar values.
    """
    merged = dict(base)
    list_fields = {"revision_dates", "sheet_ids"}
    for key, val in incoming.items():
        if key in list_fields:
            existing = list(merged.get(key) or [])
            seen_set = set(existing)
            for item in (val or []):
                if item not in seen_set:
                    existing.append(item)
                    seen_set.add(item)
            merged[key] = existing
        elif merged.get(key) is None and val is not None:
            merged[key] = val
    return merged


def _merge_structural_summary(base, incoming) -> dict:
    """
    Merge two structural_summary dicts.
    Scalar fields: fill nulls from incoming.
    List fields: append unique items from incoming.
    """
    if not base and not incoming:
        return {}
    if not base:
        return dict(incoming) if incoming else {}
    if not incoming:
        return dict(base)

    merged = dict(base)
    for key in ("system_description", "attachment_point", "confidence", "confidence_note"):
        if merged.get(key) is None and incoming.get(key) is not None:
            merged[key] = incoming[key]

    for key in ("load_bearing_elements", "non_structural_elements"):
        existing = list(merged.get(key) or [])
        seen     = set(existing)
        for item in (incoming.get(key) or []):
            if item not in seen:
                existing.append(item)
                seen.add(item)
        merged[key] = existing

    return merged


def merge_batch_results(accumulated: dict, new_batch: dict) -> dict:
    """
    Merge a new batch result into the running accumulated dict.

    Arrays (dimensions, labels_and_callouts, confidence_summary,
    extraction_warnings) are concatenated.
    Scalar sections (gfs_fields, structural_summary) have nulls filled
    from later batches but existing non-null values are never overwritten.

    If new_batch contains {"error": ...}, the error message is appended to
    extraction_warnings and no other merging occurs.
    """
    if "error" in new_batch:
        warnings = list(accumulated.get("extraction_warnings") or [])
        err_msg  = new_batch.get("error", "unknown")
        detail   = (new_batch.get("raw_text") or "")[:300]
        warnings.append(f"Batch extraction error [{err_msg}]: {detail}")
        return {**accumulated, "extraction_warnings": warnings}

    result = dict(accumulated)

    result["gfs_fields"] = _merge_gfs_fields(
        result.get("gfs_fields") or _empty_gfs_fields(),
        new_batch.get("gfs_fields") or {},
    )
    result["dimensions"]          = (result.get("dimensions") or []) + (new_batch.get("dimensions") or [])
    result["labels_and_callouts"] = (result.get("labels_and_callouts") or []) + (new_batch.get("labels_and_callouts") or [])
    result["structural_summary"]  = _merge_structural_summary(
        result.get("structural_summary"),
        new_batch.get("structural_summary"),
    )
    result["confidence_summary"]  = (result.get("confidence_summary") or []) + (new_batch.get("confidence_summary") or [])
    result["extraction_warnings"] = (result.get("extraction_warnings") or []) + (new_batch.get("extraction_warnings") or [])

    return result


# ============================================================
# CHECKPOINT  (atomic write via temp file)
# ============================================================

def _safe_file_stem(project_name: str, pdf_name: str) -> str:
    """Build a filesystem-safe stem: project__pdf, max 180 chars."""
    raw = f"{project_name}__{pdf_name}"
    return re.sub(r"[^\w\-]+", "_", raw)[:180]


def _checkpoint_path(output_dir: Path, safe_stem: str) -> Path:
    return output_dir / f"{safe_stem}.checkpoint.json"


def _output_json_path(output_dir: Path, safe_stem: str) -> Path:
    return output_dir / f"{safe_stem}.json"


def load_checkpoint(path: Path) -> dict | None:
    """Load a checkpoint file; return None if missing or corrupt."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_checkpoint(path: Path, state: dict) -> None:
    """Write checkpoint JSON atomically (write via helper temp-file replace)."""
    atomic_write_json(path, state, ensure_ascii=False, indent=2)


# ============================================================
# PER-PDF PROCESSOR
# ============================================================

def process_pdf(
    pdf_path: Path,
    source_type: str,
    project_name: str,
    output_dir: Path,
    semaphore: threading.Semaphore,
) -> dict:
    """
    Full extraction pipeline for one PDF.

    Steps
    -----
    1. Check if already done  → skip
    2. Load checkpoint        → resume from last completed batch
    3. Render pages to PNG    → pdf2image
    4. Chunk into batches     → ≤40 images per batch
    5. For each batch:
         a. Build prompt
         b. Call vision API   → call_vision_batch()
         c. Merge result      → merge_batch_results()
         d. Save checkpoint
    6. Build final JSON with meta block
    7. Write output .json, delete checkpoint

    Returns
    -------
    dict with keys: ok, pdf, output_path, [skipped], [error]
    """
    start_time = time.time()
    safe_stem       = _safe_file_stem(project_name, pdf_path.name)
    checkpoint_file = _checkpoint_path(output_dir, safe_stem)
    output_file     = _output_json_path(output_dir, safe_stem)

    # ── Already complete? ──────────────────────────────────────────────────
    if output_file.exists():
        try:
            existing = json.loads(output_file.read_text(encoding="utf-8"))
            if existing.get("meta", {}).get("extraction_complete"):
                print(f"  [SKIP] Already complete: {pdf_path.name}")
                return {
                    "ok": True,
                    "pdf": str(pdf_path),
                    "output_path": str(output_file),
                    "skipped": True,
                }
        except Exception:
            pass  # Corrupt output → re-run

    print(f"\n  [START] {pdf_path.name}  [{source_type}]")

    # ── Render ────────────────────────────────────────────────────────────
    try:
        pages = render_pdf_to_images(pdf_path)
    except Exception as exc:
        msg = f"render_failed: {exc}"
        print(f"    [ERROR] {msg}")
        return {"ok": False, "pdf": str(pdf_path), "error": msg}

    total_pages  = len(pages)
    chunks       = chunk_pages(pages)
    total_batches = len(chunks)
    print(f"    {total_pages} page(s) → {total_batches} batch(es)")

    # ── Load resume state ─────────────────────────────────────────────────
    cp = load_checkpoint(checkpoint_file)
    if cp and cp.get("pdf_abs_path") == str(pdf_path):
        completed_batches = set(cp.get("completed_batches", []))
        accumulated       = cp.get("accumulated_results", _empty_accumulated())
        started_at        = cp.get("started_at", datetime.now(timezone.utc).isoformat())
        print(f"    [RESUME] Previously completed batches: {sorted(completed_batches)}")
    else:
        completed_batches = set()
        accumulated       = _empty_accumulated()
        started_at        = datetime.now(timezone.utc).isoformat()

    # ── Process batches ───────────────────────────────────────────────────
    for batch_idx, batch_pages in enumerate(chunks, start=1):
        if batch_idx in completed_batches:
            print(f"    [SKIP batch {batch_idx}/{total_batches}]")
            continue

        batch_page_nums = [pn for _, pn, _ in batch_pages]
        page_range      = f"{batch_page_nums[0]}–{batch_page_nums[-1]}" if len(batch_page_nums) > 1 else str(batch_page_nums[0])
        print(
            f"    Batch {batch_idx}/{total_batches} — "
            f"{len(batch_pages)} image(s), pages {page_range}"
        )

        image_blocks    = [_encode_image_block(img) for img, _, _ in batch_pages]
        raw_text_block  = _build_raw_text_block(batch_pages)
        pages_with_text = sum(1 for _, _, t in batch_pages if t.strip())
        print(f"      [text layer] {pages_with_text}/{len(batch_pages)} page(s) have embedded text")
        prompt          = _build_prompt(source_type, pdf_path.name, batch_idx, total_batches, batch_page_nums, raw_text_block)

        # Throttle concurrent calls via semaphore; vision_client handles retry/backoff.
        with semaphore:
            raw = _api_call_vision_batch(image_blocks, prompt)

        # Adapt response: vision_client returns {ok, data, text, error, token_usage}
        if raw.get("ok"):
            usage = raw.get("token_usage", {})
            if usage:
                print(
                    f"      [tokens] prompt={usage.get('prompt_tokens','?')}  "
                    f"completion={usage.get('completion_tokens','?')}  "
                    f"reasoning={usage.get('reasoning_tokens','n/a')}"
                )
            batch_result = raw["data"]
        else:
            err_text = raw.get("error", "unknown")
            print(f"      [API error] {err_text}")
            batch_result = {"error": err_text, "raw_text": (raw.get("text") or "")[:300]}

        accumulated  = merge_batch_results(accumulated, batch_result)

        completed_batches.add(batch_idx)
        save_checkpoint(checkpoint_file, {
            "pdf_abs_path":        str(pdf_path),
            "total_pages":         total_pages,
            "total_batches":       total_batches,
            "completed_batches":   sorted(completed_batches),
            "accumulated_results": accumulated,
            "started_at":          started_at,
            "last_updated":        datetime.now(timezone.utc).isoformat(),
        })

    elapsed_time = time.time() - start_time
    # ── Build and write final JSON ────────────────────────────────────────
    final = {
        "meta": {
            "project_name":       project_name,
            "source_file":        pdf_path.name,
            "source_file_abs":    str(pdf_path),
            "source_type":        source_type,
            "total_pages":        total_pages,
            "processed_at":       datetime.now(timezone.utc).isoformat(),
            "model":              "vision_client (AZURE_OPENAI_DEPLOYMENT)",
            "batches_sent":       total_batches,
            "duration_seconds":   round(elapsed_time, 2),
            "extraction_complete": True,
        },
        **accumulated,
    }

    atomic_write_json(output_file, final, ensure_ascii=False, indent=2)
    print(f"    [DONE] → {output_file} (took {elapsed_time:.1f}s)")

    # Clean up checkpoint
    if checkpoint_file.exists():
        checkpoint_file.unlink()

    return {"ok": True, "pdf": str(pdf_path), "output_path": str(output_file)}


# ============================================================
# ENTRY POINT
# ============================================================

def run(
    project_folder_str: str,
    max_workers: int = DEFAULT_MAX_WORKERS,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    dry_run: bool = False,
) -> None:
    """
    Find all extractable PDFs in project_folder and run the vision pipeline
    over them in parallel.

    Parameters
    ----------
    project_folder_str : str
        Absolute path to the project folder.
    max_workers : int
        Maximum number of PDFs processed in parallel. Also caps concurrent
        API calls via the shared Semaphore.
    output_dir : Path
        Directory where .json output files (and checkpoints) are written.
    dry_run : bool
        If True, list the files that would be processed but make no API calls.
    """
    project_folder = Path(project_folder_str)
    if not project_folder.exists() or not project_folder.is_dir():
        print(f"ERROR: Not a valid folder: {project_folder}")
        return

    # Automatically resolve nested extraction folder recursively (e.g., from zip nesting)
    try:
        while True:
            subdirs = [d for d in project_folder.iterdir() if d.is_dir() and d.name.lower() not in ("__macosx",) and not d.name.startswith(".")]
            files = [f for f in project_folder.iterdir() if f.is_file()]
            if not files and len(subdirs) == 1:
                project_folder = subdirs[0]
                print(f"  [INFO] Resolving nested project root to: {project_folder}")
            else:
                break
    except Exception:
        pass

    project_name = project_folder.name
    pdfs = find_extraction_pdfs(project_folder)

    if dry_run:
        print(f"\n--- DRY RUN (Project: {project_name}) ---")
        print(f"Found {len(pdfs)} PDF(s) for extraction:")
        for pdf_path, source_type in pdfs:
            try:
                rel = pdf_path.relative_to(project_folder)
            except ValueError:
                rel = pdf_path.name
            print(f"  [{source_type}]  {rel}")
        return

    if not pdfs:
        print(f"  No extractable PDFs found in: {project_folder}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    semaphore = threading.Semaphore(max_workers)

    successes, failures = [], []
    global_start_time = time.time()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(
                process_pdf,
                pdf_path, source_type,
                project_name, output_dir, semaphore,
            ): pdf_path
            for pdf_path, source_type in pdfs
        }

        for future in as_completed(future_map):
            pdf_path = future_map[future]
            try:
                result = future.result()
            except Exception as exc:
                result = {"ok": False, "pdf": str(pdf_path), "error": str(exc)}

            if result.get("ok"):
                successes.append(result)
            else:
                failures.append(result)
                print(f"  [FAIL] {pdf_path.name}: {result.get('error')}")

    # ── Final summary ──────────────────────────────────────────────────────
    total_elapsed = time.time() - global_start_time
    print(f"\n{'=' * 64}")
    print(f"DONE — {len(successes)} succeeded, {len(failures)} failed (took {total_elapsed:.1f}s)")
    for r in successes:
        tag = " (already done — skipped)" if r.get("skipped") else ""
        print(f"  [OK]  {Path(r['output_path']).name}{tag}")

    if failures:
        fail_log = output_dir / "failed_pdfs.log"
        fail_log.write_text(
            "\n".join(f"{f['pdf']}: {f.get('error', 'unknown')}" for f in failures),
            encoding="utf-8",
        )
        print(f"  Failures logged → {fail_log}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        prog="vision_extract",
        description="GFS Vision Extraction — structured JSON output per PDF",
    )
    parser.add_argument(
        "project_folder",
        help="Path to the project folder (e.g. '.../182 Robinson St - Series 1000')",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files that would be processed without making any API calls",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=DEFAULT_MAX_WORKERS,
        metavar="N",
        help=f"Max parallel API calls (default: {DEFAULT_MAX_WORKERS})",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(DEFAULT_OUTPUT_DIR),
        metavar="DIR",
        help=f"Directory to write JSON output files (default: {DEFAULT_OUTPUT_DIR})",
    )

    args = parser.parse_args()
    run(
        project_folder_str=args.project_folder,
        max_workers=args.max_workers,
        output_dir=Path(args.output_dir),
        dry_run=args.dry_run,
    )
