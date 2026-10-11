# new_app/new_ai_engine.py
# -----------------------------------------------------------------------------
# Orchestration engine for the high-performance concurrent queue pipeline.
# Replaces e:\gfs\GFS-AI-4\ai_engine.py for testing in new_app/
# -----------------------------------------------------------------------------

import json
import re
import os
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

# Add parent directory to path so we can import GFS modules
sys.path.append(str(Path(__file__).resolve().parent.parent))

from new_app.fanout_router import (
    PipelineContext,
    azure_di_worker, classifier_worker, vision_worker, text_page_worker,
    check_if_drawing_pdf, push_text_task,
    track_vision_enqueued, snapshot_vision_pending,
    queue_timeout_for, wait_for_queue, vision_pending_detail,
)

from extraction.azure_extract import extract_email_metadata
from extraction.extraction_parser import merge_signal_dicts
from classifier.address_utils import (
    detect_address_type
)
from ai_engine import is_skipped_path, _safe_stem, consolidate_project_results, dedup_files_by_hash, extract_folder_date

# -- Orchestration Pipeline Entry Point ----------------------------------------

from typing import Any, Callable

# The files run_new_pipeline reads; anything else in the folder is ignored.
PIPELINE_FILE_EXTENSIONS = frozenset({".pdf", ".eml", ".msg", ".png", ".jpg", ".jpeg", ".txt"})

