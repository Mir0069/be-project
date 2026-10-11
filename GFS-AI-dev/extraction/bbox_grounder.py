# extraction/bbox_grounder.py
# ─────────────────────────────────────────────────────────────────────────────
# Bounding Box Grounder: Automatically grounds extracted signals & verbatim text
# to their exact physical (x0, y0, x1, y1) coordinates on drawing sheets.
# Runs in < 5ms completely in-memory with zero extra API/LLM calls.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def _normalize_text(text: str) -> str:
    """Strip punctuation and extra whitespace for fuzzy matching."""
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def find_bbox_for_verbatim(
    verbatim: Optional[str],
    page: Optional[int],
    layout_data: Optional[Dict[str, Any]],
) -> Optional[List[float]]:
    """
    Finds the exact [x0, y0, x1, y1] bounding box in inches on the given page
    for the extracted verbatim text.
    """
    if not verbatim or not layout_data:
        return None

    clean_target = _normalize_text(verbatim)
    if not clean_target:
        return None

    # 1. Search fine-grained lines first (cleanest single-line accuracy)
    lines: List[Dict[str, Any]] = layout_data.get("lines") or []
    best_bbox: Optional[List[float]] = None
    best_score = 0.0

    for line in lines:
        l_page = line.get("page")
        if page is not None and l_page is not None and int(l_page) != int(page):
            continue

        raw_text = line.get("text") or ""
        clean_line = _normalize_text(raw_text)
        if not clean_line:
            continue

        bbox = line.get("bbox") or line.get("bounding_box")
        if not bbox or len(bbox) < 4:
            continue

        # Full target containment in a single line is an immediate 100% precise match
        if clean_target in clean_line:
            return [float(b) for b in bbox[:4]]

        target_words = set(verbatim.lower().split())
        line_words = set(raw_text.lower().split())
        overlap = len(target_words.intersection(line_words))
        if overlap == len(target_words) and len(target_words) > 0:
            return [float(b) for b in bbox[:4]]

        if clean_line in clean_target and len(clean_line) >= 4:
            score = len(clean_line) / len(clean_target)
            if score > best_score:
                best_score = score
                best_bbox = [float(b) for b in bbox[:4]]

    # If a line match was found, return it immediately rather than degrading to a paragraph block
    if best_bbox:
        return best_bbox

    # 2. Search fine-grained words sequence for multi-token phrases
    words: List[Dict[str, Any]] = layout_data.get("words") or []
    if words:
        page_words = [
            w for w in words
            if (page is None or w.get("page") is None or int(w.get("page")) == int(page))
            and _normalize_text(w.get("text") or "")
            and (w.get("bbox") or w.get("bounding_box"))
        ]
        for i in range(len(page_words)):
            for j in range(i + 1, min(i + 15, len(page_words) + 1)):
                window = page_words[i:j]
                window_text = "".join(_normalize_text(w.get("text") or "") for w in window)
                if window_text == clean_target:
                    bboxes = [w.get("bbox") or w.get("bounding_box") for w in window]
                    x0 = min(b[0] for b in bboxes)
                    y0 = min(b[1] for b in bboxes)
                    x1 = max(b[2] for b in bboxes)
                    y1 = max(b[3] for b in bboxes)
                    return [float(x0), float(y0), float(x1), float(y1)]

    # 3. Search paragraphs on the specified page (fallback for older layouts)
    paragraphs: List[Dict[str, Any]] = layout_data.get("paragraphs") or []
    for p in paragraphs:
        p_page = p.get("page")
        if page is not None and p_page is not None and int(p_page) != int(page):
            continue

        raw_text = p.get("text") or ""
        clean_para = _normalize_text(raw_text)
        if not clean_para:
            continue

        bbox = p.get("bbox") or p.get("bounding_box")
        if not bbox or len(bbox) < 4:
            continue

        # Exact substring containment
        if clean_target in clean_para or clean_para in clean_target:
            score = min(len(clean_target), len(clean_para)) / max(len(clean_target), len(clean_para), 1)
            if score > best_score:
                best_score = score
                best_bbox = [float(b) for b in bbox[:4]]
                if score >= 0.8:
                    break

        # Word-level overlap match
        target_words = set(verbatim.lower().split())
        para_words = set(raw_text.lower().split())
        overlap = len(target_words.intersection(para_words))
        if overlap >= 2:
            overlap_score = overlap / len(target_words)
            if overlap_score > best_score and overlap_score > 0.5:
                best_score = overlap_score
                best_bbox = [float(b) for b in bbox[:4]]

    if best_bbox:
        return best_bbox

    # 4. Check detected figures if verbatim mentions details or elevations
    figures: List[Dict[str, Any]] = layout_data.get("figures") or []
    for fig in figures:
        fig_page = fig.get("page")
        if page is not None and fig_page is not None and int(fig_page) != int(page):
            continue

        fig_bbox = fig.get("bbox")
        if fig_bbox and isinstance(fig_bbox, dict):
            return [
                float(fig_bbox.get("x0", 0.0)),
                float(fig_bbox.get("y0", 0.0)),
                float(fig_bbox.get("x1", 0.0)),
                float(fig_bbox.get("y1", 0.0)),
            ]
        elif fig_bbox and isinstance(fig_bbox, list) and len(fig_bbox) >= 4:
            return [float(b) for b in fig_bbox[:4]]

    return None


