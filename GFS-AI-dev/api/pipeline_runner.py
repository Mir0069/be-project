from pathlib import Path
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()
import requests
from new_app.new_ai_engine import PIPELINE_FILE_EXTENSIONS, run_new_pipeline as run_pipeline
from extraction.schema_builder import build_unified_doc, update_from_new_document
from extraction.schema_builder import build_unified_doc
from extraction.unified_adapter import unified_to_extraction_dict
from extraction.canonical import CanonicalSignals
from extraction.repository import get_repository
from rules.rule2_glass_type import GlassTypeResult, decide_glass_type
from rules.rule3_frame_type import FrameTypeResult, decide_frame_type
from rules.rule4_cross_beam import CrossBeamResult, decide_cross_beam
from rules.rule5_addons import decide_add_ons
from rules.rule6_calculations import UnitTakeOff, compute_calculations
from rules.rule7_unit_description import build_unit_description, inches_to_display
from formulas.packaging import calculate_packaging_base
from config.unified_schema import write_rules_value

_mongo_client = None

from services.cache_service import (
    compute_documents_hash,
    get_cached_result,
    claim_processing_lock,
    wait_for_processing,
    save_completed_cache,
    mark_cache_failed,
    processing_heartbeat,
)

def _get_mongo_client():
    global _mongo_client
    if _mongo_client is None:
        from pymongo import MongoClient
        mongo_uri = (
            os.environ.get("MONGODB_URI")
            or os.environ.get("MONGO_URI")
            or os.environ.get("MONGODB_URL")
        )
        if not mongo_uri:
            raise ValueError("MONGO_URI/MONGODB_URI not set in environment")
        _mongo_client = MongoClient(mongo_uri)
    return _mongo_client

def _get_mongo_db():
    """Return the correct database object, reading the db name from MONGODB_URI.
    Falls back to 'smartmfg_ai' if the URI has no explicit db path segment.
    Previously this was hardcoded to 'gfs' which was wrong for local dev.
    """
    import re as _re
    mongo_uri = (
        os.environ.get("MONGODB_URI")
        or os.environ.get("MONGO_URI")
        or os.environ.get("MONGODB_URL")
        or ""
    )
    # Extract db name from URI path: mongodb://host:port/DB_NAME[?params]
    m = _re.search(r"/([^/?]+)(\?|$)", mongo_uri)
    db_name = m.group(1) if m else "smartmfg_ai"
    return _get_mongo_client()[db_name]

def read_from_mongo(project_id: str) -> dict:
    """Read unified doc from MongoDB proposals collection using projectId."""
    from bson import ObjectId
    db = _get_mongo_db()
    doc = db["proposals"].find_one({"projectId": project_id})
    if not doc:
        try:
            doc = db["proposals"].find_one({"projectId": ObjectId(project_id)})
        except Exception:
            pass
    if not doc:
        raise FileNotFoundError(f"No proposal found with projectId: {project_id}")
    schema = doc.get("schema")
    if not schema:
        raise ValueError(f"Proposal {project_id} has no schema field")
    return schema

# ── DEPRECATED: save_to_mongo() — backend now owns all MongoDB writes ──────
# Referenced by the desired retrigger behavior but did not previously exist
# in this file. Mirrors read_from_mongo()'s lookup logic (string projectId,
# falling back to ObjectId) so it writes back to whichever document
# read_from_mongo() would have found.
def save_to_mongo(project_id: str, schema: dict) -> None:
    """Persist a unified doc back into MongoDB proposals collection using projectId."""
    from bson import ObjectId
    db = _get_mongo_db()
    now_str = datetime.now(timezone.utc).isoformat()

    result = db["proposals"].update_one(
        {"projectId": project_id},
        {"$set": {"schema": schema, "updatedAt": now_str}}
    )
    if result.matched_count == 0:
        # Same fallback pattern as read_from_mongo(): projectId may be stored as ObjectId
        try:
            db["proposals"].update_one(
                {"projectId": ObjectId(project_id)},
                {"$set": {"schema": schema, "updatedAt": now_str}}
            )
        except Exception:
            pass

def _download_documents_to_temp_folder(documents, project_id: str) -> Path:
    """
    Downloads each document (fresh 60-minute SAS blobUrl) into a temp folder,
    replacing the old local-folder-path model. The temp folder is handed to
    run_pipeline() exactly like the old project folder was.
    """
    temp_dir = Path(tempfile.mkdtemp(prefix=f"gfs_{project_id}_"))

    for doc in documents:
        dest_path = temp_dir / doc.originalName
        try:
            resp = requests.get(doc.blobUrl, timeout=60, stream=True)
            resp.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
        except requests.RequestException as e:
            # Clean up partial temp dir before surfacing the error
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ValueError(
                f"Failed to download document {doc.documentId} ({doc.originalName}) "
                f"from blobUrl: {e}"
            )

    return temp_dir

def _pipeline_documents(request) -> list:
    """
    The request's documents the pipeline can read. A spreadsheet or drawing file
    on its own produced no result, and the project stayed stuck in extraction.
    """
    readable, skipped = [], []
    for doc in getattr(request, "documents", None) or []:
        suffix = Path(doc.originalName or "").suffix.lower()
        (readable if suffix in PIPELINE_FILE_EXTENSIONS else skipped).append(doc)
    if skipped:
        import logging
        logging.getLogger("gfs.api").info(
            "Skipping %d document(s) the pipeline cannot read | project_id=%s | files=%s",
            len(skipped), request.project_id, [d.originalName for d in skipped],
        )
    return readable


def _update_backend_documents_with_cache_ref(project_id: str, documents, content_hash: str) -> None:
    """
    Updates backend Document records with the cached AI result reference after successful processing.
    This allows future uploads of the same content to skip AI processing.
    """
    try:
        from bson import ObjectId
        db = _get_mongo_db()
        
        # Extract document IDs from the request
        document_ids = [doc.documentId for doc in documents] if documents else []
        
        if not document_ids:
            return
        
        # Convert string IDs to ObjectId for MongoDB query
        object_ids = []
        for doc_id in document_ids:
            try:
                object_ids.append(ObjectId(doc_id))
            except Exception:
                # Keep as string if conversion fails
                object_ids.append(doc_id)
        
        # Update all documents with the content hash and cache reference
        now_str = datetime.now(timezone.utc).isoformat()
        
        # Try ObjectId first, fall back to string
        result = db["documents"].update_many(
            {"_id": {"$in": object_ids}},
            {
                "$set": {
                    "contentHash": content_hash,
                    "contentHashCachedAt": now_str,
                    "cachedAiResultRef": content_hash  # Reference to document_processing_cache
                }
            }
        )
        
        import logging
        logging.getLogger("gfs.api").info(
            f"Updated {result.modified_count} documents with cache reference for content_hash={content_hash}"
        )
        
    except Exception as exc:
        import logging
        logging.getLogger("gfs.api").warning(
            f"Failed to update backend documents with cache reference: {exc}"
        )
        # Don't fail the pipeline if this update fails


