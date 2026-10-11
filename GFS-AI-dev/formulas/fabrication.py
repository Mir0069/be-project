"""
formulas/fabrication.py
=======================
Fabrication labor and shop man-hour formulas.

Specifications & Models:
  1. Connection-Node Model (from Fabrication Man-Hour training spec):
     Formula: connections = (rows + 1) * (cols + 1)
              man_hours   = connections * 2.0 hrs
     Approved Frame Families: Series 1000, Series 2000, Series 3000, Perimeter Non-TB, Deck Perimeter.
     Out of scope (Manual review): EconoFrame, L-shaped/irregular/curved layouts, stairs, railings.

  2. Rafter-based Base Model (from June 2026 GFS client responses):
     Formula: base_hours + (total_rafters * 2)
"""
from typing import Any, Optional

# Approved canonical frame families for automatic connection-node calculation
APPROVED_FRAME_FAMILIES: frozenset[str] = frozenset({
    "SERIES_1000",
    "SERIES_2000",
    "SERIES_3000",
    "PERIMETER_NON_TB",
    "DECK_PERIMETER",
})

# Backward compatibility alias set
IN_SCOPE_FRAMES: frozenset[str] = APPROVED_FRAME_FAMILIES

# Base hours by frame type (legacy rafter model)
MAN_HOURS_BASE: dict[str, Optional[float]] = {
    "PERIMETER_NON_TB":              8.0,
    "DECK_PERIMETER":                8.0,
    "SERIES_2000_PEDESTAL":         12.0,
    "SERIES_2000_RECESSED":         12.0,
    "SERIES_1000_PEDESTAL":         12.0,
    "SERIES_1000_RECESSED":         12.0,
    "SERIES_1000_INTERIOR_RECESSED":12.0,
    "MODIFIED_SERIES_1000":         12.0,
    "SERIES_3000":                  12.0,
    "BLANK":                         0.0,
    "ECONOFRAME":                   None,
}


def normalize_frame_family(frame_code: Optional[str]) -> Optional[str]:
    """
    Normalizes casing, whitespace, hyphens, underscores, and aliases to a canonical frame family.
    Returns canonical family name if recognized, or special non-approved category, or None.
    """
    if not frame_code or not isinstance(frame_code, str):
        return None
    s = frame_code.strip().upper().replace("-", "_").replace(" ", "_")
    while "__" in s:
        s = s.replace("__", "_")

    if not s or s in ("MANUAL", "PENDING", "UNKNOWN", "NOT_STATED", "NONE", "UNSPECIFIED", "NULL"):
        return None

    if "ECONOFRAME" in s:
        return "ECONOFRAME"

    if s in ("BLANK", "GLASS_ONLY", "JUST_GLASS") or "GLASS_ONLY" in s:
        return "GLASS_ONLY"

    # Series 1000 aliases
    if s in (
        "SERIES_1000", "SERIES_1000_PEDESTAL", "SERIES_1000_RECESSED",
        "SERIES_1000_INTERIOR_RECESSED", "MODIFIED_SERIES_1000", "S1000",
        "S1000_TB", "SERIES_1000_TB", "MODIFIED_S1000", "SERIES_1000_MODIFIED"
    ):
        return "SERIES_1000"

    # Series 2000 aliases
    if s in (
        "SERIES_2000", "SERIES_2000_PEDESTAL", "SERIES_2000_RECESSED",
        "S2000", "S2000_TB", "SERIES_2000_TB"
    ):
        return "SERIES_2000"

    # Series 3000 aliases
    if s in (
        "SERIES_3000", "SERIES_3000_PEDESTAL", "SERIES_3000_RECESSED",
        "S3000", "S3000_TB", "SERIES_3000_TB"
    ):
        return "SERIES_3000"

    # Perimeter Non-TB aliases
    if s in (
        "PERIMETER_NON_TB", "NON_TB", "PERIMETER_NTB", "PERIMETER_NON_THERMALLY_BROKEN",
        "NON_THERMALLY_BROKEN", "PERIMETER_NON_TB_SYSTEM"
    ):
        return "PERIMETER_NON_TB"

    # Deck Perimeter aliases
    if s in (
        "DECK_PERIMETER", "DECK", "DECK_PERIMETER_SYSTEM"
    ):
        return "DECK_PERIMETER"

    return None


