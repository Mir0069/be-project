# new_app/fanout_router.py
# ─────────────────────────────────────────────────────────────────────────────
# Decoupled Multi-Queue Parallel Router for GFS-AI-4 pipeline.
#
# FIX #2 (multi-project safety):
#   All previously-module-level shared state (queues, shared_results,
#   shared_layouts, layout_ready_events, customer_context_summary, per-project
#   dedup hashes) is now created fresh per pipeline run inside PipelineContext.
#   Nothing project-specific lives at module scope anymore, so N projects can
#   run concurrently in the same process without overwriting each other's
#   results or leaking customer context between them.
#
# FIX #1 (no more silently-dropped text pages):
#   classifier_worker used to `continue` (i.e. drop) any page with no vector
#   drawings/images. That page's text was extracted by Azure DI but never fed
#   through an LLM extraction pass, so its content silently never reached the
#   final result. It now gets routed to a new text_queue / text_worker pair,
#   which runs the same extraction prompt on that single page's text (no
#   image needed). Every page now ends up in exactly one of: vision path,
#   text path -- never neither.
# ─────────────────────────────────────────────────────────────────────────────

import queue
import threading
import logging
import json
import base64
import asyncio
import os
import time
from pathlib import Path
from PIL import Image
import fitz  # PyMuPDF

from prompts.prompt_loader import load_prompt
from extraction.azure_extract import call_azure_layout_chunked, crop_figures, load_ignored_templates, get_bbox_from_polygon
from extraction.page_classifier import _render_page_to_jpeg_b64, _parse_single_page_response
from extraction.text_prefilter import evaluate_page_text
from extraction.vision_client import call_vision_batch
from new_app import token_tracker
from extraction.extraction_parser import merge_extraction_results
from extraction.page_tiler import needs_tiling, render_page_tiles, tile_to_image_block

CLASSIFIER_PROMPT = load_prompt("5.page_classifier.md")
EXTRACTION_TEXT_PROMPT = load_prompt("8.extraction_text.md")
EXTRACTION_DRAWING_PROMPT = load_prompt("7.extraction_drawing.md")

logger = logging.getLogger("gfs.new_app.router")
logging.basicConfig(level=logging.INFO)

# How long vision/text/classifier workers wait for a file's Azure DI layout
# before giving up on that page. Was 60s -- too tight: standalone-image vision
# tasks dispatch immediately but Azure can take 50-70s+ per file (12-page Jane
# St run: A-501's layout landed ~1s after the window expired, losing the page).
# 120s covers slow Azure files without risking a hang (the queue watchdog is
# the backstop).
LAYOUT_WAIT_S = 120.0

# ── Module-level: read-only reference data ONLY ──────────────────────────────
# TEMPLATE_HASHES is loaded once and never mutated per-project, so it's safe
# to keep at module scope (unlike GLOBAL_SEEN_HASHES, which is now per-project
# state living on PipelineContext -- see fix #2 below).
TEMPLATE_HASHES = load_ignored_templates()


# ── FIX #2: per-project context object replaces all module-level globals ────
class PipelineContext:
    """
    Holds all mutable, project-scoped state for one run_new_pipeline() call.
    Create one fresh instance per project run -- never share across projects.
    """
    def __init__(self, project_folder: Path):
        self.project_folder = project_folder

        # Queues (per-project -- see note below on why queues are per-project too)
        self.azure_queue: "queue.Queue" = queue.Queue()
        self.classifier_queue: "queue.Queue" = queue.Queue()
        self.vision_queue: "queue.Queue" = queue.Queue()
        self.text_queue = queue.PriorityQueue()  # PriorityQueue for prioritized context/fallback tasks
        self.queue_counter = 0

        # Pending-vision tracker: page_id -> {"file": str, "page": int, "since": float}.
        # Used ONLY for watchdog diagnostics (which pages are stuck, and for how
        # long) -- queue bookkeeping still relies on task_done()/join().
        self.vision_pending: dict = {}

        # Shared result dicts -- previously keyed only by file_name/page_id,
        # which collided across projects with same-named files. Now safe
        # because each project gets its own dict instance entirely.
        self.shared_results: dict = {}              # file_name -> whole-file text result
        self.shared_vision_results: dict = {}        # page_id -> vision result
        self.shared_text_page_results: dict = {}      # FIX #1: page_id -> text-only single-page result
        self.shared_layouts: dict = {}               # file_name -> doc_entry
        self.layout_ready_events: dict = {}           # file_name -> threading.Event()

        self.store_lock = threading.Lock()

        # Previously a module global string shared by every concurrent
        # project -- now scoped per-project, so it can't leak between them.
        self.customer_context_summary: str = ""
        self.text_context_ready = threading.Event()  # set after text extraction builds context
        self.expected_text_files = 0
        self.completed_text_files = 0

        # Previously module-level GLOBAL_SEEN_HASHES -- dedup hashes are
        # meaningful per-document/per-project, not process-wide, so this
        # moves here too.
        self.global_seen_hashes: dict = {}

        # Phase 1 progressive completion callback
        self.on_phase1_complete = None


        # Completion-based streaming page batching counters/buffers
        self.doc_total_pages: dict = {}
        self.classified_pages_count: dict = {}
        # Pipeline stats counters
        self.stats = {
            "files_total": 0,
            "pages_text": 0,
            "pages_to_classifier": 0,
            "pages_prefilter_vision": 0,
            "pages_prefilter_skip": 0,
            "pages_classifier_vision": 0,
            "pages_classifier_no": 0,
            "pages_vision_processed": 0,
            "pages_vision_failed": 0,
        }
        self.accumulated_fallback_pages: dict = {}


    def file_key(self, file_path: Path) -> str:
        """
        Stable per-file dict key for all project-scoped state (layouts, events,
        page counters, fallback buffers).

        Previously everything was keyed by bare ``file_path.name``, so two files
        with the same basename in different subfolders (e.g. Dropbox-style
        project trees discovered via rglob) silently overwrote each other's
        layouts, ready-events and classified-page counters -- producing phantom
        "Page 12 of <4-page file>" symptoms and lost fallback batches. The key
        is now the path relative to the project folder, falling back to the
        basename for files outside it.
        """
        try:
            return str(Path(file_path).resolve().relative_to(
                Path(self.project_folder).resolve())).replace("\\", "/")
        except Exception:
            return Path(file_path).name


def track_vision_enqueued(ctx: PipelineContext, file_path: Path, page_num: int):
    """Record a vision task as pending (diagnostics only -- see vision_pending)."""
    page_id = f"{file_path.stem}_p{page_num}"
    with ctx.store_lock:
        ctx.vision_pending[page_id] = {
            "file": ctx.file_key(file_path),
            "page": page_num,
            "since": time.monotonic(),
        }


def track_vision_finished(ctx: PipelineContext, file_path: Path, page_num: int):
    """Remove a vision task from the pending tracker (diagnostics only)."""
    page_id = f"{file_path.stem}_p{page_num}"
    with ctx.store_lock:
        ctx.vision_pending.pop(page_id, None)