def _ensure_enrichment_payload(final_res: dict = None, unified_doc: dict = None) -> dict:
    payload = dict(final_res or {})
    if unified_doc and isinstance(unified_doc, dict):
        if not payload.get("units") and isinstance(unified_doc.get("units"), dict):
            extracted_units = []
            for u_key, u in unified_doc["units"].items():
                if not isinstance(u, dict):
                    continue
                w = u.get("value_width_in") or u.get("width_inches")
                l = u.get("value_length_in") or u.get("length_inches")
                p_val = (u.get("panel_count") or {}).get("value") if isinstance(u.get("panel_count"), dict) else u.get("panel_count")
                sheet_val = (u.get("sheet") or {}).get("value") if isinstance(u.get("sheet"), dict) else u.get("sheet")
                if isinstance(sheet_val, str):
                    sheet_val = re.sub(r'^(?:p\.|page\s*|p)', '', sheet_val, flags=re.IGNORECASE)
                extracted_units.append({
                    "unit_label": u.get("unit_label") or u_key,
                    "width_inches": w,
                    "length_inches": l,
                    "panel_count": p_val,
                    "page": sheet_val,
                })
            if extracted_units:
                payload["units"] = extracted_units

        stage_1 = unified_doc.get("stage_1") or {}
        header_signals = payload.setdefault("header_signals", {})
        if not header_signals.get("contact_name") and stage_1.get("contact_name"):
            header_signals["contact_name"] = {"value": stage_1["contact_name"].get("value")}
        if not header_signals.get("contact_email") and stage_1.get("contact_email"):
            header_signals["contact_email"] = {"value": stage_1["contact_email"].get("value")}
        if not header_signals.get("project_address") and stage_1.get("project_address"):
            header_signals["project_address"] = {"value": stage_1["project_address"].get("value")}

        stage_3 = unified_doc.get("stage_3") or {}
        frame_signals = payload.setdefault("frame_signals", {})
        if not frame_signals.get("frame_type_stated"):
            frame_val = (stage_3.get("frame_type") or {}).get("value") or (stage_3.get("decision", {}).get("frame_type") or {}).get("value")
            if frame_val:
                frame_signals["frame_type_stated"] = {"value": frame_val}

        stage_2 = unified_doc.get("stage_2") or {}
        glass_signals = payload.setdefault("glass_signals", {})
        if not glass_signals.get("is_walkable"):
            w_val = (stage_2.get("is_walkable") or {}).get("value")
            if w_val is not None:
                glass_signals["is_walkable"] = {"value": w_val}

    return payload


def _enrich_outlook_email_with_stage0(project_id: str, final_res: dict, unified_doc: dict = None) -> None:
    try:
        from bson import ObjectId
        from extraction.summary_enricher import enrich_summary_and_reasoning
        
        payload = _ensure_enrichment_payload(final_res, unified_doc)

        db = _get_mongo_db()

        pids = [project_id]
        try:
            pids.append(ObjectId(project_id))
        except Exception:
            pass

        for coll in ("outlookemails", "outlook_emails", "proposals", "projects", "zoho_leads"):
            for pid in pids:
                doc = (
                    db[coll].find_one({"projectId": pid})
                    or db[coll].find_one({"_id": pid})
                    or db[coll].find_one({"id": pid})
                    or db[coll].find_one({"leadId": pid})
                    or db[coll].find_one({"lead_id": pid})
                    or db[coll].find_one({"project_id": pid})
                )
                if doc:
                    proposed = doc.get("proposed") or {}
                    initial_summary = proposed.get("summary") or doc.get("summary")
                    initial_reasoning = proposed.get("reasoning") or doc.get("reasoning")

                    enriched = enrich_summary_and_reasoning(initial_summary, initial_reasoning, payload)

                    db[coll].update_one(
                        {"_id": doc["_id"]},
                        {"$set": {
                            "summary": enriched["summary"],
                            "reasoning": enriched["reasoning"],
                            "proposed.summary": enriched["summary"],
                            "proposed.reasoning": enriched["reasoning"]
                        }}
                    )
    except Exception as exc:
        import logging
        logging.getLogger("gfs.api").warning("Failed to enrich outlook email with Stage 0 result: %s", exc)

def _strip_sender_matching_client_fields(metadata: dict, extra_sender_values=None) -> dict:
    """
    Drop classifier-proposed client name/email that literally equal a known
    sender identity. The classifier sometimes copies the forwarder (From:
    header) into customerName/customerEmail; left as-is it would seed
    Stage 1 as a "verified" client with confidence 95 and shadow the real
    lead-sheet client. The raw sender stays available under sender keys
    (lowest-priority fallback) — only the false client-tier copy is removed.
    """
    if not isinstance(metadata, dict):
        return metadata
    try:
        from extraction.extraction_parser import normalize_sender_identity
    except Exception:
        return metadata
    sender_ids = normalize_sender_identity(
        metadata.get("sender"),
        metadata.get("senderEmail"),
        metadata.get("sender_email"),
        metadata.get("fromAddress"),
        metadata.get("from_address"),
        metadata.get("senderName"),
        metadata.get("sender_name"),
        metadata.get("fromName"),
        metadata.get("from_name"),
        *((extra_sender_values or [])),
    )
    if not sender_ids:
        return metadata
    for key in ("customerName", "contact_email"):
        val = metadata.get(key)
        if isinstance(val, str) and val.strip().lower() in sender_ids:
            import logging
            logging.getLogger("gfs.api").info(
                "Dropping classifier-proposed %s matching sender identity — "
                "sender must never pose as the client", key,
            )
            metadata[key] = None
    return metadata


def _build_sender_identity(request, lead_metadata: dict):
    """Collect known sender emails/names for sender-aware header merging."""
    try:
        from extraction.extraction_parser import normalize_sender_identity
    except Exception:
        return None
    vals = []
    for source in (lead_metadata or {},):
        if isinstance(source, dict):
            for k in ("sender", "senderEmail", "sender_email", "fromAddress",
                      "from_address", "senderName", "sender_name",
                      "fromName", "from_name"):
                vals.append(source.get(k))
    try:
        vals.append(getattr(request, "sender", None))
    except Exception:
        pass
    ids = normalize_sender_identity(*vals)
    return ids or None


