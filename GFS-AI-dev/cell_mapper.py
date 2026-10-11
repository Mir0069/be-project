"""
ai_engine/rules/stage6_aggregator.py
======================================
Stage 6 — Aggregation & Excel Cell Output.

Takes approved outputs from all previous stages and produces a flat
{cell_address: value} dict. The backend team writes this dict to Excel
using openpyxl or xlwings.

Design principle:
  - Rules engine produces field values with confidence + reasoning.
  - workbook_map.py maps field names → cell addresses.
  - This file is the ONLY place that combines the two.
  - If GFS changes their workbook → update workbook_map.py only.
  - Rules engine never changes for workbook restructuring.

Output format to backend:
  {
    "E11": 43.74,        # Unit A glass sqft (Glass 2.0 row)
    "C141": "y",         # Proposal 14 selected
    "E42": 30.0,         # Unit A frame LF (Series 2000 Recessed row)
    "E64": 6,            # Silicone tubes total
    "E71": 12.0,         # Man hours
    "D90": "y",          # Duty
    ...
  }

Cells with value=None are MANUAL — not written to Excel.
Backend skips these and leaves them blank for the estimator.
"""

from dataclasses import dataclass, field
from typing import Optional, Any
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from config.workbook_map import (
    HEADER, GLASS_ROWS, OPTIONS_ROWS, TAKEOFF_ROWS, PROPOSAL_ROWS, FRAME_ROWS, CROSS_BEAM_ROWS,
    HARDWARE, FABRICATION, ADD_ALT_ROWS, PRICING,
    cell, trigger_cell, takeoff_cell, proposal_cell, UNIT_QTY_COL,
)
from rules.rule2_glass_type import GlassTypeResult
from rules.rule3_frame_type import FrameTypeResult
from rules.rule4_cross_beam import CrossBeamResult
from rules.rule5_addons import AddOnResult
from rules.rule6_calculations import CalculationResult, UnitTakeOff


# ─────────────────────────────────────────────────────────────
# OUTPUT MODELS
# ─────────────────────────────────────────────────────────────

@dataclass
class CellOutput:
    """A single cell write instruction."""
    cell_address: str
    value: Any                  # str, int, float, "y", None
    confidence: str             # HIGH | MEDIUM | LOW | MANUAL | PENDING
    source_rule: str            # which rule produced this
    field_name: str             # human-readable field name
    flag: Optional[str] = None  # estimator note if any


@dataclass
class AggregationResult:
    """
    Complete output of Stage 6.

    cells_to_write: dict ready for backend Excel writer.
                   {cell_address: value} — None values are MANUAL (skip).

    cell_details:  full detail per cell for frontend display.

    manual_fields: cells that need estimator input — backend highlights these.

    pending_fields: cells blocked on upstream stage approval.
    """
    cells_to_write: dict[str, Any] = field(default_factory=dict)
    cell_details: list[CellOutput] = field(default_factory=list)
    manual_fields: list[CellOutput] = field(default_factory=list)
    pending_fields: list[CellOutput] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _write(
    result: AggregationResult,
    cell_addr: str,
    value: Any,
    confidence: str,
    source_rule: str,
    field_name: str,
    flag: Optional[str] = None,
) -> None:
    """
    Register a cell write. Routes to manual_fields or pending_fields
    when value cannot be determined.
    """
    co = CellOutput(
        cell_address=cell_addr,
        value=value,
        confidence=confidence,
        source_rule=source_rule,
        field_name=field_name,
        flag=flag,
    )
    result.cell_details.append(co)

    if confidence in ("MANUAL",) or value is None:
        result.manual_fields.append(co)
        # Don't add to cells_to_write — backend skips MANUAL cells
    elif confidence == "PENDING":
        result.pending_fields.append(co)
        # Don't add to cells_to_write — not ready yet
    else:
        result.cells_to_write[cell_addr] = value


