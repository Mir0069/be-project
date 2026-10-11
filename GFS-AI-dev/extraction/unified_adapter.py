"""
extraction/unified_adapter.py
==============================
Adapts a unified MongoDB document back into the flat extraction JSON format
that CanonicalSignals.from_dict() and ExtractionResult expect.

This is a thin translation layer so the existing rules engine works unchanged
while MongoDB stores the unified schema.

Production flow:
  MongoDB (unified doc) -> unified_to_extraction_dict() -> CanonicalSignals -> rules engine
  rules engine output -> write_rules_to_unified_doc() -> MongoDB (updated unified doc)

When rules engine is rewritten to read unified schema directly, delete this file.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any


def _null_like(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip().upper() in {"NOT_STATED", "NULL", "N/A", ""}:
        return True
    return False


def _field_to_signal(field: dict) -> dict:
    """
    Convert a unified schema field back to the flat signal dict
    that CanonicalSignals.from_dict() expects.
    Uses `value` (the current working value) not `extracted_value`.
    """
    reasoning_list = field.get("reasoning") or []
    # Only use the most recent reasoning entry to avoid cross-field contamination
    reasoning_text = reasoning_list[-1] if reasoning_list else ""
    
    return {
        "value": field.get("value"),
        "confidence": field.get("confidence") or "LOW",
        "verbatim": field.get("extracted_verbatim"),
        "reasoning": reasoning_text,
        "citation": field.get("extracted_citation"),
    }


def unified_to_extraction_dict(doc: dict) -> dict:
    """
    Convert unified MongoDB doc (staged structure) -> flat extraction JSON dict.
    This is what CanonicalSignals.from_dict() and get_repository() expect.
    Only maps fields the rules engine actually reads.
    """
    from config.unified_schema import _get_field

    def sig(field_name: str):
        f = _get_field(doc, field_name)
        if not f:
            return None
        v = f.get("value")
        if v is None or (isinstance(v, str) and v.strip().upper() in {"NOT_STATED", "NULL", "N/A", ""}):
            return None
        reasoning_list = f.get("reasoning") or []
        # Only use the most recent reasoning entry to avoid cross-field contamination
        reasoning_text = reasoning_list[-1] if reasoning_list else ""
        return {
            "value":      v,
            "confidence": f.get("confidence") or "LOW",
            "verbatim":   f.get("extracted_verbatim"),
            "reasoning":  reasoning_text,
            "citation":   f.get("extracted_citation"),
        }

    units = []
    for unit_id in sorted(doc.get("units", {}).keys()):
        u = doc["units"][unit_id]
        w = u.get("value_width_in") or u.get("extracted_width_in")
        l = u.get("value_length_in") or u.get("extracted_length_in")
        dia = u.get("value_diameter_in") or u.get("extracted_diameter_in")
        p = u.get("value_panel_count") or u.get("extracted_panel_count")
        if w is None and l is None and dia is None:
            continue
        units.append({
            "unit_label":           unit_id,
            "location_description": u.get("value_location") or u.get("extracted_location"),
            "drawing_number":       u.get("value_drawing_number") or u.get("value_drawing_no") or u.get("extracted_drawing_no"),
            "diameter_inches":      dia,
            "width_inches":         w,
            "length_inches":        l,
            "panel_count":          p,
            "rafter_count":         u.get("value_rafter_count") or u.get("extracted_rafter_count"),
            "vertical_rafter_count": (u.get("value_vertical_rafter_count")
                                      if u.get("value_vertical_rafter_count") is not None
                                      else u.get("extracted_vertical_rafter_count")),
            "horizontal_rafter_count": (u.get("value_horizontal_rafter_count")
                                        if u.get("value_horizontal_rafter_count") is not None
                                        else u.get("extracted_horizontal_rafter_count")),
            "rows":                 (u.get("value_rows")
                                      if u.get("value_rows") is not None
                                      else u.get("extracted_rows")),
            "columns":              (u.get("value_cols") if u.get("value_cols") is not None
                                      else u.get("value_columns") if u.get("value_columns") is not None
                                      else u.get("extracted_columns")),
            "glass_type":           u.get("value_glass_type") or u.get("extracted_glass_type"),
            "frame_type":           u.get("value_frame_type") or u.get("extracted_frame_type"),
            "product_type":         u.get("value_product_type") or u.get("extracted_product_type"),
            "glass_thickness":      u.get("value_glass_thickness") or u.get("extracted_glass_thickness"),
            # The backend contract uses snake_case with the beam word split.
            # Read legacy AI spellings during the transition, but emit/use the
            # backend's canonical spelling everywhere new values are written.
            "crossbeam":            u.get("value_cross_beam") or u.get("value_crossbeam") or u.get("extracted_cross_beam") or u.get("extracted_crossbeam"),
            "confidence":           u.get("extracted_confidence") or "LOW",
            "verbatim":             u.get("extracted_verbatim"),
            "citation":             u.get("extracted_citation"),
            "crossbeam_reasoning":   u.get("cross_beam_reasoning") or u.get("crossbeam_reasoning"),
            "crossbeam_citation":    u.get("cross_beam_citation") or u.get("crossbeam_citation"),
        })

    return {
        "project_id": doc.get("project_id", "unknown"),
        "header_signals": {
            "project_name":    sig("project_name"),
            "project_address": sig("project_address"),
            "project_type":    sig("project_type"),
            "architect_name":  sig("architect"),
            "contact_name":    sig("contact_name"),
            "contact_phone":   sig("contact_phone"),
            "contact_email":   sig("contact_email"),
        },
        "glass_signals": {
            "is_walkable":                sig("is_walkable"),
            "is_exterior":                sig("is_exterior"),
            "has_air_gap":                sig("has_air_gap"),
            "has_conditioned_space_below":sig("has_conditioned_space_below"),
            "is_stair_tread":             sig("is_stair_tread"),
            "is_egr":                     sig("is_egr"),
            "is_replacement_glass_only":  sig("is_replacement_glass_only"),
            "is_glass_2_0":               sig("is_glass_2_0"),
        },
        "frame_signals": {
            "frame_type_stated":       sig("frame_type_stated"),
            "install_type":            sig("install_type"),
            "assembly_type":           sig("assembly_type"),
            "is_thermally_broken":     sig("is_thermally_broken"),
            "is_existing_structure":   sig("is_existing_structure"),
            "is_new_deck_construction":sig("is_new_deck_construction"),
        },
        "location_signals": {
            "project_country": sig("project_country"),
            "project_address": sig("project_address"),
            "is_expedited":    sig("is_expedited"),
        },
        "addon_signals": {
            "has_nanodot":        sig("has_nanodot"),
            "has_seeded_organic": sig("has_seeded_organic"),
            "has_krypton":        sig("has_krypton"),
        },
        "units": units,
    }


# Backend-allowed per-unit codes and their aliases live in spec_codes; these
# wrappers keep the names the rest of the pipeline already calls.
from extraction.spec_codes import (
    normalize_crossbeam_code as _normalize_crossbeam_code,
    normalize_frame_code as _normalize_frame_code,
    normalize_glass_code as _normalize_glass_code,
)


def map_glass_to_backend(code) -> str | None:
    """Map a rules-engine glass code to a backend-accepted per-unit enum.
    Returns None when there is no valid mapping (GLASS_ONLY/MGDS/MANUAL):
    the unit is left blank for the estimator instead of sending a code
    the backend would reject."""
    return _normalize_glass_code(code)


def map_frame_to_backend(code, install_type=None) -> str | None:
    """Map a rules-engine frame code to a backend-accepted per-unit enum.
    Internal codes are mapped down (MODIFIED_SERIES_1000 via install type,
    CUSTOM_ROLLED_STEEL → MANUAL); BLANK/unknown → None (leave blank)."""
    return _normalize_frame_code(code, install_type)


def map_crossbeam_to_backend(code) -> str | None:
    return _normalize_crossbeam_code(code)


def _unit_crossbeam_value(unit: dict):
    """Read the canonical unit crossbeam field, accepting older AI spellings."""
    return (
        unit.get("value_cross_beam")
        or unit.get("value_crossbeam")
        or unit.get("extracted_cross_beam")
        or unit.get("extracted_crossbeam")
    )


def _has_takeoff_data(unit: dict) -> bool:
    """Return True if unit has real dimensional, panel, drawing, or location data.
    Empty pre-seeded slots from backend createEmptySchema (A-J) must not receive
    fanned-out specs."""
    if not isinstance(unit, dict):
        return False
    return any(
        unit.get(k) is not None
        for k in (
            "value_width_in", "extracted_width_in",
            "value_length_in", "extracted_length_in",
            "value_diameter_in", "extracted_diameter_in",
            "value_panel_count", "extracted_panel_count",
            "value_location", "extracted_location",
            "value_drawing_number", "value_drawing_no", "extracted_drawing_no",
            "value_description",
        )
    )


def fan_out_specs_to_units(doc: dict, glass_code=None, frame_code=None, crossbeam_code=None,
                            glass_confidence=None, frame_confidence=None, crossbeam_confidence=None,
                            install_type=None, now: str = None) -> dict:
    """Copy project-level glass/frame decisions onto each unit that lacks
    its own explicit per-unit value.

    Explicit per-unit Vision values (value_* already set from extraction)
    always win — this only fills blanks so the Parameters takeoff table
    never shows empty Glass Type / Frame Type when the project decision
    is known. Returns doc.
    """
    from datetime import datetime, timezone as _tz
    ts = now or datetime.now(_tz.utc).isoformat()
    units = doc.get("units") or {}
    if not isinstance(units, dict):
        return doc
    g = map_glass_to_backend(glass_code)
    f = map_frame_to_backend(frame_code, install_type)
    cb = map_crossbeam_to_backend(crossbeam_code)

    if g is None and f is None and cb is None:
        return doc
    for unit in units.values():
        if not isinstance(unit, dict) or not _has_takeoff_data(unit):
            continue
        if g is not None and not unit.get("value_glass_type"):
            unit["value_glass_type"] = g
            unit["extracted_glass_type"] = unit.get("extracted_glass_type") or g
            if glass_confidence:
                unit["extracted_confidence"] = unit.get("extracted_confidence") or glass_confidence
            rsn = f"Inherited project glass decision {g} (no per-unit override stated)"
            if rsn not in (unit.get("reasoning") or []):
                unit["reasoning"] = (unit.get("reasoning") or []) + [rsn]
            unit["updated_at"] = ts
            unit["updated_by"] = unit.get("updated_by") or "rules_engine"
        if f is not None and not unit.get("value_frame_type"):
            unit["value_frame_type"] = f
            unit["extracted_frame_type"] = unit.get("extracted_frame_type") or f
            rsn = f"Inherited project frame decision {f} (no per-unit override stated)"
            if rsn not in (unit.get("reasoning") or []):
                unit["reasoning"] = (unit.get("reasoning") or []) + [rsn]
            unit["updated_at"] = ts
            unit["updated_by"] = unit.get("updated_by") or "rules_engine"
        if cb is not None and not _unit_crossbeam_value(unit):
            unit["value_cross_beam"] = cb
            unit["extracted_cross_beam"] = unit.get("extracted_cross_beam") or unit.get("extracted_crossbeam") or cb
            if crossbeam_confidence:
                unit["cross_beam_confidence"] = unit.get("cross_beam_confidence") or crossbeam_confidence
            unit["cross_beam_reasoning"] = unit.get("cross_beam_reasoning") or [
                f"Inherited project crossbeam decision {cb} (no per-unit override stated)"
            ]
            rsn = f"Inherited project crossbeam decision {cb} (no per-unit override stated)"
            if rsn not in (unit.get("reasoning") or []):
                unit["reasoning"] = (unit.get("reasoning") or []) + [rsn]
            unit["updated_at"] = ts
            unit["updated_by"] = unit.get("updated_by") or "rules_engine"
    return doc


def _per_unit_rules_context(doc: dict):
    """Build (canonical, ext) for per-unit rules runs. Returns (None, None)
    when the doc has no usable units (callers fall back to project-level)."""
    import json as _json
    from extraction.canonical import CanonicalSignals, UnitCanonicalView
    from extraction.repository import get_repository
    flat = unified_to_extraction_dict(doc)
    canonical = CanonicalSignals.from_dict(flat)
    if not canonical.units:
        return None, None, None
    repo = get_repository(source="ai", ai_json=_json.dumps(flat))
    project_id = doc.get("project_id", "unknown")
    ext = repo.get(project_id) or repo.get("unknown")
    return canonical, ext, UnitCanonicalView


def persist_per_unit_decisions(doc: dict, decisions: dict, now: str = None,
                                 fields=("glass", "frame", "crossbeam")) -> dict:
    """Write per-unit glass/frame decisions onto blank units.

    decisions: {unit_id: {"glass": code|None, "glass_confidence": ...,
                          "frame": code|None, "frame_confidence": ...,
                          "install_type": ...}}
    Only fills units with no explicit value (Vision extraction and estimator
    edits always win). Codes are mapped to backend enums first; unmappable
    codes leave the unit blank. Marks writes updated_by="rules_engine_per_unit".
    `fields` limits which spec is written (stage 2 writes glass only,
    stage 3 writes frame only).
    """
    from datetime import datetime, timezone as _tz
    ts = now or datetime.now(_tz.utc).isoformat()
    units = doc.get("units") or {}
    if not isinstance(units, dict) or not isinstance(decisions, dict):
        return doc
    for unit_id, d in decisions.items():
        if not isinstance(d, dict):
            continue
        u = units.get(unit_id)
        if not isinstance(u, dict):
            continue
        if "glass" in (fields or ()):
            g = map_glass_to_backend(d.get("glass"))
            if g is not None and not u.get("value_glass_type"):
                u["value_glass_type"] = g
                u["extracted_glass_type"] = u.get("extracted_glass_type") or g
                if d.get("glass_confidence"):
                    u["extracted_confidence"] = u.get("extracted_confidence") or d.get("glass_confidence")
                rsn = f"Per-unit glass decision {g} for unit {unit_id}"
                if rsn not in (u.get("reasoning") or []):
                    u["reasoning"] = (u.get("reasoning") or []) + [rsn]
                u["updated_at"] = ts
                u["updated_by"] = "rules_engine_per_unit"
        if "frame" in (fields or ()):
            f = map_frame_to_backend(d.get("frame"), d.get("install_type"))
            if f is not None and not u.get("value_frame_type"):
                u["value_frame_type"] = f
                u["extracted_frame_type"] = u.get("extracted_frame_type") or f
                if d.get("frame_confidence"):
                    u["extracted_confidence"] = u.get("extracted_confidence") or d.get("frame_confidence")
                rsn = f"Per-unit frame decision {f} for unit {unit_id}"
                if rsn not in (u.get("reasoning") or []):
                    u["reasoning"] = (u.get("reasoning") or []) + [rsn]
                u["updated_at"] = ts
                u["updated_by"] = "rules_engine_per_unit"
        if "crossbeam" in (fields or ()):
            cb = map_crossbeam_to_backend(d.get("crossbeam"))
            if cb is not None and not _unit_crossbeam_value(u):
                u["value_cross_beam"] = cb
                u["extracted_cross_beam"] = u.get("extracted_cross_beam") or u.get("extracted_crossbeam") or cb
                if d.get("crossbeam_confidence"):
                    u["cross_beam_confidence"] = u.get("cross_beam_confidence") or d.get("crossbeam_confidence")
                crossbeam_reasoning = d.get("crossbeam_reasoning")
                if isinstance(crossbeam_reasoning, str):
                    crossbeam_reasoning = [crossbeam_reasoning]
                if isinstance(crossbeam_reasoning, list) and crossbeam_reasoning:
                    u["cross_beam_reasoning"] = crossbeam_reasoning
                rsn = f"Per-unit crossbeam decision {cb} for unit {unit_id}"
                if rsn not in (u.get("reasoning") or []):
                    u["reasoning"] = (u.get("reasoning") or []) + [rsn]
                u["updated_at"] = ts
                u["updated_by"] = "rules_engine_per_unit"
    return doc


def compute_per_unit_decisions(doc: dict):
    """Run glass+frame rules independently per unit (UnitCanonicalView).

    Returns (decisions, project_glass, project_frame):
    - decisions: {unit_id: {...}} for persist_per_unit_decisions()
    - project_glass/project_frame: the FIRST unit's result objects (the
      dominant project-level decision per contract §3), or project-level
      results when the doc has no units.
    Never raises — returns ({}, None, None) when nothing is computable.
    """
    from extraction.canonical import CanonicalSignals
    from extraction.repository import get_repository
    from rules.rule2_glass_type import decide_glass_type
    from rules.rule3_frame_type import decide_frame_type
    from rules.rule4_cross_beam import decide_cross_beam
    import json as _json
    try:
        flat = unified_to_extraction_dict(doc)
        canonical = CanonicalSignals.from_dict(flat)
        repo = get_repository(source="ai", ai_json=_json.dumps(flat))
        project_id = doc.get("project_id", "unknown")
        ext = repo.get(project_id) or repo.get("unknown")
        if canonical.units:
            from extraction.canonical import UnitCanonicalView
            decisions: dict = {}
            first_glass = None
            first_frame = None
            for unit in canonical.units:
                label = unit.unit_label
                if not label:
                    continue
                view = UnitCanonicalView(canonical, unit)
                ug = decide_glass_type(ext, canonical=view)
                try:
                    uf = decide_frame_type(ext, ug, canonical=view)
                except Exception:
                    uf = None
                try:
                    ucb = decide_cross_beam(ext, ug, uf, canonical=view)
                except Exception:
                    ucb = None
                decisions[label] = {
                    "glass": getattr(ug, "glass_type_code", None),
                    "glass_confidence": getattr(ug, "confidence", None),
                    "frame": getattr(uf, "frame_type_code", None) if uf else None,
                    "frame_confidence": getattr(uf, "confidence", None) if uf else None,
                    "install_type": getattr(uf, "install_type", None) if uf else None,
                    "crossbeam": getattr(ucb, "cross_beam_code", None) if ucb else None,
                    "crossbeam_confidence": getattr(ucb, "confidence", None) if ucb else None,
                    "crossbeam_reasoning": getattr(ucb, "reasoning", []) if ucb else [],
                }
                if first_glass is None:
                    first_glass, first_frame, first_crossbeam = ug, uf, ucb
            return decisions, first_glass, first_frame, first_crossbeam
        # No units — legacy single project-level run.
        g = decide_glass_type(ext, canonical=canonical)
        fr = decide_frame_type(ext, g, canonical=canonical)
        cb = decide_cross_beam(ext, g, fr, canonical=canonical)
        return {}, g, fr, cb
    except Exception:
        return {}, None, None, None


def write_rules_to_unified_doc(
    doc: dict,
    glass_result,
    frame_result,
    cross_beam_result,
    addon_result,
    unit_decisions: dict = None,
) -> dict:
    """
    Write rules engine output back into the unified MongoDB doc.
    Uses write_rules_value() pattern: rules engine fills `value`,
    estimator can overwrite later.

    glass_result:      GlassTypeResult from rule2
    frame_result:      FrameTypeResult from rule3
    cross_beam_result: CrossBeamResult from rule4
    addon_result:      AddOnResult from rule5
    """
    from config.unified_schema import write_rules_value
    now = datetime.now(timezone.utc).isoformat()

    # Glass type
    write_rules_value(
        doc, "glass_type",
        value=glass_result.glass_type_code,
        confidence=glass_result.confidence,
        reasoning=glass_result.reasoning,
        flags=glass_result.flags,
        now=now,
    )

    # Frame type
    write_rules_value(
        doc, "frame_type",
        value=frame_result.frame_type_code,
        confidence=frame_result.confidence,
        reasoning=frame_result.reasoning,
        flags=getattr(frame_result, "flags", []),
        now=now,
    )

    # Install type (rules engine may confirm or override extraction)
    if hasattr(frame_result, "install_type") and frame_result.install_type:
        write_rules_value(
            doc, "install_type",
            value=frame_result.install_type,
            confidence=frame_result.confidence,
            reasoning=["Derived from frame type decision"],
            now=now,
        )

    # Assembly type
    if hasattr(frame_result, "assembly_type") and frame_result.assembly_type:
        write_rules_value(
            doc, "assembly_type",
            value=frame_result.assembly_type,
            confidence=frame_result.confidence,
            reasoning=["Derived from frame type decision"],
            now=now,
        )

    # Cross beam
    write_rules_value(
        doc, "cross_beam",
        value=cross_beam_result.cross_beam_code if cross_beam_result else None,
        confidence=cross_beam_result.confidence if cross_beam_result else None,
        reasoning=cross_beam_result.reasoning if cross_beam_result else [],
        flags=getattr(cross_beam_result, "flags", []) if cross_beam_result else [],
        now=now,
    )

    # Proposal number
    if hasattr(frame_result, "proposal_number") and frame_result.proposal_number:
        write_rules_value(
            doc, "proposal_number",
            value=frame_result.proposal_number,
            confidence=frame_result.confidence,
            reasoning=["Derived from frame type decision"],
            now=now,
        )

    # Add-ons
    if addon_result:
        for addon_field, attr_name in [
            ("duty", "duty"),
            ("heat_soak_testing", "heat_soak_testing"),
            ("nanodot", "nanodot"),
            ("seeded_organic", "seeded_organic"),
            ("krypton_gas", "krypton_gas"),
            ("sentry_glass", "sentry_glass"),
            ("backpaint", "backpaint"),
            ("custom_shape", "custom_shape_surcharge"),
        ]:
            val = getattr(addon_result, attr_name, None)
            if val is not None:
                write_rules_value(
                    doc, addon_field,
                    value=val.value,
                    confidence=val.confidence,
                    reasoning=[val.source or val.flag or f"Rules engine addon decision: {addon_field}"],
                    now=now,
                )

    # Per-unit differentiation (contract §3): each unit's OWN glass/frame
    # decision first — true per-unit values beat project inheritance.
    # Runs before fan-out so fan-out only fills units with no own decision.
    try:
        _per_unit_decisions, _, _, _ = compute_per_unit_decisions(doc)
        persist_per_unit_decisions(doc, _per_unit_decisions, now=now)
    except Exception:
        pass

    # Fan-out: Parameters tab reads per-unit value_glass_type/value_frame_type,
    # so copy the project decisions onto blank units (explicit overrides win).
    # Only fills units apply_unit_decisions_to_units above didn't cover.
    try:
        fan_out_specs_to_units(
            doc,
            glass_code=getattr(glass_result, "glass_type_code", None),
            frame_code=getattr(frame_result, "frame_type_code", None),
            crossbeam_code=getattr(cross_beam_result, "cross_beam_code", None),
            glass_confidence=getattr(glass_result, "confidence", None),
            frame_confidence=getattr(frame_result, "confidence", None),
            crossbeam_confidence=getattr(cross_beam_result, "confidence", None),
            install_type=getattr(frame_result, "install_type", None),
            now=now,
        )
    except Exception:
        pass

    doc["updated_at"] = now
    return doc