def snapshot_vision_pending(ctx: PipelineContext) -> list:
    """Return pending vision tasks oldest-first as (page_id, file, page, age_s)."""
    now = time.monotonic()
    with ctx.store_lock:
        items = [
            (pid, info.get("file"), info.get("page"), now - info.get("since", now))
            for pid, info in ctx.vision_pending.items()
        ]
    items.sort(key=lambda t: -t[3])
    return items


# ── Queue watchdog (shared by new_app + legacy engines) ──────────────────────
# queue.Queue.join() blocks forever if a worker wedges (e.g. a slow LLM call on
# a 55k-vector page, repeated across retries). Instead of hanging the whole
# project, poll unfinished_tasks, log progress + the oldest pending vision
# pages, and after a generous deadline proceed with partial results.
def queue_timeout_for(env_name: str, default_base_s: float, per_task_s: float, initial: int) -> float:
    try:
        base = float(os.environ.get(env_name, default_base_s))
    except ValueError:
        base = float(default_base_s)
    return max(base, per_task_s * max(initial, 1))


def wait_for_queue(ctx: PipelineContext, q, name: str, timeout_s: float, detail_fn=None) -> bool:
    """Poll-based join. Returns True if drained, False on timeout (proceed partial)."""
    initial = q.unfinished_tasks
    print(f"  [QUEUE STATUS] {name} unfinished: {initial} (watchdog deadline {timeout_s:.0f}s)")
    deadline = time.monotonic() + timeout_s
    last_log = 0.0
    while True:
        remaining = q.unfinished_tasks
        if remaining <= 0:
            print(f"  [QUEUE STATUS] {name} joined.")
            return True
        now = time.monotonic()
        if now - last_log >= 30.0:
            last_log = now
            extra = detail_fn() if detail_fn else ""
            print(f"  [QUEUE STATUS] {name} unfinished: {remaining} (started {initial}){extra}")
        if now >= deadline:
            print(f"  [QUEUE TIMEOUT] {name} still has {remaining} unfinished task(s) after "
                  f"{timeout_s:.0f}s -- proceeding with partial results.")
            if detail_fn:
                print(f"  [QUEUE TIMEOUT] pending detail:{detail_fn()}")
            return False
        time.sleep(5.0)


def vision_pending_detail(ctx: PipelineContext) -> str:
    pending = snapshot_vision_pending(ctx)
    if not pending:
        return " (no tracked vision pages pending)"
    lines = []
    for pid, fkey, pg, age in pending[:8]:
        lines.append(f"\n      - {pid} [{fkey}] stuck {age:.0f}s")
    more = f"\n      ... +{len(pending) - 8} more" if len(pending) > 8 else ""
    return "".join(lines) + more


def push_text_task(ctx: PipelineContext, priority: int, task_type: str, task_data: dict):
    """
    Thread-safe helper to push a task to the PriorityQueue text_queue.
    Increments a unique counter to prevent Python from trying to compare dictionary arguments.
    """
    with ctx.store_lock:
        ctx.queue_counter += 1
        cnt = ctx.queue_counter
    ctx.text_queue.put((priority, cnt, task_type, task_data))


def register_page_classified(ctx: PipelineContext, file_path: Path, page_num: int, is_fallback: bool):
    """
    Thread-safe progress registry. Tracks classified pages and groups fallback pages
    into chunks of 3 pages to be sent to the text queue. Any remaining pages are flushed
    once all pages of the document are classified.
    """
    file_name = file_path.name
    file_key = ctx.file_key(file_path)
    with ctx.store_lock:
        if file_key not in ctx.classified_pages_count:
            ctx.classified_pages_count[file_key] = 0
            ctx.accumulated_fallback_pages[file_key] = []

        if is_fallback:
            ctx.accumulated_fallback_pages[file_key].append(page_num)

        ctx.classified_pages_count[file_key] += 1
        classified_count = ctx.classified_pages_count[file_key]
        total_pages = ctx.doc_total_pages.get(file_key, 0)

        # Trigger batch logic when we hit a multiple of 3 pages
        flushed_batch = []
        if len(ctx.accumulated_fallback_pages[file_key]) >= 10:
            # Pop exactly 3 pages
            fallback_list = sorted(ctx.accumulated_fallback_pages[file_key])
            flushed_batch = fallback_list[:10]
            ctx.accumulated_fallback_pages[file_key] = fallback_list[10:]

        # If document is complete, flush whatever is left
        leftovers = []
        if classified_count == total_pages:
            leftovers = sorted(ctx.accumulated_fallback_pages[file_key])
            ctx.accumulated_fallback_pages[file_key] = []

    # Send flushed batches outside the lock to avoid lock contention
    if flushed_batch:
        logger.info(f"[BATCHING] Flushing {len(flushed_batch)} fallback pages for {file_name}: {flushed_batch}")
        push_text_task(ctx, 2, "fallback_batch", {"file_path": file_path, "pages": flushed_batch})

    if leftovers:
        logger.info(f"[BATCHING] Flushing remaining fallback pages for {file_name}: {leftovers}")
        push_text_task(ctx, 2, "fallback_batch", {"file_path": file_path, "pages": leftovers})


# ── Fast Drawing Detection ────────────────────────────────────────────────────
_MEANINGFUL_IMAGE_MIN_DIM = 100  # px


def _has_meaningful_image(page) -> bool:
    """
    True if the page has at least one embedded raster image large enough to be
    real drawing/screenshot content (a pasted floor-plan or product screenshot),
    as opposed to a small email-signature icon or company logo. GFS/social
    signature icons are consistently <=75px on both axes — without this filter,
    any page in an otherwise plain-text email that happens to carry a signature
    icon gets misclassified as needing Vision/drawing-prompt review, which uses
    a prompt tuned for CAD title blocks and cannot reliably read prose contact
    info or plain-English unit/quantity statements the way the text prompt can.
    """
    for info in page.get_image_info():
        if info.get("width", 0) >= _MEANINGFUL_IMAGE_MIN_DIM and info.get("height", 0) >= _MEANINGFUL_IMAGE_MIN_DIM:
            return True
    return False


