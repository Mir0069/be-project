"""
extraction_runner.py
--------------------
Handles parallel batch dispatch and raw result collection.
API calls are routed through vision_client.call_vision_batch.

DIMENSION-EXTRACTION FIX (see page_tiler.py / dimension_ocr_locator.py):
Azure/OpenAI vision endpoints at "detail": "high" scale the shortest side of
every uploaded image down to ~768px before the model sees it, no matter how
high-res you render locally. For a large-format CAD sheet (e.g. 36"x24"
ARCH-D), sending the whole page as one image means small hand-lettered
dimension callouts (~0.3-0.5" tall) become illegible mush at the model,
regardless of the DPI you rendered at.

Fix: pages larger than a small-format threshold are routed through
page_tiler.render_page_tiles(), which (a) uses free, uncapped OCR to locate
where dimension-like text actually sits on the sheet, (b) sends small
(<=7") high-effective-DPI crops of just those regions, plus one low-res
full-page overview for spatial context, and (c) falls back to a safe
uniform grid if OCR finds nothing, so no page is silently skipped.
"""

import base64
import time
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz  # PyMuPDF

from .vision_client import call_vision_batch
from .page_tiler import needs_tiling, render_page_tiles, tile_to_image_block


def run_batch(
    chunk: list,
    prompt: str,
    batch_index: int,
    total_batches: int,
    render_images: bool = True,
    use_tiling: bool = False,
    tiling_doc_entry: dict | None = None,
) -> dict:
    """
    Build interleaved image blocks for one chunk of page records and dispatch a single API call.
    """
    print(f"[BATCH {batch_index + 1}/{total_batches}] {len(chunk)} page(s) dispatched")
    try:
        image_blocks = []
        for page in chunk:
            pdf_name = page.get("pdf_name", "unknown")
            pg = page["page_num"]
            page_text = page.get("text") or ""
            tables = page.get("tables") or []
            pdf_path = page.get("pdf_path")

            # ------------------------------------------------------------------
            # 1. Text / table block
            # ------------------------------------------------------------------
            page_type_hint = page.get("page_type_hint", "")
            page_text_parts = [f"\n--- Document: {pdf_name} | Page {pg} ---"]

            page_type = (page.get("page_type") or "").upper()
            page_is_large_format = pdf_path is not None and needs_tiling(pdf_path, pg)
            page_is_tiled = use_tiling and page_is_large_format and any(k in page_type for k in ["FLOOR_PLAN", "ROOF_PLAN", "SCHEDULE"])

            if page_is_tiled:
                page_text_parts.append(
                    "NOTE: This is a large-format CAD sheet. The paragraphs/tables text below "
                    "was extracted via OCR and may be garbled for stylized CAD hand-lettering "
                    "(e.g. reading 'aLABLOOR' instead of 'GLASS FLOOR', or 'B'-0\"' instead of "
                    "'6'-0\"'). You will also be shown one low-res OVERVIEW image of the whole "
                    "sheet for spatial context, followed by several ZOOMED-IN high-resolution "
                    "tiles covering the regions most likely to contain dimension callouts. Read "
                    "dimensions and labels from the zoomed-in tiles, not from the overview or "
                    "the garbled OCR text — the tiles are the source of truth for exact text."
                )

            if page_type_hint:
                page_text_parts.append(f"PAGE TYPE CONTEXT:\n{page_type_hint}")
            if page_text.strip():
                page_text_parts.append("PARAGRAPHS:")
                page_text_parts.append(page_text)
            if tables:
                page_text_parts.append("TABLES:")
                for t_idx, t in enumerate(tables):
                    page_text_parts.append(
                        f"  Table {t_idx + 1} ({t.get('n_rows', 0)}x{t.get('n_cols', 0)}):"
                    )
                    for cell in t.get("cells", []):
                        page_text_parts.append(
                            f"    Row {cell.get('row')}, Col {cell.get('col')}: {cell.get('text', '')}"
                        )

            page_text_full = "\n".join(page_text_parts)
            image_blocks.append({"type": "text", "text": page_text_full})

            # ------------------------------------------------------------------
            # 2. Rendered image(s)
            # ------------------------------------------------------------------
            if pdf_path is not None and render_images:
                try:
                    if page_is_tiled:
                        print(f"[RENDER] {pdf_name} p{pg} — large-format sheet, using OCR-located tiles")
                        tiles = render_page_tiles(pdf_path, pg, doc_entry=tiling_doc_entry)
                        for tile in tiles:
                            image_blocks.extend(tile_to_image_block(tile, pdf_name))
                    else:
                        print(f"[RENDER] {pdf_name} p{pg} @ 300 DPI")
                        doc = fitz.open(str(pdf_path))
                        try:
                            pix = None
                            fitz_page = doc[pg - 1]  # fitz is 0-indexed
                            for current_dpi in [300, 200, 150, 100, 72]:
                                zoom = current_dpi / 72
                                mat = fitz.Matrix(zoom, zoom)
                                try:
                                    pix = fitz_page.get_pixmap(
                                        matrix=mat,
                                        colorspace=fitz.csRGB,
                                        alpha=False,
                                    )
                                    break
                                except Exception as render_exc:
                                    err_msg = str(render_exc).lower()
                                    if (
                                        "malloc" in err_msg
                                        or "memory" in err_msg
                                        or "alloc" in err_msg
                                    ):
                                        print(
                                            f"[RENDER] {pdf_name} p{pg} failed at {current_dpi} DPI, retrying..."
                                        )
                                        continue
                                    raise
                        finally:
                            doc.close()

                        if pix is not None:
                            png_bytes = pix.tobytes("png")
                            b64 = base64.b64encode(png_bytes).decode("utf-8")
                            image_blocks.append(
                                {"type": "text", "text": f"[Full page image: {pdf_name} p{pg}]"}
                            )
                            image_blocks.append(
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{b64}",
                                        "detail": "high",
                                    },
                                }
                            )
                        else:
                            print(
                                f"[RENDER] {pdf_name} p{pg} — pixmap is None after all DPI attempts, skipping image"
                            )

                except Exception as exc:
                    print(f"[RENDER] {pdf_name} p{pg} — render failed, skipping image: {exc}")

        raw = call_vision_batch(image_blocks, prompt)
        raw["batch_index"] = batch_index

        # DEBUG: dump raw per-batch response for inspection
        try:
            import os
            dump_dir = os.environ.get("GFS_BATCH_DUMP_DIR")
            if dump_dir:
                os.makedirs(dump_dir, exist_ok=True)
                page_nums = [str(p.get("page_num", "?")) for p in chunk]
                pdf_stem = (chunk[0].get("pdf_name", "unknown") if chunk else "unknown").replace(".pdf", "").replace(" ", "_")[:40]
                dump_path = os.path.join(dump_dir, f"{pdf_stem}_batch{batch_index:03d}_p{'_'.join(page_nums)}.json")
                with open(dump_path, "w", encoding="utf-8") as _f:
                    import json as _json; _json.dump(raw, _f, indent=2, ensure_ascii=False)
        except Exception as dump_exc:
            print(f"[DUMP] failed: {dump_exc}")

        return raw
    except Exception as exc:
        return {"ok": False, "batch_index": batch_index, "error": str(exc)}


