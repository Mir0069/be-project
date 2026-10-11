"""
Stage 6 — Excel cell mapping.

Reads an approved unified_doc and produces a flat {cell_address: value} dict
that the backend writes into the Master Workbook template.

Design principles:
  - workbook_map.py is the single source of truth for row/column positions.
  - Static header cells come from stage_1.<field>._meta.excel_cell.
  - Enum-driven cells (proposal row, glass row, addon row) are recomputed at
    write time — never trust pre-computed cell addresses baked at extraction
    time, since the estimator may have edited underlying values.
  - Skip fields with value None, "MANUAL", "PENDING", or "NOT_STATED" —
    those are the estimator's responsibility to fill directly in Excel.
"""
from __future__ import annotations

from typing import Any

from config.workbook_map import (
    PROPOSAL_ROWS,
    GLASS_TYPE_ROWS,
    FRAME_TYPE_ROWS,
    ADDON_ROWS,
    ADDON_TRIGGER_CASE,
    CROSSBEAM_ROWS,
    TAKEOFF_FIRST_ROW,
    TAKEOFF_COLS,
    UNIT_SELECTOR_COLS,
    PROPOSAL_UNIT_FIRST_ROW,
    UNIT_QTY_COLS,
    MAN_HOURS_ROW,
    PACKAGING_ROW,
    FABRICATION,
)


# Rows that use uppercase "Y" as the trigger for non-add-on rows (e.g. proposal).
# Add-on rows must always use ADDON_TRIGGER_CASE from workbook_map instead.
_UPPERCASE_TRIGGER_ROWS: frozenset[int] = frozenset({109})  # Heat Soak Testing


def _skip(value: Any) -> bool:
    """True if this value should not be written to Excel."""
    if value is None:
        return True
    if isinstance(value, str) and value.upper() in ("MANUAL", "PENDING", "NOT_STATED", ""):
        return True
    return False


def _trigger_char(row: int) -> str:
    """Trigger character for non-add-on rows (proposal, glass type, etc.)."""
    return "Y" if row in _UPPERCASE_TRIGGER_ROWS else "y"


def _get_value(field: Any) -> Any:
    """Extract .value from a schema field dict, or return the raw value."""
    if isinstance(field, dict) and "value" in field:
        return field["value"]
    return field


def _unit_has_takeoff_data(unit: dict) -> bool:
    """
    Returns True if the unit has real (non-skip) data in any key takeoff field.
    Checks location, dimensions (width/length/diameter), panel count, drawing number,
    or description in both value_* and extracted_* variants.
    """
    if not isinstance(unit, dict):
        return False
    keys_to_check = (
        "value_location", "extracted_location",
        "value_width_in", "extracted_width_in", "width_inches",
        "value_length_in", "extracted_length_in", "length_inches",
        "value_diameter_in", "extracted_diameter_in", "diameter",
        "value_panel_count", "extracted_panel_count", "panel_count", "num_panels",
        "value_drawing_no", "value_drawing_number", "extracted_drawing_no",
        "value_description", "value_man_hours",
        "value_frame_type", "extracted_frame_type",
        "value_glass_type", "extracted_glass_type",
    )
    for k in keys_to_check:
        val = _get_value(unit.get(k))
        if not _skip(val):
            return True
    return False


def _normalize_units(raw_units: Any) -> dict[str, dict]:
    """
    Normalize units (whether dict or list, keyed by letter, digit, or label)
    into a dict keyed by unit letter 'A'..'J'.
    """
    if not raw_units:
        return {}
    if isinstance(raw_units, list):
        items = [u for u in raw_units if isinstance(u, dict)]
    elif isinstance(raw_units, dict):
        items = [u for _, u in sorted(raw_units.items(), key=lambda x: str(x[0])) if isinstance(u, dict)]
    else:
        return {}

    normalized: dict[str, dict] = {}
    for idx, u in enumerate(items):
        if idx >= 10:
            break
        letter = None
        # 1. Check unit_id field inside unit dict
        uid = str(u.get("unit_id") or "").strip().upper()
        if uid.startswith("UNIT ") and len(uid) > 5:
            uid = uid[5:].strip()
        if len(uid) == 1 and "A" <= uid <= "J":
            letter = uid
        elif uid.isdigit() and 1 <= int(uid) <= 10:
            letter = chr(ord("A") + int(uid) - 1)

        # 2. Check original dict key if raw_units was a dict
        if not letter and isinstance(raw_units, dict):
            for k, val in raw_units.items():
                if val is u:
                    k_str = str(k).strip().upper()
                    if k_str.startswith("UNIT ") and len(k_str) > 5:
                        k_str = k_str[5:].strip()
                    if len(k_str) == 1 and "A" <= k_str <= "J":
                        letter = k_str
                    elif k_str.isdigit() and 1 <= int(k_str) <= 10:
                        letter = chr(ord("A") + int(k_str) - 1)
                    break

        # 3. Fallback to index position (idx 0 -> 'A', idx 1 -> 'B')
        if not letter or letter in normalized:
            letter = chr(ord("A") + idx)

        u_copy = {k: _get_value(v) for k, v in u.items()}
        u_copy["unit_id"] = letter
        normalized[letter] = u_copy

    return normalized




