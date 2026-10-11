"""
Rule 3 — Frame Type Selection
================================
Validated against:
  - Rules Engine Reference Doc v2 (June 1 2026) + GFS client responses
  - Master Workbook template (rows confirmed June 2026)
  - Projects: 182 Robinson, Baldwin Farm, Avalon, Spring Lake,
               464 Greenwich, 4 Jane St, Mill Hill, Alana Ln

Workbook rows this rule targets (Framing — Perimeter section):
  Row 38  GFS-5   Series 1000 Pedestal TB
  Row 39  GFS-6   Series 1000 Recessed TB
  Row 40  GFS-4   Perimeter non thermally broken
  Row 41  GFS-15  Series 2000 Pedestal
  Row 42  GFS-16  Series 2000 Recessed
  Row 43          Series 2000 with plate
  Row 44          Series 2000 non-walkable
  Row 45  GFS-33/34  Series 3000
  Row 46  GFS-13  Deck perimeter
  Row 47  GFS-31  Econoframe - lengths

Also finalises Proposal Description (1–15) by combining
Rule 2 glass_type_code + install_type + assembly_type.

SOURCE HIERARCHY:
  1. Actual project data + approved Excel workbook (ground truth)
  2. Rules Engine Reference Doc v2 + GFS client responses (confirmed rules)
  3. Flag for client question if neither resolves it

KEY GFS CLIENT CORRECTIONS (from doc responses):
  - Pedestal vs Recessed default: GFS confirmed DEFAULT TO PEDESTAL
    unless estimator explicitly overrides to recessed.
    (Overrides Table 9 doc which said Recessed as default for Series 2000)
  - EconoFrame: existing structure detection relies on keywords — any
    ambiguity flags for estimator (GFS confirmed: "this true")
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from extraction.models import ExtractionResult
from extraction.canonical import CanonicalSignals   # canonical-first signals
from rules.rule2_glass_type import GlassTypeResult
from rules.rule_confidence import compute_rule_confidence


# ─────────────────────────────────────────────────────────────
# SIGNAL VOCABULARY
# ─────────────────────────────────────────────────────────────

# Install type — pedestal vs recessed vs interior recessed
_PEDESTAL_TERMS = [
    "pedestal", "paver", "paver system", "above paver",
    "elevated", "set on pedestal", "pedestal framing",
    "gfs-5", "gfs-15",
]
_RECESSED_TERMS = [
    "recessed", "flush mounted", "flush mount", "set flush",
    "recessed into", "recessed perimeter", "recessed frame",
    "gfs-6", "gfs-16",
]
_INTERIOR_RECESSED_TERMS = [
    "interior recessed", "recessed interior", "interior floor framing",
    "recessed interior floor", "gfs-5 interior", "gfs-6 interior",
]

# Assembly type — FA vs KD
_FA_TERMS = [
    "factory glazed", "fully assembled", "factory assembled",
    "pre-assembled", "bonded at factory", " fa ", "fa unit",
    "comes fully assembled",
]
_KD_TERMS = [
    "knock down", "knockdown", " kd ", "site glazed",
    "glazed on site", "assembled on site", "assemble on site",
    "glazing on site", "field glazed",
]

# Structure type — determines frame for Glass No IGU
_THROUGH_BOLT_TERMS = [
    "through bolt", "through-bolt", "through-bolted", "through bolted",
    "rear flange removal", "rear flange removed", "rear flange",
    "bolt to concrete", "bolted to concrete", "through bolted connections",
]
_EXISTING_STRUCTURE_TERMS = [
    "existing structure", "existing framing", "existing opening",
    "existing skylight", "insert into existing", "existing hole",
    "existing curb", "existing frame", "existing steel",
    "set into existing", "existing structural",
]
_NEW_DECK_TERMS = [
    "new deck", "deck from scratch", "outdoor deck system",
    "deck perimeter", "new outdoor deck", "new deck system",
    "building a deck", "construct a deck",
]
_CONDITIONED_SPACE_TERMS = [
    "kitchen", "living room", "dining room", "bedroom",
    "bathroom", "office", "hallway", "conditioned",
    "heated space", "hvac", "air conditioned", "living space",
    "conditioned space", "habitable",
]


# EconoFrame cut type — for Proposal 7 vs 8
_CUT_TO_SIZE_TERMS = [
    "cut to size", "cut to fit", "gfs cut", "pre-cut",
    "cut by gfs", "factory cut",
]
# Proposal 7 = eFrame and Gasket (installer cuts lengths)
# Proposal 8 = eFrame cut to size (GFS cuts to exact size)
# If no signal → flag for estimator

# Custom shape override
_CUSTOM_SHAPE_TERMS = [
    "oval", "ellipse", "elliptical", "round", "circular",
    "curved", "radius corner", "non-rectangular", "custom shape",
    "irregular shape",
]


# ─────────────────────────────────────────────────────────────
# OUTPUT MODEL
# ─────────────────────────────────────────────────────────────

@dataclass
class FrameTypeResult:
    """
    Output of Rule 3.

    frame_type_code    Internal code.
    workbook_row_name  Exact label as in workbook (Row 38-47).
    frame_variant      Sub-variant note (e.g. 'Modified NTB Recessed Interior').
    install_type       PEDESTAL | RECESSED | INTERIOR_RECESSED | None
    assembly_type      FA | KD | MANUAL
    proposal_number    Final Proposal Description (1-15), or None.
    glass_type_correction  If frame type requires correcting Rule 2 glass
                       type, the corrected code is here (e.g. Mill Hill
                       custom shape forces GLASS_NO_IGU).
    confidence         HIGH | MEDIUM | LOW | MANUAL
    flags              Plain English notes for estimator.
    reasoning          Decision steps for audit trail.
    """
    frame_type_code: str
    workbook_row_name: Optional[str]
    frame_variant: Optional[str] = None
    install_type: Optional[str] = None
    assembly_type: str = "MANUAL"
    proposal_number: Optional[int] = None
    glass_type_correction: Optional[str] = None
    confidence: Optional[int] = None
    flags: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# PROPOSAL DESCRIPTION LOOKUP
# Combines glass type + install type + assembly type → number
# ─────────────────────────────────────────────────────────────

_PROPOSAL_MAP = {
    # Series 1000 (GLASS_WITH_IGU or GLASS_NO_IGU with Series 1000 context)
    ("SERIES_1000", "PEDESTAL",          "FA"): 1,
    ("SERIES_1000", "PEDESTAL",          "KD"): 2,
    ("SERIES_1000", "RECESSED",          "FA"): 3,
    ("SERIES_1000", "RECESSED",          "KD"): 4,
    ("SERIES_1000", "INTERIOR_RECESSED", "FA"): 5,
    ("SERIES_1000", "INTERIOR_RECESSED", "KD"): 6,
    # EconoFrame
    ("ECONOFRAME",  "GASKET",            None): 7,  # Installer cuts lengths
    ("ECONOFRAME",  "CUT_TO_SIZE",       None): 8,  # GFS cuts to size
    # Special types
    ("GLASS_ONLY",  None,                None): 9,
    ("STAIR_TREAD", None,                None): 10,
    ("DECK",        None,                None): 11,
    # Series 2000
    ("SERIES_2000", "PEDESTAL",          "FA"): 12,
    ("SERIES_2000", "PEDESTAL",          "KD"): 13,
    ("SERIES_2000", "RECESSED",          "FA"): 14,
    ("SERIES_2000", "RECESSED",          "KD"): 15,
}


def _get_proposal(series_key, install_type, assembly_type) -> Optional[int]:
    result = _PROPOSAL_MAP.get((series_key, install_type, assembly_type))
    if result is None and assembly_type in ("MANUAL", None):
        # Assembly type not stated — fall back to KD default per GFS convention
        result = _PROPOSAL_MAP.get((series_key, install_type, "KD"))
    return result


# ─────────────────────────────────────────────────────────────
# SIGNAL DETECTION HELPERS
# ─────────────────────────────────────────────────────────────

def _collect_text(extraction: ExtractionResult) -> str:
    parts = []
    for s in extraction.explicit_statements:
        if s.verbatim:
            parts.append(s.verbatim.lower())
        if s.context:
            parts.append(s.context.lower())
    for m in extraction.measurements:
        if m.label_as_written:
            parts.append(m.label_as_written.lower())
        if m.context:
            parts.append(m.context.lower())
        if m.location_context:
            parts.append(m.location_context.lower())
    return " ".join(parts)


def _has(text: str, terms: list[str]) -> bool:
    return any(re.search(r'\b' + re.escape(t.lower()), text) for t in terms)


def _find(text: str, terms: list[str]) -> Optional[str]:
    for t in terms:
        if re.search(r'\b' + re.escape(t.lower()), text):
            return t
    return None


def _detect_custom_shape(
    extraction: ExtractionResult,
    canonical: Optional["CanonicalSignals"] = None,
) -> bool:
    """
    Check both measurement.shape field (set by AI), canonical unit signals, and text signals.
    Mill Hill: AI sets shape='oval', also text says 'oval walkable Skylights'.
    """
    if canonical:
        for u in getattr(canonical, "units", []):
            if getattr(u, "diameter_inches", None) is not None:
                return True
            for text_field in (getattr(u, "location_description", None), getattr(u, "verbatim", None), getattr(u, "reasoning", None)):
                if text_field and _has(str(text_field), _CUSTOM_SHAPE_TERMS):
                    return True
        if getattr(canonical, "glass_signals", None):
            for f in (canonical.glass_signals.is_walkable, canonical.glass_signals.is_exterior):
                if f and f.verbatim and _has(str(f.verbatim), _CUSTOM_SHAPE_TERMS):
                    return True
        if getattr(canonical, "header_signals", None) and canonical.header_signals.project_name:
            pn = canonical.header_signals.project_name.value or canonical.header_signals.project_name.verbatim
            if pn and _has(str(pn), _CUSTOM_SHAPE_TERMS):
                return True

    for m in extraction.measurements:
        if m.shape and m.shape.lower() in ("oval", "round", "irregular", "angled", "circular"):
            return True
    text = _collect_text(extraction)
    return _has(text, _CUSTOM_SHAPE_TERMS)


def _detect_install_type(
    text: str,
    canonical: Optional["CanonicalSignals"] = None,
) -> tuple[str, str]:
    """
    Returns (install_type, confidence_note).

    Canonical-first: reads install_type directly from Vision output enum.
    Fallback: text-based _TERMS matching (legacy path).
    GFS confirmed: default to PEDESTAL unless recessed explicitly stated.
    """
    # ── Canonical-first ───────────────────────────────────────
    if canonical is not None:
        sig = canonical.get_frame("install_type")
        if sig is not None and sig.is_stated():
            val = (sig.value or "").strip().upper()  # "PEDESTAL" | "RECESSED" | "DECK_PERIMETER" | "CURB_MOUNTED"
            if val == "RECESSED":
                return "RECESSED", sig.confidence
            if val in ("PEDESTAL", "DECK_PERIMETER"):
                return "PEDESTAL", sig.confidence
            if val == "CURB_MOUNTED":
                # Was previously falling through to the text-based fallback
                # below, which has no CURB_MOUNTED detection at all and
                # silently downgraded this to the PEDESTAL default -- confirmed
                # against a real project where a curb-mounted multi-panel unit
                # wrongly ended up as Series 2000 Pedestal instead of Series 3000.
                return "CURB_MOUNTED", sig.confidence
            # Any other stated value → fall through to text

    # ── Text-based fallback ───────────────────────────────────
    interior_recessed = _has(text, _INTERIOR_RECESSED_TERMS)
    recessed = _has(text, _RECESSED_TERMS)
    pedestal = _has(text, _PEDESTAL_TERMS)

    if interior_recessed:
        return "INTERIOR_RECESSED", "HIGH"
    if recessed and not pedestal:
        return "RECESSED", "HIGH"
    if pedestal:
        return "PEDESTAL", "HIGH"
    # GFS confirmed default: PEDESTAL
    return "PEDESTAL", "LOW"   # Default — flag for estimator


def _detect_assembly(
    text: str,
    canonical: Optional["CanonicalSignals"] = None,
) -> tuple[str, str]:
    """
    Returns (assembly_type, confidence_note).
    FA = factory glazed / fully assembled.
    KD = knock down / site glazed.

    Canonical-first: reads assembly_type directly from Vision output enum.
    Fallback: text-based _TERMS matching.
    """
    # ── Canonical-first ───────────────────────────────────────
    if canonical is not None:
        sig = canonical.get_frame("assembly_type")
        if sig is not None and sig.is_stated():
            val = sig.value  # "FA" | "KD"
            if val == "FA":
                return "FA", sig.confidence
            if val == "KD":
                return "KD", sig.confidence

    # ── Text-based fallback ───────────────────────────────────
    fa = _has(text, _FA_TERMS)
    kd = _has(text, _KD_TERMS)
    if fa and not kd:
        return "FA", "HIGH"
    if kd and not fa:
        return "KD", "HIGH"
    if fa and kd:
        return "MANUAL", "conflict"
    return "MANUAL", "not_stated"


# ─────────────────────────────────────────────────────────────
# MAIN DECISION FUNCTION
# ─────────────────────────────────────────────────────────────

def _is_single_panel_under_5x5(
    canonical: Optional["CanonicalSignals"] = None,
    extraction: Optional[ExtractionResult] = None,
) -> bool:
    """
    Check if the unit (or all units) is a single-panel opening under 5 ft x 5 ft (60" x 60").
    Per GFS standard default convention:
      - Single-panel unit under 5' x 5' -> defaults to FA (fully assembled without glass installed).
      - Multi-panel or >= 5' x 5' -> defaults to KD (knocked down).
    """
    if canonical and canonical.units:
        units = canonical.units
        if len(units) == 1:
            u = units[0]
            w = u.width_inches or (u.diameter_inches if hasattr(u, 'diameter_inches') else None)
            l = u.length_inches or (u.diameter_inches if hasattr(u, 'diameter_inches') else None)
            pc = u.panel_count or 1
            if pc == 1 and w is not None and l is not None:
                return (w <= 60.0 and l <= 60.0)
        return False

    if extraction and extraction.measurements:
        meas = [m for m in extraction.measurements if (m.width_inches or m.length_inches)]
        if len(meas) == 1:
            m = meas[0]
            w = m.width_inches
            l = m.length_inches
            pc = m.panel_count or 1
            if pc == 1 and w is not None and l is not None:
                return (w <= 60.0 and l <= 60.0)
    return False


def _get_assembly_flag(assembly_type: str, assembly_conf: str) -> list[str]:
    """Return the estimator flag for assembly type."""
    if assembly_conf == "defaulted_FA":
        return [
            "Assembly type (FA vs KD) not stated in documents — "
            "defaulting to FA (fully assembled without glass installed) for single-panel unit under 5 ft x 5 ft. "
            "Estimator must confirm."
        ]
    elif assembly_conf == "defaulted_KD":
        return [
            "Assembly type (FA vs KD) not stated in documents — "
            "defaulting to KD (knocked down) per GFS standard default. "
            "Estimator must confirm."
        ]
    elif assembly_conf == "conflict":
        return [
            "Both FA and KD signals found — conflict. Estimator must resolve."
        ]
    return []

def decide_frame_type(
    extraction: ExtractionResult,
    glass_result: GlassTypeResult,
    canonical: Optional[CanonicalSignals] = None,
) -> FrameTypeResult:
    """
    Rule 3 — Frame Type Selection.
    Unified Decision Tree sequence per GFS Frame Decision Tree diagram:
    Product Type → Custom Radius Shape → Panel Configuration → Mounting Type → Frame Type
    """
    flags = []
    reasoning = []
    text = _collect_text(extraction)

    # ── Step 0: Special Glass Types ──────────────────────────────────────
    if glass_result.glass_type_code == "MANUAL":
        reasoning.append("Rule 2 returned MANUAL — frame cannot be determined")
        return FrameTypeResult(
            frame_type_code="MANUAL",
            workbook_row_name=None,
            confidence=compute_rule_confidence("MANUAL"),
            flags=["Glass type is MANUAL — frame type also requires manual input"],
            reasoning=reasoning,
        )

    if glass_result.glass_type_code == "GLASS_ONLY":
        reasoning.append("Glass-only replacement — frame left blank")
        return FrameTypeResult(
            frame_type_code="BLANK",
            workbook_row_name=None,
            assembly_type="MANUAL",
            proposal_number=9,
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            flags=["Glass-only replacement — frame section intentionally blank"],
            reasoning=reasoning,
        )

    if glass_result.glass_type_code == "MGDS":
        reasoning.append("MGDS catalog order → Deck Perimeter auto-assigned")
        return FrameTypeResult(
            frame_type_code="DECK_PERIMETER",
            workbook_row_name="Deck perimeter",
            assembly_type="MANUAL",
            proposal_number=11,
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            flags=["MGDS catalog order — Deck Perimeter auto-assigned from SKU"],
            reasoning=reasoning,
        )

    if glass_result.glass_type_code == "STAIR_TREAD":
        reasoning.append("Stair treads — no frame row, Proposal 10")
        return FrameTypeResult(
            frame_type_code="BLANK",
            workbook_row_name=None,
            assembly_type="MANUAL",
            proposal_number=10,
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            flags=["Stair tread — no frame row filled"],
            reasoning=reasoning,
        )

    _canon_ext = canonical.get_glass("is_exterior") if canonical else None
    is_exterior = (_canon_ext.is_true()) if (_canon_ext and _canon_ext.value is not None) else _has(text, ["skylight", "roof", "exterior", "curb"])

    # ── Product Type split per Decision Tree diagram (source of truth) ──
    # PRODUCT TYPE → GLASS ONLY (handled above) / SKYLIGHT (is_exterior)
    # / Interior Floor (not exterior). No glass-type gate here — the diagram
    # branches on product + conditioned/existing/custom, not on glass code.
    is_interior_floor = not is_exterior

    _canon_cond = canonical.get_glass("has_conditioned_space_below") if canonical else None
    has_conditioned = (_canon_cond.is_true()) if (_canon_cond and _canon_cond.value is not None) else _has(text, _CONDITIONED_SPACE_TERMS)

    _canon_existing = canonical.get_frame("is_existing_structure") if canonical else None
    has_existing = (_canon_existing.is_true()) if (_canon_existing and _canon_existing.value is not None) else _has(text, _EXISTING_STRUCTURE_TERMS)

    _canon_ft = canonical.get_frame("frame_type_stated") if canonical else None
    is_econoframe = ((_canon_ft is not None and str(_canon_ft.value).upper() == "ECONOFRAME") or _has(text, ["econoframe", "eframe", "e-frame"]))
    has_existing_structure = bool(has_existing or is_econoframe)

    is_custom_shape = _detect_custom_shape(extraction, canonical)

    # ── Interior Floor Branch (diagram, source of truth) ─────────────
    # Conditioned below? NO → MODIFIED SERIES 1000 (hard terminal).
    # YES → existing? NO → custom? NO → PERIMETER_NON_TB ("non-thermally
    #   broken interior"), YES → CUSTOM_ROLLED_STEEL.
    # YES → existing? YES → custom? NO → ECONOFRAME, YES → CUSTOM.
    if is_interior_floor:
        reasoning.append("Interior Floor product type")

        if not has_conditioned:
            reasoning.append("Interior Floor + no conditioned space below → Modified Series 1000")
            install_type, _ = _detect_install_type(text, canonical)
            assembly_type, _ = _detect_assembly(text, canonical)
            return FrameTypeResult(
                frame_type_code="MODIFIED_SERIES_1000",
                workbook_row_name="Series 1000 Pedestal thermally broken",
                install_type=install_type or "RECESSED",
                assembly_type=assembly_type,
                proposal_number=None,
                confidence=compute_rule_confidence("MEDIUM"),
                flags=["Interior Floor — no conditioned space below → Modified Series 1000"],
                reasoning=reasoning,
            )

        # Conditioned space below = YES
        if not has_existing_structure:
            if is_custom_shape:
                reasoning.append("Interior Floor + conditioned + no existing + custom radius → Custom Rolled Steel")
                return FrameTypeResult(
                    frame_type_code="CUSTOM_ROLLED_STEEL",
                    workbook_row_name="Custom fab",
                    frame_variant="Custom Rolled Steel",
                    assembly_type="MANUAL",
                    proposal_number=None,
                    confidence=compute_rule_confidence("HIGH", glass_result.confidence),
                    flags=[
                        "Custom shape surcharge applies ($0.40/sqft) — Rule 5 will flag",
                        "Custom shape — Custom Rolled Steel framing auto-assigned per Decision Tree",
                    ],
                    reasoning=reasoning,
                )
            reasoning.append("Interior Floor + conditioned space + new structure → Perimeter NTB")
            install_type, _ = _detect_install_type(text, canonical)
            assembly_type, _ = _detect_assembly(text, canonical)
            return FrameTypeResult(
                frame_type_code="PERIMETER_NON_TB",
                workbook_row_name="Perimeter non thermally broken",
                install_type=install_type or "RECESSED",
                assembly_type=assembly_type,
                proposal_number=None,
                confidence=compute_rule_confidence("MEDIUM"),
                flags=["Interior Floor + conditioned space + new structure → Perimeter NTB"],
                reasoning=reasoning,
            )

        # Existing support structure = YES
        if is_custom_shape:
            reasoning.append("Interior Floor + conditioned + existing + custom radius → Custom Rolled Steel")
            return FrameTypeResult(
                frame_type_code="CUSTOM_ROLLED_STEEL",
                workbook_row_name="Custom fab",
                frame_variant="Custom Rolled Steel",
                assembly_type="MANUAL",
                proposal_number=None,
                confidence=compute_rule_confidence("HIGH", glass_result.confidence),
                flags=[
                    "Custom shape surcharge applies ($0.40/sqft) — Rule 5 will flag",
                    "Custom shape — Custom Rolled Steel framing auto-assigned per Decision Tree",
                ],
                reasoning=reasoning,
            )
        cut_to_size = _has(text, _CUT_TO_SIZE_TERMS)
        prop_num = 8 if cut_to_size else 7
        reasoning.append("Interior Floor + conditioned space + existing structure → EconoFrame")
        return FrameTypeResult(
            frame_type_code="ECONOFRAME",
            workbook_row_name="Econoframe - lengths",
            frame_variant=f"eFrame {'CUT_TO_SIZE' if cut_to_size else 'GASKET'}",
            install_type=None,
            assembly_type="MANUAL",
            proposal_number=prop_num,
            confidence=compute_rule_confidence("HIGH" if is_econoframe else "MEDIUM"),
            flags=["Interior Floor + conditioned space + existing structure → EconoFrame"],
            reasoning=reasoning,
        )

    # ── Step 4: Skylight Branch (Walkable / Non-Walkable) ─────────────────
    # Sequence: Panel Configuration → Mounting Type → Frame Type
    panel_count = None
    if canonical is not None:
        for unit in (getattr(canonical, "units", None) or []):
            pc = getattr(unit, "panel_count", None)
            if pc is not None:
                panel_count = pc
                break
    if panel_count is None:
        if re.search(r'\b(multi-panel|multi panel|2 panel|3 panel|4 panel|[2-9]\s*panel)\b', text, re.I):
            panel_count = 2
        elif re.search(r'\b(single panel|single-panel|1 panel)\b', text, re.I):
            panel_count = 1

    is_single_panel = (panel_count == 1) or (panel_count is None)
    install_type, install_conf = _detect_install_type(text, canonical)
    assembly_type, assembly_conf = _detect_assembly(text, canonical)

    # Apply GFS standard assembly default: FA if single-panel <= 5'x5', else KD
    if assembly_type in ("MANUAL", None):
        if _is_single_panel_under_5x5(canonical, extraction):
            assembly_type = "FA"
            assembly_conf = "defaulted_FA"
        else:
            assembly_type = "KD"
            assembly_conf = "defaulted_KD"

    assembly_flag = _get_assembly_flag(assembly_type, assembly_conf)

    # ── Skylight Branch (diagram, source of truth) ───────────────────
    # WALKABLE and NON-WALKABLE map identically:
    # SINGLE PANEL: curb → SERIES 3000, pedestal → 2000 PEDESTAL,
    #   recessed → 2000 RECESSED.
    # MULTI PANEL: curb → 2000 PEDESTAL, pedestal → 2000 PEDESTAL,
    #   recessed → 2000 RECESSED.
    # CUSTOM RADIUS SHAPE (walkable or non-walkable) → CUSTOM_ROLLED_STEEL.
    if is_custom_shape:
        reasoning.append("Skylight + custom radius shape → Custom Rolled Steel")
        return FrameTypeResult(
            frame_type_code="CUSTOM_ROLLED_STEEL",
            workbook_row_name="Custom fab",
            frame_variant="Custom Rolled Steel",
            assembly_type="MANUAL",
            proposal_number=None,
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            flags=[
                "Custom shape surcharge applies ($0.40/sqft) — Rule 5 will flag",
                "Custom shape — Custom Rolled Steel framing auto-assigned per Decision Tree",
            ],
            reasoning=reasoning,
        )

    is_curb_mounted = _has(text, ["curb mount", "curb-mount", "curb mounted", "curb-mounted"]) or (install_type == "CURB_MOUNTED")
    if is_curb_mounted and is_single_panel:
        reasoning.append("Single Panel + Curb Mounted Skylight → Series 3000")
        return FrameTypeResult(
            frame_type_code="SERIES_3000",
            workbook_row_name="Series 3000",
            assembly_type=assembly_type,
            proposal_number=None,
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            flags=["Single Panel Curb Mounted Skylight → Series 3000"] + assembly_flag,
            reasoning=reasoning,
        )
    if is_curb_mounted and not is_single_panel:
        reasoning.append("Multi Panel + Curb Mounted Skylight → Series 2000 Pedestal")
        proposal_num = _get_proposal("SERIES_2000", "PEDESTAL", assembly_type)
        return FrameTypeResult(
            frame_type_code="SERIES_2000_PEDESTAL",
            workbook_row_name="Series 2000 Pedestal",
            install_type="PEDESTAL",
            assembly_type=assembly_type,
            proposal_number=proposal_num,
            confidence=compute_rule_confidence("MEDIUM", install_conf, assembly_conf, glass_result.confidence),
            flags=["Multi Panel Curb Mounted Skylight → Series 2000 Pedestal per Decision Tree"] + assembly_flag,
            reasoning=reasoning,
        )

    install_flag = []
    if install_conf == "LOW":
        install_flag = [
            "Install type not stated — defaulting to Pedestal per GFS guidance. "
            "Estimator must confirm."
        ]

    if install_type == "RECESSED":
        reasoning.append("Skylight + Recessed Mount → Series 2000 Recessed")
        proposal_num = _get_proposal("SERIES_2000", "RECESSED", assembly_type)
        return FrameTypeResult(
            frame_type_code="SERIES_2000_RECESSED",
            workbook_row_name="Series 2000 Recessed",
            install_type="RECESSED",
            assembly_type=assembly_type,
            proposal_number=proposal_num,
            confidence=compute_rule_confidence("HIGH" if install_conf == "HIGH" else "MEDIUM", install_conf, assembly_conf, glass_result.confidence),
            flags=[
                "Series 2000 Recessed per Decision Tree (Skylight + Recessed Mount).",
            ] + install_flag + assembly_flag,
            reasoning=reasoning,
        )

    # Pedestal (Default per GFS)
    reasoning.append("Skylight + Pedestal Mount → Series 2000 Pedestal")
    proposal_num = _get_proposal("SERIES_2000", "PEDESTAL", assembly_type)
    return FrameTypeResult(
        frame_type_code="SERIES_2000_PEDESTAL",
        workbook_row_name="Series 2000 Pedestal",
        install_type="PEDESTAL",
        assembly_type=assembly_type,
        proposal_number=proposal_num,
        confidence=compute_rule_confidence("HIGH" if install_conf == "HIGH" else "MEDIUM", install_conf, assembly_conf, glass_result.confidence),
        flags=[
            "Series 2000 Pedestal per Decision Tree (Skylight + Pedestal Mount).",
        ] + install_flag + assembly_flag,
        reasoning=reasoning,
    )
