# rules/rule7_unit_description.py
"""
Rule 7: Auto-generated Per-Unit Proposal Description.

Three-Tier System:
  - TIER 1 (Full ICC Template):
    proposal_number in {1, 2, 3, 4, 5, 6, 12, 13, 14, 15} and both
    value_width_in and value_length_in are present.
    Template: "({qty} Qty.) {w}\" x {l}\" ICC approved {product_name} ultra high performance walkable skylight {panel_str}"

  - TIER 2 (Minimal Non-ICC Plain Description):
    Every other unit where width_in and length_in (or a diameter field) are present.
    Uses verified geometry and plain generic family labels with NO brand names (never SkyFloor®)
    and NO "ICC approved" language.
    If frame_type_code is MANUAL or unresolved, frame label is omitted entirely.
    If proposal_number is None due to an unconfirmed default branch (e.g. Step 6e) with an
    active estimator confirmation flag, appends " (pending confirmation)".

  - TIER 3 (Zero Dimensions):
    Returns None only when there are truly zero dimensions on the unit.
"""

import re
from typing import Optional, Union, Dict, Any, List

SERIES_PRODUCT_NAMES: Dict[int, str] = {
    1: "Series 1000 SkyFloor®",
    2: "Series 1000 SkyFloor®",
    3: "Series 1000 SkyFloor®",
    4: "Series 1000 SkyFloor®",
    5: "Series 1000 SkyFloor®",
    6: "Series 1000 SkyFloor®",
    12: "Series 2000 SkyFloor®",
    13: "Series 2000 SkyFloor®",
    14: "Series 2000 SkyFloor®",
    15: "Series 2000 SkyFloor®",
}

GENERATABLE_PROPOSAL_NUMBERS = frozenset(SERIES_PRODUCT_NAMES.keys())

NON_ICC_FRAME_CODES = frozenset({
    "PERIMETER_NON_TB",
    "PERIMETER_NTB",
    "ECONOFRAME",
    "DECK_PERIMETER",
    "CUSTOM_ROLLED_STEEL",
    "SERIES_3000",
    "MODIFIED_SERIES_1000",
    "BLANK",
    "MANUAL",
})

# Tier 2 plain, generic frame family labels (factual, no brand names, no ICC claims)
TIER2_FRAME_LABELS: Dict[str, str] = {
    "ECONOFRAME": "EconoFrame",
    "MODIFIED_SERIES_1000": "modified interior floor",
    "DECK_PERIMETER": "deck perimeter",
    "SERIES_2000_PEDESTAL": "pedestal mount",
    "SERIES_2000_RECESSED": "recessed mount",
    "SERIES_1000_PEDESTAL": "pedestal mount",
    "SERIES_1000_RECESSED": "recessed mount",
    "SERIES_1000_INTERIOR_RECESSED": "interior recessed",
    "PERIMETER_NON_TB": "perimeter non-thermally broken",
    "PERIMETER_NTB": "perimeter non-thermally broken",
    "CUSTOM_ROLLED_STEEL": "custom rolled steel",
    "CUSTOM_SHAPED": "custom shaped",
    "CUSTOM_SHAPE": "custom shaped",
    "CUSTOM_OVAL": "custom shaped",
    "CUSTOM_ELLIPSE": "custom shaped",
    "SERIES_3000": "curb-mounted",
}


def inches_to_display(val: Union[float, int, str]) -> str:
    """Format dimension: 41 -> '41\"', 510.5 -> '510.5\"'."""
    try:
        f = float(val)
        if f.is_integer():
            return f'{int(f)}"'
        return f'{round(f, 2):g}"'
    except (TypeError, ValueError):
        return f'{val}"'


def _has_confirmation_flag(flags: Optional[List[str]]) -> bool:
    """Check if any flag indicates an unconfirmed default requiring estimator confirmation."""
    if not flags:
        return False
    confirm_patterns = (
        "estimator must confirm",
        "confirm with estimator",
        "confirm with client",
        "defaulting to",
        "pending confirmation",
    )
    for flag in flags:
        flag_lower = str(flag).lower()
        # Assembly method (FA vs KD) is a shop/site glazing detail, not a frame family classification default
        if "assembly type" in flag_lower and "fa vs kd" in flag_lower:
            continue
        if any(p in flag_lower for p in confirm_patterns):
            return True
    return False