# ─────────────────────────────────────────────────────────────
# HEADER AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_header(
    result: AggregationResult,
    header_values: dict[str, Any],
) -> None:
    """
    Write header fields from Stage 1 approved values.
    header_values: {field_name: value} from MongoDB Stage 1.
    """
    gfs_internal = {"quote_number", "person_quoting", "person_checked"}

    for field_name, cell_addr in HEADER.items():
        value = header_values.get(field_name)
        confidence = "MANUAL" if (field_name in gfs_internal or value is None) else "HIGH"
        flag = "GFS internal — receptionist fills from ZOHO" if field_name in gfs_internal else None
        _write(result, cell_addr, value, confidence, "Stage1", field_name, flag)


# ─────────────────────────────────────────────────────────────
# GLASS TYPE AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_glass(
    result: AggregationResult,
    glass_result: GlassTypeResult,
    calc_result: CalculationResult,
    units: list[UnitTakeOff],
) -> None:
    """
    Write "y" to the TRIGGER cell for the selected glass type row, per unit.

    VERIFIED Jun 30 2026 against actual workbook formulas:
      E9 = IF(D9="y", $H$115, 0)
    Qty (E/H/K...) and Price (F/I/L...) are ALWAYS formulas that
    self-calculate sqft from the Take-off sheet once "y" is written
    to the trigger cell. We NEVER write a computed sqft value directly
    — that overwrites and permanently breaks the formula.
    """
    glass_code = glass_result.glass_type_code
    if glass_code in ("MANUAL", "PENDING"):
        _write(result, "—", None, "MANUAL", "Rule2",
               "glass_type", "Glass type could not be determined")
        return

    if glass_code == "GLASS_ONLY":
        # Glass-only replacement — no glass row filled
        return

    row = GLASS_ROWS.get(glass_code)
    if row is None:
        result.flags.append(f"Unknown glass_type_code '{glass_code}' — glass row not written")
        return

    # Write "y" to the trigger cell per unit — Qty/Price self-calculate
    for unit_calc in calc_result.units:
        uid = unit_calc.unit_id
        if uid not in UNIT_QTY_COL:
            result.flags.append(f"Unit '{uid}' not in workbook map (max 10 units A-J)")
            continue
        trig_addr = trigger_cell(uid, row)
        _write(
            result, trig_addr, "y",
            glass_result.confidence, "Rule2",
            f"glass_type_trigger_{uid}",
            glass_result.flags[0] if glass_result.flags else None,
        )

    # Also mark EGR secondary if applicable
    if glass_result.egr_secondary:
        egr_row = GLASS_ROWS["EGR"]
        for unit_calc in calc_result.units:
            uid = unit_calc.unit_id
            if uid in UNIT_QTY_COL:
                _write(result, trigger_cell(uid, egr_row), "y",
                       "MEDIUM", "Rule2", f"egr_secondary_trigger_{uid}",
                       "EGR secondary flag")


# ─────────────────────────────────────────────────────────────
# TAKE-OFF SHEET AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_takeoff(
    result: AggregationResult,
    units: list[UnitTakeOff],
) -> None:
    """Write confirmed Stage 3 dimensions to Take-Off sheet."""
    for unit in units:
        uid = unit.unit_id
        if uid not in TAKEOFF_ROWS:
            result.flags.append(f"Unit '{uid}' not in TAKEOFF_ROWS (max A-J)")
            continue

        fields_to_write = {
            "location":         unit.location,
            "drawing_number":   unit.drawing_ref,
            "panel_count":      unit.panel_count,
            "width_inches":     unit.width_inches,
            "length_inches":    unit.length_inches,
            "vertical_rafters": unit.vertical_rafters,
            "horizontal_rafters": unit.horizontal_rafters,
            "num_units":        1,
        }

        for fname, val in fields_to_write.items():
            conf = "HIGH" if val is not None else "MANUAL"
            _write(result, takeoff_cell(uid, fname), val, conf,
                   "Stage3", f"takeoff_{uid}_{fname}")