def build_excel_output(unified_doc: dict) -> dict[str, Any]:
    """
    Walk the approved unified_doc and produce {cell_address: value}.
    Backend iterates this dict and writes each entry into the workbook template.
    """
    cells: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 1. Header fields (stage_1) — static cell addresses from _meta
    # ------------------------------------------------------------------
    for field_name, field in (unified_doc.get("stage_1") or {}).items():
        if not isinstance(field, dict):
            continue
        cell = (field.get("_meta") or {}).get("excel_cell")
        value = field.get("value")
        if cell and not _skip(value):
            cells[cell] = value

    # ------------------------------------------------------------------
    # 2. Proposal / frame row (stage_3.decision.proposal_number)
    # Writes "Y" (uppercase) to C{row} where row comes from PROPOSAL_ROWS.
    # The Proposal sheet formula reads IF('Pricing Worksheet'!C128="Y", ...)
    # so uppercase "Y" is required here — do not change to lowercase.
    # ------------------------------------------------------------------
    proposal = _get_value(
        ((unified_doc.get("stage_3") or {}).get("decision") or {}).get("proposal_number")
    )
    proposal_rows_list = list(PROPOSAL_ROWS.values())
    if isinstance(proposal, int) and 1 <= proposal <= len(proposal_rows_list):
        row = proposal_rows_list[proposal - 1]
        cells[f"C{row}"] = "Y"

    # ------------------------------------------------------------------
    # 3. Per-unit fields: take-off, glass type, frame type, add-ons
    # ------------------------------------------------------------------
    glass_type = _get_value((unified_doc.get("stage_2") or {}).get("glass_type"))

    # frame_type drives the frame cost row (rows 38-47) per active unit.
    # Read from stage_3.decision.frame_type — the rules engine output.
    proposal_type = _get_value(
        ((unified_doc.get("stage_3") or {}).get("decision") or {}).get("frame_type")
    )

    # Global add-on decisions from stage_5 (applied per-unit below)
    stage5_addons = (unified_doc.get("stage_5") or {}).get("addons") or {}
    addon_decisions: dict[str, Any] = {
        "seeded_organic": _get_value(stage5_addons.get("seeded_organic")),
        "blur":           _get_value(stage5_addons.get("blur")),
        "heat_soak":      _get_value(stage5_addons.get("heat_soak_testing")),
        "nano_dot":       _get_value(stage5_addons.get("nanodot")),
        "sentry_glass":   _get_value(stage5_addons.get("sentry_glass")),
        "krypton_gas":    _get_value(stage5_addons.get("krypton_gas")),
        "backpaint":      _get_value(stage5_addons.get("backpaint")),
    }
    # Duty is GLOBAL — written once to D90 outside the per-unit loop.
    duty_decision = _get_value(stage5_addons.get("duty"))

    units = _normalize_units(unified_doc.get("units"))

    # Derive the set of selector columns that correspond to unit slots
    # that actually carry real takeoff data. Glass type, frame type, and add-on
    # marks are restricted to these columns only.
    active_selector_cols: set[str] = set()
    for unit_letter, unit in units.items():
        if unit_letter not in UNIT_SELECTOR_COLS or not isinstance(unit, dict):
            continue
        if _unit_has_takeoff_data(unit):
            active_selector_cols.add(UNIT_SELECTOR_COLS[unit_letter])

    for unit_letter, unit in units.items():
        if unit_letter not in UNIT_SELECTOR_COLS or not isinstance(unit, dict):
            continue

        unit_index = ord(unit_letter) - ord("A")
        takeoff_row = TAKEOFF_FIRST_ROW + unit_index
        selector_col = UNIT_SELECTOR_COLS[unit_letter]

        # 3a. Take-off row cells — recompute from workbook_map.
        _write_takeoff(cells, unit, takeoff_row)

        # Only write glass/frame/add-on triggers for active (non-empty) unit slots.
        if selector_col not in active_selector_cols:
            continue

        # 3b. Glass type trigger for this unit — this unit's own value wins
        # when it differs from the project default (multi-spec projects).
        unit_glass_type = unit.get("value_glass_type") or glass_type
        if isinstance(unit_glass_type, str) and unit_glass_type in GLASS_TYPE_ROWS:
            row = GLASS_TYPE_ROWS[unit_glass_type]
            cells[f"{selector_col}{row}"] = _trigger_char(row)

        # 3b2. Frame type trigger for this unit (rows 38-47 on Pricing Worksheet).
        # Uses lowercase "y" — verified against per-unit IF formulas on those rows.
        unit_frame_type = unit.get("value_frame_type") or proposal_type
        if isinstance(unit_frame_type, str) and unit_frame_type in FRAME_TYPE_ROWS:
            frame_row = FRAME_TYPE_ROWS[unit_frame_type]
            if frame_row is not None:
                cells[f"{selector_col}{frame_row}"] = "y"

        # 3c. Add-on triggers — write per unit only where decision is "y"/"Y".
        for addon_key, decision in addon_decisions.items():
            if not isinstance(decision, str):
                continue
            if decision.lower() != "y":
                continue  # skip "n", null, MANUAL, PENDING
            row = ADDON_ROWS.get(addon_key)
            if row is None:
                continue
            trigger = ADDON_TRIGGER_CASE.get((row, selector_col), "y")
            cells[f"{selector_col}{row}"] = trigger

    # ------------------------------------------------------------------
    # 4. Global add-on: Duty (D90 only, uppercase "Y")
    # ------------------------------------------------------------------
    if isinstance(duty_decision, str) and duty_decision.lower() == "y":
        cells["D90"] = ADDON_TRIGGER_CASE.get((90, "D"), "Y")

    # ------------------------------------------------------------------
    # 5. Crossbeam (stage_4.crossbeam) — global, column D only, "y"
    # ------------------------------------------------------------------
    crossbeam_value = _get_value((unified_doc.get("stage_4") or {}).get("crossbeam"))
    if isinstance(crossbeam_value, str) and crossbeam_value not in ("MANUAL", "PENDING", ""):
        cb_row = CROSSBEAM_ROWS.get((crossbeam_value, "ANY"))
        if cb_row is None and isinstance(proposal_type, str):
            # PERIMETER_NON_TB frames use the Series 1000 T-Section row family
            # (Rule 4 documents T_SECTION_NTB's workbook_row_name as
            # "Series 1000 T - Section" even though the frame_type is
            # PERIMETER_NON_TB, not SERIES_1000 — confirmed Spring Lake project).
            if proposal_type.startswith("SERIES_1000") or proposal_type == "PERIMETER_NON_TB":
                cb_row = CROSSBEAM_ROWS.get((crossbeam_value, "SERIES_1000"))
            elif proposal_type.startswith("SERIES_2000"):
                cb_row = CROSSBEAM_ROWS.get((crossbeam_value, "SERIES_2000"))
        if cb_row is not None:
            cells[f"D{cb_row}"] = "y"

    # ------------------------------------------------------------------
    # 6. Man hours (Row 71 per unit: E71 for Unit A, H71 for Unit B, etc.)
    #    computed using Connection-Node formula:
    #    connections = (rows + 1) * (cols + 1)
    #    man_hours   = connections * 2.0 hrs
    # ------------------------------------------------------------------
    _write_man_hours_for_stage6(cells, unified_doc, proposal_type, units)

    # ------------------------------------------------------------------
    # 7. Packaging (Row 73 per active unit via UNIT_QTY_COLS)
    # ------------------------------------------------------------------
    _write_packaging_for_stage6(cells, unified_doc, proposal_type, units)

    return cells


