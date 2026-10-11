"""
Rule 6 — Calculations
======================
Pure Python. No AI. Same inputs always produce same outputs.

Takes Stage 3 APPROVED takeoff data from MongoDB.
Produces: sqft, weight, perimeter LF, rafter LF, silicone tubes,
          man hours, packaging baseline.

VALIDATED FORMULAS (from Stage5-Correct-Formulas.md — FormulaEngineService, backend source of truth):
  sqft       = (width_in × length_in) ÷ 144
               width_in/length_in are the FULL opening dimensions for this unit.
               panel_count is NOT a multiplier — it does not affect sqft/weight/perimeter/silicone.

  perimeter  = 2 × (width_in + length_in) ÷ 12
               Formula per unit.

  rafter_lf  = (vertical_rafters × width_in + horizontal_rafters × length_in) ÷ 12
               Confirmed against the GFS Master Workbook take-off formula itself
               (Total length = (K*E)+(L*F), E=Width, F=Length, K=Vertical,
               L=Horizontal — verified identical in Friendly Hall, Clinton St,
               Somerville Dr, 6 Juneau Way approved workbooks). Vertical rafters
               multiply WIDTH, not length — this corrects a prior width/length
               swap (see git history for the old vertical_rafters × length_in
               formula and its now-superseded "Spring Lake"/"4 Jane St" citations).

  weight     = total_sqft × lbs_per_sqft
               GLASS_NO_IGU: 15 lbs/sqft
               GLASS_WITH_IGU: 20 lbs/sqft
               GLASS_2_0: 21 lbs/sqft
               STAIR_TREAD: 15 lbs/sqft
               NON_WALKABLE: 15 lbs/sqft
               all others: 15.0 lbs/sqft

  silicone   = ceil(perimeter_lf ÷ 10)
               Round UP always — confirmed by GFS.

MAN HOURS (Deterministic Models):
  1. Connection-Node Model (from Fabrication Man-Hour training spec):
     Formula: connections = (rows + 1) * (cols + 1)
              man_hours   = connections * 2.0 hrs
     In-scope: Series 1000, Series 2000, Series 3000, Perimeter Non-TB, Deck Perimeter.
     Out of scope (Manual review): EconoFrame, irregular/L-shaped layouts, stairs, railings.

  2. Rafter-based Base Model (from GFS responses, June 2026):
     Perimeter NTB:  8 hrs base + (total_rafters × 2) hrs
                     Validated: Robinson 0 rafters = 8 hrs ✓, Change order 1 rafter = 10 hrs ✓
     Deck Perimeter: same as Perimeter NTB (8 hrs base)
     Series 1000 TB: 12 hrs base + (total_rafters × 2) hrs
     Series 2000 TB: 12 hrs base + (total_rafters × 2) hrs
     Series 3000 TB: 12 hrs base + (total_rafters × 2) hrs (in scope per spec)
     EconoFrame:     MANUAL — out of scope for standard connection rule
     Glass Only:     0 hrs (no fabrication)
     Custom steel:   MANUAL

PACKAGING (Row 73):
  Glass only (no frame): 0.5 crates flat
  Framed systems (by panel count):
    1-2 panels:  1.0 crate
    3-6 panels:  2.0 crates
    7-10 panels: 3.0 crates
    11+ panels:  MANUAL (estimator review required)
  Open Item: Wayne/Greg weight chart pending confirmation if applicable on top.
"""

from dataclasses import dataclass, field
from typing import Optional

from rules.rule3_frame_type import FrameTypeResult
from rules.rule4_cross_beam import CrossBeamResult

from formulas.geometry import (
    calculate_sqft,
    calculate_outer_dimensions,
    calculate_perimeter_lf,
    calculate_rafter_lf,
)
from formulas.materials import (
    calculate_glass_weight,
    calculate_silicone_tubes,
)
from formulas.packaging import calculate_packaging_base


# ─────────────────────────────────────────────────────────────
# INPUT MODEL
# Stage 3 approved values from MongoDB — one entry per unit A-J
# ─────────────────────────────────────────────────────────────

