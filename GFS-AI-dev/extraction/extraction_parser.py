"""
extraction_parser.py
--------------------
Pure-Python post-processing for raw vision-batch results.
"""

import json
from datetime import datetime, timezone
from typing import Any, Optional


def _is_null_like(v) -> bool:
    """
    Treat sentinel "no data" values the same as None when merging signals.
    Without this, a real answer like "SERIES_2000" gets overwritten by
    "NOT_STATED" from a file that had no evidence, because the string
    "NOT_STATED" is not None and slips past the non-null check.
    Generalised: covers any enum sentinel, any casing, any surrounding whitespace.
    """
    if v is None:
        return True
    if isinstance(v, str) and v.strip().upper() in {"NOT_STATED", "NULL", "N/A", ""}:
        return True
    return False


def parse_batch_result(raw: dict) -> dict | None:
    """
    Convert one raw result from call_vision_batch into a parsed dict.
    """
    if not raw.get("ok"):
        idx = raw.get("batch_index", "?")
        err = raw.get("error", "unknown")
        print(f"[WARN] Batch {idx} failed — skipping. Error: {err}")
        return None

    data = raw.get("data")
    if data is None:
        data = raw.get("text", "")

    if isinstance(data, dict):
        return data

    if isinstance(data, str):
        try:
            first = data.find("{")
            last = data.rfind("}")
            if first != -1 and last >= first:
                return json.loads(data[first : last + 1])
        except (json.JSONDecodeError, ValueError):
            pass
        idx = raw.get("batch_index", "?")
        print(f"[WARN] Batch {idx} — JSON parse failed on text response. Skipping.")
        return None

    idx = raw.get("batch_index", "?")
    print(f"[WARN] Batch {idx} — unexpected data type {type(data).__name__}. Skipping.")
    return None


def merge_arrays(batch_results: list[dict], key: str, project_id: str = "project", skip_reconciler: bool = False) -> list:
    """
    Concatenate all list values for `key` across batch_results dicts.
    For units: Uses LLM-based reconciler (reconcile_units_with_llm) to deduplicate units across documents.
    """
    merged: list = []
    for result in batch_results:
        if result is None:
            continue
        value = result.get(key)
        if isinstance(value, list):
            merged.extend(value)

    if key != "units":
        return merged

    if skip_reconciler:
        return merged

    from extraction.unit_reconciler import reconcile_units_with_llm
    return reconcile_units_with_llm(merged, project_id)


_SIGNAL_SECTIONS = ["header_signals", "glass_signals", "frame_signals", "location_signals", "addon_signals"]
_ARRAY_FIELDS = ["units"]

# Contact identity fields where a transport sender/forwarder must never
# outrank the actual client named in the lead sheet / body / signature.
_CONTACT_IDENTITY_FIELDS = frozenset({"contact_name", "contact_email", "contact_phone"})

# Intent fields where an explicit customer statement ("3 walkable skylights")
# must outrank an inferred drawing guess with no matching wording — the
# lead sheet defines WHAT the customer wants, the drawing defines geometry.
_INTENT_FIELDS = frozenset({
    "is_walkable", "is_exterior", "product_type", "panel_configuration",
    "frame_type_stated", "install_type",
})

_INFER_MARKERS = ("infer", "implied", "assum", "guess", "scaled", "no wording",
                  "no label", "generic", "ambiguous")

_EXPLICIT_MARKERS = ("explicit", "stated", "customer", "labeled", "callout",
                     "quote", "verbatim")


def _is_inferred(signal: dict) -> bool:
    """True when the signal itself admits it was inferred, not stated."""
    if not isinstance(signal, dict):
        return False
    text = " ".join([
        str(signal.get("reasoning") or ""),
        str(signal.get("verbatim") or ""),
    ]).lower()
    return any(m in text for m in _INFER_MARKERS)


def _is_explicit(signal: dict) -> bool:
    """True when the signal cites an explicit customer statement/label."""
    if not isinstance(signal, dict):
        return False
    conf = _conf_score(signal.get("confidence"))
    text = " ".join([
        str(signal.get("reasoning") or ""),
        str(signal.get("verbatim") or ""),
    ]).lower()
    if any(m in text for m in _EXPLICIT_MARKERS):
        return True
    # High-confidence with a real verbatim quote is explicit evidence.
    verb = str(signal.get("verbatim") or "").strip()
    return conf >= 85 and len(verb) >= 3

_SENDER_SENTINELS = {"null", "unknown", "none", "", "pending", "not_stated", "manual"}


