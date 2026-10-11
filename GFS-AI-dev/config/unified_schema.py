"""
config/unified_schema.py
========================
Unified MongoDB document schema for GFS-AI.

Structure matches the backend integration guide (July 2026):
  stage_1           - project header fields
  stage_2
    _signals        - internal extraction inputs (never shown to estimator)
    glass_type      - rules engine output
  stage_3
    _signals        - internal extraction inputs
    decision        - frame_type, proposal_number, assembly_type
  stage_4
    crossbeam       - rules engine output
    takeoff         - panel_count, packaging
  stage_5
    _signals        - internal extraction inputs
    addons          - duty, hst, nanodot, etc
    calculated      - sqft, weight, perimeter, silicone, total_man_hours
  units             - glass openings A-J
  pipeline_status

Three layers per field:
  extracted_*  - read-only audit trail from AI extraction
  value        - current working value (rules engine writes, estimator overwrites)
  status       - PENDING | APPROVED | NEEDS_REVIEW
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Field path map - maps field_name to its location in the staged document
_FIELD_PATHS: dict[str, tuple] = {
    # Stage 1 - header
    "project_name":     ("stage_1", "project_name"),
    "project_address":  ("stage_1", "project_address"),
    "contact_name":     ("stage_1", "contact_name"),
    "contact_address":  ("stage_1", "contact_address"),
    "contact_phone":    ("stage_1", "contact_phone"),
    "contact_email":    ("stage_1", "contact_email"),
    "project_type":     ("stage_1", "project_type"),
    "architect":        ("stage_1", "architect"),
    "homeowner":        ("stage_1", "homeowner"),
    "drafter_designer": ("stage_1", "drafter_designer"),
    "quote_number":     ("stage_1", "quote_number"),
    "person_quoting":   ("stage_1", "person_quoting"),
    "person_checked":   ("stage_1", "person_checked"),
    # Stage 2 - internal signals (not shown to estimator)
    "is_walkable":                ("stage_2", "_signals", "is_walkable"),
    "is_exterior":                ("stage_2", "_signals", "is_exterior"),
    "has_air_gap":                ("stage_2", "_signals", "has_air_gap"),
    "has_conditioned_space_below":("stage_2", "_signals", "has_conditioned_space_below"),
    "is_stair_tread":             ("stage_2", "_signals", "is_stair_tread"),
    "is_egr":                     ("stage_2", "_signals", "is_egr"),
    "is_replacement_glass_only":  ("stage_2", "_signals", "is_replacement_glass_only"),
    "is_glass_2_0":               ("stage_2", "_signals", "is_glass_2_0"),
    # Stage 2 - rules engine output (shown to estimator)
    "glass_type": ("stage_2", "glass_type"),
    # Stage 3 - internal signals (not shown to estimator)
    "frame_type_stated":       ("stage_3", "_signals", "frame_type_stated"),
    "install_type":            ("stage_3", "_signals", "install_type"),
    "is_thermally_broken":     ("stage_3", "_signals", "is_thermally_broken"),
    "is_existing_structure":   ("stage_3", "_signals", "is_existing_structure"),
    "is_new_deck_construction":("stage_3", "_signals", "is_new_deck_construction"),
    # Stage 3 - rules engine output (shown to estimator)
    "frame_type":           ("stage_3", "decision", "frame_type"),
    "proposal_number":      ("stage_3", "decision", "proposal_number"),
    "proposal_description": ("stage_3", "decision", "proposal_description"),
    "assembly_type":        ("stage_3", "decision", "assembly_type"),
    # Stage 4 - crossbeam and takeoff (shown to estimator)
    "cross_beam":  ("stage_4", "crossbeam"),
    "panel_count": ("stage_4", "takeoff", "panel_count"),
    "packaging":   ("stage_4", "takeoff", "packaging"),
    # Stage 5 - internal signals (not shown to estimator)
    "has_nanodot":        ("stage_5", "_signals", "has_nanodot"),
    "has_seeded_organic": ("stage_5", "_signals", "has_seeded_organic"),
    "has_krypton":        ("stage_5", "_signals", "has_krypton"),
    "project_country":    ("stage_5", "_signals", "project_country"),
    "is_expedited":       ("stage_5", "_signals", "is_expedited"),
    # Stage 5 - addons (shown to estimator)
    "duty":              ("stage_5", "addons", "duty"),
    "heat_soak_testing": ("stage_5", "addons", "heat_soak_testing"),
    "nanodot":           ("stage_5", "addons", "nanodot"),
    "seeded_organic":    ("stage_5", "addons", "seeded_organic"),
    "sentry_glass":      ("stage_5", "addons", "sentry_glass"),
    "krypton_gas":       ("stage_5", "addons", "krypton_gas"),
    "custom_shape":      ("stage_5", "addons", "custom_shape"),
    "backpaint":         ("stage_5", "addons", "backpaint"),
    # Stage 5 - calculated (shown to estimator, filled after stage 4 approved)
    "total_sqft":      ("stage_5", "calculated", "total_sqft"),
    "total_weight":    ("stage_5", "calculated", "total_weight"),
    "perimeter_lf":    ("stage_5", "calculated", "perimeter_lf"),
    "silicone_tubes":  ("stage_5", "calculated", "silicone_tubes"),
    "total_man_hours": ("stage_5", "calculated", "total_man_hours"),
}

# Field metadata - excel cell addresses and flags
_FIELD_META: dict[str, dict] = {
    "project_name":     {"excel_cell": "C2",  "manual": False},
    "project_address":  {"excel_cell": "F2",  "manual": False},
    "contact_name":     {"excel_cell": "C3",  "manual": False},
    "contact_address":  {"excel_cell": "F3",  "manual": False},
    "contact_phone":    {"excel_cell": "I3",  "manual": False},
    "contact_email":    {"excel_cell": "L3",  "manual": False},
    "project_type":     {"excel_cell": "C4",  "manual": False},
    "architect":        {"excel_cell": "F4",  "manual": False},
    "homeowner":        {"excel_cell": "I4",  "manual": True},
    "drafter_designer": {"excel_cell": "L4",  "manual": True},
    "quote_number":     {"excel_cell": "I2",  "manual": True},
    "person_quoting":   {"excel_cell": "L2",  "manual": True},
    "person_checked":   {"excel_cell": "P2",  "manual": True},
    "is_walkable":                {"excel_cell": None, "manual": False},
    "is_exterior":                {"excel_cell": None, "manual": False},
    "has_air_gap":                {"excel_cell": None, "manual": False},
    "has_conditioned_space_below":{"excel_cell": None, "manual": False},
    "is_stair_tread":             {"excel_cell": None, "manual": False},
    "is_egr":                     {"excel_cell": None, "manual": False},
    "is_replacement_glass_only":  {"excel_cell": None, "manual": False},
    "is_glass_2_0":               {"excel_cell": None, "manual": False},
    "glass_type":           {"excel_cell": None, "manual": False},
    "frame_type_stated":    {"excel_cell": None, "manual": False},
    "install_type":         {"excel_cell": None, "manual": False},
    "is_thermally_broken":  {"excel_cell": None, "manual": False},
    "is_existing_structure":    {"excel_cell": None, "manual": False},
    "is_new_deck_construction": {"excel_cell": None, "manual": False},
    "frame_type":           {"excel_cell": None, "manual": False},
    "proposal_number":      {"excel_cell": None, "manual": False},
    "proposal_description": {"excel_cell": None, "manual": True},
    "assembly_type":        {"excel_cell": None, "manual": False},
    "cross_beam":  {"excel_cell": None,  "manual": False},
    "panel_count": {"excel_cell": None,  "manual": False},
    "packaging":   {"excel_cell": "E73", "manual": False},
    "has_nanodot":        {"excel_cell": None, "manual": False},
    "has_seeded_organic": {"excel_cell": None, "manual": False},
    "has_krypton":        {"excel_cell": None, "manual": False},
    "project_country":    {"excel_cell": None, "manual": False},
    "is_expedited":       {"excel_cell": None, "manual": False},
    "duty":              {"excel_cell": "D90", "manual": False, "excel_trigger": True},
    "heat_soak_testing": {"excel_cell": None,  "manual": False},
    "nanodot":           {"excel_cell": None,  "manual": False},
    "seeded_organic":    {"excel_cell": None,  "manual": False},
    "sentry_glass":      {"excel_cell": None,  "manual": False},
    "krypton_gas":       {"excel_cell": None,  "manual": False},
    "custom_shape":      {"excel_cell": None,  "manual": False},
    "backpaint":         {"excel_cell": None,  "manual": False},
    "total_sqft":      {"excel_cell": None, "manual": False},
    "total_weight":    {"excel_cell": None, "manual": False},
    "perimeter_lf":    {"excel_cell": None, "manual": False},
    "silicone_tubes":  {"excel_cell": None, "manual": False},
    "total_man_hours": {"excel_cell": None, "manual": False},
}


def _empty_field(field_name: str) -> dict:
    meta = _FIELD_META.get(field_name, {})
    return {
        "_meta": {
            "excel_cell":    meta.get("excel_cell"),
            "manual":        meta.get("manual", False),
            "excel_trigger": meta.get("excel_trigger", False),
        },
        "extracted_value":      None,
        "extracted_confidence": None,
        "extracted_verbatim":   None,
        "extracted_citation":   None,
        "extracted_at":         None,
        "value":      None,
        "confidence": None,
        "reasoning":  [],
        "flags":      [],
        "updated_at": None,
        "updated_by": None,
        "status":     "PENDING",
    }

def _empty_unit(unit_id: str, takeoff_row: int = None) -> dict:
    row = takeoff_row or (115 + ord(unit_id.upper()) - ord("A"))
    return {
        "unit_id": unit_id,
        "unit_label": None,
        "status": "PENDING",
        # AI internal descriptive label for matching a unit across stages
        # (e.g. "Skylight assembly 1"). Display uses value_location.
        "unit_label": None,
        "extracted_width_in": None,
        "extracted_length_in": None,
        "extracted_diameter_in": None,
        "extracted_panel_count": None,
        "extracted_rafter_count": None,
        "extracted_rows": None,
        "extracted_columns": None,
        "extracted_vertical_rafter_count": None,
        "extracted_horizontal_rafter_count": None,
        "extracted_verbatim": None,
        "extracted_citation": None,
        "extracted_at": None,
        "extracted_confidence": None,
        "extracted_location": None,
        "extracted_dim_type": None,
        "extracted_drawing_no": None,
        "extracted_frame_type": None,
        "extracted_glass_type": None,
        "extracted_glass_thickness": None,
        "extracted_crossbeam": None,
        "value_width_in": None,
        "value_length_in": None,
        "value_diameter_in": None,
        "value_panel_count": None,
        "value_rafter_count": None,
        "value_num_units": 1,
        "value_rows": None,
        "value_cols": None,
        # Canonical alias of value_cols (backend reads value_columns).
        "value_columns": None,
        # True when rows×cols is a confirmed real 2D layout, not a fallback.
        "value_is_grid_confirmed": None,
        "value_location": None,
        "value_drawing_no": None,
        "value_drawing_number": None,
        "value_frame_type": None,
        "value_glass_type": None,
        "value_glass_thickness": None,
        "value_crossbeam": None,
        "value_description": None,
        "generated_desc_at": None,
        "description_manually_edited": False,
        "reasoning": [],
        "flags": [],
        "updated_at": None,
        "updated_by": None,
        "excel_takeoff_row": row,
        "excel_width_cell": f"E{row}",
        "excel_length_cell": f"F{row}",
        "excel_panel_cell": f"G{row}",
        "excel_location_cell": f"B{row}",
        "excel_drawing_no_cell": f"C{row}",
        "excel_num_units_cell": f"J{row}",
        "excel_vert_rafter_cell": f"K{row}",
        "excel_glass_trigger_cell": "D9",
        "excel_frame_trigger_cell": None,
        "excel_beam_trigger_cell": None,
        "excel_hst_trigger_cell": "D109",
        "excel_nanodot_trigger_cell": "D110",
        "excel_seeded_trigger_cell": "D107",
    }


def _get_field(doc: dict, field_name: str) -> Optional[dict]:
    path = _FIELD_PATHS.get(field_name)
    if not path:
        return None
    node = doc
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node if isinstance(node, dict) else None


def _ensure_field(doc: dict, field_name: str) -> Optional[dict]:
    path = _FIELD_PATHS.get(field_name)
    if not path:
        return None
    node = doc
    for key in path[:-1]:
        if key not in node:
            node[key] = {}
        node = node[key]
    if path[-1] not in node:
        node[path[-1]] = _empty_field(field_name)
    return node[path[-1]]


def build_empty_doc(project_id: str) -> dict:
    ts = _now()
    return {
        "project_id":     project_id,
        "schema_version": "v3",
        "created_at":     ts,
        "updated_at":     ts,
        "stage_1": {f: _empty_field(f) for f in [
            "project_name", "project_address", "contact_name", "contact_address",
            "contact_phone", "contact_email", "project_type", "architect",
            "homeowner", "drafter_designer", "quote_number",
            "person_quoting", "person_checked",
        ]},
        "stage_2": {
            "_signals": {f: _empty_field(f) for f in [
                "is_walkable", "is_exterior", "has_air_gap",
                "has_conditioned_space_below", "is_stair_tread",
                "is_egr", "is_replacement_glass_only", "is_glass_2_0",
            ]},
            "glass_type": _empty_field("glass_type"),
        },
        "stage_3": {
            "_signals": {f: _empty_field(f) for f in [
                "frame_type_stated", "install_type",
                "is_existing_structure", "is_new_deck_construction",
            ]},
            "decision": {f: _empty_field(f) for f in [
                "frame_type", "proposal_number",
                "proposal_description", "assembly_type",
            ]},
        },
        "stage_4": {
            "crossbeam": _empty_field("cross_beam"),
            "takeoff": {f: _empty_field(f) for f in [
                "panel_count", "packaging",
            ]},
        },
        "stage_5": {
            "_signals": {f: _empty_field(f) for f in [
                "has_nanodot", "has_seeded_organic", "has_krypton",
                "project_country", "is_expedited",
            ]},
            "addons": {f: _empty_field(f) for f in [
                "duty", "heat_soak_testing", "nanodot", "seeded_organic",
                "sentry_glass", "krypton_gas", "custom_shape", "backpaint",
            ]},
            "calculated": {f: _empty_field(f) for f in [
                "total_sqft", "total_weight", "perimeter_lf", "silicone_tubes", "total_man_hours",
            ]},
        },
        "units": {},
        "pipeline_status": {
            "extraction_complete": False,
            "extraction_at":       None,
            "stage_1_status":      "PENDING",
            "stage_2_status":      "LOCKED",
            "stage_3_status":      "LOCKED",
            "stage_4_status":      "LOCKED",
            "stage_5_status":      "LOCKED",
            "stage_6_status":      "LOCKED",
        },
    }


def write_extracted_value(doc: dict, field_name: str, signal: dict, now: str = None) -> None:
    f = _ensure_field(doc, field_name)
    if f is None:
        return
    ts = now or _now()
    f["extracted_value"]      = signal.get("value")
    f["extracted_confidence"] = signal.get("confidence")
    f["extracted_verbatim"]   = signal.get("verbatim")
    f["extracted_citation"]   = signal.get("citation")
    f["citation"]             = signal.get("citation")
    f["extracted_at"]         = ts
    if f["value"] is None:
        f["value"]      = signal.get("value")
        f["confidence"] = signal.get("confidence")
        f["updated_at"] = ts
        f["updated_by"] = "extraction"

    if signal.get("reasoning"):
        existing_reasoning = f.get("reasoning") or []
        new_reasoning = signal.get("reasoning")
        # Normalize to list, then append only items not already present
        if isinstance(new_reasoning, str):
            new_reasoning = [new_reasoning]
        if isinstance(new_reasoning, list):
            for item in new_reasoning:
                if item and item not in existing_reasoning:
                    existing_reasoning = existing_reasoning + [item]
        f["reasoning"] = existing_reasoning


def write_rules_value(
    doc: dict,
    field_name: str,
    value: Any,
    confidence: str,
    reasoning: list,
    flags: list = None,
    now: str = None,
) -> None:
    f = _ensure_field(doc, field_name)
    if f is None:
        return
    # Never overwrite customer-stated or manually approved values
    meta = f.get("_meta", {})
    if meta.get("manual") or meta.get("customer_stated"):
        return
    ts = now or _now()
    previously_approved = f.get("status") == "APPROVED"
    value_changed = f.get("value") != value
    f["value"]      = value
    f["confidence"] = confidence
    f["reasoning"]  = reasoning or []
    f["flags"]      = flags or []
    f["updated_at"] = ts
    f["updated_by"] = "rules_engine"
    f["citation"]   = {
        "source_type": "rule_engine",
        "doc_name": "Rule Engine",
        "pdf_name": "Rule Engine",
    }
    if previously_approved and value_changed:
        f["status"] = "NEEDS_REVIEW"


def write_estimator_value(
    doc: dict,
    field_name: str,
    value: Any,
    estimator_id: str,
    now: str = None,
) -> None:
    f = _ensure_field(doc, field_name)
    if f is None:
        return
    ts = now or _now()
    f["value"]      = value
    f["updated_at"] = ts
    f["updated_by"] = estimator_id
    f["status"]     = "APPROVED"
