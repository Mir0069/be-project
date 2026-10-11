"""
page_tiler.py — Locates and renders small, high-effective-DPI crops of a
large CAD sheet so the vision LLM can actually read dimension callouts.

WHY THIS FILE EXISTS (read before changing tile sizes)
--------------------------------------------------------
Azure/OpenAI vision endpoints at "detail": "high" scale the shortest side
of every uploaded image down to ~768px before the model sees it, no matter
how high-res you render locally. That means:

    effective DPI at the model  ~=  768 / (physical inches of the tile)

A hand-lettered CAD dimension callout (~0.3-0.5" tall) needs roughly
100-150+ effective DPI to be legible. That requires tiles in the
4-7 inch range -- NOT 20 inches, and NOT a whole 36"x24" sheet. This is a
hard external constraint, not something a higher local render DPI can fix.

Blanket-tiling an entire ARCH-D sheet at 6" resolution is 50+ tiles/page --
too slow/expensive to run on every page of every project. So instead:

  1. Run free, uncapped Tesseract OCR (dimension_ocr_locator.py) on the full
     page at high DPI to find WHERE number/dimension-shaped text clusters
     sit. This costs nothing per-image and has no 768px ceiling because it
     never goes through the paid vision API.
  2. Render small (<=7") crops of ONLY those regions at high DPI, plus one
     low-res full-page overview tile for spatial context.
  3. If the locator finds nothing (OCR unavailable, or a page with no
     text-like marks at all) -- fall back to a safe uniform grid at a
     conservative tile size, so coverage is never silently skipped.

This generalizes to any project: it never looks for "glass floor"
specifically, only for the visual shape of dimension/number text.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

from .dimension_ocr_locator import find_dimension_rois

# Pages at or under this size (in inches, longest side) get the old
# single-image treatment -- tiling only kicks in for big sheets where the
# API's internal resize actually hurts you.
SMALL_PAGE_THRESHOLD_IN = 8.0  # letter and smaller: no tiling needed; tabloid and letter-size drawings are tiled

TILE_DPI            = 400   # rendered directly from vector paths -- free
                             # resolution, no scan-blur (vector PDF source)
OVERVIEW_MAX_PX      = 1600  # one low-res full-page tile for spatial context

# Fallback grid (used only if the OCR locator finds zero candidate regions)
FALLBACK_TILE_SIZE_IN = 7.0
FALLBACK_OVERLAP_IN   = 1.5


@dataclass
class PageTile:
    tile_index: int
    page_num: int
    bbox_in: tuple  # (x0, y0, x1, y1) inches
    png_bytes: bytes
    is_overview: bool = False


def page_size_inches(pdf_path: Path, page_num: int) -> tuple[float, float]:
    doc = fitz.open(str(pdf_path))
    try:
        page = doc[page_num - 1]
        return page.rect.width / 72.0, page.rect.height / 72.0
    finally:
        doc.close()


def needs_tiling(pdf_path: Path | str | None, page_num: int) -> bool:
    if pdf_path is None:
        return False
    try:
        w, h = page_size_inches(Path(pdf_path), page_num)
        return max(w, h) > SMALL_PAGE_THRESHOLD_IN
    except Exception:
        return False


def _render_clip(page, x0_in, y0_in, x1_in, y1_in, dpi):
    clip = fitz.Rect(x0_in * 72, y0_in * 72, x1_in * 72, y1_in * 72)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip, colorspace=fitz.csRGB, alpha=False)
    return pix.tobytes("png")


def _tile_starts(total_in: float, tile_size_in: float, step_in: float) -> list[float]:
    if total_in <= tile_size_in:
        return [0.0]
    starts, x = [], 0.0
    while True:
        starts.append(x)
        if x + tile_size_in >= total_in:
            break
        x += step_in
    return starts


def get_page_content_bbox_inches(page) -> tuple[float, float, float, float] | None:
    """
    Get the bounding box of all drawings and text on the page in inches.
    Returns (x0, y0, x1, y1) in inches, or None if no content is found.
    """
    try:
        rects = []
        # Get path/drawing bounding boxes
        for draw in page.get_drawings():
            rect = draw.get("rect")
            # Ignore lines that cover more than 95% of the page area to avoid page borders
            if rect.width > page.rect.width * 0.95 and rect.height > page.rect.height * 0.95:
                continue
            rects.append(rect)
        
        # Get text blocks bounding boxes
        for block in page.get_text("blocks"):
            rects.append(fitz.Rect(block[:4]))
            
        if not rects:
            return None
            
        # Merge all rects
        union_rect = rects[0]
        for r in rects[1:]:
            union_rect |= r
            
        # Convert to inches
        x0 = max(0.0, union_rect.x0 / 72.0)
        y0 = max(0.0, union_rect.y0 / 72.0)
        x1 = min(page.rect.width / 72.0, union_rect.x1 / 72.0)
        y1 = min(page.rect.height / 72.0, union_rect.y1 / 72.0)
        
        # Add a 0.5-inch safety margin
        x0 = max(0.0, x0 - 0.5)
        y0 = max(0.0, y0 - 0.5)
        x1 = min(page.rect.width / 72.0, x1 + 0.5)
        y1 = min(page.rect.height / 72.0, y1 + 0.5)
        
        return (x0, y0, x1, y1)
    except Exception as e:
        print(f"[TILER] Content bbox detection failed: {e}")
        return None


def _fallback_grid_tiles(pdf_path: Path, page_num: int, w_in: float, h_in: float) -> list[PageTile]:
    """Uniform grid fallback -- tiles only the active drawing area to save time & tokens."""
    doc = fitz.open(str(pdf_path))
    page = doc[page_num - 1]
    
    # 1. Detect content bounding box to ignore empty margins
    bbox = get_page_content_bbox_inches(page)
    if bbox is not None:
        cx0, cy0, cx1, cy1 = bbox
        active_w = cx1 - cx0
        active_h = cy1 - cy0
        print(f"[TILER] {pdf_path.name} p{page_num} -- Active drawing area: ({cx0:.1f}\", {cy0:.1f}\") to ({cx1:.1f}\", {cy1:.1f}\")")
    else:
        cx0, cy0, cx1, cy1 = 0.0, 0.0, w_in, h_in
        active_w, active_h = w_in, h_in

    # 2. Determine fallback tile size based on page dimensions.
    # If the page itself is small format (letter or tabloid) but still triggered tiling,
    # we need smaller tile sizes (e.g. 5.0 inches) so we actually split it into multiple zoomed-in tiles.
    if max(w_in, h_in) <= 17.0:
        tile_size = 5.0
        overlap = 1.0
    else:
        tile_size = 10.0
        overlap = 1.5
    step = tile_size - overlap
    
    xs = _tile_starts(active_w, tile_size, step)
    ys = _tile_starts(active_h, tile_size, step)

    tiles = []
    idx = 1
    try:
        for y0_rel in ys:
            y0 = cy0 + y0_rel
            y1 = min(y0 + tile_size, cy1)
            for x0_rel in xs:
                x0 = cx0 + x0_rel
                x1 = min(x0 + tile_size, cx1)
                
                png = _render_clip(page, x0, y0, x1, y1, TILE_DPI)
                tiles.append(PageTile(idx, page_num, (round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)), png))
                idx += 1
    finally:
        doc.close()
    return tiles


def render_page_tiles(pdf_path: Path, page_num: int, doc_entry: dict | None = None) -> list[PageTile]:
    """
    Main entry point. Returns:
      - 1 low-res full-page overview tile (spatial context), plus
      - N small high-DPI tiles covering OCR-located candidate regions
        (or a safe uniform grid if the locator found nothing).
    """
    pdf_path = Path(pdf_path)
    w_in, h_in = page_size_inches(pdf_path, page_num)

    tiles: list[PageTile] = []

    # 1. Full-page low-res overview -- gives the model spatial/layout context
    #    (which room is where, overall shape) even though small text on it
    #    won't be legible. This is intentional: legibility comes from the
    #    targeted tiles below.
    doc = fitz.open(str(pdf_path))
    try:
        page = doc[page_num - 1]
        overview_dpi = max(36, int(72 * (OVERVIEW_MAX_PX / 72) / max(w_in, h_in)))
        overview_png = _render_clip(page, 0, 0, w_in, h_in, overview_dpi)
    finally:
        doc.close()
    tiles.append(PageTile(0, page_num, (0.0, 0.0, round(w_in, 2), round(h_in, 2)), overview_png, is_overview=True))

    # 2. OCR-located candidate regions (the actual fix)
    try:
        if doc_entry is not None:
            from .dimension_ocr_locator import find_dimension_rois_azure
            rois = find_dimension_rois_azure(doc_entry, page_num, pdf_path)
            print(f"[TILER] {pdf_path.name} p{page_num} -- Found {len(rois)} coordinates using pre-extracted Azure DI layout")
        else:
            rois = find_dimension_rois(pdf_path, page_num)
    except Exception as exc:
        print(f"[TILER] ROI locator failed for {pdf_path.name} p{page_num}: {exc} -- using grid fallback")
        rois = []

    if rois:
        doc = fitz.open(str(pdf_path))
        page = doc[page_num - 1]
        try:
            for i, roi in enumerate(rois, start=1):
                x0, y0, x1, y1 = roi.bbox_in
                png = _render_clip(page, x0, y0, x1, y1, TILE_DPI)
                tiles.append(PageTile(i, page_num, (x0, y0, x1, y1), png))
        finally:
            doc.close()
        print(f"[TILER] {pdf_path.name} p{page_num} -- {len(rois)} OCR-located region(s) + 1 overview")
    else:
        grid_tiles = _fallback_grid_tiles(pdf_path, page_num, w_in, h_in)
        tiles.extend(grid_tiles)
        print(f"[TILER] {pdf_path.name} p{page_num} -- no OCR hits, fell back to "
              f"{len(grid_tiles)} uniform grid tile(s) + 1 overview")

    return tiles


def tile_to_image_block(tile: PageTile, pdf_name: str) -> list[dict]:
    """Build the [text-marker, image_url] pair for one tile."""
    b64 = base64.b64encode(tile.png_bytes).decode("utf-8")
    x0, y0, x1, y1 = tile.bbox_in

    if tile.is_overview:
        marker = (
            f"[OVERVIEW of {pdf_name} p{tile.page_num} -- full sheet at low resolution, "
            f"for spatial/layout context only. Small text on this image may NOT be "
            f"legible -- use the zoomed-in tiles below for reading any text or "
            f"dimensions. Use this only to understand where elements are located "
            f"relative to each other.]"
        )
    else:
        marker = (
            f"[Zoomed-in tile of {pdf_name} p{tile.page_num} -- covers region "
            f"({x0}in, {y0}in) to ({x1}in, {y1}in) of the full sheet. "
            f"Read every dimension string and callout visible in it, even partial "
            f"ones cut off at the edge (they should appear complete in a "
            f"neighboring overlapping tile).]"
        )

    return [
        {"type": "text", "text": marker},
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64}",
                "detail": "high",
            },
        },
    ]