def check_if_drawing_pdf(pdf_path: Path) -> bool:
    """
    Check if the PDF contains vector drawings or raster images in under 2ms per page.
    If it has drawings on any page, returns True.

    Embedded raster images (e.g. a floor-plan screenshot pasted into an
    otherwise plain-text email) are checked on EVERY page regardless of page
    size — an image on a normal letter-size page is still drawing/location
    content that needs Vision, not just text extraction. The vector-shape-
    count heuristic (CAD blueprints) stays gated to large-format pages only,
    since small pages can have incidental vector paths from text rendering.
    Only images at least _MEANINGFUL_IMAGE_MIN_DIM px on both axes count —
    see _has_meaningful_image for why small icons/logos are excluded.
    """
    if pdf_path.suffix.lower() != ".pdf":
        return False
    try:
        doc = fitz.open(str(pdf_path))
        for page in doc:
            # Embedded raster images (e.g. a floor-plan screenshot pasted into an
            # otherwise plain-text email) are checked on EVERY page regardless of
            # page size -- an image on a normal letter-size page is still
            # drawing/location content that needs Vision, not just text
            # extraction. Only the vector-shape-count heuristic (CAD blueprints)
            # stays gated to large-format pages, since small pages can have
            # incidental vector paths from text rendering.
            if _has_meaningful_image(page):
                doc.close()
                return True

            w, h = page.rect.width / 72.0, page.rect.height / 72.0
            if max(w, h) <= 17.0 and len(page.get_drawings()) <= 50:
                continue

            if len(page.get_drawings()) > 30:  # CAD blueprints have many vector shapes
                doc.close()
                return True
        doc.close()
    except Exception as exc:
        logger.error(f"Error checking if PDF is drawing {pdf_path.name}: {exc}")
    return False


# ── Worker 1: Azure DI Layout Worker ──────────────────────────────────────────
def azure_di_worker(ctx: PipelineContext, stop_event: threading.Event):
    """
    Pops files from ctx.azure_queue, runs document-level Azure DI layout,
    and writes layout data to non_ai_results/.
    If the Azure queue is empty, dynamically switches roles to help process text LLM tasks.
    """
    non_ai_dir = ctx.project_folder / "non_ai_results"
    non_ai_dir.mkdir(parents=True, exist_ok=True)

    while not stop_event.is_set():
        # Dynamic role-switch: help process text LLM tasks if azure_queue is empty but text_queue has tasks
        if ctx.azure_queue.empty() and not ctx.text_queue.empty():
            logger.info("[AZURE WORKER] Azure queue is empty. Helping process text LLM tasks...")
            try:
                priority, cnt, task_type, task_data = ctx.text_queue.get(timeout=1.0)
                try:
                    process_text_llm_task(ctx, task_type, task_data)
                finally:
                    ctx.text_queue.task_done()
            except queue.Empty:
                pass
            continue

        try:
            task = ctx.azure_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        file_path = task["file_path"]
        is_drawing = task["is_drawing"]
        file_name = file_path.name
        file_key = ctx.file_key(file_path)

        # Skip tiny email signature images to avoid Azure 400 Bad Request errors
        is_signature = False
        if file_path.suffix.lower() in (".png", ".jpg", ".jpeg"):
            try:
                with Image.open(file_path) as img:
                    w, h = img.size
                if w < 50 or h < 50:
                    is_signature = True
                    logger.info(f"[AZURE WORKER] Skipping tiny email signature image {file_name} ({w}x{h})")
            except Exception as size_exc:
                logger.warning(f"[AZURE WORKER] Failed to read image size for {file_name}: {size_exc}")

        if is_signature:
            with ctx.store_lock:
                ctx.shared_layouts[file_key] = {
                    "n_pages": 1,
                    "headings": [],
                    "paragraphs": [],
                    "tables": [],
                    "figures": [],
                    "full_text_by_page": {"1": ""},
                    "visual_pages": [],
                    "is_email": False,
                    "is_email_signature_image": True
                }
                if file_key in ctx.layout_ready_events:
                    ctx.layout_ready_events[file_key].set()
            ctx.azure_queue.task_done()
            continue

        logger.info(f"[AZURE WORKER] Starting Azure DI for {file_name}...")
        try:
            file_bytes = file_path.read_bytes()

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                analyze_result = loop.run_until_complete(call_azure_layout_chunked(file_bytes))
            finally:
                loop.close()

            n_pages = len(analyze_result.get("pages", []))
            full_text_by_page = {}
            paragraphs = analyze_result.get("paragraphs", [])
            for para in paragraphs:
                pg = str(para.get("boundingRegions", [{}])[0].get("pageNumber", 1))
                full_text_by_page.setdefault(pg, []).append(para.get("content", ""))

            for pg in full_text_by_page:
                full_text_by_page[pg] = "\n".join(full_text_by_page[pg])

            # Reconcile Azure's page count against the real (fitz) page count.
            # A chunked/partial Azure result can return fewer pages than the PDF
            # actually has -- downstream code (prefilter lookups, text batches)
            # indexes by page number, so missing entries surface as phantom
            # "Page N of <shorter-by-Azure file>" symptoms. Pad with empty text
            # and warn loudly instead of silently disagreeing with dispatch.
            try:
                with fitz.open(str(file_path)) as _doc:
                    fitz_pages = len(_doc)
                if fitz_pages != n_pages:
                    logger.warning(
                        f"[AZURE WORKER] Page-count mismatch for {file_name}: "
                        f"Azure DI returned {n_pages} page(s), PDF has {fitz_pages}. "
                        f"Padding missing pages with empty text."
                    )
                    n_pages = max(n_pages, fitz_pages)
            except Exception as count_exc:
                logger.warning(f"[AZURE WORKER] Could not verify fitz page count for {file_name}: {count_exc}")
            for _pg in range(1, n_pages + 1):
                full_text_by_page.setdefault(str(_pg), "")

            tables = []
            for t_idx, t in enumerate(analyze_result.get("tables", [])):
                cells = []
                for cell in t.get("cells", []):
                    cells.append({
                        "row": cell.get("rowIndex"),
                        "col": cell.get("columnIndex"),
                        "text": cell.get("content", "")
                    })
                pg = t.get("boundingRegions", [{}])[0].get("pageNumber", 1)
                t_polygon = t.get("boundingRegions", [{}])[0].get("polygon")
                tables.append({
                    "page": pg,
                    "bbox": get_bbox_from_polygon(t_polygon) if t_polygon else None,
                    "n_rows": t.get("rowCount"),
                    "n_cols": t.get("columnCount"),
                    "cells": cells
                })

            figures_list = []
            try:
                figures_list = crop_figures(
                    file_bytes=file_bytes,
                    file_name=file_name,
                    azure_result=analyze_result,
                    output_dir=ctx.project_folder,
                    template_hashes=TEMPLATE_HASHES,
                    global_seen_hashes=ctx.global_seen_hashes,  # FIX #2: per-project, not module global
                )
            except Exception as crop_exc:
                logger.error(f"[AZURE WORKER] Figure cropping failed for {file_name}: {crop_exc}")

            doc_entry = {
                "n_pages": n_pages,
                "headings": [],
                "paragraphs": [
                    {
                        "text": p.get("content", ""),
                        "page": p.get("boundingRegions", [{}])[0].get("pageNumber", 1),
                        "bbox": get_bbox_from_polygon(p.get("boundingRegions", [{}])[0].get("polygon")) if p.get("boundingRegions", [{}])[0].get("polygon") else None
                    } for p in paragraphs
                ],
                "tables": tables,
                "figures": figures_list,
                "full_text_by_page": full_text_by_page,
                "visual_pages": [],
                "is_email": False
            }

            non_ai_dir.mkdir(parents=True, exist_ok=True)
            layout_path = non_ai_dir / f"{file_path.stem}_layout.json"
            layout_path.write_text(json.dumps(doc_entry, indent=2, ensure_ascii=False), encoding="utf-8")
            logger.info(f"[AZURE WORKER] Saved layout metadata for {file_name}")

            with ctx.store_lock:
                ctx.shared_layouts[file_key] = doc_entry
                if file_key in ctx.layout_ready_events:
                    ctx.layout_ready_events[file_key].set()

            if not is_drawing:
                logger.info(f"[AZURE WORKER] File {file_name} has no drawings. Queuing text extraction scan as Priority 1.")
                ctx.stats["pages_text"] += 1
                push_text_task(ctx, 1, "text_pdf", {"file_path": file_path, "doc_entry": doc_entry})

        except Exception as exc:
            logger.error(f"[AZURE WORKER] Failed to process {file_name}: {exc}", exc_info=True)
            with ctx.store_lock:
                # Set a fallback dummy layout so waiting worker threads don't block
                if file_key not in ctx.shared_layouts:
                    ctx.shared_layouts[file_key] = {
                        "n_pages": 1,
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                        "full_text_by_page": {"1": ""},
                        "visual_pages": [],
                        "is_email": False
                    }
                if file_key not in ctx.layout_ready_events:
                    ctx.layout_ready_events[file_key] = threading.Event()
                ctx.layout_ready_events[file_key].set()
        finally:
            ctx.azure_queue.task_done()