def run_parallel_batches(
    chunks: list[list],
    prompt: str,
    max_workers: int = 4,
    render_images: bool = True,
    use_tiling: bool = False,
    tiling_doc_entry: dict | None = None,
) -> list[dict]:
    """
    Dispatch all chunks concurrently via ThreadPoolExecutor.
    """
    results: list[dict] = []
    total = len(chunks)
    t0 = time.perf_counter()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_idx: dict[Future, int] = {
            executor.submit(
                run_batch, chunk, prompt, idx, total,
                render_images=render_images,
                use_tiling=use_tiling,
                tiling_doc_entry=tiling_doc_entry
            ): idx
            for idx, chunk in enumerate(chunks)
        }
        for future in as_completed(future_to_idx):
            try:
                result = future.result()
            except Exception as exc:
                idx = future_to_idx[future]
                result = {"ok": False, "batch_index": idx, "error": str(exc)}
            results.append(result)

    elapsed = time.perf_counter() - t0
    print(f"[PARALLEL] {total} batch(es) completed in {elapsed:.2f}s")

    results.sort(key=lambda r: r.get("batch_index", 0))
    return results


def extract_from_pdf(
    pdf_path: Path,
    prompt: str,
    doc_entry: dict,
    max_workers: int = 4,
    skip_classifier: bool = False,
    render_images: bool = True,
    use_tiling: bool = False,
    tiling_doc_entry: dict | None = None,
) -> list[dict]:
    """
    Layout-aware chunk → parallel-dispatch pipeline using Azure layouts.
    """
    filename_instruction = (
        f"\n\nCRITICAL INSTRUCTION: The document you are analyzing is named: '{pdf_path.name}'. "
        f"For every single field in your output JSON: "
        f"1. If the field is found (value is NOT null), set the 'citation' key to this exact filename string: '{pdf_path.name}'. "
        f"2. If the field is NOT found (value is null), you MUST set the 'citation' key to null."
    )

    suffix = pdf_path.suffix.lower()
    if suffix in (".eml", ".msg", ".txt"):
        # Retrieve email text from first page of doc_entry
        email_text = ""
        if doc_entry and "full_text_by_page" in doc_entry:
            email_text = (
                doc_entry["full_text_by_page"].get("1", "")
                or doc_entry["full_text_by_page"].get(1, "")
            )

        print(f"[EMAIL] {pdf_path.name} — dispatching text extraction to LLM...")
        try:
            raw = call_vision_batch(
                image_blocks=[],
                prompt=prompt + filename_instruction + "\n\nEMAIL TEXT CONTENT:\n" + email_text,
            )
            raw["batch_index"] = 0
            return [raw]
        except Exception as exc:
            print(f"[ERROR] Email LLM extraction failed for {pdf_path.name}: {exc}")
            return []

    # Map pages from layout doc_entry
    n_pages = doc_entry.get("n_pages", 0)
    if n_pages == 0:
        page_keys = [
            int(k)
            for k in doc_entry.get("full_text_by_page", {}).keys()
            if str(k).isdigit()
        ]
        n_pages = max(page_keys) if page_keys else 1

    from .page_classifier import classify_pages

    classifications = None if skip_classifier else classify_pages(
        pdf_path,
        doc_entry.get("full_text_by_page", {}),
        figures=doc_entry.get("figures", []),
    )
    if classifications is not None:
        keep_count = sum(
            1 for c in classifications.values() if c.relevant in ("YES", "MAYBE")
        )
        print(f"[CLASSIFIER] {pdf_path.name} — keeping {keep_count} of {n_pages} pages")

    page_records = []
    for pg in range(1, n_pages + 1):
        if classifications is not None:
            cls = classifications.get(pg)
            if cls and cls.relevant == "NO":
                continue

        text = (
            doc_entry.get("full_text_by_page", {}).get(str(pg))
            or doc_entry.get("full_text_by_page", {}).get(pg)
            or ""
        )
        tables = [t for t in doc_entry.get("tables", []) if t.get("page") == pg]

        # Get page type hint from classifier if available
        page_hint = ""
        page_type = "FLOOR_PLAN"  # Default to FLOOR_PLAN if classifications is None (small documents)
        if classifications is not None:
            if pg in classifications:
                from extraction.page_classifier import PAGE_TYPE_HINTS
                page_hint = PAGE_TYPE_HINTS.get(classifications[pg].page_type, "")
                page_type = classifications[pg].page_type
            else:
                page_type = "UNKNOWN"

        page_records.append({
            "pdf_name": pdf_path.name,
            "pdf_path": pdf_path,
            "page_num": pg,
            "text": text,
            "tables": tables,
            "page_type_hint": page_hint,
            "page_type": page_type,
        })

    # Sort: SCHEDULE first, then plans, then sections, then rest.
    _PAGE_ORDER = {
        "SCHEDULE": 0,
        "GLAZING_SCHEDULE": 0,
        "ROOF_PLAN": 1,
        "FLOOR_PLAN": 1,
        "SECTION": 2,
        "DETAIL": 2,
        "ENLARGED": 2,
        "SPECIFICATION": 3,
        "COVER": 4,
        "SHEET_INDEX": 4,
    }

    def _page_sort_key(rec):
        pt = (rec.get("page_type_hint") or "").upper()
        for key in _PAGE_ORDER:
            if key in pt:
                return _PAGE_ORDER[key]
        return 5

    page_records.sort(key=_page_sort_key)

    # Chunk page_records: 3 pages per batch, EXCEPT large-format pages (which
    # get tiled into many images) always go alone in their own batch. Mixing
    # a tiled page (10-15+ images) with 2 other full pages in one API call
    # dilutes the model's attention across too many images at once.
    chunks = []
    i = 0
    while i < len(page_records):
        rec = page_records[i]
        rec_type = (rec.get("page_type") or "").upper()
        rec_is_tiled = use_tiling and needs_tiling(rec["pdf_path"], rec["page_num"]) and any(k in rec_type for k in ["FLOOR_PLAN", "ROOF_PLAN", "SCHEDULE"])
        
        if rec_is_tiled:
            chunks.append([rec])
            i += 1
            continue
        batch = []
        while i < len(page_records) and len(batch) < 3:
            nxt = page_records[i]
            nxt_type = (nxt.get("page_type") or "").upper()
            nxt_is_tiled = use_tiling and needs_tiling(nxt["pdf_path"], nxt["page_num"]) and any(k in nxt_type for k in ["FLOOR_PLAN", "ROOF_PLAN", "SCHEDULE"])
            
            if nxt_is_tiled:
                break
            batch.append(nxt)
            i += 1
        if batch:
            chunks.append(batch)

    print(f"[DOCUMENT] {pdf_path.name} — {n_pages} page(s) → {len(chunks)} batch(es)")
    return run_parallel_batches(
        chunks,
        prompt + filename_instruction,
        max_workers=max_workers,
        render_images=render_images,
        use_tiling=use_tiling,
        tiling_doc_entry=tiling_doc_entry,
    )