def _get_lead_context_metadata(project_id: str) -> dict:
    """
    Fetch verified lead metadata (from OutlookEmail and Project records in MongoDB)
    so Stage 0 extraction does not wipe out classifier/user-approved information.
    """
    metadata = {}
    try:
        from bson import ObjectId
        db = _get_mongo_db()

        pids = [project_id]
        try:
            pids.append(ObjectId(project_id))
        except Exception:
            pass

        # 1. Check outlookemails collection (contains classifier's proposed signals)
        email_doc = None
        for pid in pids:
            email_doc = db["outlookemails"].find_one({"projectId": pid})
            if email_doc:
                break

        if email_doc:
            proposed = email_doc.get("proposed") or {}
            # NEVER fall back to sender header (fromName/fromAddress) for the
            # customer contact. The sender is often a forwarder/architect, not
            # the actual client in the lead-sheet body. Leave empty so document
            # extraction (lead sheet signature/body) can fill the real client.
            metadata["customerName"] = proposed.get("customerName")
            metadata["companyName"] = proposed.get("companyName")
            metadata["projectName"] = proposed.get("projectName") or email_doc.get("subject")
            metadata["jobAddress"] = proposed.get("jobAddress") or proposed.get("address")
            metadata["address"] = proposed.get("address") or proposed.get("jobAddress")
            metadata["allAddresses"] = proposed.get("allAddresses") or []
            # Company-aware contact: explicit company/contact email first; sender
            # header last. Never use a bidder/competitor email as the contact.
            # Sender is stored under sender keys only (lowest priority in
            # normalize_lead_metadata) — never promoted to contact_email.
            metadata["contact_email"] = (
                proposed.get("customerEmail")
                or proposed.get("companyEmail")
                or proposed.get("contact_email")
            )
            # Keep raw sender for provenance / cache-keying, not as contact.
            if email_doc.get("fromAddress"):
                metadata.setdefault("sender", email_doc.get("fromAddress"))
                metadata.setdefault("fromAddress", email_doc.get("fromAddress"))
            if email_doc.get("fromName"):
                metadata.setdefault("senderName", email_doc.get("fromName"))
                metadata.setdefault("fromName", email_doc.get("fromName"))
            metadata["customerPhone"] = (
                proposed.get("customerPhone")
                or proposed.get("contactPhone")
                or proposed.get("contact_phone")
                or email_doc.get("fromPhone")
            )
            metadata["companyAddress"] = (
                proposed.get("companyAddress")
                or proposed.get("contactAddress")
                or proposed.get("contact_address")
            )
            # De-poison: if the classifier copied the forwarder/sender into
            # customerName/customerEmail, it must not pose as verified client.
            _strip_sender_matching_client_fields(metadata)

        # 2. Check projects collection (contains project-level approved metadata)
        project_doc = None
        for pid in pids:
            project_doc = db["projects"].find_one({"_id": pid}) or db["projects"].find_one({"projectId": pid})
            if project_doc:
                break

        if project_doc:
            if not metadata.get("customerName") and project_doc.get("customerName"):
                metadata["customerName"] = project_doc.get("customerName")
            if not metadata.get("contact_email") and project_doc.get("customerEmail"):
                metadata["contact_email"] = project_doc.get("customerEmail")
            if not metadata.get("customerPhone") and (project_doc.get("customerPhone") or project_doc.get("phone")):
                metadata["customerPhone"] = project_doc.get("customerPhone") or project_doc.get("phone")
            if not metadata.get("jobAddress") and (project_doc.get("jobAddress") or project_doc.get("address")):
                metadata["jobAddress"] = project_doc.get("jobAddress") or project_doc.get("address")
            if not metadata.get("projectName") and project_doc.get("projectName"):
                metadata["projectName"] = project_doc.get("projectName")
            if project_doc.get("architect"):
                metadata["architect"] = project_doc.get("architect")

        # 3. Check existing proposal schema if already created (e.g. on retrigger)
        proposal_doc = None
        for pid in pids:
            proposal_doc = db["proposals"].find_one({"projectId": pid})
            if proposal_doc:
                break

        if proposal_doc and isinstance(proposal_doc.get("schema"), dict):
            s1 = proposal_doc["schema"].get("stage_1") or {}
            for f_name, meta_key in [
                ("contact_name", "customerName"),
                ("contact_email", "contact_email"),
                ("contact_phone", "customerPhone"),
                ("project_address", "jobAddress"),
                ("architect", "architect"),
                ("project_name", "projectName"),
            ]:
                f_obj = s1.get(f_name)
                if isinstance(f_obj, dict) and f_obj.get("value") and not metadata.get(meta_key):
                    val = f_obj.get("value")
                    if str(val).strip().upper() not in ("PENDING", "NOT_STATED", "MANUAL", "NONE", "NULL", ""):
                        metadata[meta_key] = val

    except Exception as exc:
        import logging
        logging.getLogger("gfs.api").warning("Failed to fetch lead context metadata for project_id=%s: %s", project_id, exc)

    return metadata


def _preserve_stage1_fields(target_doc: dict, source_doc: dict, lead_meta: dict = None) -> None:
    """
    Ensure non-null, verified Stage 1 fields from source_doc (or lead_meta)
    are preserved and never overwritten with null or sentinel data.
    """
    if not isinstance(target_doc, dict):
        return
    s1_target = target_doc.setdefault("stage_1", {})
    s1_source = (source_doc.get("stage_1") if isinstance(source_doc, dict) else None) or {}
    sentinels = {None, "", "PENDING", "NOT_STATED", "MANUAL", "NONE", "NULL"}

    for field in ["project_name", "project_address", "contact_name", "contact_address", "contact_email", "contact_phone", "architect", "project_type"]:
        src_field = s1_source.get(field)
        tgt_field = s1_target.get(field)

        src_val = src_field.get("value") if isinstance(src_field, dict) else src_field
        tgt_val = tgt_field.get("value") if isinstance(tgt_field, dict) else tgt_field

        if src_val not in sentinels:
            if tgt_val in sentinels:
                if isinstance(tgt_field, dict) and isinstance(src_field, dict):
                    tgt_field["value"] = src_field.get("value")
                    tgt_field["confidence"] = src_field.get("confidence")
                    tgt_field["reasoning"] = src_field.get("reasoning")
                    tgt_field["status"] = src_field.get("status", "PENDING")
                elif isinstance(tgt_field, dict):
                    tgt_field["value"] = src_val

    # Also apply any lead_meta that is still missing in target
    if lead_meta and isinstance(lead_meta, dict):
        from extraction.schema_builder import normalize_lead_metadata
        norm = normalize_lead_metadata(lead_meta)
        try:
            from extraction.extraction_parser import (
                normalize_sender_identity, value_matches_sender,
            )
            _sender_ids = normalize_sender_identity(
                lead_meta.get("sender"), lead_meta.get("senderEmail"),
                lead_meta.get("sender_email"), lead_meta.get("fromAddress"),
                lead_meta.get("from_address"), lead_meta.get("senderName"),
                lead_meta.get("sender_name"), lead_meta.get("fromName"),
                lead_meta.get("from_name"),
            )
        except Exception:
            _sender_ids = set()
        for k, val in norm.items():
            if k.startswith("_"):
                continue
            tgt_field = s1_target.get(k)
            tgt_val = tgt_field.get("value") if isinstance(tgt_field, dict) else tgt_field
            if tgt_val in sentinels:
                if isinstance(tgt_field, dict):
                    tgt_field["value"] = val
                    # A sender fallback must never pose as verified client data.
                    if k in ("contact_name", "contact_email", "contact_phone") and value_matches_sender(val, _sender_ids):
                        tgt_field["confidence"] = 50
                        tgt_field["reasoning"] = ["Taken from sender header as fallback — verify against document signature/body"]
                    else:
                        tgt_field["confidence"] = 90
                    tgt_field["status"] = "PENDING"
                    tgt_field["updated_by"] = "classifier_lead"

    # Canonicalize a legacy project_type (older docs may hold lowercase or
    # descriptive values predating the enum choke point in schema_builder).
    try:
        from extraction.schema_builder import normalize_project_type_value as _norm_pt
        _pt_field = s1_target.get("project_type")
        if isinstance(_pt_field, dict) and isinstance(_pt_field.get("value"), str):
            _pt_normed = _norm_pt(_pt_field.get("value"))
            if _pt_normed is not None and _pt_normed != _pt_field.get("value"):
                _pt_field["value"] = _pt_normed
    except Exception:
        pass