@dataclass
class UnitTakeOff:
    """
    Stage 3 confirmed dimensions for one unit (A through J).
    Comes from MongoDB after estimator approval.
    width_inches and length_inches are the FULL opening dimensions for this
    unit — used as-is for sqft/perimeter/silicone (no panel_count multiplier).
    panel_count still multiplies into the outer-width/rafter term only
    (calculate_outer_dimensions), since rafters are structural members
    within the opening.
    """
    unit_id: str               # "A", "B", ..., "J"
    width_inches: float        # short side, full opening (confirmed by estimator)
    length_inches: float       # long side, full opening (confirmed by estimator)
    panel_count: int           # number of glass panels in this unit (rafter/outer-width math only)
    vertical_rafters: Optional[int] = None    # rafters running along length dimension
    horizontal_rafters: Optional[int] = None  # rafters running along width dimension (rare)
    location: Optional[str] = None
    drawing_ref: Optional[str] = None
    rows: Optional[int] = None
    cols: Optional[int] = None
    is_grid_confirmed: Optional[bool] = None
    custom_shape: Optional[str] = None
    dim_type: Optional[str] = None
    product_type: Optional[str] = None
    glass_type: Optional[str] = None
    frame_type: Optional[str] = None   # this unit's own frame type, if it differs from the project default


# ─────────────────────────────────────────────────────────────
# OUTPUT MODELS
# ─────────────────────────────────────────────────────────────

@dataclass
class UnitCalc:
    """Computed values for one unit."""
    unit_id: str
    sqft: float
    outer_width_inches: float    # panel_count × width_inches
    outer_length_inches: float   # length_inches (unchanged)
    perimeter_lf: float
    rafter_lf: float
    weight_lbs: float
    silicone_tubes: int          # ceil(perimeter_lf / 10)
    man_hours: Optional[float] = None


@dataclass
class CalculationResult:
    """
    Output of Rule 6. All computed fields.
    Consumed by Stage 6 aggregation.
    """
    units: list[UnitCalc] = field(default_factory=list)

    # Job totals
    total_sqft: float = 0.0
    total_perimeter_lf: float = 0.0
    total_rafter_lf: float = 0.0
    total_weight_lbs: float = 0.0
    total_silicone_tubes: int = 0

    # Man hours (Row 71)
    man_hours: Optional[float] = None   # None = MANUAL
    man_hours_formula: Optional[str] = None
    man_hours_confidence: str = "MANUAL"

    # Packaging (Row 73)
    packaging_base: Optional[float] = None   # 0.5 glass-only, 1.0 framed
    packaging_note: str = ""

    confidence: str = "HIGH"
    flags: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# UNIT CALCULATION
# ─────────────────────────────────────────────────────────────

def _calc_unit(unit: UnitTakeOff, glass_type_code: Optional[str] = None) -> UnitCalc:
    """
    Compute all derived values for one unit using modular formulas.
    """
    # Total sqft for this unit (width/length are full opening dims — no panel_count multiplier)
    sqft = calculate_sqft(unit.width_inches, unit.length_inches)

    # Outer opening dimensions
    outer_width, outer_length = calculate_outer_dimensions(
        unit.width_inches, unit.length_inches, unit.panel_count
    )

    # Perimeter LF of the unit (per unit: 2 × (width_in + length_in) / 12)
    perimeter_lf = calculate_perimeter_lf(unit.width_inches, unit.length_inches)

    # Rafter LF — vertical rafters multiply width, horizontal multiply length
    # (ground-truth workbook formula: Total length = (K*E)+(L*F), E=Width, F=Length).
    # Uses raw width/length, not the panel-count-scaled outer_width.
    rafter_lf = calculate_rafter_lf(
        unit.vertical_rafters or 0, unit.width_inches,
        unit.horizontal_rafters or 0, unit.length_inches
    )

    # Weight & Glass Type resolution
    gt_val = glass_type_code
    if hasattr(gt_val, "glass_type_code"):
        gt_val = getattr(gt_val, "glass_type_code", None)
    elif isinstance(gt_val, dict):
        gt_val = gt_val.get("glass_type_code")

    gt = (str(gt_val or unit.glass_type or "")).upper().strip()
    if gt == "GLASS_NO_IGU":
        lbs_per_sqft = 15.0
    elif gt == "GLASS_WITH_IGU":
        lbs_per_sqft = 20.0
    elif gt == "GLASS_2_0":
        lbs_per_sqft = 21.0
    elif gt == "STAIR_TREAD":
        lbs_per_sqft = 15.0
    elif gt == "NON_WALKABLE":
        lbs_per_sqft = 15.0
    else:
        lbs_per_sqft = 15.0  # default fallback
    weight_lbs = calculate_glass_weight(sqft, lbs_per_sqft=lbs_per_sqft)

    # Silicone tubes (ceil((perimeter_lf + rafter_lf) / 8))
    silicone_tubes = calculate_silicone_tubes(perimeter_lf, rafter_lf=rafter_lf, lf_per_tube=8.0)

    return UnitCalc(
        unit_id=unit.unit_id,
        sqft=round(sqft, 2),
        outer_width_inches=round(outer_width, 2),
        outer_length_inches=round(outer_length, 2),
        perimeter_lf=round(perimeter_lf, 2),
        rafter_lf=round(rafter_lf, 2),
        weight_lbs=round(weight_lbs, 2),
        silicone_tubes=silicone_tubes,
    )