# ─────────────────────────────────────────────────────────────
# PROPOSAL DESCRIPTION AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_proposal(
    result: AggregationResult,
    frame_result: FrameTypeResult,
) -> None:
    """Write Y to the selected Proposal Description row."""
    pn = frame_result.proposal_number
    if pn is None:
        _write(result, "—", None, "MANUAL", "Rule3",
               "proposal_description",
               "Proposal Description not determinable — install type or assembly type not confirmed")
        return

    if pn not in PROPOSAL_ROWS:
        result.flags.append(f"Proposal number {pn} not in workbook map")
        return

    _write(
        result, proposal_cell(pn), "y",
        frame_result.confidence, "Rule3",
        f"proposal_description_{pn}",
        frame_result.flags[0] if frame_result.flags else None,
    )


# ─────────────────────────────────────────────────────────────
# FRAMING AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_framing(
    result: AggregationResult,
    frame_result: FrameTypeResult,
    calc_result: CalculationResult,
) -> None:
    """
    Write "y" to the TRIGGER cell for the selected frame type row, per unit.

    VERIFIED Jun 30 2026: E38 = IF(D38="y", $I$115, 0) — Qty (perimeter LF)
    self-calculates from the Take-off sheet. Never write a computed LF
    value directly.
    """
    frame_code = frame_result.frame_type_code
    if frame_code in ("MANUAL", "BLANK"):
        if frame_code != "BLANK":
            _write(result, "—", None, "MANUAL", "Rule3",
                   "frame_type", "Frame type could not be determined")
        return

    row = FRAME_ROWS.get(frame_code)
    if row is None:
        result.flags.append(f"Unknown frame_type_code '{frame_code}' — frame row not written")
        return

    for unit_calc in calc_result.units:
        uid = unit_calc.unit_id
        if uid not in UNIT_QTY_COL:
            continue
        _write(
            result, trigger_cell(uid, row), "y",
            frame_result.confidence, "Rule3",
            f"frame_trigger_{uid}",
            frame_result.flags[0] if frame_result.flags else None,
        )


# ─────────────────────────────────────────────────────────────
# CROSS BEAM AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_cross_beam(
    result: AggregationResult,
    cross_beam_result: CrossBeamResult,
    calc_result: CalculationResult,
) -> None:
    """
    Write "y" to the TRIGGER cell for the selected cross beam row, per unit.

    VERIFIED Jun 30 2026: E53 = IF(D53="y", $N$115, 0)/12 — Qty
    self-calculates total length / 12 from the Take-off sheet.
    """
    cb_code = cross_beam_result.cross_beam_code
    if cb_code in ("NONE",):
        return   # Single panel — no cross beam, nothing to write
    if cb_code in ("MANUAL", "PENDING"):
        _write(result, "—", None, cb_code, "Rule4",
               "cross_beam",
               cross_beam_result.flags[0] if cross_beam_result.flags else None)
        return

    row = CROSS_BEAM_ROWS.get(cb_code)
    if row is None:
        result.flags.append(f"Unknown cross_beam_code '{cb_code}' — row not written")
        return

    for unit_calc in calc_result.units:
        uid = unit_calc.unit_id
        if uid not in UNIT_QTY_COL:
            continue
        _write(
            result, trigger_cell(uid, row), "y",
            cross_beam_result.confidence, "Rule4",
            f"cross_beam_trigger_{uid}",
            cross_beam_result.flags[0] if cross_beam_result.flags else None,
        )