def normalize_sender_identity(*values) -> set:
    """
    Build a comparable sender-identity set from raw sender values
    (email addresses and/or person names). Matching is exact on the
    lowercased stripped string — never fuzzy — so a client is only
    treated as "the sender" when it is literally the same address/name.
    """
    ids: set = set()
    for v in values:
        if v is None or not isinstance(v, str):
            continue
        s = v.strip().lower()
        if not s or s in _SENDER_SENTINELS:
            continue
        ids.add(s)
    return ids


def value_matches_sender(value: Any, sender_ids) -> bool:
    """True when a signal value literally equals a known sender identity."""
    if value is None or not sender_ids:
        return False
    if not isinstance(value, str):
        value = str(value)
    return value.strip().lower() in sender_ids


def _merge_reasoning_into(target: dict, source: dict) -> None:
    """Absorb source's reasoning strings into target without duplicates."""
    if not isinstance(target, dict) or not isinstance(source, dict):
        return
    existing = target.get("reasoning") or []
    if isinstance(existing, str):
        existing = [existing]
    new_reasoning = source.get("reasoning")
    if new_reasoning:
        if isinstance(new_reasoning, str):
            new_reasoning = [new_reasoning]
        for nr in new_reasoning:
            if nr and nr not in existing:
                existing.append(nr)
        target["reasoning"] = existing
def _conf_score(conf: Any) -> int:
    if conf is None:
        return 0
    if isinstance(conf, (int, float)):
        return max(0, min(100, int(round(conf))))
    if isinstance(conf, str):
        c = conf.strip().upper()
        if c == "HIGH":
            return 85
        if c == "MEDIUM":
            return 60
        if c == "LOW":
            return 30
        try:
            return max(0, min(100, int(round(float(c)))))
        except ValueError:
            return 0
    return 0