# ── Helper: Process Single Vision Page Task ───────────────────────────────────
def process_vision_task(ctx: PipelineContext, task: dict):
    """
    Executes the visual extraction crop, tile, LLM request, and file save for a single page task.
    """
    file_path = task["file_path"]
    page_num = task["page_num"]
    page_type = task["page_type"]
    page_type_hint = task["page_type_hint"]
    file_name = file_path.name
    file_key = ctx.file_key(file_path)

    logger.info(f"[VISION] Processing drawing page {page_num} of {file_name}...")
    ctx.stats["pages_vision_processed"] += 1
    # Wait briefly for text context (lead sheet extraction), but don't block forever
    ctx.text_context_ready.wait(timeout=30.0)
    if ctx.customer_context_summary:
        page_type_hint = ctx.customer_context_summary + "\n" + page_type_hint
    try:
        event = None
        with ctx.store_lock:
            if file_key not in ctx.layout_ready_events:
                ctx.layout_ready_events[file_key] = threading.Event()
            event = ctx.layout_ready_events[file_key]

        if not event.wait(timeout=LAYOUT_WAIT_S):
            logger.error(f"[VISION] Timeout waiting for layout coordinates of {file_name}")
            with ctx.store_lock:
                if file_key not in ctx.shared_layouts:
                    ctx.shared_layouts[file_key] = {
                        "n_pages": page_num,
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                        "full_text_by_page": {str(page_num): ""},
                        "visual_pages": [],
                        "is_email": False
                    }

            return

        doc_entry = ctx.shared_layouts[file_key]

        if doc_entry.get("is_email_signature_image"):
            logger.info(f"[VISION] Skipping tiny email signature image visual analysis for {file_name}")
            return


        page_figures = [f for f in doc_entry.get("figures", []) if f.get("page") == page_num]
        doc_entry_page = dict(doc_entry)
        doc_entry_page["figures"] = page_figures

        page_text = doc_entry.get("full_text_by_page", {}).get(str(page_num), "")
        tables = [t for t in doc_entry.get("tables", []) if t.get("page") == page_num]

        chunk = [{
            "pdf_name": file_name,
            "pdf_path": file_path,
            "page_num": page_num,
            "text": page_text,
            "tables": tables,
            "page_type_hint": page_type_hint,
            "page_type": page_type
        }]

        raw_response = new_run_batch_with_retry(
            chunk=chunk,
            prompt=EXTRACTION_DRAWING_PROMPT,
            doc_entry=doc_entry_page,
            batch_index=0,
            total_batches=1,
            render_images=True,
            use_tiling=True
        )

        drawing_pages = {page_num}
        token_tracker.track("vision", raw_response.get("token_usage", {}) if isinstance(raw_response, dict) else {})
        merged_page_result = merge_extraction_results(
            [raw_response],
            project_id=file_path.stem,
            all_page_texts={str(page_num): page_text},
            drawing_pages=drawing_pages,
            skip_reconciler=True,
        )

        page_id = f"{file_path.stem}_p{page_num}"
        output_dir = ctx.project_folder / "extraction_results"
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{page_id}_vision.json"
        out_path.write_text(json.dumps(merged_page_result, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info(f"[VISION] Saved visual extraction results for page {page_num}")

        with ctx.store_lock:
            ctx.shared_vision_results[page_id] = merged_page_result

    except Exception as exc:
        logger.error(f"[VISION] Failed on page {page_num} of {file_name}: {exc}", exc_info=True)
        ctx.stats["pages_vision_failed"] += 1
        # NOTE: still no result written on failure -- see fix #3 (dead-letter
        # marking) recommended separately; not in scope for fixes #1/#2.
    finally:
        # Always clear the watchdog pending-tracker so a finished/failed page
        # never looks stuck. Queue bookkeeping (task_done) stays with callers.
        track_vision_finished(ctx, file_path, page_num)


# ── FIX #1: Helper: Process a single TEXT-ONLY page (the missing fallback) ───
def process_text_only_task(ctx: PipelineContext, task: dict):
    """
    Runs the text extraction prompt on ONE page's already-extracted DI text,
    with no image involved. This is the destination for any page that fails
    the has_vectors check inside classifier_worker -- previously such pages
    were just `continue`d and their content was never extracted at all.
    """
    file_path = task["file_path"]
    page_num = task["page_num"]
    file_name = file_path.name
    file_key = ctx.file_key(file_path)

    logger.info(f"[TEXT-PAGE] Processing text-only page {page_num} of {file_name}...")
    try:
        event = None
        with ctx.store_lock:
            if file_key not in ctx.layout_ready_events:
                ctx.layout_ready_events[file_key] = threading.Event()
            event = ctx.layout_ready_events[file_key]

        if not event.wait(timeout=LAYOUT_WAIT_S):
            logger.error(f"[TEXT-PAGE] Timeout waiting for layout coordinates of {file_name}")
            with ctx.store_lock:
                if file_key not in ctx.shared_layouts:
                    ctx.shared_layouts[file_key] = {
                        "n_pages": page_num,
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                        "full_text_by_page": {str(page_num): ""},
                        "visual_pages": [],
                        "is_email": False
                    }
            return


        doc_entry = ctx.shared_layouts[file_key]
        page_text = doc_entry.get("full_text_by_page", {}).get(str(page_num), "")
        tables = [t for t in doc_entry.get("tables", []) if t.get("page") == page_num]

        # A page with no vector drawings AND no real text is genuinely empty
        # (e.g. a blank separator sheet) -- nothing to extract, safe no-op.
        if not page_text.strip() and not tables:
            logger.info(f"[TEXT-PAGE] Page {page_num} of {file_name} has no text/tables. Skipping (empty page).")
            return

        chunk = [{
            "pdf_name": file_name,
            "pdf_path": file_path,
            "page_num": page_num,
            "text": page_text,
            "tables": tables,
            "page_type_hint": "Pure-text page inside a mixed drawing/text document.",
            "page_type": "TEXT_ONLY"
        }]

        raw_response = new_run_batch_with_retry(
            chunk=chunk,
            prompt=EXTRACTION_TEXT_PROMPT,
            doc_entry=doc_entry,
            batch_index=0,
            total_batches=1,
            render_images=False,   # no image needed -- text only
            use_tiling=False
        )

        merged_page_result = merge_extraction_results(
            [raw_response],
            project_id=file_path.stem,
            all_page_texts={str(page_num): page_text},
            drawing_pages=set(),
            skip_reconciler=True,
        )

        page_id = f"{file_path.stem}_p{page_num}"
        output_dir = ctx.project_folder / "extraction_results"
        output_dir.mkdir(parents=True, exist_ok=True)
        # Distinct suffix from both *_text.json (whole-file) and *_vision.json
        # (per-page image-based) so the consolidation step can tell them apart
        # while still merging all three into one final per-document result.
        out_path = output_dir / f"{page_id}_textpage.json"
        out_path.write_text(json.dumps(merged_page_result, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info(f"[TEXT-PAGE] Saved text-only extraction results for page {page_num}")

        with ctx.store_lock:
            ctx.shared_text_page_results[page_id] = merged_page_result

    except Exception as exc:
        logger.error(f"[TEXT-PAGE] Failed on page {page_num} of {file_name}: {exc}", exc_info=True)


def process_text_batch_task(ctx: PipelineContext, task_data: dict):
    """
    Processes a batch of text-only fallback pages in a single LLM call.
    """
    file_path = task_data["file_path"]
    pages = task_data["pages"]
    file_name = file_path.name
    file_key = ctx.file_key(file_path)

    logger.info(f"[TEXT-BATCH] Processing pages {pages} of {file_name}...")
    try:
        event = None
        with ctx.store_lock:
            if file_key not in ctx.layout_ready_events:
                ctx.layout_ready_events[file_key] = threading.Event()
            event = ctx.layout_ready_events[file_key]

        if not event.wait(timeout=LAYOUT_WAIT_S):
            logger.error(f"[TEXT-BATCH] Timeout waiting for layout coordinates of {file_name}")
            return


        doc_entry = ctx.shared_layouts[file_key]

        chunk = []
        for page_num in pages:
            page_text = doc_entry.get("full_text_by_page", {}).get(str(page_num), "")
            tables = [t for t in doc_entry.get("tables", []) if t.get("page") == page_num]

            if not page_text.strip() and not tables:
                logger.info(f"[TEXT-BATCH] Page {page_num} of {file_name} has no text/tables. Skipping empty page.")
                continue

            chunk.append({
                "pdf_name": file_name,
                "pdf_path": file_path,
                "page_num": page_num,
                "text": page_text,
                "tables": tables,
                "page_type_hint": "Pure-text page inside a mixed drawing/text document.",
                "page_type": "TEXT_ONLY"
            })

        if not chunk:
            logger.info(f"[TEXT-BATCH] Batch {pages} for {file_name} is empty. Skipping.")
            return

        raw_response = new_run_batch_with_retry(
            chunk=chunk,
            prompt=EXTRACTION_TEXT_PROMPT,
            doc_entry=doc_entry,
            batch_index=0,
            total_batches=1,
            render_images=False,
            use_tiling=False
        )

        token_tracker.track("text", raw_response.get("token_usage", {}) if isinstance(raw_response, dict) else {})
        output_dir = ctx.project_folder / "extraction_results"
        output_dir.mkdir(parents=True, exist_ok=True)

        for record in chunk:
            p_num = record["page_num"]
            p_text = record["text"]

            merged_page_result = merge_extraction_results(
                [raw_response],
                project_id=file_path.stem,
                all_page_texts={str(p_num): p_text},
                drawing_pages=set(),
                skip_reconciler=True,
            )

            page_id = f"{file_path.stem}_p{p_num}"
            out_path = output_dir / f"{page_id}_textpage.json"
            out_path.write_text(json.dumps(merged_page_result, indent=2, ensure_ascii=False), encoding="utf-8")
            logger.info(f"[TEXT-BATCH] Saved text-only results for page {p_num}")

            with ctx.store_lock:
                ctx.shared_text_page_results[page_id] = merged_page_result

    except Exception as exc:
        logger.error(f"[TEXT-BATCH] Failed on pages {pages} of {file_name}: {exc}", exc_info=True)


# ── Worker 2: Classifier Worker ───────────────────────────────────────────────
def classifier_worker(ctx: PipelineContext, stop_event: threading.Event):
    """
    Pops single drawing pages from ctx.classifier_queue and classifies them.
    - Pages with real vector/raster content -> classified visually, GFS-relevant
      ones go to ctx.vision_queue.
    - Pages with no vector/raster content -> FIX #1: routed to ctx.text_queue
      instead of being silently dropped.
    Also dynamically helps drain ctx.vision_queue when it's backed up.
    """
    while not stop_event.is_set():
        if ctx.vision_queue.qsize() >= 10 or (ctx.classifier_queue.empty() and not ctx.vision_queue.empty()):
            logger.info("[CLASSIFIER WORKER] Vision queue needs help or classification is done. Helping process vision tasks...")
            try:
                task = ctx.vision_queue.get(timeout=1.0)
                try:
                    process_vision_task(ctx, task)
                finally:
                    ctx.vision_queue.task_done()
            except queue.Empty:
                pass
            continue

        try:
            task = ctx.classifier_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        file_path = task["file_path"]
        pg = task["page_num"]
        file_name = file_path.name
        file_key = ctx.file_key(file_path)
        # Tracks whether this page was counted via register_page_classified.
        # EVERY path below must leave this True -- otherwise the document's
        # classified counter never reaches its total, leftover fallback pages
        # are never flushed, and those pages silently vanish from the result.
        registered = False

        try:
            has_vectors = False
            try:
                doc_temp = fitz.open(str(file_path))
                try:
                    if pg < 1 or pg > len(doc_temp):
                        logger.error(
                            f"[CLASSIFIER WORKER] Page {pg} out of range for {file_name} "
                            f"({len(doc_temp)} pages). Routing to text fallback."
                        )
                    else:
                        page_temp = doc_temp[pg - 1]
                        has_vectors = _has_meaningful_image(page_temp) or len(page_temp.get_drawings()) > 30
                finally:
                    doc_temp.close()
            except Exception as e:
                logger.error(f"Error checking vector elements on page {pg} of {file_name}: {e}")

            if not has_vectors:
                logger.info(
                    f"[CLASSIFIER WORKER] Page {pg} of {file_name} has no vector/raster content. "
                    f"Routing to dynamic text-only page batching."
                )
                register_page_classified(ctx, file_path, pg, is_fallback=True)
                registered = True
                continue

            # OCR Text Pre-Filter: Check Azure DI layout text before calling Vision LLM
            event = None
            with ctx.store_lock:
                if file_key not in ctx.layout_ready_events:
                    ctx.layout_ready_events[file_key] = threading.Event()
                event = ctx.layout_ready_events[file_key]

            if not event.wait(timeout=LAYOUT_WAIT_S):
                logger.error(f"[PREFILTER] Timeout waiting for layout text of {file_name}")

            else:
                doc_entry = ctx.shared_layouts.get(file_key, {})
                page_text = doc_entry.get("full_text_by_page", {}).get(str(pg), "")
                decision, reason = evaluate_page_text(page_text)
                if decision == "SKIP_VISION":
                    logger.info(f"[PREFILTER] Page {pg} of {file_name} pre-filtered to SKIP Vision LLM: {reason}")
                    ctx.stats["pages_prefilter_skip"] += 1
                    register_page_classified(ctx, file_path, pg, is_fallback=False)
                    registered = True
                    continue
                elif decision == "SEND_VISION":
                    logger.info(f"[PREFILTER] Page {pg} of {file_name} confirmed for Vision LLM: {reason}. Direct routing to Vision Queue.")
                    ctx.stats["pages_prefilter_vision"] += 1
                    ctx.vision_queue.put({
                        "file_path": file_path,
                        "page_num": pg,
                        "page_type": "FLOOR_PLAN" if "plan" in reason.lower() else "DETAIL",
                        "page_type_hint": f"Confirmed glass drawing page via text pre-filter: {reason}"
                    })
                    track_vision_enqueued(ctx, file_path, pg)
                    register_page_classified(ctx, file_path, pg, is_fallback=False)
                    registered = True
                    continue

            b64 = _render_page_to_jpeg_b64(file_path, pg)
            if b64 is None:
                # Render failure (e.g. giant vector page exhausting memory at
                # every DPI attempt). The page still counts as classified and
                # goes to the text fallback path -- it must NOT vanish.
                logger.warning(
                    f"[CLASSIFIER WORKER] Page {pg} of {file_name} failed to render. "
                    f"Routing to dynamic text-only page batching."
                )
                register_page_classified(ctx, file_path, pg, is_fallback=True)
                registered = True
                continue

            image_block = {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{b64}",
                    "detail": "high"
                }
            }

            try:
                raw = call_vision_batch(image_blocks=[image_block], prompt=CLASSIFIER_PROMPT, max_completion_tokens=1000)
                token_tracker.track("classifier", raw.get("token_usage", {}))
            except Exception as exc:
                logger.error(f"Classifier API call failed for page {pg} of {file_name}: {exc}")
                raw = {}

            relevant, page_type, sheet_code, reasoning = _parse_single_page_response(raw)
            logger.info(f"[CLASSIFIER] page {pg} of {file_name}: {relevant} | {page_type} | {sheet_code}")

            ctx.stats["pages_to_classifier"] += 1
            if relevant in ("YES", "MAYBE"):
                ctx.vision_queue.put({
                    "file_path": file_path,
                    "page_num": pg,
                    "page_type": page_type,
                    "page_type_hint": f"PRE-CLASSIFIED AS GLASS-RELEVANT ({page_type}). Extract skylight/glass openings. For dimensions: subtract coordinate pairs at opposite corners (N2-N1 for one axis, E2-E1 for the other). Convert to inches. {reasoning}"
                })
                track_vision_enqueued(ctx, file_path, pg)
                ctx.stats["pages_classifier_vision"] += 1
                register_page_classified(ctx, file_path, pg, is_fallback=False)
                registered = True
            else:
                # Page has vector/raster content but was classified NO
                ctx.stats["pages_classifier_no"] += 1
                # Drawing pages rejected by classifier are skipped entirely.
                # Only pure text pages go to text LLM — not rejected drawings.
                register_page_classified(ctx, file_path, pg, is_fallback=False)
                registered = True

        except Exception as exc:
            logger.error(f"[CLASSIFIER WORKER] Failed on page {pg} of {file_name}: {exc}", exc_info=True)
            if not registered:
                # Last-resort counting so one bad page can't wedge the whole
                # document's fallback flush (classified_count < total forever).
                try:
                    register_page_classified(ctx, file_path, pg, is_fallback=True)
                except Exception as reg_exc:
                    logger.error(f"[CLASSIFIER WORKER] Fallback registration failed for page {pg} of {file_name}: {reg_exc}")
        finally:
            ctx.classifier_queue.task_done()


# ── Worker 3: Vision Extraction Worker ────────────────────────────────────────
def vision_worker(ctx: PipelineContext, stop_event: threading.Event):
    """
    Pops drawing pages from vision_queue and runs vision extraction helper.
    If the vision queue is empty, dynamically switches roles to help process text LLM tasks.
    """
    while not stop_event.is_set():
        # Help text queue if vision queue is empty but text queue has tasks
        if ctx.vision_queue.empty() and not ctx.text_queue.empty():
            logger.info("[VISION WORKER] Vision queue is empty. Helping process text LLM tasks...")
            try:
                priority, cnt, task_type, task_data = ctx.text_queue.get(timeout=1.0)
                try:
                    process_text_llm_task(ctx, task_type, task_data)
                finally:
                    ctx.text_queue.task_done()
            except queue.Empty:
                pass
            continue

        try:
            task = ctx.vision_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        try:
            process_vision_task(ctx, task)
        finally:
            ctx.vision_queue.task_done()


# ── Helper: Process Text LLM Task (Context & Fallbacks) ───────────────────────
def process_text_llm_task(ctx: PipelineContext, task_type: str, task_data: dict):
    """
    Directs a task from the priority text_queue to the correct text LLM handler.
    """
    if task_type in ("email", "text_pdf"):
        file_path = task_data["file_path"]
        doc_entry = task_data["doc_entry"]
        run_text_extraction(ctx, file_path, doc_entry)
    elif task_type == "fallback_page":
        process_text_only_task(ctx, task_data)
    elif task_type == "fallback_batch":
        process_text_batch_task(ctx, task_data)


# ── FIX #1: Worker 4: Text-only Page Extraction Worker ───────────────────────
def text_page_worker(ctx: PipelineContext, stop_event: threading.Event):
    """
    Pops single-page text-only or chunked document context tasks from ctx.text_queue
    and extracts them based on Priority (Priority 1 = Context, Priority 2 = Fallbacks).
    If the text queue is empty, dynamically switches roles to help process vision tasks.
    """
    while not stop_event.is_set():
        # Help vision queue if text queue is empty but vision queue has tasks
        if ctx.text_queue.empty() and not ctx.vision_queue.empty():
            logger.info("[TEXT WORKER] Text queue is empty. Helping process vision tasks...")
            try:
                task = ctx.vision_queue.get(timeout=1.0)
                try:
                    process_vision_task(ctx, task)
                finally:
                    ctx.vision_queue.task_done()
            except queue.Empty:
                pass
            continue

        try:
            priority, cnt, task_type, task_data = ctx.text_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        try:
            process_text_llm_task(ctx, task_type, task_data)
        finally:
            ctx.text_queue.task_done()


# ── Custom Run Batch supporting Pre-cropped Figures ───────────────────────────
def new_run_batch(
    chunk: list,
    prompt: str,
    doc_entry: dict,
    batch_index: int,
    total_batches: int,
    render_images: bool = True,
    use_tiling: bool = False,
) -> dict:
    """
    Build interleaved image blocks for one chunk of page records.
    Always includes any pre-cropped figures (flagged drawings) for the page.
    (Unchanged from original -- not part of fixes #1/#2.)
    """
    logger.info(f"[BATCH {batch_index + 1}/{total_batches}] {len(chunk)} page(s) dispatched")
    try:
        image_blocks = []
        for page in chunk:
            pdf_name = page.get("pdf_name", "unknown")
            pg = page["page_num"]
            page_text = page.get("text") or ""
            tables = page.get("tables") or []
            pdf_path = page.get("pdf_path")
            render_start = time.monotonic()

            page_type_hint = page.get("page_type_hint", "")
            page_text_parts = [f"\n--- Document: {pdf_name} | Page {pg} ---"]

            page_type = (page.get("page_type") or "").upper()

            page_is_large_format = pdf_path is not None and needs_tiling(pdf_path, pg)
            # FLOOR_PLAN pages are NOT tiled — they need full-page context for coordinate-derived dimensions.
            # Tiling fragments coordinate pairs across tiles, breaking dimension math.
            # ROOF_PLAN and SCHEDULE pages are still tiled as before.
            # PLAN pages (FLOOR_PLAN, ROOF_PLAN, SITE_PLAN) are NOT tiled —
            # they need full-page context for coordinate-derived dimensions.
            # Only SCHEDULE pages are tiled (table rows are independent).
            PLAN_TYPES = ["FLOOR_PLAN", "ROOF_PLAN", "SITE_PLAN"]
            page_is_plan = any(k in page_type for k in PLAN_TYPES)
            page_is_tiled = use_tiling and page_is_large_format and "SCHEDULE" in page_type
            page_is_floor_plan = page_is_plan  # used for DPI selection below

            if page_is_tiled:
                page_text_parts.append(
                    "NOTE: This is a large-format CAD sheet. Tiled views are included below."
                )

            if page_type_hint:
                page_text_parts.append(f"PAGE TYPE CONTEXT:\n{page_type_hint}")
            if page_text.strip():
                page_text_parts.append("PARAGRAPHS:")
                page_text_parts.append(page_text)
            if tables:
                page_text_parts.append("TABLES:")
                for t_idx, t in enumerate(tables):
                    page_text_parts.append(f"  Table {t_idx + 1}:")
                    for cell in t.get("cells", []):
                        page_text_parts.append(f"    Row {cell.get('row')}, Col {cell.get('col')}: {cell.get('text', '')}")

            page_text_full = "\n".join(page_text_parts)
            image_blocks.append({"type": "text", "text": page_text_full})

            if not page_is_tiled:
                page_figures = [f for f in doc_entry.get("figures", []) if f.get("page") == pg]
                for fig in page_figures:
                    img_path_str = fig.get("cropped_image_path")
                    if img_path_str:
                        img_path = Path(img_path_str)
                        if img_path.exists():
                            try:
                                fig_bytes = img_path.read_bytes()
                                b64 = base64.b64encode(fig_bytes).decode("utf-8")
                                image_blocks.append({
                                    "type": "text",
                                    "text": f"[Flagged drawing block {fig.get('figure_id')} on page {pg}]"
                                })
                                image_blocks.append({
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{b64}",
                                        "detail": "high"
                                    }
                                })
                                logger.info(f"Appended flagged drawing {fig.get('figure_id')} for page {pg}")
                            except Exception as e:
                                logger.error(f"Failed to load figure image {img_path}: {e}")

            is_pdf = pdf_path is not None and pdf_path.suffix.lower() == ".pdf"
            if pdf_path is not None and render_images and is_pdf:
                try:
                    # Warn on monster vector pages up-front: these dominate
                    # render time and LLM payload size, and are the pages most
                    # likely to wedge the vision queue.
                    try:
                        with fitz.open(str(pdf_path)) as _vdoc:
                            if 1 <= pg <= len(_vdoc):
                                _nvec = len(_vdoc[pg - 1].get_drawings())
                                if _nvec > 10000:
                                    logger.warning(
                                        f"[RENDER] {pdf_name} p{pg} has {_nvec} vector paths -- "
                                        f"expect a slow render + large payload."
                                    )
                    except Exception:
                        pass
                    if page_is_tiled:
                        logger.info(f"[RENDER] {pdf_name} p{pg} — using OCR tiles")
                        # For plan pages: prepend a 150 DPI overview so Vision has
                        # full spatial context for coordinate math, then add tiles
                        # for small-text detail. Best of both worlds.
                        if page_is_floor_plan:
                            try:
                                doc = fitz.open(str(pdf_path))
                                fitz_page = doc[pg - 1]
                                for overview_dpi in [150, 100, 72]:
                                    zoom = overview_dpi / 72
                                    mat = fitz.Matrix(zoom, zoom)
                                    try:
                                        pix = fitz_page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
                                        break
                                    except Exception:
                                        continue
                                doc.close()
                                if pix is not None:
                                    png_bytes = pix.tobytes("png")
                                    b64 = base64.b64encode(png_bytes).decode("utf-8")
                                    image_blocks.append({"type": "text", "text": f"[OVERVIEW — full page at 150 DPI for spatial context: {pdf_name} p{pg}]"})
                                    image_blocks.append({
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/png;base64,{b64}",
                                            "detail": "high"
                                        }
                                    })
                                    logger.info(f"[RENDER] {pdf_name} p{pg} — overview at 150 DPI prepended before tiles")
                            except Exception as e:
                                logger.warning(f"Overview render failed for {pdf_name} p{pg}: {e}")
                        tiles = render_page_tiles(pdf_path, pg, doc_entry=doc_entry)
                        for tile in tiles:
                            image_blocks.extend(tile_to_image_block(tile, pdf_name))
                    else:
                        logger.info(f"[RENDER] {pdf_name} p{pg} @ 200 DPI")
                        doc = fitz.open(str(pdf_path))
                        pix = None
                        fitz_page = doc[pg - 1]
                        start_dpi = 150 if page_is_floor_plan else 200
                        for current_dpi in ([150, 100, 72] if page_is_floor_plan else [200, 150, 100, 72]):
                            zoom = current_dpi / 72
                            mat = fitz.Matrix(zoom, zoom)
                            try:
                                pix = fitz_page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
                                break
                            except Exception:
                                continue
                        doc.close()

                        if pix is not None:
                            png_bytes = pix.tobytes("png")
                            b64 = base64.b64encode(png_bytes).decode("utf-8")
                            image_blocks.append({"type": "text", "text": f"[Full page image: {pdf_name} p{pg}]"})
                            image_blocks.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64}",
                                    "detail": "high"
                                }
                            })
                except Exception as exc:
                    logger.error(f"Full page render failed for page {pg}: {exc}")
                logger.info(f"[RENDER] {pdf_name} p{pg} render took {time.monotonic() - render_start:.1f}s")

        llm_start = time.monotonic()
        raw = call_vision_batch(image_blocks, prompt, max_completion_tokens=12000)
        logger.info(f"[BATCH {batch_index + 1}/{total_batches}] LLM call took {time.monotonic() - llm_start:.1f}s")
        raw["batch_index"] = batch_index
        return raw
    except Exception as exc:
        return {"ok": False, "batch_index": batch_index, "error": str(exc)}