# ─────────────────────────────────────────────────────────────
# ADD-ONS & OPTIONS AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_addons(
    result: AggregationResult,
    addon_result: AddOnResult,
    calc_result: CalculationResult,
) -> None:
    """
    Write "y" to TRIGGER cells for add-ons that apply. Qty/sqft for
    Options and Add Alternates self-calculate from the Take-off sheet
    once the trigger is set (VERIFIED Jun 30 2026):
      E16 = IF(D16="y", $H$115, 0)        — Options
      E107 = IF(D107="y", H115*J115, 0)   — Add Alternates (sqft x units)
    We never write a computed sqft value directly into Qty.

    Duty (row 90) is the one exception — D90 is a literal y/n input,
    not a formula, confirmed by direct inspection of the template.
    """

    def write_trigger_per_unit(row: int, addon_field, field_name: str) -> None:
        """Write 'y' to the trigger cell for each unit, if addon value is 'y'."""
        if addon_field is None:
            return
        if addon_field.value == "y":
            for unit_calc in calc_result.units:
                uid = unit_calc.unit_id
                if uid in UNIT_QTY_COL:
                    _write(result, trigger_cell(uid, row), "y",
                           addon_field.confidence, "Rule5",
                           f"{field_name}_trigger_{uid}", addon_field.flag)
        elif addon_field.value == "MANUAL":
            _write(result, "—", None, "MANUAL", "Rule5",
                   field_name, addon_field.flag)
        # "n" = do nothing, leave blank/0

    # Options (rows 16-21) — trigger pattern confirmed
    write_trigger_per_unit(OPTIONS_ROWS["sentry_glass"], addon_result.sentry_glass, "sentry_glass")
    write_trigger_per_unit(OPTIONS_ROWS["krypton_gas"], addon_result.krypton_gas, "krypton_gas")
    write_trigger_per_unit(OPTIONS_ROWS["colored_interlayer"], addon_result.colored_interlayer, "colored_interlayer")
    write_trigger_per_unit(OPTIONS_ROWS["backpaint"], addon_result.backpaint, "backpaint")
    write_trigger_per_unit(OPTIONS_ROWS["round_glass"], addon_result.round_glass_surcharge, "round_glass")

    # Custom shapes (row 24) — VERIFIED: E24 is blank, NO trigger, NO formula.
    # This is a genuine manual numeric (sqft) input, not a y/n select.
    if addon_result.custom_shape_surcharge:
        f = addon_result.custom_shape_surcharge
        if f.value == "y":
            for unit_calc in calc_result.units:
                uid = unit_calc.unit_id
                if uid in UNIT_QTY_COL:
                    _write(result, cell(uid, OPTIONS_ROWS["custom_shapes"]),
                           round(unit_calc.sqft, 3),
                           f.confidence, "Rule5",
                           f"custom_shapes_sqft_{uid}", f.flag)
        # "n" or MANUAL — leave blank

    # Embeds (row 22) — VERIFIED: E22 is blank, NO trigger, NO formula.
    # Genuine manual count input, not sqft.
    if addon_result.embeds_titanium and addon_result.embeds_titanium.value == "y":
        for unit_calc in calc_result.units:
            uid = unit_calc.unit_id
            if uid in UNIT_QTY_COL:
                _write(result, cell(uid, OPTIONS_ROWS["embeds_titanium"]),
                       None, "MANUAL", "Rule5",
                       f"embeds_count_{uid}",
                       "Titanium embeds — qty is count of embeds, not sqft. Min 4 per tread.")

    # Add alternates (rows 107-110) — trigger pattern confirmed per-unit
    write_trigger_per_unit(ADD_ALT_ROWS["seeded_organic"], addon_result.seeded_organic, "seeded_organic")
    write_trigger_per_unit(ADD_ALT_ROWS["heat_soak_testing"], addon_result.heat_soak_testing, "heat_soak_testing")
    write_trigger_per_unit(ADD_ALT_ROWS["nanodot"], addon_result.nanodot, "nanodot")

    # Blur — always MANUAL
    if addon_result.blur:
        _write(result, "—", None, "MANUAL", "Rule5", "blur", addon_result.blur.flag)

    # Duty — VERIFIED: D90 is a literal y/n input, NOT a formula. Correct as-is.
    if addon_result.duty:
        if addon_result.duty.value == "y":
            _write(result, PRICING["duty_y"], "y",
                   addon_result.duty.confidence, "Rule5",
                   "duty", addon_result.duty.flag)
        elif addon_result.duty.value == "n":
            _write(result, PRICING["duty_y"], "n",
                   addon_result.duty.confidence, "Rule5",
                   "duty", None)


