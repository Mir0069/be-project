"""
Rule 4 — Cross Beam Selection
================================
Validated against:
  - Rules Engine Reference Doc v2 (June 1 2026) + GFS client responses
  - Master Workbook template (rows confirmed June 2026)
  - Projects: 182 Robinson (single panel, 0 rafters confirmed),
               Spring Lake (3-panel Perimeter Non-TB → T-Section NTB confirmed),
               4 Jane St (14-panel EconoFrame → EconoFrame 3.5"),
               464 Greenwich (single panel, no cross beam)

Workbook rows this rule targets (Cross Beam section):
  Row 53  GFS-1   Series 1000 T-Section TB
  Row 54  GFS-7   Series 1000 I-Beam TB       ← practice default
  Row 55          Series 1000 T-Section NTB
  Row 56          Series 1000 I-Beam NTB
  Row 57          Series 2000 T-Section TB     ← price = 0, NOT USED
  Row 58  GFS-17  Series 2000 I-Beam TB        ← only option for Series 2000
  Row 59  GFS-11  Econoframe 2.5"
  Row 60  GFS-32  Econoframe 3.5"              ← standard EconoFrame cross beam

KEY RULES (from doc + GFS client responses):
  - Single panel (panels = 1) → NO cross beam regardless of frame type (HIGH conf)
  - Panel count unknown → PENDING (blocked on Stage 3 approval, not estimator decision)
  - Series 2000 → I-Beam only, no T-section (confirmed from rules review)
  - Series 1000 + multi-panel → I-Beam TB default (engineering chart pending B1 blocker)
  - Perimeter Non-TB + Non-IGU + interior + multi-panel → T-Section NTB (Spring Lake confirmed)
  - EconoFrame + multi-panel → Econoframe 3.5" (GFS-32) — 2.5" vs 3.5" needs GFS confirm
  - Custom steel (Mill Hill) → engineering required, always flag

GFS CLIENT CORRECTIONS:
  - "T section is available for recessed non-TB but engineering drives this.
     I rafter is also available for this frame type." → flag for engineering
  - "Load chart to be provided" → B1 blocker still open

OPEN BLOCKER B1:
  Engineering load chart for I-Beam vs T-Section (Series 1000) not yet received.
  Until received: default to I-Beam for Series 1000, flag every multi-panel job.

SOURCE HIERARCHY:
  1. Actual project data + approved Excel workbook (ground truth)
  2. Rules Engine Reference Doc v2 + GFS client responses
  3. Flag for client question if neither resolves it
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from extraction.models import ExtractionResult
from extraction.canonical import CanonicalSignals   # canonical-first signals
from rules.rule2_glass_type import GlassTypeResult
from rules.rule3_frame_type import FrameTypeResult
from rules.rule_confidence import compute_rule_confidence


# ─────────────────────────────────────────────────────────────
# PANEL COUNT EXTRACTION
# Looks for explicit count mentions in AI-extracted statements.
# Panel count is the primary driver of cross beam selection.
# ─────────────────────────────────────────────────────────────

# Regex patterns to detect panel count from explicit statements.
# IMPORTANT: negative lookbehind (?<!series\s) prevents "Series 2000" / "Series 1000"
# being parsed as panel counts. Count limited to [1-9]\d? (max 99) to reject
# product series numbers (1000, 2000, 3000).
_COUNT_PATTERNS = [
    # Direct panel mentions: "14 glass panels", "3 panels"
    (r'(?<!series\s)\b([1-9]\d?)\s+(?:glass\s+)?panels?\b', 'panels', 'panel_count'),
    # Unit/skylight count: "2 walkable skylights" → infer 1 panel per unit
    (r'(?<!series\s)\b([1-9])\s+(?:walkable\s+)?skylights?\b', 'skylights', 'unit_count'),
    (r'(?<!series\s)\b([1-9]\d?)\s+(?:glass\s+)?units?\b', 'units', 'unit_count'),
    # Stair treads
    (r'(?<!series\s)\b([1-9]\d?)\s+treads?\b', 'treads', 'panel_count'),
]
_SINGLE_PATTERNS = [
    r'\bsingle\s+panel\b',
    r'\bone\s+(?:glass\s+)?panel\b',
    r'\b1\s+panel\b',
    r'\bsingle\s+skylight\b',
]


def _extract_panel_count(
    extraction: ExtractionResult,
    canonical: Optional["CanonicalSignals"] = None,
) -> tuple[Optional[int], Optional[str]]:
    """
    Returns (panel_count, source_description).
    Searches explicit_statements for count signals.

    panel_count is PANELS PER UNIT (not total units across job).
    "X skylights" → infers 1 panel per unit (most common case).
    "14 glass panels" in one contiguous opening → 14 panels for that unit.

    Returns (None, None) if not determinable.
    """
    # ── Canonical-first: read panel count from Vision unit objects ────────
    if canonical is not None:
        pc = canonical.primary_panel_count()
        if pc is not None:
            unit_labels = [u.unit_label for u in canonical.units if u.panel_count is not None]
            label_str = unit_labels[0] if unit_labels else "unit"
            return pc, f"[canonical] unit {label_str!r}: {pc} panels from Vision"

    # ── Text-based fallback ───────────────────────────────────────────────
    for stmt in extraction.explicit_statements:
        text = (stmt.verbatim + " " + (stmt.context or "")).lower()

        # Check single panel patterns first (most specific)
        for pattern in _SINGLE_PATTERNS:
            if re.search(pattern, text):
                return 1, f"single panel — '{stmt.verbatim[:60]}'"

        # Check numeric patterns
        for pattern, label, count_type in _COUNT_PATTERNS:
            m = re.search(pattern, text)
            if m:
                count = int(m.group(1))
                if count_type == 'unit_count':
                    # X skylights/units → infer 1 panel per unit
                    return 1, (
                        f"1 panel per unit inferred from {count} {label} — "
                        f"'{stmt.verbatim[:50]}'"
                    )
                return count, f"{count} {label} — '{stmt.verbatim[:60]}'"

    return None, None


def _extract_layout_details(
    extraction: ExtractionResult,
    canonical: Optional["CanonicalSignals"] = None,
    panel_count: Optional[int] = None,
) -> tuple[int, int, list[str]]:
    """
    Returns (vertical_rafters, horizontal_rafters, flags).

    Reads rows/cols or explicit rafter counts from canonical Vision signals
    or text extraction statements.
    Falls back to single-row layout assumption (vertical = panel_count - 1, horizontal = 0)
    with an estimator flag.
    """
    flags = []
    # 1. Canonical unit check (unit-wise: CanonicalUnit uses
    # vertical_rafter_count/horizontal_rafter_count + rows/columns)
    if canonical is not None and getattr(canonical, "units", None):
        for u in canonical.units:
            v_ref = getattr(u, "vertical_rafter_count", None)
            if v_ref is None:
                v_ref = getattr(u, "vertical_rafters", None)
            h_ref = getattr(u, "horizontal_rafter_count", None)
            if h_ref is None:
                h_ref = getattr(u, "horizontal_rafters", None)
            rows = getattr(u, "rows", None)
            cols = getattr(u, "columns", None)
            if cols is None:
                cols = getattr(u, "cols", None)

            if v_ref is not None or h_ref is not None:
                return (v_ref or 0), (h_ref or 0), flags
            if rows is not None and cols is not None and rows > 0 and cols > 0:
                v = max(0, cols - 1)
                h = max(0, rows - 1)
                if rows > 1:
                    flags.append(f"Grid layout detected ({rows}x{cols}): {v} vertical rafters, {h} horizontal rafters")
                return v, h, flags

    # 2. Text fallback check for grid patterns like "2x2", "3x2"
    text = (
        " ".join([s.verbatim for s in extraction.explicit_statements if s.verbatim])
        if extraction and extraction.explicit_statements else ""
    )
    grid_match = re.search(r'\b([2-9])\s*[x×]\s*([2-9])\b', text, re.I)
    if grid_match:
        r, c = int(grid_match.group(1)), int(grid_match.group(2))
        v, h = max(0, c - 1), max(0, r - 1)
        flags.append(f"2D grid layout detected in text ({r}x{c}): {v} vertical, {h} horizontal rafters")
        return v, h, flags

    # 3. Fallback: single-row assumption
    pc = panel_count or 1
    v = max(0, pc - 1)
    h = 0
    if pc > 2:
        flags.append(f"Single-row layout assumed for {pc} panels ({v} vertical rafters). Confirm if 2D grid applies.")
    return v, h, flags


def _estimate_rafters(
    panel_count: int,
    extraction: Optional[ExtractionResult] = None,
    canonical: Optional["CanonicalSignals"] = None,
) -> tuple[int, int]:
    v, h, _ = _extract_layout_details(extraction, canonical, panel_count)
    return v, h


# ─────────────────────────────────────────────────────────────
# OUTPUT MODEL
# ─────────────────────────────────────────────────────────────

@dataclass
class CrossBeamResult:
    """
    Output of Rule 4.

    cross_beam_code     Internal code.
    workbook_row_name   Exact label from workbook (Row 53-60), or None.
    panel_count         Panel count used for this decision, or None.
    vertical_rafters    Estimated vertical rafter count.
    horizontal_rafters  Estimated horizontal rafter count.
    confidence          HIGH | MEDIUM | LOW | MANUAL | PENDING
    flags               Plain English notes for estimator.
    reasoning           Decision steps for audit trail.
    """
    cross_beam_code: str            # T_SECTION_TB | I_BEAM_TB | T_SECTION_NTB
                                    # I_BEAM_NTB | ECONOFRAME_35 | ECONOFRAME_25
                                    # NONE | PENDING | MANUAL

    workbook_row_name: Optional[str]

    panel_count: Optional[int] = None
    vertical_rafters: int = 0
    horizontal_rafters: int = 0

    confidence: Optional[int] = None
    flags: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# MAIN DECISION FUNCTION
# ─────────────────────────────────────────────────────────────

def decide_cross_beam(
    extraction: ExtractionResult,
    glass_result: GlassTypeResult,
    frame_result: FrameTypeResult,
    canonical: Optional[CanonicalSignals] = None,
) -> CrossBeamResult:
    """
    Rule 4 — Cross Beam Selection.

    Decision order:
      0. MANUAL / BLANK / PENDING frames → no cross beam needed or not applicable
      1. Extract panel count from extraction
      2. Single panel (count = 1) → NO cross beam (HIGH confidence)
      3. Panel count unknown → PENDING (blocked on Stage 3)
      4. Multi-panel routing by frame type:
           a. Perimeter Non-TB + Non-IGU + interior → T-Section NTB
           b. Series 2000 → Series 2000 I-Beam only
           c. EconoFrame → Econoframe 3.5" (GFS-32)
           d. Series 1000 → I-Beam TB default (B1 blocker pending)
           e. Series 3000 / Custom → engineering required
    """
    flags = []
    reasoning = []

    # ── Step 0: Frames that don't need cross beam logic ──────────────────

    # Glass-only, stair treads, MGDS → no frame, no cross beam
    if frame_result.frame_type_code in ("BLANK", "MANUAL"):
        reasoning.append(f"Frame is {frame_result.frame_type_code} — no cross beam applicable")
        return CrossBeamResult(
            cross_beam_code="NONE",
            workbook_row_name=None,
            confidence=compute_rule_confidence("HIGH", frame_result.confidence),
            flags=[],
            reasoning=reasoning,
        )

    # MANUAL glass type cascades to MANUAL cross beam
    if glass_result.glass_type_code == "MANUAL":
        reasoning.append("Glass type MANUAL — cross beam cannot be determined")
        return CrossBeamResult(
            cross_beam_code="MANUAL",
            workbook_row_name=None,
            confidence=compute_rule_confidence("MANUAL"),
            flags=["Glass type is MANUAL — cross beam requires manual input"],
            reasoning=reasoning,
        )

    # ── Step 1: Extract panel count ──────────────────────────────────────
    panel_count, count_source = _extract_panel_count(extraction, canonical)
    reasoning.append(
        f"Panel count: {panel_count} ({count_source})"
        if panel_count else "Panel count: not found in documents"
    )

    # ── Step 2: Single panel → no cross beam ─────────────────────────────
    if panel_count == 1:
        reasoning.append("Single panel → no cross beam")
        return CrossBeamResult(
            cross_beam_code="NONE",
            workbook_row_name=None,
            panel_count=1,
            vertical_rafters=0,
            horizontal_rafters=0,
            confidence=compute_rule_confidence("HIGH", frame_result.confidence, glass_result.confidence),
            flags=[],
            reasoning=reasoning,
        )

    frame_code = frame_result.frame_type_code

    # ── Step 3: Engineering-required frames → MANUAL before panel check ───
    # Custom steel and Series 3000 need engineering regardless of panel count.
    # Check this BEFORE the PENDING check so Mill Hill gets MANUAL not PENDING.
    if frame_code == "SERIES_3000":
        reasoning.append("Series 3000 non-walkable — cross beam engineering dependent")
        return CrossBeamResult(
            cross_beam_code="MANUAL",
            workbook_row_name=None,
            panel_count=panel_count,
            confidence=compute_rule_confidence("MANUAL"),
            flags=["Non-walkable Series 3000 — cross beam requires GFS engineering input"],
            reasoning=reasoning,
        )

    if frame_code == "PERIMETER_NON_TB" and glass_result.glass_type_code not in (
        "GLASS_NO_IGU",
    ):
        # Custom steel (non-rectangular shape) — engineering required
        reasoning.append(
            "Perimeter Non-TB (custom steel / non-rectangular) → engineering required"
        )
        return CrossBeamResult(
            cross_beam_code="MANUAL",
            workbook_row_name=None,
            panel_count=panel_count,
            confidence=compute_rule_confidence("MANUAL"),
            flags=[
                "Custom shape Perimeter Non-TB — cross beam requires GFS engineering input. "
                "Cannot be auto-determined for non-rectangular shapes.",
            ],
            reasoning=reasoning,
        )

    # ── Step 4: Panel count unknown → PENDING ────────────────────────────
    # Not MANUAL — cross beam follows deterministically once panel count
    # is confirmed at Stage 3. Estimator doesn't decide this.
    if panel_count is None:
        reasoning.append(
            "Panel count unknown — cross beam PENDING Stage 3 approval"
        )
        return CrossBeamResult(
            cross_beam_code="PENDING",
            workbook_row_name=None,
            panel_count=None,
            confidence=compute_rule_confidence("MANUAL"),
            flags=[
                "Cross beam blocked — panel count not found in documents. "
                "Will be computed automatically once Stage 3 panel count is confirmed."
            ],
            reasoning=reasoning,
        )

    # ── Multi-panel: compute rafter estimates ─────────────────────────────
    v_rafters, h_rafters, layout_flags = _extract_layout_details(extraction, canonical, panel_count)
    flags.extend(layout_flags)
    reasoning.append(
        f"Multi-panel: {panel_count} panels → "
        f"{v_rafters} vertical rafters, {h_rafters} horizontal rafters"
    )

    # ── Step 5a: Perimeter Non-TB + Non-IGU + interior → T-Section NTB ──
    # Confirmed: Spring Lake — 3 panels, interior, Perimeter Non-TB
    # Source: shop drawing page 5, "DETAIL - NON-THERMALLY BROKEN T-RAFTER"
    if frame_code == "PERIMETER_NON_TB" and glass_result.glass_type_code == "GLASS_NO_IGU":
        reasoning.append(
            "Perimeter Non-TB + Glass No IGU + multi-panel → T-Section NTB "
            "(confirmed Spring Lake 3-panel)"
        )
        return CrossBeamResult(
            cross_beam_code="T_SECTION_NTB",
            workbook_row_name="Series 1000 T - Section ",
            panel_count=panel_count,
            vertical_rafters=v_rafters,
            horizontal_rafters=h_rafters,
            confidence=compute_rule_confidence("HIGH", frame_result.confidence, glass_result.confidence),
            flags=[
                "T-Section NTB confirmed for interior Perimeter Non-TB multi-panel systems. "
                "GFS note: T-section available for recessed non-TB — engineering drives final selection.",
                f"Rafter count estimated from panel count ({panel_count} panels → "
                f"{v_rafters} vertical rafters). Verify from drawings if available.",
            ],
            reasoning=reasoning,
        )

    # ── Step 5b: Series 2000 → I-Beam only (no T-section for 2000) ───────
    # Confirmed from rules review document.
    # Row 57 (Series 2000 T-section) has price=0 in workbook — not used.
    if "SERIES_2000" in frame_code:
        reasoning.append(
            "Series 2000 → Series 2000 I-Beam only (no T-section option for Series 2000)"
        )
        return CrossBeamResult(
            cross_beam_code="I_BEAM_TB_2000",
            workbook_row_name="Series 2000 I beam thermally broken",
            panel_count=panel_count,
            vertical_rafters=v_rafters,
            horizontal_rafters=h_rafters,
            confidence=compute_rule_confidence("HIGH", frame_result.confidence, glass_result.confidence),
            flags=[
                f"Rafter count estimated ({panel_count} panels → {v_rafters} vertical). "
                "Verify from drawings if available."
            ],
            reasoning=reasoning,
        )

    # ── Step 5c: EconoFrame → Econoframe 3.5" (GFS-32) ───────────────────
    # Doc says "EconoFrame 3.0 crossbeam" but workbook has 2.5" and 3.5" only.
    # Defaulting to 3.5" (GFS-32) as the standard cross beam.
    # NOT validated against a real completed project folder — medium confidence.
    if frame_code == "ECONOFRAME":
        reasoning.append(
            "EconoFrame multi-panel → Econoframe 3.5\" cross beam (GFS-32)"
        )
        return CrossBeamResult(
            cross_beam_code="ECONOFRAME_35",
            workbook_row_name="Econoframe 3.5\"",
            panel_count=panel_count,
            vertical_rafters=v_rafters,
            horizontal_rafters=h_rafters,
            confidence=compute_rule_confidence("MEDIUM", frame_result.confidence, glass_result.confidence),
            flags=[
                "EconoFrame cross beam: doc references 'EconoFrame 3.0' but workbook has "
                "2.5\" (GFS-11) and 3.5\" (GFS-32) only. Defaulting to 3.5\". "
                "Confirm with GFS which size applies.",
                "NOT VALIDATED: EconoFrame cross beam not confirmed against real project workbook.",
                f"Rafter count estimated ({panel_count} panels → {v_rafters} vertical).",
            ],
            reasoning=reasoning,
        )

    # ── Step 5d: Series 1000 → I-Beam TB default (B1 blocker) ────────────
    # Engineering load chart not yet received from GFS.
    # Until received: always default to I-Beam, flag for estimator.
    # GFS comment: "T-section is exception, I-Beam is practice default"
    if "SERIES_1000" in frame_code or frame_code == "GLASS_WITH_IGU":
        reasoning.append(
            "Series 1000 + multi-panel → I-Beam TB default (B1 blocker: "
            "engineering load chart pending)"
        )
        return CrossBeamResult(
            cross_beam_code="I_BEAM_TB",
            workbook_row_name="Series 1000 I - Beam thermally broken",
            panel_count=panel_count,
            vertical_rafters=v_rafters,
            horizontal_rafters=h_rafters,
            confidence=compute_rule_confidence("MEDIUM", frame_result.confidence, glass_result.confidence),
            flags=[
                "OPEN BLOCKER B1: Engineering load chart for I-Beam vs T-Section "
                "not yet received from GFS. Defaulting to I-Beam as practice standard. "
                "Verify with estimator before ordering.",
                f"Rafter count estimated ({panel_count} panels → {v_rafters} vertical). "
                "Verify from drawings if available.",
            ],
            reasoning=reasoning,
        )

    # ── Step 5e (now handled in Step 3 above): Series 3000 / custom steel → engineering required ────────
    # Non-walkable or custom shape — cross beam engineering dependent
    if frame_code in ("SERIES_3000",) or "PERIMETER_NON_TB" in frame_code:
        reasoning.append(
            f"Frame {frame_code} + multi-panel → engineering required for cross beam"
        )
        return CrossBeamResult(
            cross_beam_code="MANUAL",
            workbook_row_name=None,
            panel_count=panel_count,
            confidence=compute_rule_confidence("MANUAL"),
            flags=[
                f"Frame type {frame_code} with multi-panel configuration — "
                "cross beam selection requires GFS engineering input. "
                "Cannot be auto-determined.",
            ],
            reasoning=reasoning,
        )

    # ── Fallback ──────────────────────────────────────────────────────────
    reasoning.append(f"Unhandled frame code: {frame_code}")
    return CrossBeamResult(
        cross_beam_code="MANUAL",
        workbook_row_name=None,
        panel_count=panel_count,
        confidence=compute_rule_confidence("MANUAL"),
        flags=[
            f"Unhandled frame type '{frame_code}' — cross beam requires manual input"
        ],
        reasoning=reasoning,
    )