def _compute_man_hours(
    frame_code: str,
    units: list[UnitTakeOff],
) -> tuple[Optional[float], str, str, dict[str, Optional[float]]]:
    """
    Computes fabrication man-hours using the Connection-Node formula:
        connections = (rows + 1) * (cols + 1)
        man_hours   = connections * 2.0 hrs

    Delegates to check_fabrication_man_hours_eligibility for each unit, using
    that unit's own frame type when it differs from the project default
    (falls back to `frame_code` when the unit has none of its own).
    Multi-unit projects calculate hours for eligible units only, and clearly
    record manual-review reasons for any unresolvable unit.
    Returns (total_hours, formula_str, confidence, per_unit_hours_map).
    """
    from formulas.fabrication import check_fabrication_man_hours_eligibility

    total_hours = 0.0
    formula_parts: list[str] = []
    manual_reasons: list[str] = []
    unit_hours_map: dict[str, Optional[float]] = {}
    eligible_count = 0
    manual_count = 0

    for u in units:
        v_raf = u.vertical_rafters
        h_raf = u.horizontal_rafters
        rows = u.rows
        cols = u.cols
        is_grid = u.is_grid_confirmed

        # If rafter counts and rows/cols are absent, infer standard single-row layout (52 hrs):
        if rows is None and cols is None and v_raf is None and h_raf is None and is_grid is not False:
            if u.panel_count is not None and int(u.panel_count) >= 1:
                h_raf = 0
                v_raf = max(0, int(u.panel_count) - 1)
                is_grid = True

        res = check_fabrication_man_hours_eligibility(
            frame_code=u.frame_type or frame_code,
            rows=rows,
            cols=cols,
            panel_count=u.panel_count,
            vertical_rafters=v_raf,
            horizontal_rafters=h_raf,
            is_grid_confirmed=is_grid if is_grid is not None else False,
            exclusion_indicators=[
                u.location,
                u.drawing_ref,
                u.custom_shape,
                u.dim_type,
                u.product_type,
                u.glass_type,
            ],
        )

        if res["eligible"] and res["man_hours"] is not None:
            total_hours += res["man_hours"]
            formula_parts.append(f"Unit {u.unit_id} ({res['rows']}x{res['cols']} grid): {res['man_hours']} hrs")
            eligible_count += 1
            unit_hours_map[u.unit_id] = res["man_hours"]
        else:
            reason = res["reason"] or "Manual review required"
            manual_reasons.append(f"Unit {u.unit_id}: {reason}")
            manual_count += 1
            unit_hours_map[u.unit_id] = None

    if eligible_count == 0:
        combined_reason = " | ".join(manual_reasons) if manual_reasons else "Manual review required"
        return (None, combined_reason, "MANUAL", unit_hours_map)

    if manual_count == 0:
        combined_formula = " + ".join(formula_parts) + f" = {total_hours} hrs"
        return (total_hours, combined_formula, "HIGH", unit_hours_map)

    # Partial multi-unit: some units eligible, some manual
    combined_formula = (
        " + ".join(formula_parts)
        + f" = {total_hours} hrs (Note: aggregate excludes manual-review units: "
        + " | ".join(manual_reasons)
        + ")"
    )
    return (total_hours, combined_formula, "MEDIUM", unit_hours_map)


# ─────────────────────────────────────────────────────────────
# MAIN CALCULATION FUNCTION
# ─────────────────────────────────────────────────────────────