def run_new_project(request) -> dict:
    has_context = bool(getattr(request, "context", None))
    has_documents = bool(getattr(request, "documents", None))

    # Fetch verified lead metadata from classifier / project records
    lead_metadata = _get_lead_context_metadata(request.project_id)
    # Do NOT promote transport sender to contact_email. normalize_lead_metadata
    # treats the "contact_email" key as highest-priority CLIENT email, while
    # "sender" is correctly treated as last-resort. Storing sender as
    # contact_email is what made every forwarder (e.g. zoya@amberflux.com)
    # overwrite the real client from the lead sheet.
    if getattr(request, "sender", None):
        lead_metadata.setdefault("sender", request.sender)
        lead_metadata.setdefault("senderEmail", request.sender)
    if getattr(request, "subject", None) and not lead_metadata.get("projectName"):
        lead_metadata["projectName"] = request.subject
    # De-poison against the transport sender too, then build the identity
    # set used for sender-aware header merging (forwarder never beats client).
    _strip_sender_matching_client_fields(
        lead_metadata, extra_sender_values=[getattr(request, "sender", None)],
    )
    sender_identity = _build_sender_identity(request, lead_metadata)

    # ── Detect existing vs new project ──────────────────────────────────────────
    try:
        existing_schema = read_from_mongo(request.project_id)
        units = existing_schema.get("units") or {}
        real_dim_count = 0
        for u in units.values():
            if not isinstance(u, dict):
                continue
            w = u.get("value_width_in")
            l = u.get("value_length_in")
            if isinstance(w, (int, float)) and w > 0:
                real_dim_count += 1
            if isinstance(l, (int, float)) and l > 0:
                real_dim_count += 1

        sentinels = {None, "", "PENDING", "NOT_STATED", "MANUAL"}

        has_stage2 = existing_schema.get("stage_2", {}).get("glass_type", {}).get("value") not in sentinels
        has_stage3 = existing_schema.get("stage_3", {}).get("decision", {}).get("frame_type", {}).get("value") not in sentinels
        has_contact = existing_schema.get("stage_1", {}).get("contact_name", {}).get("value") not in sentinels

        score = real_dim_count + (1 if has_stage2 else 0) + (1 if has_stage3 else 0) + (1 if has_contact else 0)
        is_existing = (real_dim_count >= 2) or (score >= 2 and (real_dim_count >= 1 or has_stage2))
    except Exception:
        existing_schema = None
        is_existing = False

    if is_existing and existing_schema:
        import logging
        logging.getLogger("gfs.api").info(
            "project_id=%s routing to revision merge (is_existing=%s, has_context=%s, has_documents=%s)",
            request.project_id, is_existing, has_context, has_documents
        )
        if not existing_schema:
            existing_schema = build_unified_doc({}, lead_metadata=lead_metadata)
        return _run_revision_with_docs(existing_schema, request)

    from utils.io_utils import format_context_to_str
    context_str = format_context_to_str(getattr(request, "context", None))

    # ── New project — run normal extraction (with content deduplication) ─────
    documents = _pipeline_documents(request)
    if not documents:
        import logging
        logging.getLogger("gfs.api").info(
            "[NEW PROJECT TEXT ONLY] No documents — writing context as .txt for project_id=%s",
            request.project_id
        )
        folder = Path(tempfile.mkdtemp(prefix=f"gfs_{request.project_id}_"))
        txt_path = folder / "email_context.txt"
        txt_path.write_text(context_str or "", encoding="utf-8")
    else:
        folder = _download_documents_to_temp_folder(documents, request.project_id)

    try:
        if not folder.exists():
            raise FileNotFoundError(f"Project folder not found: {folder}")

        # ── Step 1: Compute content hash of file(s) + email context ──
        # File bytes alone are NOT enough: the same attachment forwarded by two
        # different senders (or with different body text) must not share one
        # cached extracted_result, otherwise the first sender's contact wins
        # for everyone ("cached that only" bug).
        _sender_ctx = getattr(request, "sender", None) or ""
        _cache_context = "\n".join(
            s for s in [context_str or "", str(_sender_ctx or "")] if s
        ) or None
        content_hash = compute_documents_hash(folder, context=_cache_context)
        final_res = None

        # ── Step 2: Check for existing completed AI result in cache ───────────
        cached_doc = get_cached_result(content_hash)
        if cached_doc:
            import logging
            logging.getLogger("gfs.api").info(
                "[CACHE HIT] Reusing previous AI extraction result for content_hash=%s (project_id=%s)",
                content_hash, request.project_id
            )
            final_res = cached_doc.get("extracted_result")
            print("\n" + "="*80)
            print("DEBUG [CACHE HIT] RAW AI RESULT:")
            import json
            try:
                print(json.dumps(final_res, indent=2))
            except Exception:
                print(final_res)
            print("="*80 + "\n")
        else:
            # ── Step 3: Try to claim lock / wait for concurrent duplicate ────
            is_leader = claim_processing_lock(content_hash)
            if not is_leader:
                import logging
                logging.getLogger("gfs.api").info(
                    "[CONCURRENT WAIT] Identical document hash=%s is being processed by another task — waiting...",
                    content_hash
                )
                waiting_doc = wait_for_processing(content_hash)
                if waiting_doc:
                    final_res = waiting_doc.get("extracted_result")

            if not final_res:
                if not is_leader:
                    # Leader is gone (stale lock), failed, or slower than the
                    # follower wait -- (re-)claim, stealing a dead lock, so the
                    # run below is tracked and the next duplicate waits on us.
                    is_leader = claim_processing_lock(content_hash)
                    if not is_leader:
                        import logging
                        logging.getLogger("gfs.api").warning(
                            "[CONCURRENT DUPLICATE] hash=%s still locked by a live leader after wait — "
                            "running a duplicate pipeline to avoid blocking the project",
                            content_hash,
                        )
                # ── Step 4: Run the expensive AI pipeline (OCR + Vision + LLM) ─
                def _on_phase1_complete(intermediate_res: dict) -> None:
                    try:
                        import logging
                        logging.getLogger("gfs.api").info(
                            "[PHASE 1 PROGRESSIVE] Populating early AI insights for project_id=%s",
                            request.project_id
                        )
                        _enrich_outlook_email_with_stage0(request.project_id, intermediate_res)
                        phase1_doc = build_unified_doc(intermediate_res, lead_metadata=lead_metadata)
                        save_to_mongo(request.project_id, phase1_doc)
                        if content_hash:
                            from services.cache_service import save_phase1_cache
                            save_phase1_cache(content_hash, intermediate_res)
                    except Exception as exc:
                        import logging
                        logging.getLogger("gfs.api").warning("Phase 1 progressive update failed: %s", exc)


                try:
                    with processing_heartbeat(content_hash):
                        pipeline_res = run_pipeline(
                            project_folder=folder,
                            lead_id=request.project_id,
                            on_phase1_complete=_on_phase1_complete,
                            sender_identity=sender_identity,
                        )
                    final_res = pipeline_res.get("final_result")
                    if not final_res:
                        mark_cache_failed(content_hash, "Pipeline run did not produce any final extraction result.")
                        raise ValueError("Pipeline run did not produce any final extraction result.")
                    
                    save_completed_cache(content_hash, final_res)
                    
                    # Update backend documents with cached AI result reference
                    _update_backend_documents_with_cache_ref(request.project_id, documents, content_hash)
                except Exception as exc:
                    mark_cache_failed(content_hash, str(exc))
                    raise


        # Always build the fresh unified doc from this extraction up front.
        _enrich_outlook_email_with_stage0(request.project_id, final_res)
        new_schema = build_unified_doc(final_res, lead_metadata=lead_metadata)
        new_schema = _apply_all_rules(new_schema)
        
        # Extract validation results for enrichment
        header_validation = None
        if "stage_1" in new_schema and "_header_validation" in new_schema["stage_1"]:
            header_validation = new_schema["stage_1"]["_header_validation"]
            final_res["header_validation"] = header_validation
        
        # Enrich with validation-aware summary
        _enrich_outlook_email_with_stage0(request.project_id, final_res)

        old_schema = None
        try:
            old_schema = read_from_mongo(request.project_id)
        except FileNotFoundError:
            old_schema = None
        except ValueError:
            old_schema = None

        if old_schema:
            # Only merge if old schema has REAL extracted data.
            # Backend pre-creates empty docs with null values — treat those as new.
            old_units = old_schema.get("units") or {}
            has_real_units = any(
                (isinstance(u.get("value_width_in"), (int, float)) and u.get("value_width_in") > 0) or
                (isinstance(u.get("value_length_in"), (int, float)) and u.get("value_length_in") > 0)
                for u in old_units.values() if isinstance(u, dict)
            )
            sentinels = {None, "", "PENDING", "NOT_STATED", "MANUAL"}
            has_stage2 = old_schema.get("stage_2", {}).get("glass_type", {}).get("value") not in sentinels
            if has_real_units or has_stage2:
                from extraction.revision_patcher import run_revision
                merged_doc = run_revision(old_schema, final_res, context=context_str)
                _preserve_stage1_fields(merged_doc, old_schema, lead_metadata)
                merged_doc = _apply_all_rules(merged_doc)
                _enrich_outlook_email_with_stage0(request.project_id, final_res, merged_doc)
                return merged_doc
            else:
                _preserve_stage1_fields(new_schema, old_schema, lead_metadata)

        _enrich_outlook_email_with_stage0(request.project_id, final_res, new_schema)
        return new_schema
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _run_revision_with_docs(existing_schema: dict, request) -> dict:
    """
    Revision path: download new documents, run extraction pipeline (or reuse cache),
    merge result into existing unified schema via update_from_new_document and run_revision.
    """
    lead_metadata = _get_lead_context_metadata(request.project_id)
    # Same sender rule as run_new_project: keep sender at lowest priority.
    if getattr(request, "sender", None):
        lead_metadata.setdefault("sender", request.sender)
        lead_metadata.setdefault("senderEmail", request.sender)
    if getattr(request, "subject", None) and not lead_metadata.get("projectName"):
        lead_metadata["projectName"] = request.subject
    _strip_sender_matching_client_fields(
        lead_metadata, extra_sender_values=[getattr(request, "sender", None)],
    )
    sender_identity = _build_sender_identity(request, lead_metadata)

    if not existing_schema or "stage_1" not in existing_schema:
        existing_schema = build_unified_doc({}, lead_metadata=lead_metadata)

    from utils.io_utils import format_context_to_str
    from extraction.revision_patcher import run_revision
    context_str = format_context_to_str(getattr(request, "context", None))

    documents = _pipeline_documents(request)
    if not documents:
        import logging
        logging.getLogger("gfs.api").info(
            "[TEXT ONLY RETRIGGER] No documents attached — running revision patcher directly on context for project_id=%s",
            request.project_id
        )
        updated_doc = run_revision(existing_schema, {}, context=context_str)
        _preserve_stage1_fields(updated_doc, existing_schema, lead_metadata)
        updated_doc = _apply_all_rules(updated_doc)
        _enrich_outlook_email_with_stage0(request.project_id, {}, updated_doc)
        return updated_doc

    folder = _download_documents_to_temp_folder(documents, request.project_id)
    try:
        _sender_ctx2 = getattr(request, "sender", None) or ""
        _cache_context2 = "\n".join(
            s for s in [context_str or "", str(_sender_ctx2 or "")] if s
        ) or None
        content_hash = compute_documents_hash(folder, context=_cache_context2)
        cached_doc = get_cached_result(content_hash)
        final_res = None

        if cached_doc:
            import logging
            logging.getLogger("gfs.api").info(
                "[CACHE HIT REVISION] Reusing cached AI result for content_hash=%s (project_id=%s)",
                content_hash, request.project_id
            )
            final_res = cached_doc.get("extracted_result")
        else:
            is_leader = claim_processing_lock(content_hash)
            if not is_leader:
                waiting_doc = wait_for_processing(content_hash)
                if waiting_doc:
                    final_res = waiting_doc.get("extracted_result")

            if not final_res:
                if not is_leader:
                    # Same stale-lock recovery as the new-project path: steal a
                    # dead leader's lock so this run is tracked + heartbeated.
                    is_leader = claim_processing_lock(content_hash)
                    if not is_leader:
                        import logging
                        logging.getLogger("gfs.api").warning(
                            "[CONCURRENT DUPLICATE] hash=%s still locked by a live leader after wait — "
                            "running a duplicate pipeline to avoid blocking the project",
                            content_hash,
                        )
                def _on_phase1_complete(intermediate_res: dict) -> None:
                    try:
                        import logging
                        logging.getLogger("gfs.api").info(
                            "[PHASE 1 PROGRESSIVE REVISION] Populating early AI insights for project_id=%s",
                            request.project_id
                        )
                        _enrich_outlook_email_with_stage0(request.project_id, intermediate_res)
                        if content_hash:
                            from services.cache_service import save_phase1_cache
                            save_phase1_cache(content_hash, intermediate_res)
                    except Exception as exc:
                        import logging
                        logging.getLogger("gfs.api").warning("Phase 1 progressive revision update failed: %s", exc)


                try:
                    with processing_heartbeat(content_hash):
                        pipeline_res = run_pipeline(
                            project_folder=folder,
                            lead_id=request.project_id,
                            on_phase1_complete=_on_phase1_complete,
                            sender_identity=sender_identity,
                        )
                    final_res = pipeline_res.get("final_result")
                    if not final_res:
                        mark_cache_failed(content_hash, "Revision pipeline run did not produce a final extraction result.")
                        raise ValueError("Revision pipeline run did not produce a final extraction result.")
                    save_completed_cache(content_hash, final_res)
                    
                    # Update backend documents with cached AI result reference
                    _update_backend_documents_with_cache_ref(request.project_id, documents, content_hash)
                except Exception as exc:
                    mark_cache_failed(content_hash, str(exc))
                    raise


        # Use structured revision patcher instead of full-schema LLM merge
        from extraction.revision_patcher import run_revision
        updated_doc = run_revision(existing_schema, final_res, context=context_str)
        _preserve_stage1_fields(updated_doc, existing_schema, lead_metadata)
        updated_doc = _apply_all_rules(updated_doc)
        _enrich_outlook_email_with_stage0(request.project_id, final_res, updated_doc)
        return updated_doc
    finally:
        shutil.rmtree(folder, ignore_errors=True)