def _write_packaging_for_stage6(
    cells: dict[str, Any],
    unified_doc: dict,
    frame_type: str | None = None,
    units: dict | None = None,
) -> None:
    """
    Write packaging quantity to the Master Workbook template (Row 73 per active unit).
    Unit A -> E73, Unit B -> H73, Unit C -> K73, etc.
    Calculates crates independently per unit using each unit's frame type and panel count.
    If absent, 11+ panels, or manual, leaves the cell unwritten for estimator review.
    Preserves single-unit project-level takeoff.packaging fallback when units is empty.
    """
    from formulas.packaging import calculate_packaging_base

    # Resolve project-level frame type
    proj_frame = _get_value(frame_type)
    if _skip(proj_frame) or (isinstance(proj_frame, str) and proj_frame.upper() == "MANUAL"):
        proj_frame = None

    if proj_frame is None:
        proj_frame = _get_value(((unified_doc.get("stage_3") or {}).get("decision") or {}).get("frame_type"))
        if _skip(proj_frame) or (isinstance(proj_frame, str) and proj_frame.upper() == "MANUAL"):
            proj_frame = None

    if proj_frame is None:
        proj_frame = _get_value((unified_doc.get("stage_3") or {}).get("frame_type"))
        if _skip(proj_frame) or (isinstance(proj_frame, str) and proj_frame.upper() == "MANUAL"):
            proj_frame = None

    if proj_frame is None:
        proj_frame = _get_value((unified_doc.get("stage_1") or {}).get("frame_type"))
        if _skip(proj_frame) or (isinstance(proj_frame, str) and proj_frame.upper() == "MANUAL"):
            proj_frame = None

    if units is None:
        units = _normalize_units(unified_doc.get("units"))
    elif not all(isinstance(k, str) and len(k) == 1 and "A" <= k <= "J" for k in units.keys()):
        units = _normalize_units(units)

    # Filter to active units that have takeoff data
    active_units_list: list[tuple[str, dict]] = []
    for idx, (raw_key, u) in enumerate(sorted(units.items(), key=lambda x: str(x[0]))):
        if not isinstance(u, dict) or not _unit_has_takeoff_data(u):
            continue

        letter = None
        key_str = str(raw_key).strip().upper()
        if key_str.startswith("UNIT ") and len(key_str) > 5:
            key_str = key_str[5:].strip()

        if key_str in UNIT_QTY_COLS:
            letter = key_str
        else:
            uid = str(u.get("unit_id") or "").strip().upper()
            if uid.startswith("UNIT ") and len(uid) > 5:
                uid = uid[5:].strip()
            if uid in UNIT_QTY_COLS:
                letter = uid
            elif key_str.isdigit() and 1 <= int(key_str) <= 10:
                letter = chr(ord("A") + int(key_str) - 1)
            elif uid.isdigit() and 1 <= int(uid) <= 10:
                letter = chr(ord("A") + int(uid) - 1)
            elif 0 <= idx < 10:
                letter = chr(ord("A") + idx)

        if letter and letter in UNIT_QTY_COLS:
            active_units_list.append((letter, u))

    if active_units_list:
        for unit_letter, unit in active_units_list:
            qty_col = UNIT_QTY_COLS.get(unit_letter)
            if not qty_col:
                continue

            # 1. Check unit-level manual override
            unit_packaging = _get_value(unit.get("value_packaging"))
            if not _skip(unit_packaging):
                try:
                    cells[f"{qty_col}{PACKAGING_ROW}"] = float(unit_packaging)
                    continue
                except (ValueError, TypeError):
                    pass

            # 2. Resolve frame type for this unit
            raw_uf = _get_value(unit.get("value_frame_type"))
            if _skip(raw_uf) or (isinstance(raw_uf, str) and raw_uf.upper() == "MANUAL"):
                raw_uf = _get_value(unit.get("extracted_frame_type"))
            if _skip(raw_uf) or (isinstance(raw_uf, str) and raw_uf.upper() == "MANUAL"):
                raw_uf = _get_value(unit.get("frame_type"))
            if _skip(raw_uf) or (isinstance(raw_uf, str) and raw_uf.upper() == "MANUAL"):
                raw_uf = proj_frame

            unit_frame = str(raw_uf).strip() if raw_uf else None

            # 3. Resolve panel count for this unit
            raw_p = _get_value(unit.get("value_panel_count"))
            if raw_p is None:
                raw_p = _get_value(unit.get("extracted_panel_count"))
            if raw_p is None:
                raw_p = _get_value(unit.get("panel_count"))
            if raw_p is None:
                raw_p = _get_value(unit.get("num_panels"))
            if raw_p is None:
                r = _get_value(unit.get("value_rows")) or _get_value(unit.get("extracted_rows"))
                c = _get_value(unit.get("value_cols")) or _get_value(unit.get("value_columns")) or _get_value(unit.get("extracted_columns"))
                if r is not None and c is not None:
                    try:
                        raw_p = int(r) * int(c)
                    except (ValueError, TypeError):
                        pass

            if raw_p is None:
                has_dims = (
                    (_get_value(unit.get("value_width_in")) is not None and _get_value(unit.get("value_length_in")) is not None)
                    or (_get_value(unit.get("extracted_width_in")) is not None and _get_value(unit.get("extracted_length_in")) is not None)
                    or (_get_value(unit.get("width_inches")) is not None and _get_value(unit.get("length_inches")) is not None)
                    or _get_value(unit.get("value_diameter_in")) is not None
                    or _get_value(unit.get("extracted_diameter_in")) is not None
                )
                if has_dims:
                    raw_p = 1

            p_cnt = None
            if raw_p is not None:
                try:
                    p_cnt = int(float(str(raw_p).strip()))
                except (ValueError, TypeError):
                    p_cnt = None

            crates, _ = calculate_packaging_base(unit_frame, panel_count=p_cnt)

            # Fallback for single-unit project: check stage_4.takeoff.packaging
            if crates is None and len(active_units_list) == 1:
                stage4_val = _get_value(((unified_doc.get("stage_4") or {}).get("takeoff") or {}).get("packaging"))
                if not _skip(stage4_val):
                    try:
                        crates = float(stage4_val)
                    except (ValueError, TypeError):
                        crates = None


            if crates is not None and not _skip(crates):
                pack_cell = f"{qty_col}{PACKAGING_ROW}"
                cells[pack_cell] = float(crates)
        return

    # Single-unit / project-level fallback when active_units_list is empty
    stage4 = unified_doc.get("stage_4") or {}
    takeoff = stage4.get("takeoff") or {}
    packaging_field = takeoff.get("packaging")
    if packaging_field is None:
        packaging_field = stage4.get("packaging")

    packaging_val = _get_value(packaging_field)

    if _skip(packaging_val):
        total_panels = _get_value(takeoff.get("panel_count"))
        if total_panels is not None:
            try:
                total_panels = int(float(str(total_panels).strip()))
            except (ValueError, TypeError):
                total_panels = None
        crates, _ = calculate_packaging_base(proj_frame, panel_count=total_panels)
        if crates is not None:
            packaging_val = crates

    if not _skip(packaging_val):
        pack_cell = f"E{PACKAGING_ROW}"
        try:
            cells[pack_cell] = float(packaging_val)
        except (ValueError, TypeError):
            cells[pack_cell] = packaging_val