def is_manual_override(field_data: Any) -> bool:
    """
    Returns True if the field is protected by a human estimator manual override.
    Checks existing conventions: manual, _meta.manual, is_override, edited_by_estimator, customer_stated.
    Only active if an actual value is present (value is not None).
    """
    if not isinstance(field_data, dict):
        return False
    val = field_data.get("value")
    if val is None:
        return False
    meta = field_data.get("_meta")
    if isinstance(meta, dict):
        if (
            meta.get("manual") is True
            or meta.get("is_override") is True
            or meta.get("customer_stated") is True
            or meta.get("edited_by_estimator") is True
        ):
            return True
    if (
        field_data.get("manual") is True
        or field_data.get("is_override") is True
        or field_data.get("edited_by_estimator") is True
        or field_data.get("customer_stated") is True
    ):
        return True
    if field_data.get("updated_by") not in (None, "", "rules_engine", "extraction", "system"):
        return True
    return False


def check_geometry_and_product_exclusions(*inputs: Any) -> tuple[bool, Optional[str]]:
    """
    Inspects fields for non-rectangular geometries, stairs, railings, and unapproved product types.
    Returns (True, reason) if an exclusion is detected, else (False, None).
    """
    EXCLUDED_TERMS = [
        "irregular",
        "l_shape", "l-shape", "l shaped", "lshaped",
        "circular", "circle", "round",
        "curved", "curve", "curving",
        "triangle", "triangular",
        "custom_shape", "custom shape", "special_shape", "special shape",
        "stairs", "stair", "stair_tread", "stair tread", "stair_treads", "stairtread",
        "railing", "rail", "balustrade", "guardrail",
        "staggered",
        "running_bond", "running-bond", "running bond", "runningbond",
        "offset",
        "non_aligned", "non-aligned", "non aligned",
    ]

    for inp in inputs:
        if inp is None:
            continue
        if isinstance(inp, bool):
            if inp:
                return (True, "Non-rectangular geometry or custom shape flag is active — manual review required")
            continue
        if isinstance(inp, (int, float)):
            continue
        s = str(inp).strip().lower().replace("-", " ").replace("_", " ")
        if s in ("y", "yes", "true", "1") and len(str(inp)) <= 4:
            # Standalone truthy flag for custom shape/irregular
            return (True, "Non-rectangular geometry or custom shape flag is active — manual review required")
        for term in EXCLUDED_TERMS:
            term_clean = term.replace("-", " ").replace("_", " ")
            if term_clean in s:
                return (True, f"Non-rectangular geometry or excluded product type detected: '{term}' — manual review required")

    return (False, None)