def merge_signal_dicts(parsed: list[dict], section: str, sender_identity=None) -> dict:
    """
    Merge one signal section (e.g. glass_signals) across all batch results.

    sender_identity: optional set of lowercased sender emails/names (see
    normalize_sender_identity). For contact identity fields only
    (contact_name/contact_email/contact_phone): when two batches disagree
    and exactly one side literally matches the sender, the NON-sender side
    (the lead-sheet/body client) always wins — regardless of confidence or
    page order. A forwarder must never outrank the actual client.
    Callers that do not pass it get the previous confidence/page behavior.
    """
    sender_ids = set(sender_identity or [])
    merged: dict = {}
    for batch in parsed:
        section_data = batch.get(section)
        if not isinstance(section_data, dict):
            continue
        for field, signal in section_data.items():
            if not isinstance(signal, dict):
                continue
            if field not in merged:
                merged[field] = signal
            else:
                # Sender-aware identity rule (contact fields only).
                if (sender_ids and section == "header_signals"
                        and field in _CONTACT_IDENTITY_FIELDS):
                    existing_val = merged[field].get("value") if isinstance(merged[field], dict) else None
                    new_val = signal.get("value")
                    if (not _is_null_like(existing_val) and not _is_null_like(new_val)
                            and str(existing_val).strip().lower() != str(new_val).strip().lower()):
                        existing_is_sender = value_matches_sender(existing_val, sender_ids)
                        new_is_sender = value_matches_sender(new_val, sender_ids)
                        if existing_is_sender != new_is_sender:
                            if new_is_sender:
                                # Keep existing client; absorb sender reasoning.
                                _merge_reasoning_into(merged[field], signal)
                            else:
                                # New client beats existing sender; keep sender reasoning for audit.
                                _merge_reasoning_into(signal, merged[field])
                                merged[field] = signal
                            continue
                # Intent priority: explicit customer statement beats an
                # inferred drawing guess for WHAT the customer wants, unless
                # the inferred side is decisively more confident (+20).
                if (section in ("glass_signals", "frame_signals")
                        and field in _INTENT_FIELDS):
                    existing_val = merged[field].get("value") if isinstance(merged[field], dict) else None
                    new_val = signal.get("value")
                    if (not _is_null_like(existing_val) and not _is_null_like(new_val)
                            and str(existing_val) != str(new_val)):
                        existing_inf = _is_inferred(merged[field])
                        new_inf = _is_inferred(signal)
                        existing_exp = _is_explicit(merged[field])
                        new_exp = _is_explicit(signal)
                        # Only intervene on a clear explicit-vs-inferred split;
                        # otherwise fall through to confidence merge.
                        if (existing_exp and new_inf) or (new_exp and existing_inf):
                            existing_conf_tmp = _conf_score(merged[field].get("confidence"))
                            new_conf_tmp = _conf_score(signal.get("confidence"))
                            if existing_exp and new_inf:
                                # Existing explicit wins unless new beats it by >20.
                                if new_conf_tmp > existing_conf_tmp + 20:
                                    _merge_reasoning_into(signal, merged[field])
                                    merged[field] = signal
                                else:
                                    _merge_reasoning_into(merged[field], signal)
                                continue
                            else:
                                # New explicit wins unless existing beats it by >20.
                                if new_conf_tmp + 20 >= existing_conf_tmp:
                                    _merge_reasoning_into(signal, merged[field])
                                    merged[field] = signal
                                else:
                                    _merge_reasoning_into(merged[field], signal)
                                continue
                existing_conf = _conf_score(merged[field].get("confidence"))
                new_conf = _conf_score(signal.get("confidence"))
                existing_is_null = _is_null_like(merged[field].get("value"))
                new_is_null = _is_null_like(signal.get("value"))

                if new_conf > existing_conf:
                    # Higher confidence wins, UNLESS the new signal is null-like and existing is a real value
                    if not existing_is_null and new_is_null:
                        # Never overwrite a real value with a null-like sentinel regardless of confidence
                        pass
                    else:
                        merged[field] = signal
                elif new_conf == existing_conf and existing_is_null and not new_is_null:
                    # Real value beats null value at equal confidence
                    merged[field] = signal
                elif new_conf == existing_conf and not existing_is_null and not new_is_null:
                    # Both batches found non-null values at equal confidence.
                    # For header_signals, prioritize earlier pages (e.g. Cover Sheet / Sheet 1 over detail sheets)
                    if section == "header_signals":
                        existing_page = merged[field].get("page")
                        new_page = signal.get("page")
                        if isinstance(new_page, int) and (existing_page is None or not isinstance(existing_page, int) or new_page < existing_page):
                            merged[field] = signal

                    # Merge reasoning from both signals
                    existing_reasoning = merged[field].get("reasoning") or []
                    if isinstance(existing_reasoning, str):
                        existing_reasoning = [existing_reasoning]
                    new_reasoning = signal.get("reasoning")
                    if new_reasoning:
                        if isinstance(new_reasoning, str):
                            new_reasoning = [new_reasoning]
                        for nr in new_reasoning:
                            if nr and nr not in existing_reasoning:
                                existing_reasoning.append(nr)
                        merged[field]["reasoning"] = existing_reasoning
                elif new_conf == existing_conf:
                    # At equal confidence, merge reasoning
                    existing_reasoning = merged[field].get("reasoning") or []
                    if isinstance(existing_reasoning, str):
                        existing_reasoning = [existing_reasoning]
                    new_reasoning = signal.get("reasoning")
                    if new_reasoning:
                        if isinstance(new_reasoning, str):
                            new_reasoning = [new_reasoning]
                        for nr in new_reasoning:
                            if nr and nr not in existing_reasoning:
                                existing_reasoning.append(nr)
                        merged[field]["reasoning"] = existing_reasoning
    return merged


def relabel_units(units: list[dict]) -> list[dict]:
    import re
    from collections import Counter
    label_counts: Counter = Counter()
    result = []
    for u in units:
        if not u.get("unit_label"):
            u["unit_label"] = "Unit"
        base = re.sub(r'\s+\d+$', '', u["unit_label"]).strip()
        label_counts[base] += 1
        u = dict(u)
        u["unit_label"] = f"{base} {label_counts[base]}"
        result.append(u)
    return result


def drop_hallucinated_units(
    units: list[dict],
    all_page_texts: dict[int, str],
    drawing_pages: set = None,
) -> list[dict]:
    import re
    if drawing_pages is None:
        drawing_pages = set()

    def normalize_text(s: str) -> str:
        s = s.lower()
        s = s.replace("\u201c", "").replace("\u201d", "").replace("\u2018", "").replace("\u2019", "")
        s = s.replace("'", "").replace('"', "")
        s = s.replace("\u2013", "-").replace("\u2014", "-")
        return re.sub(r'\s+', '', s)

    clean = []
    for u in units:
        verbatim = u.get("verbatim") or ""
        page = u.get("page")
        
        if page in drawing_pages or (page is not None and str(page) in drawing_pages):
            clean.append(u)
            continue
            
        core = re.sub(r'\(OCR:.*?\)', '', verbatim).strip().strip('"\'').strip()
        page_text = ""
        if page is not None:
            page_text = all_page_texts.get(page, "") or all_page_texts.get(str(page), "")
            
        norm_core = normalize_text(core)
        norm_page = normalize_text(page_text)
        
        if not norm_core or not norm_page or norm_core in norm_page:
            clean.append(u)
        else:
            print(f"[WARN] Dropping likely hallucinated unit: "
                  f"{u.get('unit_label')} | {verbatim!r}")
    return clean


