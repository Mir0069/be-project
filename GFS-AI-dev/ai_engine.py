# new_app/new_ai_engine.py
# ─────────────────────────────────────────────────────────────────────────────
# Orchestration engine for the high-performance concurrent queue pipeline.
# Replaces e:\gfs\GFS-AI-4\ai_engine.py for testing in new_app/
# ─────────────────────────────────────────────────────────────────────────────

import json
import re
import sys
import time
from pathlib import Path
import threading
from typing import Any
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import fitz

from new_app.fanout_router import (
    PipelineContext,
    azure_di_worker, classifier_worker, vision_worker, text_page_worker,
    check_if_drawing_pdf, push_text_task,
    track_vision_enqueued, queue_timeout_for, wait_for_queue, vision_pending_detail,
)

from extraction.azure_extract import extract_email_metadata
from extraction.extraction_parser import merge_signal_dicts
from extraction.local_prefilter import detect_relevant_pages_locally

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
    "pictures",
    "change orders",
    "bol",
    "sales receipt",
    "shipping pictures",
    "flagged_figures",
]

def is_skipped_path(path: Path, project_folder: Path) -> bool:
    """True if any part of the path relative to the project folder indicates internal content."""
    try:
        rel_path = path.relative_to(project_folder)
    except ValueError:
        rel_path = path
    for part in rel_path.parts[:-1]:  # exclude the file name itself
        part_lower = part.lower()
        if any(kw == part_lower or kw in part_lower for kw in INTERNAL_FOLDER_KEYWORDS):
            return True
    return False

def _safe_stem(name: str) -> str:
    """Filesystem-safe version of a PDF stem (max 160 chars)."""
    return re.sub(r"[^\w\-]+", "_", name)[:160]

def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def dedup_files_by_hash(files: list[Path]) -> list[Path]:
    """Remove byte-identical files from the list, preserving first occurrence.

    Returns a filtered list of Path objects.
    """
    import hashlib

    seen = {}
    result = []
    for p in files:
        try:
            h = hashlib.sha256(p.read_bytes()).hexdigest()
        except Exception as e:
            print(f"[WARN] Could not hash {p.name}: {e}")
            # Keep the file if it couldn't be read
            result.append(p)
            continue
        if h in seen:
            prev = seen[h]
            print(f"  ⏭️ Skipping duplicate file {p.name} (identical to {prev.name})")
            continue
        seen[h] = p
        result.append(p)
    return result


def extract_folder_date(path: Path, project_folder: Path) -> str | None:
    """Try to extract a date string from the file's containing folders.

    Looks for common patterns (YYYY-MM-DD, YYYYMMDD) in ancestor folder names.
    Falls back to file modification time ISO string when no pattern is found.
    """
    rel = None
    try:
        rel = path.resolve().relative_to(Path(project_folder).resolve())
    except Exception:
        rel = path

    # Walk up from the file's parent towards the project root
    p = path.parent
    date_re1 = re.compile(r"(\d{4}-\d{2}-\d{2})")
    date_re2 = re.compile(r"(\d{8})")
    while True:
        if p == Path(project_folder) or p == p.parent:
            break
        name = p.name
        m = date_re1.search(name)
        if m:
            return m.group(1)
        m2 = date_re2.search(name)
        if m2:
            s = m2.group(1)
            try:
                return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
            except Exception:
                pass
        p = p.parent

    # Fallback to file's modification time
    try:
        ts = path.stat().st_mtime
        return datetime.fromtimestamp(ts, timezone.utc).date().isoformat()
    except Exception:
        return None