def compute_calculations(
    units: list[UnitTakeOff],
    frame_result: FrameTypeResult,
    cross_beam_result: CrossBeamResult,
    glass_type_code: Optional[str] = None,
    **kwargs,
) -> CalculationResult:
    """
    Rule 6 — All numeric computations.

    Takes Stage 3 approved unit data + frame type from Rule 3.
    Returns all derived quantities needed for workbook yellow cells
    and for Rule 5 HST weight check.

    Pure Python — no AI, no extraction.
    Same inputs always produce same outputs.
    """
    result = CalculationResult()
    flags = []
    reasoning = []

    if not units:
        result.flags = ["No units provided — calculations cannot run"]
        result.confidence = "MANUAL"
        return result

    # Resolve glass_type_code if passed as GlassTypeResult or in kwargs
    if hasattr(glass_type_code, "glass_type_code"):
        glass_type_code = glass_type_code.glass_type_code
    if not glass_type_code and "glass_type" in kwargs:
        glass_type_code = kwargs["glass_type"]
    if not glass_type_code and "glass_result" in kwargs:
        glass_type_code = getattr(kwargs["glass_result"], "glass_type_code", None)
    if not glass_type_code and hasattr(frame_result, "glass_type_correction") and frame_result.glass_type_correction:
        glass_type_code = frame_result.glass_type_correction

    # ── Per-unit calculations ─────────────────────────────────────────────
    for unit in units:
        # This unit's own glass type wins when it differs from the project
        # default — otherwise multi-spec projects apply the wrong weight rate.
        effective_gt = unit.glass_type or glass_type_code
        uc = _calc_unit(unit, glass_type_code=effective_gt)
        result.units.append(uc)

        result.total_sqft          += uc.sqft
        result.total_perimeter_lf  += uc.perimeter_lf
        result.total_rafter_lf     += uc.rafter_lf
        result.total_weight_lbs    += uc.weight_lbs

        # Flag multi-panel units where arrangement may affect perimeter
        if unit.panel_count > 1 and unit.horizontal_rafters is not None and unit.horizontal_rafters > 0:
            flags.append(
                f"Unit {unit.unit_id}: 2D panel grid detected "
                f"({unit.vertical_rafters} vertical + {unit.horizontal_rafters} horizontal rafters). "
                "Perimeter formula assumes 1D row — estimator must verify silicone count."
            )

    # Round totals cleanly to 2 decimal places
    result.total_sqft         = round(result.total_sqft, 2)
    result.total_perimeter_lf = round(result.total_perimeter_lf, 2)
    result.total_rafter_lf    = round(result.total_rafter_lf, 2)
    result.total_weight_lbs   = round(result.total_weight_lbs, 2)
    result.total_silicone_tubes = calculate_silicone_tubes(
        result.total_perimeter_lf, rafter_lf=result.total_rafter_lf, lf_per_tube=10.0
    )

    reasoning.append(
        f"Totals: sqft={result.total_sqft} | "
        f"perim={result.total_perimeter_lf} LF | "
        f"rafters={result.total_rafter_lf} LF | "
        f"weight={result.total_weight_lbs} lbs | "
        f"silicone={result.total_silicone_tubes} tubes"
    )

    # ── Man hours (Connection-Node Model) ─────────────────────────────────
    man_hrs, formula, conf, unit_hours_map = _compute_man_hours(
        frame_result.frame_type_code, units
    )

    result.man_hours           = man_hrs
    result.man_hours_formula   = formula
    result.man_hours_confidence = conf

    for uc in result.units:
        uc.man_hours = unit_hours_map.get(uc.unit_id)

    if man_hrs is None:
        flags.append(
            f"Man hours MANUAL — frame type '{frame_result.frame_type_code}' "
            "baseline not defined or out of scope. Estimator must fill."
        )
    else:
        reasoning.append(f"Man hours: {formula}")

    # EconoFrame additional note
    if frame_result.frame_type_code and "ECONOFRAME" in frame_result.frame_type_code:
        flags.append(
            "EconoFrame man hours: base varies. Additional = 1 hr per connection. "
            "Estimator must confirm base hours and total."
        )

    # ── Packaging ─────────────────────────────────────────────────────────
    # Sourcing total panel count across takeoffs / units
    total_panels: Optional[int] = None
    if units:
        panel_counts = [u.panel_count for u in units if u.panel_count is not None]
        if panel_counts:
            total_panels = sum(panel_counts)
    if total_panels is None and cross_beam_result and cross_beam_result.panel_count is not None:
        total_panels = cross_beam_result.panel_count

    crates, pack_note = calculate_packaging_base(
        frame_result.frame_type_code,
        panel_count=total_panels,
    )
    result.packaging_base = crates
    result.packaging_note = pack_note

    # OPEN ITEM note: GFS confirmed panel-count bands, but previous specs mentioned
    # a weight-based packaging chart from Wayne/Greg. Flag kept for estimator confirmation.
    flags.append(
        "Packaging chart from Wayne/Greg not yet received — "
        "additional crates beyond base not computed. Estimator must confirm."
    )

    result.flags = flags
    result.reasoning = reasoning
    result.confidence = "HIGH"
    return result
