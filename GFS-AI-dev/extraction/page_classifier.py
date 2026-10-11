"""
page_classifier.py — Visual LLM-based page classifier for drawing sets.

Purpose: Before running expensive Vision extraction on every page of a large
drawing set, classify each page as relevant or irrelevant to GFS products.

Uses a purely visual approach: each page is rendered at 200 DPI via fitz and
sent as an image to the Vision API. This is necessary because Azure DI does NOT
reliably OCR vector-text glass callouts (e.g. "6'-0" x 6'-0" GLASS FLOOR"
embedded in drawings), so text-based classification misses critical pages.

Cost: ~$0.005–$0.01 per page (image-based, one call per page).
On a 400-page set, classification costs ~$2–4 total vs ~$60 for full Vision on all pages.

Safety: documents under 10 pages skip classification entirely (keep all).
Pages classified as MAYBE are always kept (conservative).
If Vision call or JSON parse fails for any page, that page defaults to MAYBE.
"""

from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from prompts.prompt_loader import load_prompt
from .vision_client import call_vision_batch


@dataclass
class PageClassification:
    """Classification result for a single page."""
    page_num: int
    relevant: str          # YES, NO, MAYBE
    page_type: str         # COVER, SHEET_INDEX, SCHEDULE, FLOOR_PLAN, ROOF_PLAN,
                           # SECTION, DETAIL, SPECIFICATION, LEAD_SHEET, IRRELEVANT
    reasoning: str
    sheet_code: Optional[str] = None


CLASSIFIER_PROMPT = load_prompt("5.page_classifier.md")

import os

_RENDER_DPI = int(os.environ.get("INGESTION_PAGE_DPI", 200))
_USE_LOW_DETAIL = os.environ.get("INGESTION_LOW_DETAIL_CLASSIFIER", "false").lower() == "true"