def consolidate_project_results(file_results: list[dict], project_id: str, sender_identity=None) -> dict:
    """
    Consolidate extraction JSON results from multiple files into one project-level result.
    sender_identity: optional sender emails/names — forwarded to the header
    merge so a forwarder never outranks the lead-sheet client.
    """
    from datetime import datetime, timezone

    # Source files and types
    source_files = [r.get("source_file") for r in file_results if r.get("source_file")]
    final_source_file = ", ".join(source_files) if source_files else None

    source_types = set(r.get("source_type") for r in file_results if r.get("source_type"))
    if len(source_types) == 1:
        final_source_type = list(source_types)[0]
    else:
        final_source_type = "mixed"

    # Merge signal dicts
    header_signals = merge_signal_dicts(file_results, "header_signals", sender_identity=sender_identity)
    glass_signals = merge_signal_dicts(file_results, "glass_signals")
    frame_signals = merge_signal_dicts(file_results, "frame_signals")
    location_signals = merge_signal_dicts(file_results, "location_signals")
    addon_signals = merge_signal_dicts(file_results, "addon_signals")

    # Merge units across all project files using LLM Unit Reconciler
    units = []
    for r in file_results:
        units.extend(r.get("units") or [])

    from extraction.unit_reconciler import reconcile_units_with_llm
    deduped_units = reconcile_units_with_llm(units, project_id)

    return {
        "project_id": project_id,
        "source_file": final_source_file,
        "source_type": final_source_type,
        "header_signals": header_signals,
        "glass_signals": glass_signals,
        "frame_signals": frame_signals,
        "location_signals": location_signals,
        "addon_signals": addon_signals,
        "units": deduped_units,
        "extraction_timing": datetime.now(timezone.utc).isoformat()
    }

# ── Orchestration Pipeline Entry Point ────────────────────────────────────────