def _apply_all_rules(unified_doc: dict) -> dict:
    """Run all rules engine modules to pre-populate parameters in the unified doc upon extraction."""
    try:
        from extraction.unified_adapter import write_rules_to_unified_doc
        flat = unified_to_extraction_dict(unified_doc)
        canonical = CanonicalSignals.from_dict(flat)
        repo = get_repository(source="ai", ai_json=json.dumps(flat))
        project_id = unified_doc.get("project_id", "unknown")
        ext = repo.get(project_id) or repo.get("unknown")
        
        g  = decide_glass_type(ext, canonical=canonical)
        fr = decide_frame_type(ext, g, canonical=canonical)
        cb = decide_cross_beam(ext, g, fr, canonical=canonical)
        a  = decide_add_ons(ext, g, fr, cb, canonical=canonical)
        
        return write_rules_to_unified_doc(unified_doc, g, fr, cb, a)
    except Exception as exc:
        import logging
        logging.getLogger("gfs.api").warning("Failed to pre-populate rules in initial schema: %s", exc)
        return unified_doc

def run_stage_1(unified_doc: dict) -> dict:
    # Stage 1 has no rules engine, just pure field copies from signals (done by build_unified_doc)
    return {"stage_1": unified_doc.get("stage_1", {})}

def run_stage_2(unified_doc: dict) -> dict:
    # If glass_type was customer-stated or approved/needs_review, skip re-derivation — manual/AI value wins
    s2 = unified_doc.get("stage_2") or {}
    glass_field = s2.get("glass_type") or {}
    meta = glass_field.get("_meta") or {}
    if isinstance(glass_field, dict) and (meta.get("manual") or meta.get("customer_stated") or glass_field.get("status") in ["APPROVED", "NEEDS_REVIEW"]):
        import logging
        logging.getLogger("gfs.api").info(
            "[Stage 2] glass_type has manual/customer_stated=True or status=%s — preserving value '%s'",
            glass_field.get("status"), glass_field.get("value")
        )
        return {"stage_2": s2, "units": unified_doc.get("units", {})}
    flat = unified_to_extraction_dict(unified_doc)
    canonical = CanonicalSignals.from_dict(flat)
    repo = get_repository(source="ai", ai_json=json.dumps(flat))
    project_id = unified_doc.get("project_id", "unknown")
    ext = repo.get(project_id) or repo.get("unknown")

    # Per-unit differentiation (contract §3): each unit's OWN glass decision;
    # the project holds the FIRST unit's decision (dominant). Falls back to
    # the legacy project-level run when there are no units.
    from extraction.unified_adapter import compute_per_unit_decisions as _compute_pu
    from extraction.unified_adapter import persist_per_unit_decisions as _persist_pu
    _decisions, _first_glass, _, _ = _compute_pu(unified_doc)
    now_str = datetime.now(timezone.utc).isoformat()
    if _first_glass is not None:
        g = _first_glass
        _persist_pu(unified_doc, _decisions, now=now_str, fields=("glass",))
    else:
        g = decide_glass_type(ext, canonical=canonical)

    write_rules_value(
        unified_doc, "glass_type",
        value=g.glass_type_code,
        confidence=g.confidence,
        reasoning=g.reasoning,
        flags=g.flags,
        now=now_str
    )
    # Fan-out to Parameters takeoff units so stage_4.units shows glass type.
    # Only fills units that didn't get their own value above.
    try:
        from extraction.unified_adapter import fan_out_specs_to_units
        fan_out_specs_to_units(unified_doc, glass_code=g.glass_type_code,
                               glass_confidence=g.confidence, now=now_str)
    except Exception:
        pass
    return {"stage_2": unified_doc.get("stage_2", {}),
            "units": unified_doc.get("units", {})}