# ─────────────────────────────────────────────────────────────
# HARDWARE AGGREGATION
# ─────────────────────────────────────────────────────────────

def _agg_hardware(
    result: AggregationResult,
    calc_result: CalculationResult,
) -> None:
    """
    VERIFIED Jun 30 2026 against actual workbook formulas:
      E62 Brackets   = formula off K115/L115 — NEVER write
      E63 Fasteners  = formula off K115/L115 — NEVER write
      E64 Silicone   = "=E72/8"              — NEVER write, self-calculates
      E66 Perimeter  = "=I115"               — NEVER write, self-calculates
      E67 Rafter LF  = "=N115/12"            — NEVER write, self-calculates
      E72 Paint LF   = "=SUM(E66:E67)"       — NEVER write, self-calculates
      E69 3m tape    = "=IF(D69="y",E66+E67,0)" — write "y" to D69 TRIGGER only
      E71 Man Hours  = blank, true manual input — write our calculated value
      E73 Packaging  = blank, true manual input — write our calculated value
                        (F73 is a PRICE formula "=E73*$C73" — never write F73)

    Once Take-off width/length/rafters (E,F,K,L at rows 115-124) are
    written by _agg_takeoff, Silicone/Perimeter/Rafter/Paint LF all
    self-calculate with zero further input from this function.
    """
    # 3m tape — trigger only, self-calculates from E66+E67
    _write(result, HARDWARE["tape_3m_trigger"], "y",
           "HIGH", "Rule6", "tape_3m_trigger",
           "3m tape applies whenever perimeter/rafter gasket is present")

    # Man hours — genuine manual input, no formula exists
    if calc_result.man_hours is not None:
        _write(result, FABRICATION["man_hours"],
               calc_result.man_hours,
               calc_result.man_hours_confidence, "Rule6",
               "man_hours", calc_result.man_hours_formula)
    else:
        _write(result, FABRICATION["man_hours"],
               None, "MANUAL", "Rule6",
               "man_hours",
               calc_result.flags[0] if calc_result.flags else "Man hours — MANUAL")

    # Packaging — genuine manual input (E73), NOT the price formula (F73)
    if calc_result.packaging_base is not None:
        _write(result, FABRICATION["packaging"],
               calc_result.packaging_base,
               "MEDIUM", "Rule6", "packaging",
               calc_result.packaging_note)
    else:
        _write(result, FABRICATION["packaging"],
               None, "MANUAL", "Rule6",
               "packaging", calc_result.packaging_note)


# ─────────────────────────────────────────────────────────────
# MAIN AGGREGATION FUNCTION
# ─────────────────────────────────────────────────────────────

def aggregate(
    header_values: dict[str, Any],
    units: list[UnitTakeOff],
    glass_result: GlassTypeResult,
    frame_result: FrameTypeResult,
    cross_beam_result: CrossBeamResult,
    addon_result: AddOnResult,
    calc_result: CalculationResult,
) -> AggregationResult:
    """
    Stage 6 — Produce final {cell: value} output for backend Excel writer.

    Call order is intentional — each section reads from confirmed rule outputs.
    No AI calls. Pure mapping.

    Returns AggregationResult with:
      .cells_to_write  → backend writes these to Excel
      .manual_fields   → backend highlights these for estimator
      .pending_fields  → backend shows as blocked
    """
    result = AggregationResult()

    _agg_header(result, header_values)
    _agg_takeoff(result, units)
    _agg_glass(result, glass_result, calc_result, units)
    _agg_proposal(result, frame_result)
    _agg_framing(result, frame_result, calc_result)
    _agg_cross_beam(result, cross_beam_result, calc_result)
    _agg_addons(result, addon_result, calc_result)
    _agg_hardware(result, calc_result)

    return result