def run_new_pipeline(
    project_folder: Path,
    lead_id: str | None = None,
    max_workers: int = 4,
    sender_identity=None,
) -> dict[str, Any]:
    """
    Runs the fully decoupled concurrent multi-queue GFS-AI pipeline.
    sender_identity: optional sender emails/names forwarded to header
    merges so a forwarder never outranks the lead-sheet client.
    """
    wall_start = time.perf_counter()
    project_folder = Path(project_folder).resolve()

    print(f"\n{'='*70}")
    print("  GFS-AI CONCURRENT PIPELINE (new_app)")
    print(f"  Project Folder: {project_folder.name}")
    print(f"{'='*70}\n")

    # Instantiate project context
    ctx = PipelineContext(project_folder)

    # Load ignore templates once at startup to avoid repeated disk reads
    from extraction.azure_extract import load_ignored_templates
    cached_template_hashes = load_ignored_templates()

    # ── 1. Pre-extract Email attachments ──
    for p in list(project_folder.glob("*")):
        if p.is_file() and p.suffix.lower() in (".eml", ".msg"):
            try:
                headers, email_body, attachments = extract_email_metadata(p)
                for attach_name, attach_bytes in attachments:
                    # Prefix attachment with email name to avoid filename collisions
                    unique_attach_name = f"{p.stem}_attachment_{attach_name}"
                    attach_path = project_folder / unique_attach_name
                    if not attach_path.exists():
                        attach_path.write_bytes(attach_bytes)
                        print(f"[EMAIL] Pre-extracted attachment: {unique_attach_name} from {p.name}")
            except Exception as exc:
                print(f"[WARN] Failed to pre-extract attachments from {p.name}: {exc}")

    # ── 2. Discover files to process ──
    all_files: list[Path] = []
    exts = {".pdf", ".eml", ".msg", ".png", ".jpg", ".jpeg", ".txt"}
    for p in sorted(project_folder.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue
        if p.name.startswith("._") or "__macosx" in str(p).lower():
            continue
        if is_skipped_path(p, project_folder):
            continue
        if any(x in p.parts for x in ("extraction_results", "non_ai_results", "azure_results", "flagged_figures", "citations_output")):
            continue
        all_files.append(p)

    if not all_files:
        print("[ERROR] No lead, email, or drawing PDFs found.")
        return {"timing": {"total_seconds": 0.0}}

    print(f"Discovered {len(all_files)} file(s) to process:")
    for f in all_files:
        print(f"  • {f.name}")

    # Create directories & clear old JSON files from previous runs
    output_dir = project_folder / "extraction_results"
    if output_dir.exists():
        for old_f in output_dir.glob("*.json"):
            try:
                old_f.unlink()
            except Exception:
                pass
    output_dir.mkdir(parents=True, exist_ok=True)
    non_ai_dir = project_folder / "non_ai_results"
    non_ai_dir.mkdir(parents=True, exist_ok=True)

    # ── 3. Start Parallel Worker Threads ──
    print("\n[PIPELINE] Initializing concurrent workers...")
    stop_event = threading.Event()
    
    azure_threads = []
    for i in range(2):
        t = threading.Thread(target=azure_di_worker, args=(ctx, stop_event), daemon=True)
        t.start()
        azure_threads.append(t)

    classifier_threads = []
    for i in range(3):
        t = threading.Thread(target=classifier_worker, args=(ctx, stop_event), daemon=True)
        t.start()
        classifier_threads.append(t)

    vision_threads = []
    for i in range(4):
        t = threading.Thread(target=vision_worker, args=(ctx, stop_event), daemon=True)
        t.start()
        vision_threads.append(t)

    text_page_threads = []
    for i in range(3):
        t = threading.Thread(target=text_page_worker, args=(ctx, stop_event), daemon=True)
        t.start()
        text_page_threads.append(t)

    # ── 4. Categorize & Dispatch files to queues ──
    image_router_threads = []
    for f in all_files:
        suffix = f.suffix.lower()
        
        # Emails and Text files bypass Azure DI queue entirely
        if suffix in (".eml", ".msg", ".txt"):
            print(f"[DISPATCH] {f.name} — Bypassing Azure DI, routing straight to Text Agent")
            email_body = ""
            headers = {}
            if suffix in (".eml", ".msg"):
                try:
                    headers, email_body, attachments = extract_email_metadata(f)
                except Exception as e:
                    print(f"[WARN] Failed to parse email body for {f.name}: {e}")
            else:
                email_body = f.read_text(encoding="utf-8", errors="replace")

            # Build in-memory text metadata structure
            doc_entry = {
                "n_pages": 1,
                "headings": [],
                "paragraphs": [{"text": email_body, "page": 1, "bbox": None, "label": "email_body"}],
                "tables": [],
                "figures": [],
                "full_text_by_page": {"1": email_body},
                "visual_pages": [],
                "is_email": True,
                "email_headers": headers
            }
            
            # Save dummy layout metadata
            layout_path = non_ai_dir / f"{f.stem}_layout.json"
            layout_path.write_text(json.dumps(doc_entry, indent=2, ensure_ascii=False), encoding="utf-8")

            # Store layout and set event
            with ctx.store_lock:
                ctx.shared_layouts[ctx.file_key(f)] = doc_entry
                ctx.layout_ready_events[ctx.file_key(f)] = threading.Event()
                ctx.layout_ready_events[ctx.file_key(f)].set()

            # Push email LLM extraction to text queue as Priority 1
            push_text_task(ctx, 1, "email", {"file_path": f, "doc_entry": doc_entry})

        elif suffix in (".png", ".jpg", ".jpeg"):
            # Check if it matches an ignored template or is a tiny signature image before dispatching to any queue
            discard = False
            try:
                from PIL import Image
                from extraction.azure_extract import calculate_dhash, hamming_distance_bitwise
                
                # Check dimensions first
                with Image.open(f) as img_obj:
                    w, h = img_obj.size
                if w < 50 or h < 50:
                    discard = True
                    print(f"  🚫 Skipping tiny image {f.name} (dimensions: {w}x{h} too small for blueprints)")
                
                # If not tiny, check templates
                if not discard:
                    with Image.open(f) as img_obj:
                        img_hash = calculate_dhash(img_obj)
                    if cached_template_hashes:
                        for th in cached_template_hashes:
                            if hamming_distance_bitwise(img_hash, th) <= 12:
                                discard = True
                                print(f"  🚫 Skipping ignored template standalone image {f.name}")
                                break
            except Exception as check_exc:
                print(f"[WARN] Failed to pre-screen image {f.name}: {check_exc}")

            if discard:
                continue

            print(f"[DISPATCH] Standalone Image {f.name} — Queued for Azure DI & Vision Queue in parallel")
            with ctx.store_lock:
                ctx.layout_ready_events[ctx.file_key(f)] = threading.Event()
            ctx.azure_queue.put({"file_path": f, "is_drawing": True})
            ctx.vision_queue.put({
                "file_path": f,
                "page_num": 1,
                "page_type": "DETAIL",
                "page_type_hint": "Standalone image file. Visual analysis needed."
            })
            track_vision_enqueued(ctx, f, 1)

        elif suffix == ".pdf":
            # Fast local check: does it contain drawings?
            is_drawing = check_if_drawing_pdf(f)
            with ctx.store_lock:
                ctx.layout_ready_events[ctx.file_key(f)] = threading.Event()
            
            if is_drawing:
                try:
                    doc = fitz.open(str(f))
                    n_pages = len(doc)
                    doc.close()
                except Exception as e:
                    print(f"[ERROR] Failed to count pages for drawing PDF {f.name}: {e}")
                    n_pages = 1

                # Local drawing prefix filter
                kept_pages, pages_str = detect_relevant_pages_locally(f)
                
                print(f"[DISPATCH] Drawing PDF {f.name} — Queued for Azure DI & Classifier Queue in parallel (kept {len(kept_pages)}/{n_pages} pages)")
                ctx.azure_queue.put({"file_path": f, "is_drawing": True, "pages": pages_str, "total_pages_local": n_pages})
                
                with ctx.store_lock:
                    ctx.doc_total_pages[ctx.file_key(f)] = len(kept_pages)
                
                for pg in kept_pages:
                    ctx.classifier_queue.put({"file_path": f, "page_num": pg})
            else:
                try:
                    doc = fitz.open(str(f))
                    n_pages = len(doc)
                    doc.close()
                except Exception:
                    n_pages = 1
                print(f"[DISPATCH] Text-only PDF {f.name} — Queued for Azure DI Layout & Text LLM")
                ctx.azure_queue.put({"file_path": f, "is_drawing": False, "total_pages_local": n_pages})



    # ── 5. Wait for all queues to process (watchdog guarded -- never hang) ──
    print("\n[PIPELINE] Waiting for parallel queues to finish (watchdog guarded)...")

    wait_for_queue(ctx, ctx.azure_queue, "azure_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_AZURE_S", 900, 180, ctx.azure_queue.unfinished_tasks))

    wait_for_queue(ctx, ctx.classifier_queue, "classifier_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_CLASSIFIER_S", 600, 60, ctx.classifier_queue.unfinished_tasks))

    # If no text files were found, set context event so Vision doesn't block
    if hasattr(ctx, "text_context_ready") and not ctx.text_context_ready.is_set():
        ctx.text_context_ready.set()

    wait_for_queue(ctx, ctx.vision_queue, "vision_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_VISION_S", 1200, 240, ctx.vision_queue.unfinished_tasks),
                   detail_fn=lambda: vision_pending_detail(ctx))

    wait_for_queue(ctx, ctx.text_queue, "text_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_TEXT_S", 900, 120, ctx.text_queue.unfinished_tasks))

    print("\n[PIPELINE] Queues complete, stopping workers...")
    stop_event.set()

    # Join workers to clean up
    for t in azure_threads + classifier_threads + vision_threads + text_page_threads:
        t.join(timeout=1.0)

    print("\n[PIPELINE] All parallel extractions completed.")

    # Collect timing
    total_seconds = time.perf_counter() - wall_start
    timing = {
        "stage1_non_ai_seconds": 0.0,
        "stage3_deep_extraction_seconds": 0.0,
        "total_seconds": round(total_seconds, 2),
    }

    # ── 6. Consolidation & Final Merging ──
    all_results = []
    intermediate_paths = []
    
    # 1. Read all compiled text results from shared folder in deterministic order
    for p in sorted(output_dir.glob("*_text.json"), key=lambda x: x.name):
        try:
            res_dict = json.loads(p.read_text(encoding="utf-8"))
            all_results.append(res_dict)
            intermediate_paths.append(p)
        except Exception as exc:
            print(f"[WARN] Failed to load text result {p.name}: {exc}")

    # 2. Group page vision / textpage results by document stem in deterministic page order
    vision_results_by_doc = {}
    for p in sorted(output_dir.glob("*_p*_vision.json"), key=lambda x: x.name):
        try:
            res_dict = json.loads(p.read_text(encoding="utf-8"))
            doc_stem = re.sub(r'_p\d+_vision\.json$', '', p.name)
            vision_results_by_doc.setdefault(doc_stem, []).append(res_dict)
            intermediate_paths.append(p)
        except Exception as exc:
            print(f"[WARN] Failed to load vision result {p.name}: {exc}")

    for p in sorted(output_dir.glob("*_p*_textpage.json"), key=lambda x: x.name):
        try:
            res_dict = json.loads(p.read_text(encoding="utf-8"))
            doc_stem = re.sub(r'_p\d+_textpage\.json$', '', p.name)
            vision_results_by_doc.setdefault(doc_stem, []).append(res_dict)
            intermediate_paths.append(p)
        except Exception as exc:
            print(f"[WARN] Failed to load textpage result {p.name}: {exc}")

    # 3. Merge page vision/textpage results per document in deterministic document order, then add to all_results
    for doc_stem in sorted(vision_results_by_doc.keys()):
        page_results = vision_results_by_doc[doc_stem]
        if not page_results:
            continue
        
        # Ensure page results are sorted deterministically by page number
        page_results.sort(key=lambda r: (r.get("page") or 0))
        
        # Merge individual page signals
        merged_header = merge_signal_dicts(page_results, "header_signals", sender_identity=sender_identity)
        merged_glass = merge_signal_dicts(page_results, "glass_signals")
        merged_frame = merge_signal_dicts(page_results, "frame_signals")
        merged_location = merge_signal_dicts(page_results, "location_signals")
        merged_addon = merge_signal_dicts(page_results, "addon_signals")

        # Collect units
        merged_units = []
        for r in page_results:
            merged_units.extend(r.get("units") or [])

        # Match back to original file name
        original_name = None
        for f in all_files:
            if f.stem == doc_stem:
                original_name = f.name
                break
        if original_name is None:
            original_name = f"{doc_stem}.pdf"

        consolidated_doc_vision = {
            "project_id": doc_stem,
            "source_file": original_name,
            "source_type": "customer_drawing",
            "header_signals": merged_header,
            "glass_signals": merged_glass,
            "frame_signals": merged_frame,
            "location_signals": merged_location,
            "addon_signals": merged_addon,
            "units": merged_units
        }
        all_results.append(consolidated_doc_vision)

    consolidated_result = {}
    consolidated_path = None
    if all_results:
        print("\n[CONSOLIDATING] Creating unified project-level final result...")
        # Ground citations using shared layouts on each file's extractions individually
        try:
            from extraction.bbox_grounder import ground_signal_citations
            layouts = ctx.shared_layouts if 'ctx' in locals() and hasattr(ctx, 'shared_layouts') else {}
            for res in all_results:
                fname = res.get("source_file")
                if fname and layouts and fname in layouts:
                    ground_signal_citations(res, layouts[fname], default_pdf_name=fname)
            print("  [GROUNDER] Grounded individual document citation coordinates successfully.")
        except Exception as ground_exc:
            print(f"  [WARN] Individual citation grounding failed: {ground_exc}")

        # Consolidated extraction results across all project files
        proj_id = lead_id or project_folder.name
        consolidated_result = consolidate_project_results(all_results, project_id=proj_id, sender_identity=sender_identity)
        
        # Save consolidated final result
        clean_proj_name = _safe_stem(project_folder.name)
        consolidated_path = output_dir / f"{clean_proj_name}_final_result.json"
        try:
            consolidated_path.write_text(
                json.dumps(consolidated_result, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            print(f"  [SAVED FINAL] {consolidated_path.name}")

            # Group all_results by document and save as document_extractions.json
            document_extractions = {}
            for r in all_results:
                doc_name = r.get("source_file") or r.get("project_id") or "unknown"
                document_extractions[doc_name] = r

            doc_ext_path = output_dir / f"{clean_proj_name}_document_extractions.json"
            doc_ext_path.write_text(
                json.dumps(document_extractions, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            print(f"  [SAVED DOCUMENT EXTRACTIONS] {doc_ext_path.name}")
            
            # Clean up intermediate files
            print("  [CLEANUP] Deleting intermediate page JSON files...")
            for ip in intermediate_paths:
                try:
                    ip.unlink()
                except Exception as clean_exc:
                    print(f"    Failed to delete {ip.name}: {clean_exc}")
        except Exception as exc:
            print(f"  [ERROR] Failed to save output files: {exc}")

    # Print pipeline timing
    print(f"\n{'='*70}")
    print("  GFS-AI CONCURRENT PIPELINE TIMING")
    print(f"{'='*70}")
    print(f"  TOTAL ELAPSED TIME            : {timing['total_seconds']:>7.1f}s")
    print(f"{'='*70}")

    # ── 7. Rules Engine Connection ──
    rules_result = {}
    if consolidated_result:
        try:
            from extraction.canonical import CanonicalSignals
            from extraction.repository import get_repository
            from rules.rule2_glass_type import decide_glass_type
            from rules.rule3_frame_type import decide_frame_type
            from rules.rule4_cross_beam import decide_cross_beam
            from rules.rule5_addons import decide_add_ons

            canonical = CanonicalSignals.from_dict(consolidated_result)
            repo = get_repository(source="ai", ai_json=json.dumps(consolidated_result))
            ext = repo.get(consolidated_result.get("project_id", ""))

            g  = decide_glass_type(ext, canonical=canonical)
            fr = decide_frame_type(ext, g, canonical=canonical)
            cb = decide_cross_beam(ext, g, fr, canonical=canonical)
            a  = decide_add_ons(ext, g, fr, cb, canonical=canonical)

            rules_result = {
                "glass_type": g.glass_type_code,
                "glass_confidence": g.confidence,
                "glass_reasoning": g.reasoning,
                "frame_type": fr.frame_type_code,
                "frame_confidence": fr.confidence,
                "install_type": fr.install_type,
                "assembly_type": fr.assembly_type,
                "proposal_number": fr.proposal_number,
                "frame_flags": fr.flags,
                "cross_beam": cb.cross_beam_code,
                "cross_beam_confidence": cb.confidence,
                "panel_count": cb.panel_count,
                "duty": a.duty.value if a.duty else None,
                "hst": a.heat_soak_testing.value if a.heat_soak_testing else None,
                "frame_reasoning": fr.reasoning,
                "cross_beam_reasoning": cb.reasoning,
                "addon_reasoning": a.reasoning,
                "addons": {
                    "nanodot":        a.nanodot.value if a.nanodot else None,
                    "seeded_organic": a.seeded_organic.value if a.seeded_organic else None,
                    "krypton_gas":    a.krypton_gas.value if a.krypton_gas else None,
                    "sentry_glass":   a.sentry_glass.value if a.sentry_glass else None,
                    "custom_shape":   a.custom_shape_surcharge.value if a.custom_shape_surcharge else None,
                },
                "dimensions": [
                    {
                        "label":      u.unit_label,
                        "location":   u.location_description,
                        "width_in":   u.width_inches,
                        "length_in":  u.length_inches,
                        "panels":     u.panel_count,
                        "dim_type":   u.dimension_label_type,
                        "confidence": u.confidence,
                        "verbatim":   u.verbatim,
                        "page":       u.page,
                        "reasoning":  u.reasoning,
                    }
                    for u in canonical.units
                ],
            }

            if consolidated_path:
                rules_path = consolidated_path.parent / (
                    consolidated_path.stem.replace("_final_result", "") + "_rules_result.json"
                )
                rules_path.write_text(json.dumps(rules_result, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  [SAVED RULES] {rules_path.name}")

            # Generate unified MongoDB document
            try:
                from extraction.schema_builder import build_unified_doc
                from extraction.unified_adapter import write_rules_to_unified_doc
                unified_doc = build_unified_doc(consolidated_result)
                unified_doc = write_rules_to_unified_doc(unified_doc, g, fr, cb, a)
                unified_path = output_dir / f"{project_folder.name}_unified.json"
                unified_path.write_text(
                    json.dumps(unified_doc, ensure_ascii=False, indent=2, default=lambda o: {k: v for k, v in o.__dict__.items() if not k.startswith("_")} if hasattr(o, "__dict__") and not isinstance(o, type) else str(o)),
                    encoding="utf-8"
                )
                print(f"  [SAVED UNIFIED] {unified_path.name}")
            except Exception as unified_exc:
                print(f"  [WARN] Unified schema generation failed: {unified_exc}")

        except Exception as exc:
            import traceback
            print(f"  [WARN] Rules engine failed: {exc}")
            traceback.print_exc()

    return {
        "final_result": consolidated_result,
        "final_result_path": str(consolidated_path) if consolidated_path else None,
        "timing": timing,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python new_ai_engine.py <project_folder>")
        sys.exit(1)
        
    run_new_pipeline(Path(sys.argv[1]))