def run_stage_3(unified_doc: dict) -> dict:
    # If frame_type was customer-stated or approved/needs_review, skip re-derivation — manual/AI value wins
    s3 = unified_doc.get("stage_3") or {}
    s3_decision = s3.get("decision") or {}
    frame_field = s3_decision.get("frame_type") or {}
    meta = frame_field.get("_meta") or {}
    if isinstance(frame_field, dict) and (meta.get("manual") or meta.get("customer_stated") or frame_field.get("status") in ["APPROVED", "NEEDS_REVIEW"]):
        import logging
        logging.getLogger("gfs.api").info(
            "[Stage 3] frame_type has manual/customer_stated=True or status=%s — preserving value '%s'",
            frame_field.get("status"), frame_field.get("value")
        )
        return {"stage_3": s3, "units": unified_doc.get("units", {})}
    flat = unified_to_extraction_dict(unified_doc)
    canonical = CanonicalSignals.from_dict(flat)
    repo = get_repository(source="ai", ai_json=json.dumps(flat))
    project_id = unified_doc.get("project_id", "unknown")
    ext = repo.get(project_id) or repo.get("unknown")

    # Per-unit differentiation (contract §3): each unit's OWN frame decision
    # from its OWN glass decision; the project holds the FIRST unit's
    # decision (dominant). Falls back to the legacy project-level run.
    from extraction.unified_adapter import compute_per_unit_decisions as _compute_pu3
    from extraction.unified_adapter import persist_per_unit_decisions as _persist_pu3
    _decisions3, _, _first_frame, _ = _compute_pu3(unified_doc)
    now_str = datetime.now(timezone.utc).isoformat()
    if _first_frame is not None:
        fr = _first_frame
        _persist_pu3(unified_doc, _decisions3, now=now_str, fields=("frame",))
    else:
        # Reconstruct GlassTypeResult from stage_2
        s2 = unified_doc.get("stage_2", {}).get("glass_type", {})
        g = GlassTypeResult(
            glass_type_code=s2.get("value"),
            workbook_row_name=None,
            confidence=s2.get("confidence"),
            reasoning=s2.get("reasoning", [])
        )

        fr = decide_frame_type(ext, g, canonical=canonical)

    write_rules_value(
        unified_doc, "frame_type",
        value=fr.frame_type_code,
        confidence=fr.confidence,
        reasoning=fr.reasoning,
        flags=getattr(fr, "flags", []),
        now=now_str
    )
    if hasattr(fr, "install_type") and fr.install_type:
        write_rules_value(
            unified_doc, "install_type",
            value=fr.install_type,
            confidence=fr.confidence,
            reasoning=["Derived from frame type decision"],
            now=now_str
        )
    if hasattr(fr, "assembly_type") and fr.assembly_type:
        write_rules_value(
            unified_doc, "assembly_type",
            value=fr.assembly_type,
            confidence=fr.confidence,
            reasoning=["Derived from frame type decision"],
            now=now_str
        )
    if hasattr(fr, "proposal_number") and fr.proposal_number:
        write_rules_value(
            unified_doc, "proposal_number",
            value=fr.proposal_number,
            confidence=fr.confidence,
            reasoning=["Derived from frame type decision"],
            now=now_str
        )
    # Fan-out to Parameters takeoff units so stage_4.units shows frame type.
    # Only fills units that didn't get their own value above.
    try:
        from extraction.unified_adapter import fan_out_specs_to_units
        fan_out_specs_to_units(unified_doc, frame_code=fr.frame_type_code,
                               frame_confidence=fr.confidence,
                               install_type=getattr(fr, "install_type", None),
                               now=now_str)
    except Exception:
        pass

    return {"stage_3": unified_doc.get("stage_3", {}),
            "units": unified_doc.get("units", {})}


def _val(obj, default=None):
    if isinstance(obj, dict):
        return obj.get("value", default)
    return obj if obj is not None else default