def _render_page_to_jpeg_b64(pdf_path: Path, page_num: int) -> Optional[str]:
    """
    Render a single PDF page (1-indexed) to a JPEG base64 string at 200 DPI.
    Returns None on failure.
    """
    try:
        import fitz  # PyMuPDF
        from PIL import Image

        doc = fitz.open(str(pdf_path))
        try:
            # fitz pages are 0-indexed internally
            page = doc[page_num - 1]
            zoom = _RENDER_DPI / 72
            mat = fitz.Matrix(zoom, zoom)

            pix = None
            for current_dpi in [_RENDER_DPI, 150, 100, 72]:
                z = current_dpi / 72
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(z, z), colorspace=fitz.csRGB, alpha=False)
                    break
                except Exception as exc:
                    err_msg = str(exc).lower()
                    if "malloc" in err_msg or "memory" in err_msg or "alloc" in err_msg:
                        continue
                    raise

            if pix is None:
                return None

            png_bytes = pix.tobytes("png")

            # Convert to JPEG via PIL for smaller payload
            img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
            if max(img.size) > 1568:
                img.thumbnail((1568, 1568), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            return b64
        finally:
            doc.close()
    except Exception as exc:
        print(f"[CLASSIFIER] Failed to render page {page_num} of {pdf_path.name}: {exc}")
        return None


def _parse_single_page_response(raw: dict) -> tuple[str, str, Optional[str], str]:
    """
    Parse Vision API response for a single page classification.
    Returns (relevant, page_type, sheet_code, reasoning).
    Defaults to MAYBE on any parse failure.
    """
    default = ("MAYBE", "UNKNOWN", None, "classifier failed, kept conservatively")

    if not raw:
        return default

    raw_text = raw.get("text", "")
    if not raw_text:
        return default

    # Extract JSON object from response text
    data = None
    try:
        first_brace = raw_text.find("{")
        last_brace = raw_text.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            data = json.loads(raw_text[first_brace:last_brace + 1])
    except (json.JSONDecodeError, ValueError):
        pass

    if not isinstance(data, dict):
        return default

    relevant = str(data.get("relevant", "MAYBE")).upper()
    if relevant not in ("YES", "NO", "MAYBE"):
        relevant = "MAYBE"

    page_type = str(data.get("page_type", "UNKNOWN")).upper()
    valid_page_types = {
        "COVER", "SHEET_INDEX", "SCHEDULE", "FLOOR_PLAN", "ROOF_PLAN",
        "SECTION", "DETAIL", "SPECIFICATION", "LEAD_SHEET", "IRRELEVANT", "UNKNOWN"
    }
    if page_type not in valid_page_types:
        page_type = "UNKNOWN"

    sheet_code = data.get("sheet_code")
    if sheet_code is not None:
        sheet_code = str(sheet_code).strip() or None

    reasoning = str(data.get("reasoning", "")).strip()
    if not reasoning:
        reasoning = "No reasoning provided"

    return relevant, page_type, sheet_code, reasoning


def classify_pages(
    pdf_path: Path,
    full_text_by_page: dict,
    figures: list = None,
) -> dict[int, PageClassification] | None:
    """
    Classify each page in a document as relevant or irrelevant to GFS products
    using a purely visual approach (one Vision API call per rendered page image).

    Args:
        pdf_path:           Path to the PDF file to classify.
        full_text_by_page:  Dict mapping page number (int or str) -> extracted text.
                            Used only to determine page count and apply the small-doc rule.
        figures:            Unused in the visual classifier (kept for API compatibility).

    Returns:
        A dict mapping page_num (int) -> PageClassification, or None if
        classification should be skipped (small documents < 10 pages).

    Safety rules:
      - Documents under 10 pages: returns None (skip classification, keep all)
      - If Vision call or JSON parse fails for any page: defaults to MAYBE (kept)
      - MAYBE pages are always kept downstream (conservative)
    """
    if not full_text_by_page:
        return None

    # Normalise keys to int to determine page count
    pages: dict[int, str] = {}
    for k, v in full_text_by_page.items():
        try:
            pages[int(k)] = v or ""
        except (ValueError, TypeError):
            continue

    # Small-doc rule: skip classification for documents under 10 pages
    if len(pages) < 10:
        return None

    sorted_page_nums = sorted(pages.keys())
    classifications: dict[int, PageClassification] = {}

    print(f"[CLASSIFIER] Visual classification of {pdf_path.name} — {len(sorted_page_nums)} pages (running in parallel)...")

    from concurrent.futures import ThreadPoolExecutor

    def _classify_single_page(page_num: int) -> PageClassification:
        # Render the page to a JPEG base64 string
        b64 = _render_page_to_jpeg_b64(pdf_path, page_num)

        if b64 is None:
            # Render failed — keep conservatively
            print(
                f"[CLASSIFIER] page {page_num}: MAYBE | UNKNOWN | None | "
                f"render failed, kept conservatively"
            )
            return PageClassification(
                page_num=page_num,
                relevant="MAYBE",
                page_type="UNKNOWN",
                reasoning="classifier failed, kept conservatively",
                sheet_code=None,
            )

        # Build image block for Vision API
        image_block = {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64}",
                "detail": "low" if _USE_LOW_DETAIL else "high",
            },
        }

        # Call Vision API — one call per page for maximum accuracy
        try:
            raw = call_vision_batch(image_blocks=[image_block], prompt=CLASSIFIER_PROMPT)
        except Exception as exc:
            print(f"[CLASSIFIER] Vision call failed for page {page_num}: {exc}")
            raw = {}

        relevant, page_type, sheet_code, reasoning = _parse_single_page_response(raw)

        # Per-page decision log
        print(
            f"[CLASSIFIER] page {page_num}: {relevant} | {page_type} | {sheet_code} | "
            f"{reasoning[:80]}"
        )
        return PageClassification(
            page_num=page_num,
            relevant=relevant,
            page_type=page_type,
            reasoning=reasoning,
            sheet_code=sheet_code,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_classify_single_page, page_num): page_num
            for page_num in sorted_page_nums
        }
        for future in futures:
            pg = futures[future]
            try:
                res = future.result()
                if res is not None:
                    classifications[res.page_num] = res
            except Exception as exc:
                print(f"[CLASSIFIER] Failed to process page {pg} in thread: {exc}")
                classifications[pg] = PageClassification(
                    page_num=pg,
                    relevant="MAYBE",
                    page_type="UNKNOWN",
                    reasoning=f"parallel classification error: {exc}",
                    sheet_code=None,
                )

    # Summary
    kept = sum(1 for r in classifications.values() if r.relevant in ("YES", "MAYBE"))
    skipped = sum(1 for r in classifications.values() if r.relevant == "NO")
    print(f"[CLASSIFIER] Result: {kept} pages to process, {skipped} pages skipped")

    return classifications


