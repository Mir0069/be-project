"""
dimension_ocr_locator.py
-------------------------
Finds candidate regions on a large-format CAD sheet that likely contain
dimension callouts (e.g. `6'-0" x 6'-0" GLASS FLOOR`), so the vision LLM
only needs to be shown small, high-effective-DPI crops of those regions
instead of either (a) the whole sheet, or (b) large tiles that still get
crushed by the vision API's fixed 768px-shortest-side scaling.

WHY THIS EXISTS
---------------
OpenAI/Azure OpenAI vision endpoints, at "detail": "high", always scale
the shortest side of an uploaded image down to 768px before the model sees
it — regardless of how high-res you rendered it locally. That means:

    effective DPI at the model ≈ 768 / (physical inches of the tile)

For hand-lettered CAD dimension text (~0.3-0.5" tall) to survive this, a
tile needs to cover roughly 4-6 physical inches, not 20. But blanket-tiling
a 36"x24" sheet at 5" resolution is 50+ tiles/page — too slow/expensive to
run on every page of every project.

So: use free, uncapped OCR (Tesseract has no resolution ceiling — you feed
it whatever DPI you want) as a cheap locator pass to find WHERE on the
sheet text clusters exist, then only send small high-detail crops of those
specific regions to the vision LLM. This generalizes to any drawing set:
it doesn't look for "GLASS FLOOR" specifically, it looks for any tight
cluster of small OCR-detected text plus number-shaped patterns, which is
what any dimension callout looks like regardless of project.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

LOCATOR_DPI = 500  # uncapped — this only feeds free local Tesseract, not the API

# Any digit-ish / dimension-ish / feet-inch-ish pattern, INCLUDING garbled
# OCR variants, since we already know CAD hand-lettering fonts produce
# low-confidence/garbled OCR (e.g. "B'-0"" instead of "6'-0""). We are not
# trying to read the value correctly here — just find WHERE something
# number-shaped is sitting so we can zoom the vision model in on it.
_DIM_LIKE_RE = re.compile(
    r"\d+['\-\"]|['\-\"]\d+|"       # 6'  -0"  '-0
    r"\d+\s*[xX×]\s*\d+|"           # 6 x 6 / 6x6
    r"[A-Za-z]{2,}['\-\"]|"         # garbled OCR like B'-0" (letter next to a foot/inch mark)
    r"glass|floor|skylight|deck|opening|walkable|gl\s*flr|abloor|labloor|glassflr|stair|tread",
    re.IGNORECASE
)

MIN_ROI_SIZE_IN = 5.0     # never crop smaller than this — keeps enough context
MAX_ROI_SIZE_IN = 7.0     # never send a crop larger than this — floor plans have
                          # many scattered callouts that will merge into one big
                          # blob if left uncapped; oversized clusters get
                          # subdivided into a grid instead (see _subdivide)
MERGE_DISTANCE_IN = 2.0   # merge OCR hits within this distance into one ROI
MARGIN_IN = 1.0           # pad each ROI so nothing sits right at the crop edge
SUBDIVIDE_OVERLAP_IN = 1.5


@dataclass
class ROI:
    bbox_in: tuple  # (x0, y0, x1, y1) inches, page coordinate space


def _render_full_page_png(pdf_path: Path, page_num: int, dpi: int = LOCATOR_DPI) -> tuple[bytes, float, float]:
    doc = fitz.open(str(pdf_path))
    try:
        page = doc[page_num - 1]
        w_in = page.rect.width / 72.0
        h_in = page.rect.height / 72.0
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
        return pix.tobytes("png"), w_in, h_in
    finally:
        doc.close()


def _run_tesseract_tsv(png_bytes: bytes) -> list[dict]:
    """
    Run Tesseract with --psm 11 (sparse text) and return word-level boxes
    via the TSV output format (x, y, w, h in pixels, plus recognized text).
    """
    with tempfile.TemporaryDirectory() as td:
        img_path = Path(td) / "page.png"
        img_path.write_bytes(png_bytes)
        out_base = Path(td) / "out"
        subprocess.run(
            ["tesseract", str(img_path), str(out_base), "--psm", "11", "tsv"],
            check=True,
            capture_output=True,
        )
        tsv_text = (out_base.with_suffix(".tsv")).read_text(errors="replace")

    words = []
    lines = tsv_text.splitlines()
    if not lines:
        return words
    header = lines[0].split("\t")
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) != len(header):
            continue
        row = dict(zip(header, parts))
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            words.append({
                "text": text,
                "left": int(row["left"]),
                "top": int(row["top"]),
                "width": int(row["width"]),
                "height": int(row["height"]),
            })
        except (KeyError, ValueError):
            continue
    return words


def _px_to_in(px: float, dpi: int) -> float:
    return px / dpi


def _process_hits_to_rois(hits: list[list[float]], w_in: float, h_in: float) -> list[ROI]:
    """
    Given raw bounding box hits in inches, merges nearby clusters,
    adds margins, enforces minimum crop sizes, and clamps to page bounds.
    """
    if not hits:
        return []

    # Merge nearby hits into clusters (simple greedy union by proximity)
    merged: list[list[float]] = []
    for box in hits:
        placed = False
        for m in merged:
            if (box[0] < m[2] + MERGE_DISTANCE_IN and box[2] > m[0] - MERGE_DISTANCE_IN and
                    box[1] < m[3] + MERGE_DISTANCE_IN and box[3] > m[1] - MERGE_DISTANCE_IN):
                m[0] = min(m[0], box[0])
                m[1] = min(m[1], box[1])
                m[2] = max(m[2], box[2])
                m[3] = max(m[3], box[3])
                placed = True
                break
        if not placed:
            merged.append(list(box))

    # Second pass merge (clusters that grew may now touch each other)
    changed = True
    while changed:
        changed = False
        for i in range(len(merged)):
            for j in range(i + 1, len(merged)):
                a, b = merged[i], merged[j]
                if (a[0] < b[2] + MERGE_DISTANCE_IN and a[2] > b[0] - MERGE_DISTANCE_IN and
                        a[1] < b[3] + MERGE_DISTANCE_IN and a[3] > b[1] - MERGE_DISTANCE_IN):
                    a[0] = min(a[0], b[0]); a[1] = min(a[1], b[1])
                    a[2] = max(a[2], b[2]); a[3] = max(a[3], b[3])
                    merged.pop(j)
                    changed = True
                    break
            if changed:
                break

    rois = []
    for m in merged:
        x0, y0, x1, y1 = m
        # Pad with margin
        x0 -= MARGIN_IN; y0 -= MARGIN_IN
        x1 += MARGIN_IN; y1 += MARGIN_IN
        # Clamp to page bounds
        x0 = max(0.0, x0); y0 = max(0.0, y0)
        x1 = min(w_in, x1); y1 = min(h_in, y1)

        width, height = x1 - x0, y1 - y0

        if width > MAX_ROI_SIZE_IN or height > MAX_ROI_SIZE_IN:
            # Oversized cluster — subdivide
            rois.extend(_subdivide(x0, y0, x1, y1))
            continue

        # Enforce minimum crop size so tiny single-word hits still get context
        if width < MIN_ROI_SIZE_IN:
            cx = (x0 + x1) / 2
            x0, x1 = cx - MIN_ROI_SIZE_IN / 2, cx + MIN_ROI_SIZE_IN / 2
        if height < MIN_ROI_SIZE_IN:
            cy = (y0 + y1) / 2
            y0, y1 = cy - MIN_ROI_SIZE_IN / 2, cy + MIN_ROI_SIZE_IN / 2
        x0 = max(0.0, x0); y0 = max(0.0, y0)
        x1 = min(w_in, x1); y1 = min(h_in, y1)
        rois.append(ROI(bbox_in=(round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2))))

    return rois


def find_dimension_rois(
    pdf_path: Path,
    page_num: int,
    dpi: int = LOCATOR_DPI,
) -> list[ROI]:
    """
    Locate candidate dimension-callout regions on one page using Tesseract OCR.
    """
    png_bytes, w_in, h_in = _render_full_page_png(pdf_path, page_num, dpi=dpi)

    try:
        words = _run_tesseract_tsv(png_bytes)
    except Exception:
        return []  # Tesseract unavailable or failed

    hits = []
    for w in words:
        if _DIM_LIKE_RE.search(w["text"]):
            x0 = _px_to_in(w["left"], dpi)
            y0 = _px_to_in(w["top"], dpi)
            x1 = _px_to_in(w["left"] + w["width"], dpi)
            y1 = _px_to_in(w["top"] + w["height"], dpi)
            hits.append([x0, y0, x1, y1])

    return _process_hits_to_rois(hits, w_in, h_in)


def find_dimension_rois_azure(
    doc_entry: dict,
    page_num: int,
    pdf_path: Path,
) -> list[ROI]:
    """
    Locate candidate dimension-callout regions on one page using pre-extracted Azure DI coordinates.
    Uses proximity filtering to keep only dimensions that are within 8 inches of glass-related keywords.
    """
    try:
        import fitz as _fitz; _doc = _fitz.open(pdf_path); _pg = _doc[page_num]; _rect = _pg.rect; w_in, h_in = _rect.width / 72.0, _rect.height / 72.0; _doc.close()
    except Exception:
        # Fallback to standard 36x24 sheet size if page cannot be read
        w_in, h_in = 36.0, 24.0

    import math
    GLASS_RE = re.compile(r"glass|skylight|deck|opening|walkable|gl\s*flr|glassflr|stair\s*tread", re.IGNORECASE)
    DIM_RE = re.compile(r"\d+['\-\"]|['\-\"]\d+|\d+\s*[xX×]\s*\d+|[A-Za-z]{2,}['\-\"]", re.IGNORECASE)

    glass_boxes = []
    dim_boxes = []

    # 1. Classify paragraphs on this page
    for p in doc_entry.get("paragraphs", []):
        if p.get("page") == page_num and p.get("bbox"):
            text = p.get("text", "")
            bbox = p["bbox"] # [x0, y0, x1, y1]
            if GLASS_RE.search(text):
                glass_boxes.append(bbox)
            elif DIM_RE.search(text):
                dim_boxes.append(bbox)

    # 2. Classify tables on this page
    for t in doc_entry.get("tables", []):
        if t.get("page") == page_num and t.get("bbox"):
            bbox = t["bbox"]
            has_glass = False
            has_dim = False
            for cell in t.get("cells", []):
                cell_text = cell.get("text", "")
                if GLASS_RE.search(cell_text):
                    has_glass = True
                if DIM_RE.search(cell_text):
                    has_dim = True
            if has_glass:
                glass_boxes.append(bbox)
            elif has_dim:
                dim_boxes.append(bbox)

    # 3. Proximity check helper
    def get_distance(b1, b2):
        cx1, cy1 = (b1[0] + b1[2]) / 2.0, (b1[1] + b1[3]) / 2.0
        cx2, cy2 = (b2[0] + b2[2]) / 2.0, (b2[1] + b2[3]) / 2.0
        return math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

    hits = []
    # Always include the glass boxes themselves as ROIs
    hits.extend(glass_boxes)

    # Only include dim boxes that are close (within 8.0 inches) to a glass keyword box
    for db in dim_boxes:
        close_to_glass = False
        for gb in glass_boxes:
            if get_distance(db, gb) <= 8.0:
                close_to_glass = True
                break
        if close_to_glass:
            hits.append(db)

    return _process_hits_to_rois(hits, w_in, h_in)


def _subdivide(x0: float, y0: float, x1: float, y1: float) -> list[ROI]:
    """Grid-subdivide an oversized cluster bbox into MAX_ROI_SIZE_IN cells with overlap."""
    step = MAX_ROI_SIZE_IN - SUBDIVIDE_OVERLAP_IN
    width, height = x1 - x0, y1 - y0

    xs = [x0]
    if width > MAX_ROI_SIZE_IN:
        cur = x0
        while cur + MAX_ROI_SIZE_IN < x1:
            cur += step
            xs.append(cur)
    ys = [y0]
    if height > MAX_ROI_SIZE_IN:
        cur = y0
        while cur + MAX_ROI_SIZE_IN < y1:
            cur += step
            ys.append(cur)

    out = []
    for gy in ys:
        for gx in xs:
            cx1 = min(gx + MAX_ROI_SIZE_IN, x1)
            cy1 = min(gy + MAX_ROI_SIZE_IN, y1)
            out.append(ROI(bbox_in=(round(gx, 2), round(gy, 2), round(cx1, 2), round(cy1, 2))))
    return out
