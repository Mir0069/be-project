"""
formulas/packaging.py
=====================
Packaging and crating baseline formulas.

CONFIRMED BUSINESS RULE (Client Email 2026-09-22):
- Glass only ("BLANK", "JUST_GLASS"): 0.5 crates flat, regardless of panel count.
- Framed system (any frame type not MANUAL/glass-only), based on panel_count:
    1-2 panels  -> 1.0 crate
    3-6 panels  -> 2.0 crates
    7-10 panels -> 3.0 crates
    11+ panels  -> None (do not compute or write value; estimator review required)
- Missing/invalid panel count or unknown/manual frame -> None (manual review).

OPEN ITEM FOR HUMAN RESOLUTION:
--------------------------------
The previous documentation and code comments referenced an additional weight-based
packaging chart pending from Wayne/Greg at GFS. GFS's confirmed answer describes a
complete panel-count-based rule (1-2 -> 1, 3-6 -> 2, 7-10 -> 3, 11+ -> manual) with
no mention of a separate weight chart.
Ambiguity: Is the weight chart concept obsolete and fully superseded by these panel-count
bands, or are panel-count bands only a baseline with a weight-based adjustment on top?
Until resolved with GFS, the estimator-flag note regarding the pending Wayne/Greg weight
chart is preserved in Rule 6 calculations alongside this panel-count band logic.

OUT OF SCOPE TODO:
------------------
TODO: GFS's 2026-09-22 email also confirmed that "expedited" orders apply to BOTH glass-only
and framed systems, with 4 specific constraints:
  1. Expedited only valid for non-IGU glass with EconoFrame or non-thermally-broken frames.
  2. Expedited orders require EGR glass price selected.
  3. Expedited orders require back paint selected.
  4. HST (Heat Soak Testing) cannot be offered as an option on expedited orders.
These affect glass-type selection (see rules/rule2_glass_type.py), add-on selection
(see rules/rule5_addons.py), and workbook pricing selection, not packaging/crate math.
Do NOT implement these here.
"""
from typing import Optional


def calculate_packaging_base(
    frame_type_code: Optional[str],
    panel_count: Optional[int] = None,
) -> tuple[Optional[float], str]:
    """
    Computes crate count based on frame type and panel count.
    Returns: (packaging_base_crates, packaging_note)
    """
    if not frame_type_code or frame_type_code == "MANUAL":
        return None, "Packaging MANUAL — frame type unknown"

    # Glass only: 0.5 crates flat regardless of panel count
    if frame_type_code in ("BLANK", "JUST_GLASS"):
        return (
            0.5,
            "Glass-only replacement — 0.5 crate base flat regardless of panel count."
        )

    # Framed systems require panel count
    if panel_count is None:
        return None, "Packaging MANUAL — panel count missing for framed system"

    if panel_count < 1:
        return None, f"Packaging MANUAL — invalid panel count ({panel_count})"

    if 1 <= panel_count <= 2:
        return (
            1.0,
            f"Framed system ({panel_count} panel{'s' if panel_count > 1 else ''}) — 1 crate (1-2 panels band)."
        )

    if 3 <= panel_count <= 6:
        return (
            2.0,
            f"Framed system ({panel_count} panels) — 2 crates (3-6 panels band)."
        )

    if 7 <= panel_count <= 10:
        return (
            3.0,
            f"Framed system ({panel_count} panels) — 3 crates (7-10 panels band)."
        )

    # 11+ panels: out of range for automatic calculation; requires manual estimator review
    return (
        None,
        f"Packaging MANUAL — {panel_count} panels exceeds 10 panel threshold; estimator review required."
    )