# ---------------------------------------------------------------------------
# Page-type-aware extraction hints injected into Vision prompt per page.
# Tells Vision what to focus on for each page type.
# These are consumed by extraction_runner.py and are NOT part of the classifier.
# ---------------------------------------------------------------------------
PAGE_TYPE_HINTS = {
    "FLOOR_PLAN": """You are looking at a FLOOR PLAN page.
Focus ONLY on:
- Rectangular or shaped areas with diagonal-line hatching (architectural symbol for glass)
- Labels near those areas: SKYLIGHT, SK, GLASS DECK, GLASS FLOOR, WALKABLE, GL FLR, OPENING
- Overall dimensions of the glass opening (width x length) - only dims touching/labeling the glass element
- Panel divisions visible inside the glass area (count for panel_count)
- Lollipop callout markers (circle with number/letter like 3/A5.01) pointing to section sheets
Ignore: room dimensions, door widths, stair dimensions, ceiling heights, wall thicknesses.""",

    "ROOF_PLAN": """You are looking at a ROOF PLAN page.
Focus ONLY on:
- Skylight openings, roof glass panels, roof decks with glass
- Labels: SK, SL, SKYLIGHT, ROOF OPENING, GLASS DECK, WALKABLE
- Overall dimensions of roof openings - only dims touching/labeling the glass element
- Panel count if divisions are visible
- Lollipop callouts to section/detail sheets
Ignore: roof drainage, parapet dimensions, HVAC equipment, membrane details.""",

    "SECTION": """You are looking at a BUILDING or WALL SECTION page.
Focus ONLY on:
- Is the glass element EXTERIOR above with INTERIOR/conditioned space below? -> has_conditioned_space_below=true
- Is the frame sitting ON TOP of structure (PEDESTAL) or SET INTO it (RECESSED)?
- Curb or support condition shown
- Flashing details, waterproofing, modifications (e.g. rear flange removed)
- Frame profile - does it match Series 2000 pedestal, recessed, face-mount, or curb-mount?
- Glass makeup if called out (laminated, tempered, IGU, air spacer thickness)
Ignore: overall building heights, floor-to-floor dimensions, room names.""",

    "DETAIL": """You are looking at a DETAIL page.
Focus ONLY on:
- Frame profile and glass thickness if labeled
- Mounting modifications (rear flange removed, custom flashing, special conditions)
- Fastener types, anchors, drainage details specific to the glass system
- Named manufacturer or basis-of-design reference (GFS, Glass Flooring Systems)
- is_existing_structure signals (existing curb, existing opening being reused)
Ignore: general construction details unrelated to the glass framing system.""",

    "SCHEDULE": """You are looking at a SCHEDULE page.
Focus ONLY on:
- Rows containing: SKYLIGHT, WALKABLE, GLASS FLOOR, SK, GL, GLASS DECK, GLASS BRIDGE, OPENING
- For matching rows: extract mark number, size (width x length), quantity, glass type, location
- Ignore all other rows (standard windows, doors, hardware)
- Schedule dimensions = glass opening size -> use as width_inches x length_inches""",

    "SPECIFICATION": """You are looking at a SPECIFICATION page.
Focus ONLY on:
- Named manufacturer (Glass Flooring Systems, GFS, or named competitors)
- Glass type requirements (laminated, tempered, heat-strengthened, low iron, SentryGlas, IGU)
- Performance requirements (load rating, slip resistance, thermal break)
- Assembly type mentioned (factory-glazed, field-glazed, knock-down)
- Do NOT extract dimensions from specification text""",

    "COVER": """You are looking at a COVER SHEET page.
Focus ONLY on:
- Project name, project address, project type (residential/commercial)
- Architect firm name and contact
- Do NOT extract dimensions or glass/frame signals from cover sheets""",

    "SHEET_INDEX": """You are looking at a SHEET INDEX page.
This page lists all sheets in the drawing set.
Extract nothing for units. Focus only on header signals if present (project name, address).
Do NOT extract dimensions or glass signals from sheet index pages.""",
}