def new_run_batch_with_retry(max_attempts: int = 3, backoff_seconds: float = 5.0, **kwargs) -> dict:
    """
    Wraps new_run_batch with up to max_attempts tries. A single failed batch
    (raw.get("ok") is False) would otherwise leave fields like customer name/
    phone/address, unit dimensions, and rafter counts permanently null with no
    distinction from "customer genuinely didn't provide this info" — that null
    then cascades into man hours, frame type, etc. Retries only on failure;
    a successful call always returns immediately on the first attempt.
    """
    chunk = kwargs.get("chunk") or []
    label = (chunk[0].get("pdf_name") if chunk else None) or "batch"
    raw = None
    for attempt in range(1, max_attempts + 1):
        raw = new_run_batch(**kwargs)
        if raw.get("ok"):
            return raw
        if attempt < max_attempts:
            logger.warning(
                f"[RETRY] Batch failed for {label} (attempt {attempt}/{max_attempts}, "
                f"error={raw.get('error')}) — retrying after {backoff_seconds}s"
            )
            time.sleep(backoff_seconds)
    return raw


# ── Helper: Run Text-only LLM Scan (whole-file, e.g. emails / non-drawing PDFs)
def run_text_extraction(ctx: PipelineContext, file_path: Path, doc_entry: dict):
    """
    Dispatches a text-only scan LLM request and saves the result to *_text.json.
    """
    output_dir = ctx.project_folder / "extraction_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    file_name = file_path.name

    try:
        page_records = []
        for pg in range(1, doc_entry.get("n_pages", 0) + 1):
            page_records.append({
                "pdf_name": file_name,
                "pdf_path": file_path,
                "page_num": pg,
                "text": doc_entry.get("full_text_by_page", {}).get(str(pg), ""),
                "tables": [t for t in doc_entry.get("tables", []) if t.get("page") == pg],
                "page_type_hint": "",
                "page_type": "UNKNOWN"
            })

        chunks = []
        for i in range(0, len(page_records), 3):
            chunks.append(page_records[i:i + 3])

        raw_results = []
        for idx, chunk in enumerate(chunks):
            res = new_run_batch_with_retry(
                chunk=chunk,
                prompt=EXTRACTION_TEXT_PROMPT,
                doc_entry=doc_entry,
                batch_index=idx,
                total_batches=len(chunks),
                render_images=False,
                use_tiling=False
            )
            raw_results.append(res)
            token_tracker.track("text", res.get("token_usage", {}) if isinstance(res, dict) else {})

        merged_text_result = merge_extraction_results(
            raw_results,
            project_id=file_path.stem,
            all_page_texts=doc_entry.get("full_text_by_page", {}),
            drawing_pages=set(),
            skip_reconciler=True,
        )
        merged_text_result["source_file"] = file_name
        merged_text_result["source_type"] = "customer_drawing" if check_if_drawing_pdf(file_path) else "lead_sheet"

        out_path = output_dir / f"{file_path.stem}_text.json"
        out_path.write_text(json.dumps(merged_text_result, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info(f"[TEXT WORKER] Saved text extraction for {file_name}")

        with ctx.store_lock:
            ctx.shared_results[ctx.file_key(file_path)] = merged_text_result
            # Build compact project context from text extraction
            units = merged_text_result.get("units", [])
            if not ctx.customer_context_summary:
                lines = []
                # Include units
                for u in (merged_text_result.get("units") or [])[:5]:
                    label = u.get("unit_label", "unit")
                    w = u.get("width_inches")
                    l = u.get("length_inches")
                    verb = (u.get("verbatim") or "")[:80]
                    dim = f"{w}x{l}in" if w and l else "dims unknown"
                    lines.append(f"- {label}: {dim} | {verb}")
                # Include glass/frame/location signals for Vision context
                for sig_type in ["glass_signals", "frame_signals", "location_signals"]:
                    sigs = merged_text_result.get(sig_type, {})
                    if isinstance(sigs, dict):
                        for field, sig in sigs.items():
                            if isinstance(sig, dict) and sig.get("value") is not None:
                                verb = (sig.get("verbatim") or "")[:60]
                                lines.append(f"- {sig_type}.{field}={sig['value']} | {verb}")
                # Include explicit statements (walkable/non-walkable/curb-mounted)
                for stmt in (merged_text_result.get("explicit_statements") or [])[:5]:
                    if isinstance(stmt, dict):
                        verb = (stmt.get("verbatim") or "")[:100]
                        if verb:
                            lines.append(f"- CUSTOMER STATED: {verb}")
                if lines:
                    ctx.customer_context_summary = "PROJECT CONTEXT (from lead sheet/email):\n" + "\n".join(lines)
                logger.info(f"[CONTEXT] Built project context: {len(units)} units from {file_name}")

        # Trigger progressive Phase 1 complete callback immediately
        cb = getattr(ctx, "on_phase1_complete", None)
        if cb and callable(cb):
            try:
                logger.info(f"[PHASE 1] Triggering progressive Phase 1 completion callback for {file_name}")
                cb(merged_text_result)
            except Exception as cb_exc:
                logger.warning(f"[PHASE 1] Progressive Phase 1 callback failed for {file_name}: {cb_exc}")

    except Exception as exc:
        logger.error(f"[TEXT WORKER] Failed text extraction for {file_name}: {exc}", exc_info=True)
    finally:
        with ctx.store_lock:
            ctx.completed_text_files += 1
            if ctx.completed_text_files >= ctx.expected_text_files:
                ctx.text_context_ready.set()
                logger.info(f"[CONTEXT] All {ctx.completed_text_files} text files processed — Vision unblocked")