def run_new_pipeline(
    project_folder: Path,
    lead_id: str | None = None,
    max_workers: int = 4,
    on_phase1_complete: Callable[[dict], None] | None = None,
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
    ctx.on_phase1_complete = on_phase1_complete


    # Load ignore templates once at startup to avoid repeated disk reads
    from extraction.azure_extract import load_ignored_templates
    cached_template_hashes = load_ignored_templates()

    # -- 1. Pre-extract Email attachments --
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

    # -- 2. Discover files to process --
    all_files: list[Path] = []
    for p in sorted(project_folder.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in PIPELINE_FILE_EXTENSIONS:
            continue
        if p.name.startswith("._") or "__macosx" in str(p).lower():
            continue
        if is_skipped_path(p, project_folder):
            continue
        if any(x in p.parts for x in ("extraction_results", "non_ai_results", "azure_results", "flagged_figures", "citations_output")):
            continue
        all_files.append(p)

    # Fix 1: drop byte-identical files before any extraction runs
    all_files = dedup_files_by_hash(all_files)


    if not all_files:
        print("[ERROR] No lead, email, or drawing PDFs found.")
        return {"timing": {"total_seconds": 0.0}}

    ctx.stats["files_total"] = len(all_files)
    print(f"Discovered {len(all_files)} file(s) to process:")
    for f in all_files:
        print(f"  * {f.name}")

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

    # -- 3. Start Parallel Worker Threads --
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

    # -- 4. Categorize & Dispatch files to queues --
    image_router_threads = []
    for f in all_files:
        suffix = f.suffix.lower()
        
        # Emails and Text files bypass Azure DI queue entirely
        if suffix in (".eml", ".msg", ".txt"):
            print(f"[DISPATCH] {f.name} -- Bypassing Azure DI, routing straight to Text Agent")
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
                    print(f"  [SKIP] Skipping tiny image {f.name} (dimensions: {w}x{h} too small for blueprints)")
                
                # If not tiny, check templates
                if not discard:
                    with Image.open(f) as img_obj:
                        img_hash = calculate_dhash(img_obj)
                    if cached_template_hashes:
                        for th in cached_template_hashes:
                            if hamming_distance_bitwise(img_hash, th) <= 12:
                                discard = True
                                print(f"  [SKIP] Skipping ignored template standalone image {f.name}")
                                break
            except Exception as check_exc:
                print(f"[WARN] Failed to pre-screen image {f.name}: {check_exc}")

            if discard:
                continue

            print(f"[DISPATCH] Standalone Image {f.name} -- Queued for Azure DI & Vision Queue in parallel")
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
                print(f"[DISPATCH] Drawing PDF {f.name} -- Queued for Azure DI & Classifier Queue in parallel")
                ctx.azure_queue.put({"file_path": f, "is_drawing": True})
                try:
                    doc = fitz.open(str(f))
                    n_pages = len(doc)
                    doc.close()
                    with ctx.store_lock:
                        ctx.doc_total_pages[ctx.file_key(f)] = n_pages
                    for pg in range(1, n_pages + 1):
                        ctx.classifier_queue.put({"file_path": f, "page_num": pg})
                except Exception as e:
                    print(f"[ERROR] Failed to count pages for drawing PDF {f.name}: {e}")
            else:
                print(f"[DISPATCH] Text-only PDF {f.name} -- Queued for Azure DI Layout & Text LLM")
                ctx.expected_text_files += 1
                ctx.azure_queue.put({"file_path": f, "is_drawing": False})



    # -- 5. Wait for all queues to process --
    # If no text files to process, unblock Vision immediately
    if ctx.expected_text_files == 0:
        ctx.text_context_ready.set()
        print("[CONTEXT] No text files -- Vision unblocked immediately")
    print("\n[PIPELINE] Waiting for parallel queues to finish (watchdog guarded)...")

    wait_for_queue(ctx, ctx.azure_queue, "azure_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_AZURE_S", 900, 180, ctx.azure_queue.unfinished_tasks))

    wait_for_queue(ctx, ctx.classifier_queue, "classifier_queue",
                   queue_timeout_for("GFS_QUEUE_TIMEOUT_CLASSIFIER_S", 600, 60, ctx.classifier_queue.unfinished_tasks))
    # If no text files were found, set context event so Vision doesn't block
    if not ctx.text_context_ready.is_set():
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

    # -- 6. Consolidation & Final Merging --
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
        proj_id = lead_id or project_folder.name
        # Fix 2: attach folder-derived date to each file result before consolidation
        for _fr in all_results:
            _src = _fr.get("source_file")
            if _src:
                for _f in all_files:
                    if _f.name == _src:
                        _fr["_folder_date"] = extract_folder_date(_f, project_folder)
                        break
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
            
            # Apply enhanced address analysis using new classifier improvements
            print("  [ADDRESS ANALYSIS] Applying enhanced address processing...")
            try:
                project_address = consolidated_result.get("header_signals", {}).get("project_address", {}).get("value")
                if project_address:
                    # Convert result to string for analysis
                    result_text = json.dumps(consolidated_result)
                    
                    # Analyze the extracted address
                    addr_type, confidence, keywords = detect_address_type(
                        result_text, 
                        project_address
                    )
                    print(f"    Address: {project_address}")
                    print(f"    Detected Type: {addr_type}, Confidence: {confidence}")
                    print(f"    Keywords: {keywords}")
                    
                    # Add enhanced address info to result
                    consolidated_result["enhanced_address_analysis"] = {
                        "address": project_address,
                        "detected_type": addr_type,
                        "confidence": confidence,
                        "keywords": keywords,
                        "analysis_timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    
                    # Save updated result with address analysis
                    consolidated_path.write_text(
                        json.dumps(consolidated_result, ensure_ascii=False, indent=2),
                        encoding="utf-8"
                    )
                    print("  [UPDATED FINAL] Enhanced address analysis added")
            except Exception as addr_exc:
                print(f"    Address analysis failed: {addr_exc}")
            
            # Clean up intermediate files
            print("  [CLEANUP] Deleting intermediate page JSON files...")
            for ip in intermediate_paths:
                try:
                    pass  # ip.unlink()
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
    # Pipeline stats summary
    s = ctx.stats
    print(f"\n{'='*70}")
    print("  GFS-AI PIPELINE STATS")
    print(f"{'='*70}")
    print(f"  Files discovered              : {s['files_total']:>7}")
    print(f"  Pages -> text extraction       : {s['pages_text']:>7}")
    print(f"  Pages -> classifier            : {s['pages_to_classifier']:>7}")
    print(f"    |-- prefilter -> vision       : {s['pages_prefilter_vision']:>7}")
    print(f"    |-- prefilter -> skip         : {s['pages_prefilter_skip']:>7}")
    print(f"    |-- classifier -> vision      : {s['pages_classifier_vision']:>7}")
    print(f"    `-- classifier -> no          : {s['pages_classifier_no']:>7}")
    print(f"  Pages -> vision processed      : {s['pages_vision_processed']:>7}")
    print(f"  Pages -> vision failed         : {s['pages_vision_failed']:>7}")
    print(f"{'='*70}")

    # -- 7. Rules Engine Connection --
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

            # -- Per-unit rules engine run ---------------------------------
            # Each unit gets its own glass type and crossbeam decision.
            # Units with condition_override use their own signals.
            # Units without override inherit project-level signals.
            unit_glass_results:  dict = {}
            unit_frame_results:  dict = {}
            unit_cb_results:     dict = {}

            units_to_process = canonical.units or []
            if not units_to_process:
                # No units from Vision -- fall back to single project-level run
                # (handles legacy extractions and projects with no unit data yet)
                g  = decide_glass_type(ext, canonical=canonical)
                fr = decide_frame_type(ext, g, canonical=canonical)
                cb = decide_cross_beam(ext, g, fr, canonical=canonical)
                unit_glass_results["A"] = g
                unit_frame_results["A"] = fr
                unit_cb_results["A"]    = cb
            else:
                for unit in units_to_process:
                    label = unit.unit_label
                    if not label:
                        continue

                    from extraction.canonical import UnitCanonicalView
                    unit_view = UnitCanonicalView(canonical, unit) if canonical else None

                    ug = decide_glass_type(ext, canonical=unit_view)
                    uf = decide_frame_type(
                        ext, ug,
                        canonical=unit_view,
                    )
                    ucb = decide_cross_beam(
                        ext, ug, uf,
                        canonical=unit_view,
                    )
                    unit_glass_results[label] = ug
                    unit_frame_results[label] = uf
                    unit_cb_results[label]    = ucb

            # -- Aggregate to project-level decisions ---------------------
            # Frame type: most demanding wins. Workbook has one frame row.
            # Frame type: use first unit's result for project-level decision
            # (simplified aggregation - could be enhanced later)
            first_frame_result = next(iter(unit_frame_results.values()), None) if unit_frame_results else None
            fr = first_frame_result if first_frame_result else decide_frame_type(ext, g, canonical=canonical)
            frame_conflicts = []  # No conflict detection in simplified version

            # Dominant glass: for add-ons (duty, HST, backpaint).
            # Use the first unit's result -- add-ons are project-level.
            # EGR secondary: True if ANY unit flagged EGR.
            first_label = next(iter(unit_glass_results), None)
            g = unit_glass_results.get(first_label) if first_label else decide_glass_type(ext, canonical=canonical)
            if any(ug.egr_secondary for ug in unit_glass_results.values()):
                g.egr_secondary = True

            # First crossbeam (for add-ons weight check -- uses dominant unit)
            cb = unit_cb_results.get(first_label) if first_label else decide_cross_beam(ext, g, fr, canonical=canonical)

            # -- Build unit_decisions dict for schema + stage6 ------------
            unit_decisions: dict = {}
            for label, ug in unit_glass_results.items():
                from config.workbook_map import GLASS_TYPE_ROWS
                ucb = unit_cb_results.get(label)
                uf = unit_frame_results.get(label)
                unit_decisions[label] = {
                    "glass_type_code":         ug.glass_type_code,
                    "glass_type_workbook_row":  GLASS_TYPE_ROWS.get(ug.glass_type_code),
                    "frame_type_code":          uf.frame_type_code if uf else None,
                    "frame_install_type":       uf.install_type if uf else None,
                    "crossbeam_code":           ucb.cross_beam_code if ucb else None,
                    "crossbeam_workbook_row":   None,  # resolved by stage6
                    "had_condition_override":   bool(
                        units_to_process and
                        next((u for u in units_to_process if u.unit_label == label), None) and
                        getattr(
                            next((u for u in units_to_process if u.unit_label == label), None),
                            "condition_override", None
                        ) and
                        getattr(
                            next((u for u in units_to_process if u.unit_label == label),
                                 None).condition_override,
                            "has_different_conditions", False
                        )
                    ),
                }

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
                "unit_decisions": unit_decisions,
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

            from new_app import token_tracker as _tt; _tt.summary(); _tt.reset()
            # Generate unified MongoDB document
            try:
                from extraction.schema_builder import build_unified_doc
                from extraction.unified_adapter import write_rules_to_unified_doc
                unified_doc = build_unified_doc(consolidated_result)
                unified_doc = write_rules_to_unified_doc(unified_doc, g, fr, cb, a, unit_decisions=unit_decisions)
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
        print("Usage: python new_ai_engine.py <project_folder_or_zip>")
        sys.exit(1)
        
    target = Path(sys.argv[1])
    if target.is_file() and target.suffix.lower() == ".zip":
        import zipfile
        extract_dir = target.parent / target.stem
        if not extract_dir.exists():
            print(f"[EXTRACT] Unzipping {target.name} to {extract_dir.name}...")
            with zipfile.ZipFile(target, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
        target = extract_dir
        
    run_new_pipeline(target)