def _meta(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return default

def run_stage_4(unified_doc: dict) -> dict:
    # Gate check: frame_type must be set before crossbeam can run
    frame_type = unified_doc.get("stage_3", {}).get("decision", {}).get("frame_type", {}).get("value")
    if not frame_type:
        return {
            "stage_4": {
                "crossbeam": {
                    "value": None,
                    "confidence": None,
                    "reasoning": ["Stage 3 (frame type) must be approved before Stage 4 can run"],
                    "flags": ["Stage 3 not yet approved — frame_type is null"],
                    "updated_by": "rules_engine",
                    "status": "LOCKED"
                },
                "takeoff": {
                    "panel_count": {"value": None, "status": "LOCKED"},
                            "packaging": {"value": None, "status": "LOCKED"}
                }
            }
        }
    flat = unified_to_extraction_dict(unified_doc)
    canonical = CanonicalSignals.from_dict(flat)
    repo = get_repository(source="ai", ai_json=json.dumps(flat))
    project_id = unified_doc.get("project_id", "unknown")
    ext = repo.get(project_id) or repo.get("unknown")

    def _val(obj, default=None):
        if isinstance(obj, dict):
            return obj.get("value", default)
        return obj if obj is not None else default

    def _meta(obj, key, default=None):
        if isinstance(obj, dict):
            return obj.get(key, default)
        return default

    # Reconstruct GlassTypeResult
    s2 = unified_doc.get("stage_2", {}).get("glass_type", {})
    g = GlassTypeResult(
        glass_type_code=_val(s2),
        workbook_row_name=None,
        confidence=_meta(s2, "confidence", "MEDIUM"),
        reasoning=_meta(s2, "reasoning", []) or []
    )

    # Reconstruct FrameTypeResult
    s3 = unified_doc.get("stage_3", {})
    s3_decision = s3.get("decision", {})
    s3_signals = s3.get("_signals", {})
    ft_field = s3_decision.get("frame_type")
    fr = FrameTypeResult(
        frame_type_code=_val(ft_field),
        workbook_row_name=None,
        install_type=_val(s3_signals.get("install_type")),
        assembly_type=_val(s3_decision.get("assembly_type")),
        proposal_number=_val(s3_decision.get("proposal_number")),
        confidence=_meta(ft_field, "confidence", "MEDIUM"),
        reasoning=_meta(ft_field, "reasoning", []) or [],
        flags=_meta(ft_field, "flags", []) or []
    )

    cb = decide_cross_beam(ext, g, fr, canonical=canonical)

    now_str = datetime.now(timezone.utc).isoformat()
    write_rules_value(
        unified_doc, "cross_beam",
        value=cb.cross_beam_code,
        confidence=cb.confidence,
        reasoning=cb.reasoning,
        flags=getattr(cb, "flags", []),
        now=now_str
    )
    write_rules_value(
        unified_doc, "panel_count",
        value=cb.panel_count,
        confidence=cb.confidence,
        reasoning=cb.reasoning,
        flags=[],
        now=now_str
    )

    # Sourcing total panel count across takeoffs / units, falling back to cb.panel_count
    total_panels = None
    units_dict = unified_doc.get("units")
    if isinstance(units_dict, dict):
        p_counts = [u.get("value_panel_count") for u in units_dict.values() if isinstance(u, dict) and u.get("value_panel_count") is not None]
        if p_counts:
            total_panels = sum(p_counts)
    if total_panels is None:
        total_panels = cb.panel_count

    crates, pack_note = calculate_packaging_base(
        fr.frame_type_code,
        panel_count=total_panels,
    )
    if crates is not None:
        write_rules_value(
            unified_doc, "packaging",
            value=crates,
            confidence="HIGH",
            reasoning=[pack_note] if pack_note else ["Packaging base determined from frame type"],
            flags=[],
            now=now_str,
        )
    else:
        # 11+ panels or unknown frame: omit packaging key completely so it is not sent downstream
        if "stage_4" in unified_doc and isinstance(unified_doc["stage_4"], dict):
            takeoff_block = unified_doc["stage_4"].get("takeoff")
            if isinstance(takeoff_block, dict) and "packaging" in takeoff_block:
                del takeoff_block["packaging"]
    # Refresh per-unit specs so the Parameters table is populated even if
    # Stage 2/3 webhooks were missed — explicit per-unit values still win.
    try:
        from extraction.unified_adapter import fan_out_specs_to_units
        fan_out_specs_to_units(
            unified_doc,
            glass_code=_val(s2),
            frame_code=_val(ft_field),
            now=now_str,
        )
    except Exception:
        pass
    return {"stage_4": unified_doc.get("stage_4", {}),
            "units": unified_doc.get("units", {})}

_build_unit_description = build_unit_description
_inches_to_display = inches_to_display


def _frame_series(code) -> str:
    """SERIES_2000_RECESSED -> SERIES_2000; other frame codes are their own family."""
    code = str(code or "").upper()
    for series in ("SERIES_1000", "SERIES_2000"):
        if code.startswith(series) or code.endswith(series):
            return series
    return code


def _unit_description_basis(unit: dict, proposal_number, project_frame):
    """
    The proposal number and frame a unit's description is written from. A unit
    framed differently from the project uses its own frame, and the project's
    proposal number only while both are the same series (it names the product).
    """
    unit_frame = unit.get("value_frame_type")
    if not unit_frame or unit_frame == project_frame:
        return proposal_number, project_frame
    same_series = _frame_series(unit_frame) == _frame_series(project_frame)
    return (proposal_number if same_series else None), unit_frame


def run_stage_5(unified_doc: dict) -> dict:
    # Gate check: glass_type must be set before addons can run
    glass_type = unified_doc.get("stage_2", {}).get("glass_type", {}).get("value")
    if not glass_type:
        return {
            "stage_5": {
                "addons": {k: {"value": None, "status": "LOCKED", "flags": ["Stage 2 not yet approved"]}
                           for k in ["duty","heat_soak_testing","nanodot","seeded_organic","sentry_glass","krypton_gas","custom_shape","backpaint"]},
                "calculated": {k: {"value": None, "status": "LOCKED"}
                               for k in ["total_sqft","total_weight","perimeter_lf","silicone_tubes","total_man_hours"]}
            },
            "stage_4": unified_doc.get("stage_4", {}),
            "units": unified_doc.get("units", {}),
        }
    flat = unified_to_extraction_dict(unified_doc)
    canonical = CanonicalSignals.from_dict(flat)
    repo = get_repository(source="ai", ai_json=json.dumps(flat))
    project_id = unified_doc.get("project_id", "unknown")
    ext = repo.get(project_id) or repo.get("unknown")

    # Reconstruct GlassTypeResult
    s2 = unified_doc.get("stage_2", {}).get("glass_type", {})
    g = GlassTypeResult(
        glass_type_code=_val(s2),
        workbook_row_name=None,
        confidence=_meta(s2, "confidence", "MEDIUM"),
        reasoning=_meta(s2, "reasoning", []) or []
    )

    # Reconstruct FrameTypeResult
    s3 = unified_doc.get("stage_3", {})
    s3_decision = s3.get("decision", {})
    s3_signals = s3.get("_signals", {})
    ft_field = s3_decision.get("frame_type")
    fr = FrameTypeResult(
        frame_type_code=_val(ft_field),
        workbook_row_name=None,
        install_type=_val(s3_signals.get("install_type")),
        assembly_type=_val(s3_decision.get("assembly_type")),
        proposal_number=_val(s3_decision.get("proposal_number")),
        confidence=_meta(ft_field, "confidence", "MEDIUM"),
        reasoning=_meta(ft_field, "reasoning", []) or [],
        flags=_meta(ft_field, "flags", []) or []
    )

    # Reconstruct confirmed takeoffs
    takeoffs = []
    print("\n" + "="*80)
    print("DEBUG [RULES ENGINE] PROCESSING UNITS FOR TAKEOFF:")
    for unit_id in sorted(unified_doc.get("units", {}).keys()):
        u = unified_doc["units"][unit_id]
        w = u.get("value_width_in")
        l = u.get("value_length_in")
        print(f"  -> Unit {unit_id}: w={w}, l={l}, p_cnt={u.get('value_panel_count')}")
        if w is not None and l is not None:
            p_cnt = u.get("value_panel_count")
            if p_cnt is None:
                p_cnt = 1
            # Unit-wise rafter counts: canonical keys first, legacy fallbacks second.
            # (value_horiz_rafter_count never existed in schema — always None.)
            v_raf = (u.get("value_vertical_rafter_count")
                     if u.get("value_vertical_rafter_count") is not None
                     else u.get("value_rafter_count"))
            h_raf = u.get("value_horizontal_rafter_count")
            rows = u.get("value_rows")
            cols = u.get("value_cols") if u.get("value_cols") is not None else u.get("value_columns")
            is_grid_confirmed = bool(
                u.get("value_is_grid_confirmed")
                or (v_raf is not None and h_raf is not None)
            )
            takeoffs.append(UnitTakeOff(
                unit_id=unit_id,
                width_inches=float(w),
                length_inches=float(l),
                panel_count=int(p_cnt),
                vertical_rafters=int(v_raf) if v_raf is not None else (max(0, int(p_cnt) - 1) if p_cnt is not None else None),
                horizontal_rafters=int(h_raf) if h_raf is not None else (0 if p_cnt is not None else None),
                location=u.get("value_location"),
                drawing_ref=u.get("value_drawing_number") or u.get("value_drawing_no"),
                rows=int(rows) if rows is not None else None,
                cols=int(cols) if cols is not None else None,
                is_grid_confirmed=is_grid_confirmed,
                custom_shape=u.get("value_custom_shape"),
                dim_type=u.get("value_dim_type"),
                glass_type=u.get("value_glass_type"),
                frame_type=u.get("value_frame_type"),
            ))
        else:
            print(f"  -> SKIPPED Unit {unit_id} because w or l is None")
    print("="*80 + "\n")

    # Reconstruct CrossBeamResult
    s4 = unified_doc.get("stage_4", {})
    cb = CrossBeamResult(
        cross_beam_code=s4.get("crossbeam", {}).get("value"),
        workbook_row_name=None,
        panel_count=s4.get("takeoff", {}).get("panel_count", {}).get("value"),
        confidence=s4.get("crossbeam", {}).get("confidence", "LOW")
    )

    calc = compute_calculations(takeoffs, fr, cb, glass_type_code=glass_type)

    # HST is a per-panel weight limit (heat-soak oven/handling constraint), not a
    # shipment-total constraint — use the heaviest single unit, not the project sum.
    max_unit_weight_lbs = max((u.weight_lbs for u in calc.units), default=None)
    a = decide_add_ons(ext, g, fr, cb, weight_lbs=max_unit_weight_lbs, canonical=canonical)

    now_str = datetime.now(timezone.utc).isoformat()
    # Write calculations with detailed reasoning from calc result
    write_rules_value(
        unified_doc,
        "total_sqft",
        calc.total_sqft,
        "HIGH",
        ["Calculated from unit dimensions: (width_in × length_in) / 144 per unit, summed across all units"],
        now=now_str,
    )
    write_rules_value(
        unified_doc,
        "total_weight",
        calc.total_weight_lbs,
        "HIGH",
        ["Calculated as total_sqft × lbs_per_sqft (rate determined by glass_type), summed across all units"],
        now=now_str,
    )
    write_rules_value(
        unified_doc,
        "perimeter_lf",
        calc.total_perimeter_lf,
        "HIGH",
        ["Calculated as 2 × (width_in + length_in) / 12 per unit"],
        now=now_str,
    )
    write_rules_value(
        unified_doc,
        "silicone_tubes",
        calc.total_silicone_tubes,
        "HIGH",
        ["ceil((perimeter_lf + rafter_lf) / 10)"],
        now=now_str,
    )
    
    # Write total man hours (display-only UI signal)
    write_rules_value(
        unified_doc,
        "total_man_hours",
        calc.man_hours,
        calc.man_hours_confidence if calc.man_hours is not None else "LOW",
        [calc.man_hours_formula] if calc.man_hours_formula else (
            ["Total man hours summed across units via Connection-Node formula"]
            if calc.man_hours is not None
            else ["Takeoff data incomplete — man hours could not be reliably estimated"]
        ),
        now=now_str
    )
    # Persist all per-unit calculations directly onto each unit
    units_container = unified_doc.get("units")

    def _update_unit(u_item: dict, calc_uc):
        if calc_uc.man_hours is not None:
            u_item["value_man_hours"] = calc_uc.man_hours
        u_item["value_calculated_sqft"] = calc_uc.sqft
        u_item["value_outer_width_in"] = calc_uc.outer_width_inches
        u_item["value_outer_length_in"] = calc_uc.outer_length_inches
        u_item["value_perimeter_lf"] = calc_uc.perimeter_lf
        u_item["value_rafter_lf"] = calc_uc.rafter_lf
        u_item["value_calculated_weight_lbs"] = calc_uc.weight_lbs
        u_item["value_silicone_tubes"] = calc_uc.silicone_tubes

    if isinstance(units_container, dict):
        for uc in calc.units:
            if uc.unit_id in units_container and isinstance(units_container[uc.unit_id], dict):
                _update_unit(units_container[uc.unit_id], uc)
    elif isinstance(units_container, list):
        for uc in calc.units:
            for u_item in units_container:
                if isinstance(u_item, dict) and u_item.get("unit_id") == uc.unit_id:
                    _update_unit(u_item, uc)

    if calc.packaging_base is not None:
        write_rules_value(
            unified_doc, "packaging", calc.packaging_base, "HIGH",
            [calc.packaging_note] if calc.packaging_note else ["Packaging base determined from frame type"],
            now=now_str,
        )
    else:
        # 11+ panels or unknown frame: omit packaging key completely so it is not sent downstream
        if "stage_4" in unified_doc and isinstance(unified_doc["stage_4"], dict):
            takeoff_block = unified_doc["stage_4"].get("takeoff")
            if isinstance(takeoff_block, dict) and "packaging" in takeoff_block:
                del takeoff_block["packaging"]


    # Write addons
    for addon_field, attr_name in [
        ("duty", "duty"),
        ("heat_soak_testing", "heat_soak_testing"),
        ("nanodot", "nanodot"),
        ("seeded_organic", "seeded_organic"),
        ("sentry_glass", "sentry_glass"),
        ("krypton_gas", "krypton_gas"),
        ("custom_shape", "custom_shape_surcharge"),
        ("backpaint", "backpaint"),
    ]:
        val = getattr(a, attr_name, None)
        if val is not None:
            write_rules_value(
                unified_doc, addon_field,
                value=val.value,
                confidence=val.confidence,
                reasoning=[val.source or val.flag or f"Rules engine addon decision: {addon_field}"],
                now=now_str
            )
            

    # Auto-generate per-unit proposal descriptions (Rule 7).
    _doc_proposal_num = getattr(fr, "proposal_number", None)
    if _doc_proposal_num is None:
        raw_pn = (unified_doc.get("stage_3") or {}).get("decision", {}).get("proposal_number")
        _doc_proposal_num = raw_pn.get("value") if isinstance(raw_pn, dict) else raw_pn

    _doc_frame_type = getattr(fr, "frame_type_code", None)
    if _doc_frame_type is None:
        raw_ft = (unified_doc.get("stage_3") or {}).get("decision", {}).get("frame_type")
        _doc_frame_type = raw_ft.get("value") if isinstance(raw_ft, dict) else raw_ft

    _doc_flags = list(getattr(fr, "flags", None) or [])
    raw_pn = (unified_doc.get("stage_3") or {}).get("decision", {}).get("proposal_number")
    _pn_flags = raw_pn.get("flags") if isinstance(raw_pn, dict) else []
    _all_flags = _doc_flags + list(_pn_flags or [])

    _units_c = unified_doc.get("units")
    _unit_rows = _units_c.values() if isinstance(_units_c, dict) else _units_c if isinstance(_units_c, list) else []
    for _udata in _unit_rows:
        if not isinstance(_udata, dict) or _udata.get("description_manually_edited"):
            continue
        _unit_pn, _unit_frame = _unit_description_basis(_udata, _doc_proposal_num, _doc_frame_type)
        desc = build_unit_description(
            _udata,
            _unit_pn,
            frame_type_code=_unit_frame,
            flags=_all_flags,
        )
        if desc is not None:
            _udata["value_description"] = desc
            _udata["generated_desc_at"] = now_str

    return {
        "stage_5": unified_doc.get("stage_5", {}),
        "stage_4": unified_doc.get("stage_4", {}),
        "units": unified_doc.get("units", {}),
    }

def run_revision(request) -> dict:
    """
    Handles explicit REVISION trigger from fastapi_app.py.
    Supports both document-based and text-only (context-only) revision.
    Loads existing schema from MongoDB if not provided in request.
    """
    existing_schema = request.unified_doc or read_from_mongo(request.project_id)
    return _run_revision_with_docs(existing_schema, request)
