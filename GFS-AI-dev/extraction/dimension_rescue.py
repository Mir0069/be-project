"""
dimension_rescue.py
-------------------
Phase 3B — Targeted dimension re-extraction for units that came back
with null dimensions from the main Vision pass.

This is a GENERALIZED solution: it works on any PDF where the main
extraction found a glass element but failed to read its dimensions
(due to prompt overload, low resolution, or OCR font issues).

Strategy:
  1. After the main Vision pass, scan the merged result for units
     with null width_inches or length_inches.
  2. For each such unit, re-render the specific page as a 2x2 grid
     of high-DPI tiles (covering full page with overlap).
  3. Send the tiles with a SHORT, focused prompt that ONLY asks
     for dimensions — no signals, no header, no frame questions.
  4. Patch the returned dimensions back into the original result.
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from prompts.prompt_loader import load_prompt
from .vision_client import call_vision_batch
from .page_tiler import render_page_tiles, tile_to_image_block

# NOTE (dimension rescue fix):
# The old _render_page_2x2() below split a page into 4 quadrants. For a
# 36"x24" ARCH-D sheet that's ~18"x12" per quadrant. Azure/OpenAI vision
# endpoints at "detail": "high" scale the shortest side of any uploaded
# image down to ~768px regardless of local render DPI, so a 12" quadrant
# still only reaches ~768/12 =~ 64 effective DPI at the model -- not enough
# to read ~0.3-0.5" hand-lettered dimension text. render_page_tiles()
# (page_tiler.py) fixes this: it first locates candidate regions with free,
# uncapped OCR, then renders only small (<=7") crops of those regions,
# which land in the 100+ effective-DPI range the model actually needs.
# _render_page_2x2() is kept below only as a documented reference of the
# old behavior; rescue_dimensions() no longer calls it.


# ---------------------------------------------------------------------------
# Focused prompt — intentionally minimal to avoid attention dilution.
# No project-specific references — works on any architectural drawing.
# ---------------------------------------------------------------------------
DIMENSION_RESCUE_PROMPT = load_prompt("7.dimension_rescue.md")


def _render_page_2x2(
    pdf_path: Path,
    page_num: int,
    dpi: int = 300,
    max_tile_px: int = 2048,
) -> list[tuple[bytes, str]]:
    """
    Render a single page as a 2x2 grid of overlapping tiles.
    
    Args:
        pdf_path: Path to the PDF file.
        page_num: 1-indexed page number.
        dpi: Render resolution (default 300 — proven in scratch test).
        max_tile_px: Max pixel dimension per tile before upload.
    
    Returns:
        List of (png_bytes, quadrant_label) tuples.
    """
    doc = fitz.open(str(pdf_path))
    try:
        page = doc[page_num - 1]  # fitz is 0-indexed
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
        img_data = pix.tobytes("png")
        full_img = Image.open(io.BytesIO(img_data)).convert("RGB")
        width, height = full_img.size
    finally:
        doc.close()

    # 2x2 grid with 10% overlap (ensures text at tile boundaries is readable)
    overlap_frac = 0.10
    half_w = width // 2
    half_h = height // 2
    delta_w = int(width * overlap_frac)
    delta_h = int(height * overlap_frac)

    quadrants = [
        (full_img.crop((0, 0, half_w + delta_w, half_h + delta_h)), "Top-Left"),
        (full_img.crop((half_w - delta_w, 0, width, half_h + delta_h)), "Top-Right"),
        (full_img.crop((0, half_h - delta_h, half_w + delta_w, height)), "Bottom-Left"),
        (full_img.crop((half_w - delta_w, half_h - delta_h, width, height)), "Bottom-Right"),
    ]

    tiles = []
    for tile_img, label in quadrants:
        # Resize to max_tile_px to keep API payload reasonable
        tw, th = tile_img.size
        if tw > max_tile_px or th > max_tile_px:
            scale = max_tile_px / max(tw, th)
            new_w = int(tw * scale)
            new_h = int(th * scale)
            resample = (
                Image.Resampling.LANCZOS
                if hasattr(Image, "Resampling")
                else Image.BICUBIC
            )
            tile_img = tile_img.resize((new_w, new_h), resample=resample)

        buf = io.BytesIO()
        tile_img.save(buf, format="PNG")
        tiles.append((buf.getvalue(), label))

    return tiles


def rescue_dimensions(
    vision_result: dict,
    pdf_path: Path,
    dpi: int = 300,
    text_result: dict | None = None,
    doc_entry: dict | None = None,
) -> dict:
    """
    Scan the vision_result for units with null dimensions or LOW confidence and attempt
    a focused re-extraction using high-DPI tiles and a minimal prompt.
    """
    # Ensure units list exists
    if "units" not in vision_result:
        vision_result["units"] = []
    units = vision_result["units"]

    # 1. Identify existing vision units needing rescue (null dimensions or LOW confidence)
    rescue_targets = []
    for idx, unit in enumerate(units):
        w = unit.get("width_inches")
        l = unit.get("length_inches")
        conf = unit.get("confidence")
        conf_is_low = False
        if conf is None:
            conf_is_low = True
        elif isinstance(conf, (int, float)):
            conf_is_low = conf < 60
        elif isinstance(conf, str):
            conf_is_low = conf.strip().upper() == "LOW"
        if pg is not None and (w is None or l is None or conf_is_low):
            rescue_targets.append((idx, unit, pg, "PATCH"))

    # 2. Check for pages flagged by Phase 2 (Text) that are missing in Phase 3 (Vision)
    if text_result:
        text_units = text_result.get("units", [])
        vision_pages = {u.get("page") for u in units if u.get("page") is not None}
        
        for tu in text_units:
            t_pg = tu.get("page")
            if t_pg is not None and t_pg not in vision_pages:
                # Text pass found a unit here but vision pass missed it. Create placeholder.
                virtual_unit = {
                    "unit_label": tu.get("unit_label") or "GLASS FLOOR 1",
                    "location_description": tu.get("location_description") or "Found in text pass",
                    "width_inches": None,
                    "length_inches": None,
                    "page": t_pg,
                    "dimension_label_type": "UNKNOWN",
                    "confidence": "LOW",
                    "verbatim": tu.get("verbatim") or "",
                    "reasoning": "[TEXT LLM FINDING] Detected in text pass; routing to focused visual scan."
                }
                units.append(virtual_unit)
                new_idx = len(units) - 1
                rescue_targets.append((new_idx, virtual_unit, t_pg, "ADD"))
                vision_pages.add(t_pg)

    if not rescue_targets:
        return vision_result

    # Group by page to avoid rendering the same page twice
    pages_to_rescue: dict[int, list[tuple[int, dict]]] = {}
    for idx, unit, pg, action in rescue_targets:
        pages_to_rescue.setdefault(pg, []).append((idx, unit))

    print(
        f"\n[DIMENSION RESCUE] {len(rescue_targets)} unit(s) needing visual scan/rescue "
        f"on {len(pages_to_rescue)} page(s) — running focused re-extraction..."
    )

    for pg, unit_list in pages_to_rescue.items():
        labels = ", ".join(u.get("unit_label", "?") for _, u in unit_list)
        print(f"[DIMENSION RESCUE] Page {pg} — units: {labels}")

        t0 = time.perf_counter()

        # Step 1: Locate and render small, OCR-guided high-effective-DPI tiles
        # (replaces the old _render_page_2x2 — see module note above for why
        # the old quadrant approach couldn't beat the API's 768px shortest-
        # side cap).
        try:
            page_tiles = render_page_tiles(pdf_path, pg, doc_entry=doc_entry)
            print(f"[DIMENSION RESCUE] Rendered {len(page_tiles)} tile(s) via ROI locator")
        except Exception as exc:
            print(f"[DIMENSION RESCUE] ❌ Failed to render page {pg}: {exc}")
            continue

        # Step 2: Build image blocks for API call
        image_blocks = []
        for pt in page_tiles:
            image_blocks.extend(tile_to_image_block(pt, pdf_path.name))

        # Step 3: Call API with the focused rescue prompt
        try:
            raw = call_vision_batch(image_blocks, DIMENSION_RESCUE_PROMPT)
        except Exception as exc:
            print(f"[DIMENSION RESCUE] ❌ API call failed for page {pg}: {exc}")
            continue

        elapsed = time.perf_counter() - t0

        if not raw.get("ok"):
            print(f"[DIMENSION RESCUE] ❌ API error for page {pg}: {raw.get('error')} ({elapsed:.1f}s)")
            continue

        # Step 4: Parse rescue results
        rescue_data = raw.get("data", {})
        rescue_units = rescue_data.get("units", [])

        if not rescue_units:
            print(f"[DIMENSION RESCUE] ❌ Page {pg}: no units returned ({elapsed:.1f}s)")
            continue

        # Step 5: Patch dimensions back into original units
        # Match rescue units to original units by index (simple 1:1 for single-unit pages)
        # For multi-unit pages, try to match by label similarity
        patched_count = 0
        for rescue_unit in rescue_units:
            rw = rescue_unit.get("width_inches")
            rl = rescue_unit.get("length_inches")

            if rw is None and rl is None:
                continue  # Rescue also couldn't find dimensions

            # Find the best matching original unit to patch
            best_match = None
            rescue_label = (rescue_unit.get("unit_label") or "").upper()

            for idx, original_unit in unit_list:
                orig_label = (original_unit.get("unit_label") or "").upper()
                # Prefer exact label match, fall back to first unpatched unit
                if rescue_label and orig_label and (rescue_label in orig_label or orig_label in rescue_label):
                    best_match = (idx, original_unit)
                    break

            if best_match is None and unit_list:
                # Fall back to first unit that still has null dimensions
                for idx, original_unit in unit_list:
                    if original_unit.get("width_inches") is None or original_unit.get("length_inches") is None:
                        best_match = (idx, original_unit)
                        break

            if best_match is None:
                continue

            idx, original_unit = best_match
            original_unit["width_inches"] = rw
            original_unit["length_inches"] = rl
            if rescue_unit.get("verbatim"):
                original_unit["verbatim"] = rescue_unit["verbatim"]
            if rescue_unit.get("reasoning"):
                original_unit["reasoning"] = f"[DIMENSION RESCUE] {rescue_unit['reasoning']}"
            if rescue_unit.get("dimension_label_type"):
                original_unit["dimension_label_type"] = rescue_unit["dimension_label_type"]
            original_unit["confidence"] = rescue_unit.get("confidence", "MEDIUM")
            patched_count += 1

        if patched_count > 0:
            dims = [f"{u.get('width_inches')}x{u.get('length_inches')}" for _, u in unit_list if u.get("width_inches")]
            print(f"[DIMENSION RESCUE] ✅ Page {pg}: patched {patched_count} unit(s) — {', '.join(dims)} ({elapsed:.1f}s)")
        else:
            print(f"[DIMENSION RESCUE] ❌ Page {pg}: rescue returned dimensions but couldn't match to units ({elapsed:.1f}s)")

    return vision_result
