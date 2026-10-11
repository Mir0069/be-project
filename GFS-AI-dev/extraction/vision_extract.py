"""
vision_extract.py — Helper functions for PDF rendering, chunking, and file discovery.
"""

import base64
import os
import sys
from pathlib import Path

# Force UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from .vision_client import resize_image_bytes

RENDER_DPI           = int(os.environ.get("INGESTION_PAGE_DPI", 200))
MAX_IMAGES_PER_CALL  = 25
INTERNAL_FOLDER_KEYWORDS = [
    "__macosx",               # macOS metadata folder — always skip
    "approved documents",
    "shop drawing",
    "engineering",
    "glass",
    "install",
    "shipping",
    "accounting",
    "invoices",
    "change orders",
    "transmittal",
    "emails",                 # customer email folders (will be processed separately if needed, but skipped in draw search)
    "flagged_figures",
]


def _path_contains_internal_keyword(path_str: str) -> bool:
    """True if any segment of the path matches a GFS-internal folder keyword."""
    lower = path_str.lower()
    return any(kw in lower for kw in INTERNAL_FOLDER_KEYWORDS)


def _path_is_customer_provided(path_str: str) -> bool:
    """True if the path is inside a 'Customer Provided Info...' folder."""
    return "customer provided" in path_str.lower()


def find_extraction_pdfs(project_folder: Path) -> list:
    """
    Walk the project folder and return a list of (pdf_path, source_type) tuples.
    """
    results = []
    seen_paths = set()

    # Rule 1 — lead sheets at the project root
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
        if f.name.startswith("._"):
            continue
        full_path_str = str(f)
        if "__macosx" in full_path_str.lower():
            continue
        parent_str = str(f.parent)
        if _path_is_customer_provided(parent_str) and not _path_contains_internal_keyword(parent_str):
            results.append((f, "customer_drawing"))
            seen_paths.add(f)

    return results


def render_pdf_to_images(pdf_path: Path, dpi: int = RENDER_DPI) -> list:
    """
    Render every page of a PDF to an in-memory PNG using PyMuPDF (fitz),
    and also extract each page's raw embedded text layer.
    """
    import fitz  # PyMuPDF

    doc  = fitz.open(str(pdf_path))
    out  = []
    try:
        for page_num, page in enumerate(doc, start=1):
            pix = None
            # Try rendering with progressively lower DPIs if we run out of memory
            for current_dpi in [dpi, 150, 100, 72]:
                zoom = current_dpi / 72
                mat  = fitz.Matrix(zoom, zoom)
                try:
                    # Render in grayscale with no alpha channel for minimal memory footprint
                    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
                    break
                except Exception as exc:
                    err_msg = str(exc).lower()
                    if "malloc" in err_msg or "memory" in err_msg or "alloc" in err_msg:
                        print(f"  [WARN] Failed to render {pdf_path.name} page {page_num} at {current_dpi} DPI. Retrying...")
                        continue
                    else:
                        raise exc
            
            if pix is None:
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.0, 1.0))
                except Exception as exc:
                    raise RuntimeError(f"Could not render page {page_num} of {pdf_path.name} due to memory limits: {exc}")
            
            png_bytes = pix.tobytes("png")
            raw_text  = page.get_text()
            out.append((png_bytes, page_num, raw_text))
    finally:
        doc.close()
    return out


def chunk_pages(pages: list, max_images: int = MAX_IMAGES_PER_CALL) -> list:
    """Split page triples into batches."""
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
    """Build raw text block for prompt injection."""
    sections = []
    for _, page_num, raw_text in batch_pages:
        text = raw_text.strip()
        if not text:
            continue
        if len(text) > max_chars_per_page:
            text = text[:max_chars_per_page] + f"\n... [truncated — {len(raw_text.strip()) - max_chars_per_page} more chars]"
        sections.append(f"--- page {page_num} ---\n{text}")

    if not sections:
        return "RAW TEXT FROM PDF (none found — these pages likely have no real text layer):"

    header = "RAW TEXT EXTRACTED DIRECTLY FROM THE PDF FILES:"
    body = "\n\n".join(sections)
    if len(body) > max_total_chars:
        body = body[:max_total_chars] + f"\n\n... [total raw text truncated at {max_total_chars} chars]"
    return header + "\n\n" + body


def _encode_image_block(png_bytes: bytes) -> dict:
    """Convert raw PNG bytes into base64 image block."""
    resized = resize_image_bytes(png_bytes, "image/png")
    b64 = base64.b64encode(resized).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
    }