def ground_signal_citations(
    extraction_json: Dict[str, Any],
    layout_data: Optional[Dict[str, Any]] = None,
    default_pdf_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Traverses extraction_json and attaches exact grounded bounding boxes
    [x0, y0, x1, y1] to every signal and physical unit citation.
    """
    pdf_name = default_pdf_name or extraction_json.get("source_file")

    signal_groups = [
        "header_signals",
        "glass_signals",
        "frame_signals",
        "location_signals",
        "addon_signals",
    ]

    for group_name in signal_groups:
        group = extraction_json.get(group_name)
        if not isinstance(group, dict):
            continue

        for key, signal in group.items():
            if not isinstance(signal, dict):
                continue

            page = signal.get("page")
            verbatim = signal.get("verbatim")

            # Resolve bounding box
            bbox_inches = None
            resolved_pdf = pdf_name
            if layout_data:
                # If layout_data is a dictionary of multiple layouts, search across all
                if "paragraphs" not in layout_data and any(isinstance(v, dict) and "paragraphs" in v for v in layout_data.values()):
                    for doc_name, sub_layout in layout_data.items():
                        bbox = find_bbox_for_verbatim(verbatim, page, sub_layout)
                        if bbox:
                            bbox_inches = bbox
                            resolved_pdf = doc_name
                            break
                else:
                    bbox_inches = find_bbox_for_verbatim(verbatim, page, layout_data)

            signal["bbox_inches"] = bbox_inches
            signal["citation"] = {
                "pdf_name": resolved_pdf,
                "page": page,
                "bbox_inches": bbox_inches,
                "verbatim": verbatim,
            }

    # Units grounding
    units = extraction_json.get("units")
    if isinstance(units, list):
        for unit in units:
            if not isinstance(unit, dict):
                continue

            page = unit.get("page")
            verbatim = unit.get("verbatim") or unit.get("location_description")

            bbox_inches = None
            resolved_pdf = unit.get("citation") or pdf_name
            if layout_data:
                # If layout_data is a dictionary of multiple layouts, search across all
                if "paragraphs" not in layout_data and any(isinstance(v, dict) and "paragraphs" in v for v in layout_data.values()):
                    for doc_name, sub_layout in layout_data.items():
                        bbox = find_bbox_for_verbatim(verbatim, page, sub_layout)
                        if bbox:
                            bbox_inches = bbox
                            resolved_pdf = doc_name
                            break
                else:
                    bbox_inches = find_bbox_for_verbatim(verbatim, page, layout_data)

            unit["bbox_inches"] = bbox_inches
            unit["citation"] = {
                "pdf_name": resolved_pdf,
                "page": page,
                "bbox_inches": bbox_inches,
                "verbatim": verbatim,
            }

    return extraction_json