def check_fabrication_man_hours_eligibility(
    frame_code: Optional[str] = None,
    rows: Optional[int] = None,
    cols: Optional[int] = None,
    panel_count: Optional[int] = None,
    vertical_rafters: Optional[int] = None,
    horizontal_rafters: Optional[int] = None,
    is_grid_confirmed: bool = False,
    exclusion_indicators: Optional[list[Any]] = None,
    existing_override_field: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Centralized eligibility decision helper for Fabrication Man-Hours.
    Returns a structured decision dictionary.
    """
    # 1. Manual override protection
    if is_manual_override(existing_override_field):
        return {
            "eligible": False,
            "status": "MANUAL",
            "reason": "Protected by estimator manual override",
            "normalized_frame_family": normalize_frame_family(frame_code),
            "rows": None,
            "cols": None,
            "connections": None,
            "man_hours": None,
        }

    # 2. Frame-family normalization and scope
    norm_family = normalize_frame_family(frame_code)
    if not norm_family or norm_family not in APPROVED_FRAME_FAMILIES:
        if norm_family == "ECONOFRAME":
            reason = "EconoFrame is out of scope for standard connection rule — manual review required"
        elif norm_family == "GLASS_ONLY":
            reason = "Glass-only / non-framed scope — no standard fabrication hours rule applies"
        else:
            reason = f"Frame system '{frame_code}' is missing, pending, or not in approved fabrication scope — manual review required"
        return {
            "eligible": False,
            "status": "MANUAL",
            "reason": reason,
            "normalized_frame_family": norm_family,
            "rows": None,
            "cols": None,
            "connections": None,
            "man_hours": None,
        }

    # 3. Geometry and product exclusions
    is_excl, excl_reason = check_geometry_and_product_exclusions(*(exclusion_indicators or []))
    if is_excl:
        return {
            "eligible": False,
            "status": "MANUAL",
            "reason": excl_reason or "Non-rectangular geometry or excluded product type — manual review required",
            "normalized_frame_family": norm_family,
            "rows": None,
            "cols": None,
            "connections": None,
            "man_hours": None,
        }

    # 4. Confirmed grid dimensions (rows & cols)
    final_rows: Optional[int] = None
    final_cols: Optional[int] = None
    provenance_note: Optional[str] = None

    if rows is not None and cols is not None:
        if int(rows) >= 1 and int(cols) >= 1:
            r = int(rows)
            c = int(cols)
            if panel_count is not None and int(panel_count) != r * c:
                return {
                    "eligible": False,
                    "status": "MANUAL",
                    "reason": f"Panel count mismatch: panel_count={panel_count} != rows({r}) * cols({c}) ({r * c}) — manual review required",
                    "normalized_frame_family": norm_family,
                    "rows": None,
                    "cols": None,
                    "connections": None,
                    "man_hours": None,
                }
            if vertical_rafters is not None and c != int(vertical_rafters) + 1:
                return {
                    "eligible": False,
                    "status": "MANUAL",
                    "reason": f"Vertical rafter mismatch: cols={c} requires {c-1} vertical rafters, but vertical_rafters={vertical_rafters} — manual review required",
                    "normalized_frame_family": norm_family,
                    "rows": None,
                    "cols": None,
                    "connections": None,
                    "man_hours": None,
                }
            if horizontal_rafters is not None and r != int(horizontal_rafters) + 1:
                return {
                    "eligible": False,
                    "status": "MANUAL",
                    "reason": f"Horizontal rafter mismatch: rows={r} requires {r-1} horizontal rafters, but horizontal_rafters={horizontal_rafters} — manual review required",
                    "normalized_frame_family": norm_family,
                    "rows": None,
                    "cols": None,
                    "connections": None,
                    "man_hours": None,
                }
            final_rows = r
            final_cols = c
        else:
            return {
                "eligible": False,
                "status": "MANUAL",
                "reason": f"Invalid grid dimensions (rows={rows}, cols={cols}) — manual review required",
                "normalized_frame_family": norm_family,
                "rows": None,
                "cols": None,
                "connections": None,
                "man_hours": None,
            }

    elif horizontal_rafters is not None and vertical_rafters is not None:
        # 1. When both explicit confirmed rafter counts exist:
        #    rows = horizontal_rafters + 1, cols = vertical_rafters + 1
        r = int(horizontal_rafters) + 1
        c = int(vertical_rafters) + 1
        # 2. Validate: panel_count == rows * cols when panel_count is present
        if panel_count is not None and int(panel_count) != r * c:
            return {
                "eligible": False,
                "status": "MANUAL",
                "reason": f"Panel count mismatch: panel_count={panel_count} != {r}x{c} ({r * c}) — manual review required",
                "normalized_frame_family": norm_family,
                "rows": None,
                "cols": None,
                "connections": None,
                "man_hours": None,
            }
        final_rows = r
        final_cols = c

    elif vertical_rafters is None and horizontal_rafters is not None and panel_count is not None:
        # 3. Vertical rafter count unavailable:
        #    Never use cols = panel_count // rows unless:
        #    - vertical rafter count is unavailable
        #    - panel_count % rows == 0
        #    - the layout is explicitly confirmed rectangular
        #    - and the result is marked with a provenance reason
        r = int(horizontal_rafters) + 1
        if int(panel_count) % r != 0:
            return {
                "eligible": False,
                "status": "MANUAL",
                "reason": f"panel_count={panel_count} is not divisible by inferred rows={r} — manual review required",
                "normalized_frame_family": norm_family,
                "rows": None,
                "cols": None,
                "connections": None,
                "man_hours": None,
            }
        if not is_grid_confirmed:
            return {
                "eligible": False,
                "status": "MANUAL",
                "reason": f"Vertical rafter count unavailable and layout not confirmed rectangular for panel_count={panel_count} — manual review required",
                "normalized_frame_family": norm_family,
                "rows": None,
                "cols": None,
                "connections": None,
                "man_hours": None,
            }
        final_rows = r
        final_cols = int(panel_count) // r
        provenance_note = f"cols inferred as panel_count({panel_count}) // rows({r}) on confirmed rectangular layout"

    elif panel_count == 1:
        # Deterministic single rectangular opening (1x1)
        final_rows = 1
        final_cols = 1

    elif panel_count is None and (vertical_rafters == 0 or vertical_rafters is None) and is_grid_confirmed:
        # Single opening with confirmed outer dimensions
        final_rows = 1
        final_cols = 1

    else:
        # 4. Return None + MANUAL when:
        #    - rafter counts are absent/unknown rather than explicitly zero
        if horizontal_rafters is None and vertical_rafters is None:
            reason = f"Ambiguous or unconfirmed panel layout (panel_count={panel_count}): rafter counts are absent/unknown (horizontal_rafters=None, vertical_rafters=None) — manual review required"
        else:
            p_str = f"panel_count={panel_count}" if panel_count is not None else "missing panel count"
            reason = f"Ambiguous or unconfirmed panel layout ({p_str}) without confirmed rows/columns — manual review required"
        return {
            "eligible": False,
            "status": "MANUAL",
            "reason": reason,
            "normalized_frame_family": norm_family,
            "rows": None,
            "cols": None,
            "connections": None,
            "man_hours": None,
        }

    # 5. Calculation for eligible rectangular grid
    connections = (final_rows + 1) * (final_cols + 1)
    total_hours = float(connections * 2.0)
    formula_str = f"({final_rows}+1) rows × ({final_cols}+1) cols = {connections} connection nodes × 2.0 hrs = {total_hours} hrs"
    if provenance_note:
        formula_str += f" ({provenance_note})"

    return {
        "eligible": True,
        "status": "AUTO",
        "reason": formula_str,
        "normalized_frame_family": norm_family,
        "rows": final_rows,
        "cols": final_cols,
        "connections": connections,
        "man_hours": total_hours,
    }


def calculate_man_hours_by_connections(
    rows: Optional[int] = None,
    cols: Optional[int] = None,
    frame_code: Optional[str] = None,
    panel_count: Optional[int] = None,
    vertical_rafters: Optional[int] = None,
    horizontal_rafters: Optional[int] = None,
    is_grid_confirmed: bool = False,
    exclusion_indicators: Optional[list[Any]] = None,
    existing_override_field: Optional[dict] = None,
) -> tuple[Optional[float], str, str]:
    """
    Computes fabrication labor hours using the deterministic connection-node formula:
        connections = (rows + 1) * (cols + 1)
        man_hours   = connections * 2.0 hrs

    Delegates to check_fabrication_man_hours_eligibility for all scope, geometry,
    grid confirmation, and override checks.
    """
    res = check_fabrication_man_hours_eligibility(
        frame_code=frame_code,
        rows=rows,
        cols=cols,
        panel_count=panel_count,
        vertical_rafters=vertical_rafters,
        horizontal_rafters=horizontal_rafters,
        is_grid_confirmed=is_grid_confirmed,
        exclusion_indicators=exclusion_indicators,
        existing_override_field=existing_override_field,
    )
    if not res["eligible"]:
        return (None, res["reason"] or "Manual review required", res["status"])

    return (res["man_hours"], res["reason"] or "", "HIGH")


def calculate_man_hours(
    frame_code: str,
    total_rafters: int,
) -> tuple[Optional[float], str, str]:
    """
    Computes fabrication man hours using the rafter-based baseline model:
        man_hours = base_hours + (total_rafters * 2)
    """
    if not frame_code:
        return (
            None,
            "Frame type is unspecified — man hours baseline not defined",
            "MANUAL",
        )

    # Find base by checking partial matches
    base = None
    matched_key = None
    for key, hrs in MAN_HOURS_BASE.items():
        if key in frame_code or frame_code.startswith(key):
            base = hrs
            matched_key = key
            break

    if base is None:
        if "ECONOFRAME" in frame_code:
            return (None, "EconoFrame is out of scope for standard fabrication rule — manual review", "MANUAL")
        return (
            None,
            f"Frame type '{frame_code}' — man hours baseline not defined (manual review)",
            "MANUAL",
        )

    if base == 0.0:
        return (0.0, "Glass-only — no fabrication hours", "HIGH")

    extra = total_rafters * 2
    total = base + extra
    formula = (
        f"{base} hrs base ({matched_key}) "
        f"+ {total_rafters} rafters × 2 hrs = {total} hrs"
    )

    conf = "HIGH"
    return (total, formula, conf)

