# extraction/summary_enricher.py
# ─────────────────────────────────────────────────────────────────────────────
# Enriches the project summary with concrete, verified technical scope
# and engineering specs once Stage 0 drawing extraction completes.
# ─────────────────────────────────────────────────────────────────────────────
from typing import Any, Dict, List, Optional
import re


def _val(sig: Any) -> Any:
    return sig.get("value") if isinstance(sig, dict) else sig


def enrich_summary_from_extraction(
    initial_summary: Optional[str],
    extraction_result: Dict[str, Any],
) -> str:
    """
    Combines initial opportunity/email context with extracted CAD drawing facts:
    - Replaces vague scope with exact unit dimensions, counts, and labels.
    - Adds frame series, installation type, and assembly mode.
    - Adds glass engineering signals (air gap, exterior, walkable, add-ons).
    - Preserves customer name, sender email, and job address.
    """
    # 1. Parse existing key-value pairs from initial_summary if present
    parsed_fields: Dict[str, str] = {}
    if initial_summary:
        has_bullet_keys = False
        for line in initial_summary.strip().split("\n"):
            line = line.strip()
            if line.startswith("- ") and ":" in line:
                has_bullet_keys = True
                key, val = line[2:].split(":", 1)
                parsed_fields[key.strip().lower()] = val.strip()
        if not has_bullet_keys and initial_summary.strip():
            from utils.io_utils import sanitize_vtt_and_zoho_text
            clean_init = sanitize_vtt_and_zoho_text(initial_summary)
            if clean_init:
                parsed_fields["request summary"] = clean_init.replace("\n", " ").strip()

    # 2. Extract technical elements from Stage 0 extraction_result
    units: List[Dict[str, Any]] = extraction_result.get("units") or []
    glass_signals: Dict[str, Any] = extraction_result.get("glass_signals") or {}
    frame_signals: Dict[str, Any] = extraction_result.get("frame_signals") or {}
    header_signals: Dict[str, Any] = extraction_result.get("header_signals") or {}
    location_signals: Dict[str, Any] = extraction_result.get("location_signals") or {}
    addon_signals: Dict[str, Any] = extraction_result.get("addon_signals") or {}

    # 3. Resolve Customer Info
    cust_info = parsed_fields.get("customer info")
    if not cust_info or cust_info.lower() in ("null", "unknown"):
        contact = (header_signals.get("contact_name") or {}).get("value")
        company = parsed_fields.get("company name")
        if contact and company:
            cust_info = f"{contact} from {company}"
        elif contact:
            cust_info = contact
        elif company:
            cust_info = f"Representative from {company}"
        else:
            cust_info = "Customer inquiry"

    # 4. Resolve Location
    location = parsed_fields.get("location")
    cad_address = (header_signals.get("project_address") or {}).get("value") or (location_signals.get("project_address") or {}).get("value")
    if cad_address and cad_address.strip() and (not location or location.lower() in ("null", "unknown")):
        location = cad_address.strip()

    # 5. Build Scope from CAD Units
    scope_items: List[str] = []
    for u in units:
        label = u.get("unit_label") or "Glass Unit"
        w = u.get("width_inches")
        l = u.get("length_inches")
        panels = u.get("panel_count")
        page = u.get("page")
        
        dim_str = ""
        if w is not None and l is not None:
            dim_str = f" ({w:.1f}\" × {l:.1f}\")"
        elif w is not None:
            dim_str = f" (Width: {w:.1f}\")"
            
        panel_str = f", {panels} panel(s)" if panels else ""
        page_str = f" [Sheet p.{page}]" if page else ""
        
        scope_items.append(f"{label}{dim_str}{panel_str}{page_str}")

    if scope_items:
        verified_scope = "; ".join(scope_items)
    else:
        verified_scope = parsed_fields.get("scope") or "Architectural structural glass elements referenced in attached drawings"

    # 6. Build Engineering & Framing Specs
    eng_parts: List[str] = []
    frame_type = _val(frame_signals.get("frame_type_stated"))
    if frame_type and frame_type != "NOT_STATED" and isinstance(frame_type, str):
        eng_parts.append(f"Frame: {frame_type.replace('_', ' ').title()}")

    install_type = _val(frame_signals.get("install_type"))
    if install_type and install_type != "NOT_STATED" and isinstance(install_type, str):
        eng_parts.append(f"Mount: {install_type.replace('_', ' ').title()}")

    assembly_type = _val(frame_signals.get("assembly_type"))
    if assembly_type and assembly_type != "NOT_STATED" and isinstance(assembly_type, str):
        eng_parts.append(f"Assembly: {assembly_type}")

    # Glass Signals
    is_walkable = _val(glass_signals.get("is_walkable"))
    if is_walkable is True:
        eng_parts.append("Walkable Glass")
    is_ext = _val(glass_signals.get("is_exterior"))
    if is_ext is True:
        eng_parts.append("Exterior Application")
    has_gap = _val(glass_signals.get("has_air_gap"))
    if has_gap is True:
        eng_parts.append("Air Gap / Insulated")

    # Addons
    if _val(addon_signals.get("has_nanodot")) is True:
        eng_parts.append("NanoDot Anti-slip")
    if _val(addon_signals.get("has_krypton")) is True:
        eng_parts.append("Krypton Gas Filled")

    engineering_summary = ", ".join(eng_parts) if eng_parts else "Standard GFS Engineering Specifications"

    # 7. Request Summary & Attachments
    req_summary = parsed_fields.get("request summary") or "Quoting and pricing requested based on extracted CAD specifications."
    attachments = parsed_fields.get("attachments") or "Architectural drawings and project documents."
    if attachments:
        attachments = re.sub(r'[a-fA-F0-9]{24,}\.pdf', 'Document Drawing.pdf', attachments)
        attachments = re.sub(r'[a-fA-F0-9-]{32,}\.pdf', 'Document Drawing.pdf', attachments)
        
        parts = [p.strip() for p in attachments.split(",")]
        clean_parts = [p for p in parts if not (p.lower().startswith("email-") and ".txt" in p.lower())]
        attachments = ", ".join(clean_parts) if clean_parts else "Architectural drawings and project documents."

    header_validation = extraction_result.get("header_validation", {})
    corrections = header_validation.get("corrections", {})
    
    contact_email_value = (header_signals.get("contact_email") or {}).get("value")
    if "contact_email" in corrections:
        contact_email_value = corrections["contact_email"]
    
    contact_phone_value = (header_signals.get("contact_phone") or {}).get("value")
    if "contact_phone" in corrections:
        contact_phone_value = corrections["contact_phone"]
    
    sender_name = parsed_fields.get("sender name") or (header_signals.get("contact_name") or {}).get("value") or ""
    sender_email = parsed_fields.get("sender email") or contact_email_value or ""
    company_name = parsed_fields.get("company name") or ""
    
    quality_warning = ""
    if header_validation.get("warnings"):
        warning_count = len(header_validation["warnings"])
        if warning_count > 0:
            quality_warning = f" [Data Quality: {warning_count} warning(s) detected]"

    # 8. Assemble the Clean Structured Multi-Line Summary (All 8 keys guaranteed)
    lines = [
        f"- Customer Info: {cust_info}",
        f"- Location: {location or 'Not specified'}",
        f"- Scope: {verified_scope}",
        f"- Engineering & Framing: {engineering_summary}",
        f"- Request Summary: {req_summary}",
        f"- Attachments: {attachments}",
        f"- Sender Name: {sender_name or 'null'}",
        f"- Sender Email: {sender_email or 'null'}",
        f"- Company Name: {company_name or 'null'}",
    ]
    if quality_warning:
        lines.append(f"- Quality Notes: {quality_warning}")

    return "\n".join(lines)