def _write_man_hours_for_stage6(
    cells: dict[str, Any],
    unified_doc: dict,
    frame_type: str | None,
    units: dict,
) -> None:
    """
    Compute and write fabrication man-hours per unit to Row 71 (e.g. E71 for Unit A,
    H71 for Unit B, K71 for Unit C, etc.) using the deterministic Connection-Node formula:
        connections = (rows + 1) * (cols + 1)
        man_hours   = connections * 2.0 hrs

    Delegates to check_fabrication_man_hours_eligibility.
    """
    from formulas.fabrication import (
        check_fabrication_man_hours_eligibility,
        is_manual_override,
    )

    # 1. Read stage_5.calculated.total_man_hours as source of truth
    stage5_calculated = (unified_doc.get("stage_5") or {}).get("calculated") or {}
    stage5_man_hours_field = stage5_calculated.get("total_man_hours") or {}
    stage5_total_hours = _get_value(stage5_man_hours_field)
    try:
        stage5_total_hours = float(stage5_total_hours) if stage5_total_hours is not None and not _skip(stage5_total_hours) else None
    except (ValueError, TypeError):
        stage5_total_hours = None

    # Check legacy / manual override fields
    stage4_takeoff = (unified_doc.get("stage_4") or {}).get("takeoff") or {}
    man_hours_field = stage4_takeoff.get("man_hours") or stage5_man_hours_field

    if units is None:
        units = _normalize_units(unified_doc.get("units"))
    elif not all(isinstance(k, str) and len(k) == 1 and "A" <= k <= "J" for k in units.keys()):
        units = _normalize_units(units)

    for unit_letter, unit in units.items():
        if not isinstance(unit, dict):
            continue
        if not _unit_has_takeoff_data(unit):
            continue

        qty_col = UNIT_QTY_COLS.get(unit_letter.upper())
        if not qty_col:
            continue

        # Check unit-level manual override
        unit_man_hours = unit.get("value_man_hours")
        if unit_man_hours is not None and not _skip(unit_man_hours):
            try:
                cells[f"{qty_col}{MAN_HOURS_ROW}"] = float(unit_man_hours)
                continue
            except (ValueError, TypeError):
                cells[f"{qty_col}{MAN_HOURS_ROW}"] = unit_man_hours
                continue

        panel_count = unit.get("value_panel_count")
        rafter_count = (unit.get("value_vertical_rafter_count")
                        if unit.get("value_vertical_rafter_count") is not None
                        else unit.get("value_rafter_count"))
        horiz_rafters = unit.get("value_horizontal_rafter_count")
        rows = unit.get("value_rows")
        cols = unit.get("value_cols") if unit.get("value_cols") is not None else unit.get("value_columns")
        has_dims = unit.get("value_width_in") is not None and unit.get("value_length_in") is not None

        if panel_count is not None and int(panel_count) >= 1:
            h_raf = horiz_rafters or 0
            if h_raf > 0:
                rows = int(h_raf) + 1
                cols = max(1, int(panel_count) // rows)
            else:
                rows = 1
                cols = int(panel_count)
            is_grid_confirmed = True
        else:
            is_grid_confirmed = bool(unit.get("value_is_grid_confirmed") or has_dims)

        res = check_fabrication_man_hours_eligibility(
            frame_code=unit.get("value_frame_type") or frame_type,
            rows=rows,
            cols=cols,
            panel_count=int(panel_count) if panel_count is not None else (1 if has_dims else None),
            vertical_rafters=int(rafter_count) if rafter_count is not None else (max(0, int(panel_count) - 1) if panel_count else None),
            horizontal_rafters=int(horiz_rafters) if horiz_rafters is not None else 0,
            is_grid_confirmed=is_grid_confirmed,
            exclusion_indicators=[
                unit.get("value_location"),
                unit.get("value_drawing_no"),
                unit.get("value_custom_shape"),
                unit.get("value_dim_type"),
                unit.get("value_glass_type"),
            ],
            existing_override_field=man_hours_field if isinstance(man_hours_field, dict) else None,
        )

        if res["eligible"] and res["man_hours"] is not None:
            cells[f"{qty_col}{MAN_HOURS_ROW}"] = res["man_hours"]

    # Safe fallback: Ensure E71 is populated only for single-unit projects if not already written.
    # NEVER fall back total_man_hours to E71 on multi-unit projects to avoid double-counting.
    active_units_with_data = [
        u for u in units.values()
        if isinstance(u, dict) and _unit_has_takeoff_data(u)
    ]
    if len(active_units_with_data) <= 1:
        if "E71" not in cells and stage5_total_hours is not None and stage5_total_hours > 0:
            cells["E71"] = stage5_total_hours


def _compute_man_hours_for_stage6(
    unified_doc: dict,
    frame_type: str | None,
    units: dict,
) -> float | None:
    """
    Compute total fabrication man-hours across all units.
    """
    from formulas.fabrication import (
        check_fabrication_man_hours_eligibility,
        is_manual_override,
    )

    # 1. Respect existing calculated value in stage_5
    stage5_calculated = (unified_doc.get("stage_5") or {}).get("calculated") or {}
    stage5_man_hours_field = stage5_calculated.get("total_man_hours") or {}
    if isinstance(stage5_man_hours_field, dict):
        existing_val = stage5_man_hours_field.get("value")
        if existing_val is not None and not _skip(existing_val):
            try:
                return float(existing_val)
            except (ValueError, TypeError):
                pass

    # Legacy fallback: stage_4
    stage4_takeoff = (unified_doc.get("stage_4") or {}).get("takeoff") or {}
    man_hours_field = stage4_takeoff.get("man_hours") or {}
    if isinstance(man_hours_field, dict):
        existing_val = man_hours_field.get("value")
        if is_manual_override(man_hours_field) and existing_val is not None and not _skip(existing_val):
            try:
                return float(existing_val)
            except (ValueError, TypeError):
                return existing_val
        if existing_val is not None and not _skip(existing_val):
            try:
                return float(existing_val)
            except (ValueError, TypeError):
                pass

    total_hours = 0.0
    any_unit_computed = False

    for unit_letter, unit in units.items():
        if not isinstance(unit, dict):
            continue
        if not _unit_has_takeoff_data(unit):
            continue

        panel_count = unit.get("value_panel_count")
        rafter_count = (unit.get("value_vertical_rafter_count")
                        if unit.get("value_vertical_rafter_count") is not None
                        else unit.get("value_rafter_count"))
        horiz_rafters = unit.get("value_horizontal_rafter_count")
        rows = unit.get("value_rows")
        cols = unit.get("value_cols") if unit.get("value_cols") is not None else unit.get("value_columns")
        has_dims = unit.get("value_width_in") is not None and unit.get("value_length_in") is not None
        if panel_count is not None and int(panel_count) >= 1:
            h_raf = horiz_rafters or 0
            if h_raf > 0:
                rows = int(h_raf) + 1
                cols = max(1, int(panel_count) // rows)
            else:
                rows = 1
                cols = int(panel_count)
            is_grid_confirmed = True
        else:
            is_grid_confirmed = bool(unit.get("value_is_grid_confirmed") or has_dims)

        res = check_fabrication_man_hours_eligibility(
            frame_code=frame_type,
            rows=rows,
            cols=cols,
            panel_count=int(panel_count) if panel_count is not None else (1 if has_dims else None),
            vertical_rafters=int(rafter_count) if rafter_count is not None else (max(0, int(panel_count) - 1) if panel_count else None),
            horizontal_rafters=int(horiz_rafters) if horiz_rafters is not None else 0,
            is_grid_confirmed=is_grid_confirmed,
            exclusion_indicators=[
                unit.get("value_location"),
                unit.get("value_drawing_no"),
                unit.get("value_custom_shape"),
                unit.get("value_dim_type"),
                unit.get("value_glass_type"),
            ],
            existing_override_field=man_hours_field if isinstance(man_hours_field, dict) else None,
        )

        if res["eligible"] and res["man_hours"] is not None:
            total_hours += res["man_hours"]
            any_unit_computed = True

    if not any_unit_computed:
        return None

    return total_hours


def _write_takeoff(cells: dict[str, Any], unit: dict, row: int) -> None:
    """Write take-off row cells (width, length, panels, location, rafters, etc.) for one unit."""
    if not _unit_has_takeoff_data(unit):
        return

    # Derive vertical and horizontal rafter counts if not explicitly keyed as value_rafter_width/length
    raw_p = _get_value(unit.get("value_panel_count"))
    panel_count = None
    if raw_p is not None:
        try:
            panel_count = int(float(str(raw_p).strip()))
        except (ValueError, TypeError):
            panel_count = None

    rafter_w = _get_value(unit.get("value_rafter_width"))
    if rafter_w is None:
        rafter_w = _get_value(unit.get("value_vertical_rafter_count"))
    if rafter_w is None:
        rafter_w = _get_value(unit.get("value_rafter_count"))
    if rafter_w is None and panel_count is not None and panel_count >= 1:
        rafter_w = panel_count - 1
    elif rafter_w is None and _get_value(unit.get("value_width_in")) is not None and _get_value(unit.get("value_length_in")) is not None:
        rafter_w = 0

    rafter_l = _get_value(unit.get("value_rafter_length"))
    if rafter_l is None:
        rafter_l = _get_value(unit.get("value_horizontal_rafter_count"))
    if rafter_l is None and (rafter_w is not None or panel_count is not None):
        rafter_l = 0

    mapping = [
        ("value_location",        TAKEOFF_COLS["location"]),
        ("value_drawing_no",      TAKEOFF_COLS["drawing_no"]),
        ("value_width_in",        TAKEOFF_COLS["width"]),
        ("value_length_in",       TAKEOFF_COLS["length"]),
        ("value_panel_count",     TAKEOFF_COLS["num_panels"]),
        ("value_num_units",       TAKEOFF_COLS["num_units"]),
        ("value_glass_thickness", TAKEOFF_COLS["glass_thickness"]),
    ]
    for schema_key, col in mapping:
        val = _get_value(unit.get(schema_key))
        if not _skip(val):
            cells[f"{col}{row}"] = val

    if rafter_w is not None and not _skip(rafter_w):
        try:
            cells[f"{TAKEOFF_COLS['rafter_width']}{row}"] = int(rafter_w)
        except (ValueError, TypeError):
            pass
    if rafter_l is not None and not _skip(rafter_l):
        try:
            cells[f"{TAKEOFF_COLS['rafter_length']}{row}"] = int(rafter_l)
        except (ValueError, TypeError):
            pass



def build_proposal_excel_output(unified_doc: dict) -> dict[str, Any]:
    """
    Build a flat dictionary of {cell_address: value} for writing directly to
    the 'Proposal' tab of the Master Workbook.

    Header Fields:
        K2: Quote Number
        K3: Date
        K4: Project Name
        K5: Project Address (postal code L6J 1G3)
        K6: Project Type
        K7: Architect
        K8: Contact Name
        K9: Contact Phone
        K10: Contact Email
        K11: Person Quoting

    Unit Rows (A23:H32 for Units A-J):
        Col A: unit_id (A, B...)
        Col B: value_drawing_no (only if not null)
        Col C: value_drawing_date (only if not null)
        Col E: value_location
        Col F: value_width_in
        Col G: fixed text "x"
        Col H: value_length_in
    """
    cells: dict[str, Any] = {}
    stage1 = unified_doc.get("stage_1") or {}

    # Header fields
    quote_no = (
        _get_value(stage1.get("quote_number"))
        or _get_value(stage1.get("quote_no"))
        or unified_doc.get("project_id")
    )
    if quote_no:
        cells["K2"] = quote_no

    prop_date = _get_value(stage1.get("date")) or _get_value((unified_doc.get("stage_3") or {}).get("proposal", {}).get("date"))
    if prop_date:
        cells["K3"] = prop_date

    if _get_value(stage1.get("project_name")):
        cells["K4"] = _get_value(stage1.get("project_name"))

    proj_addr = _get_value(stage1.get("project_address"))
    if proj_addr:
        proj_addr = proj_addr.replace("LAJ 1G3", "L6J 1G3")
        cells["K5"] = proj_addr

    if _get_value(stage1.get("project_type")):
        cells["K6"] = _get_value(stage1.get("project_type"))

    if _get_value(stage1.get("architect")):
        cells["K7"] = _get_value(stage1.get("architect"))

    if _get_value(stage1.get("contact_name")):
        cells["K8"] = _get_value(stage1.get("contact_name"))

    if _get_value(stage1.get("contact_phone")):
        cells["K9"] = _get_value(stage1.get("contact_phone"))

    if _get_value(stage1.get("contact_email")):
        cells["K10"] = _get_value(stage1.get("contact_email"))

    person_quoting = _get_value(stage1.get("person_quoting")) or _get_value(stage1.get("quoted_by"))
    if person_quoting:
        cells["K11"] = person_quoting

    raw_units = _normalize_units(unified_doc.get("units"))

    for unit_letter, unit in raw_units.items():
        if not isinstance(unit, dict):
            continue
        unit_index = ord(unit_letter.upper()) - ord("A")
        if unit_index < 0 or unit_index > 9:  # Units A through J only
            continue

        if not _unit_has_takeoff_data(unit):
            continue

        row = PROPOSAL_UNIT_FIRST_ROW + unit_index

        # Col B: Unit label (A, B, C ...) — shifted from col A per frontend request
        cells[f"B{row}"] = unit_letter.upper()

        # Col C: Drawing No — shifted from col B per frontend request
        dwg = unit.get("value_drawing_no")
        if dwg is not None and str(dwg).strip() != "":
            cells[f"C{row}"] = dwg

        # Col D: Drawing Date — shifted from col C per frontend request
        dwg_date = unit.get("value_drawing_date")
        if dwg_date is not None and str(dwg_date).strip() != "":
            cells[f"D{row}"] = dwg_date

        # Col E: Location — unchanged
        loc = unit.get("value_location")
        if loc is not None and str(loc).strip() != "":
            cells[f"E{row}"] = loc

        # Col F/G/H: Width / "x" separator / Length — unchanged
        w = unit.get("value_width_in")
        l = unit.get("value_length_in")
        if w is not None:
            cells[f"F{row}"] = w
        if l is not None:
            cells[f"H{row}"] = l
        if w is not None and l is not None:
            cells[f"G{row}"] = "x"

        # Col J: Description — top-left anchor of merged range J:K
        desc = unit.get("value_description")
        if desc is not None and str(desc).strip() != "":
            cells[f"J{row}"] = desc

    return cells