def _cap_confidence(obj):
    """Recursively walk the JSON and downgrade any 'HIGH' confidence to 'MEDIUM'."""
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key == "confidence" and val == "HIGH":
                obj[key] = "MEDIUM"
            else:
                _cap_confidence(val)
    elif isinstance(obj, list):
        for item in obj:
            _cap_confidence(item)


def merge_extraction_results(
    raw_batch_results: list[dict],
    project_id: str,
    all_page_texts: dict = None,
    drawing_pages: set = None,
    skip_reconciler: bool = False,
    sender_identity=None,
) -> dict:
    """
    Parse → merge signal dicts → merge units array → return final result.
    sender_identity is forwarded to the header-signals merge so a
    forwarder/sender value can never outrank the lead-sheet client.
    """
    if all_page_texts is None:
        all_page_texts = {}

    parsed: list[dict] = []
    for raw in raw_batch_results:
        result = parse_batch_result(raw)
        if result is not None:
            parsed.append(result)

    if not parsed:
        null_signal = {"value": None, "confidence": "LOW", "verbatim": None, "page": None, "reasoning": None}
        return {
            "project_id": project_id,
            "source_file": None,
            "source_type": None,
            "extraction_status": "NO_CUSTOMER_INPUT",
            "no_input_reason": "all batches failed or returned no data",
            "header_signals": {k: dict(null_signal) for k in [
                "project_name", "project_address", "project_type",
                "architect_name", "contact_name", "contact_address",
                "contact_phone", "contact_email"
            ]},
            "glass_signals": {k: dict(null_signal) for k in [
                "is_walkable", "is_exterior", "has_air_gap",
                "has_conditioned_space_below", "is_stair_tread", "is_egr",
                "is_replacement_glass_only", "is_glass_2_0"
            ]},
            "frame_signals": {k: dict(null_signal) for k in [
                "frame_type_stated", "install_type", "assembly_type"
            ]},
            "location_signals": {k: dict(null_signal) for k in [
                "project_country", "project_address", "is_expedited"
            ]},
            "units": [],
            "extraction_timing": datetime.now(timezone.utc).isoformat(),
        }

    merged_header  = merge_signal_dicts(parsed, "header_signals", sender_identity=sender_identity)
    merged_glass   = merge_signal_dicts(parsed, "glass_signals")
    merged_frame   = merge_signal_dicts(parsed, "frame_signals")
    merged_location = merge_signal_dicts(parsed, "location_signals")
    merged_addon   = merge_signal_dicts(parsed, "addon_signals")

    all_units: list[dict] = merge_arrays(parsed, "units", skip_reconciler=skip_reconciler)
    seen_dims: set = set()
    deduped_units: list[dict] = []
    for unit in all_units:
        w = unit.get("width_inches")
        l = unit.get("length_inches")
        if w is not None and l is not None:
            key = (round(float(w), 1), round(float(l), 1))
            if key not in seen_dims:
                seen_dims.add(key)
                deduped_units.append(unit)
        else:
            deduped_units.append(unit)

    first = parsed[0]

    merged = {
        "project_id": project_id,
        "source_file": first.get("source_file"),
        "source_type": first.get("source_type"),
        "extraction_status": first.get("extraction_status", "PARTIAL"),
        "no_input_reason": first.get("no_input_reason"),
        "header_signals":   merged_header,
        "glass_signals":    merged_glass,
        "frame_signals":    merged_frame,
        "location_signals": merged_location,
        "addon_signals":    merged_addon,
        "units":            deduped_units,
        "extraction_timing": datetime.now(timezone.utc).isoformat(),
    }

    # merged["units"] = drop_hallucinated_units(merged.get("units", []), all_page_texts, drawing_pages)  # disabled — was incorrectly dropping valid coordinate-derived units
    merged["units"] = relabel_units(merged.get("units", []))
    _cap_confidence(merged)

    return merged