def generate_enriched_reasoning(
    initial_reasoning: Optional[str],
    extraction_result: Dict[str, Any],
) -> str:
    """
    Generates a short, reviewer-facing explanation of what glass scope was
    found in the submitted documents.
    """
    units: List[Dict[str, Any]] = extraction_result.get("units") or []
    frame_signals: Dict[str, Any] = extraction_result.get("frame_signals") or {}
    glass_signals: Dict[str, Any] = extraction_result.get("glass_signals") or {}
    addon_signals: Dict[str, Any] = extraction_result.get("addon_signals") or {}

    pages = sorted(list({str(u.get("page")) for u in units if u.get("page")}))
    sheets_str = f"on sheet(s) {', '.join(pages)}" if pages else "in the submitted documents"

    if units:
        unit_count_str = f"{len(units)} physical glass unit{'s' if len(units) > 1 else ''}"

        frame_type = _val(frame_signals.get("frame_type_stated"))
        frame_str = f"{frame_type.replace('_', ' ').title()} frame" if frame_type and frame_type != "NOT_STATED" and isinstance(frame_type, str) else None

        features = []
        if _val(glass_signals.get("is_walkable")) is True:
            features.append("walkable")
        if _val(glass_signals.get("is_exterior")) is True:
            features.append("exterior")
        if _val(glass_signals.get("has_air_gap")) is True:
            features.append("insulated (air gap)")
        if _val(addon_signals.get("has_nanodot")) is True:
            features.append("NanoDot anti-slip")

        detail_bits = [b for b in [frame_str, ", ".join(features) if features else None] if b]
        detail_str = f" — {'; '.join(detail_bits)}" if detail_bits else ""

        technical_reasoning = f"Found {unit_count_str} {sheets_str} with confirmed dimensions{detail_str}."
    else:
        technical_reasoning = (
            f"No structural glass or walkable skylight line items were found {sheets_str} — "
            f"flagged for manual estimator review."
        )

    from utils.io_utils import sanitize_vtt_and_zoho_text

    if initial_reasoning:
        initial_reasoning = sanitize_vtt_and_zoho_text(initial_reasoning)
        if initial_reasoning:
            lower_init = initial_reasoning.lower()
            if (
                "verification error" in lower_init or
                "jsondecodeerror" in lower_init or
                "blocked by azure content safety filter" in lower_init or
                "zoho was updated" in lower_init
            ):
                initial_reasoning = None
            elif "\n" in initial_reasoning or len(initial_reasoning) > 250:
                first_line = initial_reasoning.split("\n")[0].strip()
                if any(kw in first_line.lower() for kw in ("matched", "new project", "opportunity", "classified", "creating")):
                    initial_reasoning = first_line
                else:
                    initial_reasoning = None

    if initial_reasoning and not initial_reasoning.lower().startswith("ai classified"):
        return f"{initial_reasoning.rstrip('.')}. {technical_reasoning}"

    return technical_reasoning


def enrich_summary_and_reasoning(
    initial_summary: Optional[str],
    initial_reasoning: Optional[str],
    extraction_result: Dict[str, Any],
) -> Dict[str, str]:
    """
    Returns both enriched summary and enriched reasoning in a single dictionary.
    """
    return {
        "summary": enrich_summary_from_extraction(initial_summary, extraction_result),
        "reasoning": generate_enriched_reasoning(initial_reasoning, extraction_result),
    }