def build_unit_description(
    unit: Dict[str, Any],
    proposal_number: Optional[Union[int, str]],
    frame_type_code: Optional[str] = None,
    flags: Optional[List[str]] = None,
) -> Optional[str]:
    """
    Build proposal description string for a single unit.

    TIER 1 (Full ICC Template):
      - proposal_number must be in {1, 2, 3, 4, 5, 6, 12, 13, 14, 15}
      - value_width_in and value_length_in must both be present (not None / empty)
      - Must have NO active confirmation-required flags on frame_type.

    TIER 2 (Minimal Plain Description):
      - Units with width_in + length_in (or diameter) that either do not qualify for
        Tier 1 (e.g. non-ICC frame family, ungeneratable proposal number) OR fell through
        from Tier 1 due to active confirmation flags.
      - Uses generic frame label, no brand claims, no ICC.
      - If frame_type_code is MANUAL or unresolved, frame label is omitted.
      - If confirmation flags are present, appends ' (pending confirmation)'.

    TIER 3:
      - Returns None only when there are truly zero dimensions.
    """
    try:
        pn = int(proposal_number) if proposal_number is not None else None
    except (TypeError, ValueError):
        pn = None

    w = unit.get("value_width_in")
    l = unit.get("value_length_in")
    dia = (
        unit.get("value_diameter_in")
        or unit.get("diameter_in")
        or unit.get("diameter")
        or unit.get("value_diameter")
    )

    try:
        qty = int(unit.get("value_num_units") or 1)
    except (TypeError, ValueError):
        qty = 1
    if qty <= 0:
        qty = 1

    try:
        panels = int(unit.get("value_panel_count") or 1)
    except (TypeError, ValueError):
        panels = 1
    if panels <= 0:
        panels = 1

    has_confirm = _has_confirmation_flag(flags)

    raw_frame_code = str(frame_type_code).strip().upper() if frame_type_code else ""
    is_non_icc_frame = (
        raw_frame_code in NON_ICC_FRAME_CODES
        or "NON_TB" in raw_frame_code
        or "NTB" in raw_frame_code
        or "NON-TB" in raw_frame_code
    )
    has_non_tb_flag = any(
        ("non-thermal" in str(fl).lower() or "non thermally" in str(fl).lower() or "non-tb" in str(fl).lower())
        for fl in (flags or [])
    )

    # ─────────────────────────────────────────────────────────────
    # TIER 1: Full ICC Template (Only for confirmed, flag-free classifications)
    # ─────────────────────────────────────────────────────────────
    if (
        pn in GENERATABLE_PROPOSAL_NUMBERS
        and not is_non_icc_frame
        and not has_non_tb_flag
        and w not in (None, "")
        and l not in (None, "")
        and not has_confirm
    ):
        product_name = SERIES_PRODUCT_NAMES[pn]
        w_str = inches_to_display(w)
        l_str = inches_to_display(l)
        panel_str = (
            f"consisting of {panels} equally sized panels"
            if panels > 1
            else "consisting of 1 panel per system"
        )
        return (
            f"({qty} Qty.) {w_str} x {l_str} ICC approved {product_name} "
            f"ultra high performance walkable skylight {panel_str}"
        )

    # ─────────────────────────────────────────────────────────────
    # TIER 2: Minimal Plain Geometry / System Description
    # ─────────────────────────────────────────────────────────────
    has_wl = (w not in (None, "") and l not in (None, ""))
    has_dia = (dia not in (None, ""))

    if has_wl or has_dia:
        panel_label = f"{panels} panel" if panels == 1 else f"{panels} panels"
        raw_frame_code = str(frame_type_code).strip().upper() if frame_type_code else None
        frame_label = TIER2_FRAME_LABELS.get(raw_frame_code) if raw_frame_code else None
        if not frame_label:
            has_custom_shape_signal = any(
                any(t in str(fl).lower() for t in ("custom shape", "custom radius", "custom shaped", "oval"))
                for fl in (flags or [])
            )
            if has_custom_shape_signal or (raw_frame_code and any(k in raw_frame_code for k in ("CUSTOM", "OVAL", "ELLIPSE", "SHAPE"))):
                frame_label = "custom shaped"

        confirm_suffix = " (pending confirmation)" if has_confirm else ""

        if has_wl:
            w_str = inches_to_display(w)
            l_str = inches_to_display(l)
            if frame_label:
                return f"({qty} Qty.) {w_str} x {l_str} {frame_label} glass flooring system, {panel_label}{confirm_suffix}"
            else:
                return f"({qty} Qty.) {w_str} x {l_str} glass flooring system, {panel_label}{confirm_suffix}"
        else:
            # Diameter only (circular system)
            d_str = inches_to_display(dia)
            if frame_label:
                return f"({qty} Qty.) {d_str} diameter circular {frame_label} glass flooring system, {panel_label}{confirm_suffix}"
            else:
                return f"({qty} Qty.) {d_str} diameter circular glass flooring system, {panel_label}{confirm_suffix}"

    # ─────────────────────────────────────────────────────────────
    # TIER 3: Truly Zero Dimensions -> None
    # ─────────────────────────────────────────────────────────────
    return None
