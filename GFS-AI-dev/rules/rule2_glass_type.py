"""
Rule 2 — Glass Type Decision Tree
===================================
Validated against:
  - Rules Engine Reference Doc v2 (June 1 2026) + GFS client responses
  - Master Workbook template (rows confirmed June 2026)
  - Projects: 182 Robinson, Baldwin Farm, Avalon, 379 13th, Spring Lake,
               464 Greenwich, 4 Jane St, Mill Hill, Alana Ln

Workbook rows this rule targets:
  Row  9  Glass - no IGU
  Row 10  Glass - with IGU
  Row 11  Glass 2.0 system
  Row 12  Stair treads - post lamination polish
  Row 13  Non-Walkable glass
  Row 14  EGR

Proposal Description rows (Row 127-142):
   1  Series 1000 Pedestal TB - FA
   2  Series 1000 Pedestal TB - KD
   3  Series 1000 Recessed TB - FA
   4  Series 1000 Recessed TB - KD
   5  Series 1000 Recessed interior - FA
   6  Series 1000 Recessed interior - KD
   7  eFrame and Gasket
   8  eFrame cut to size
   9  Just Glass
  10  Stair Treads with post lami polish
  11  Deck
  12  Series 2000 Pedestal TB - FA
  13  Series 2000 Pedestal TB - KD
  14  Series 2000 Recessed TB - FA
  15  Series 2000 Recessed TB - KD

Rule 2 returns glass_type_code + proposal_candidates.
Final Proposal Description selection happens AFTER Rule 3 adds
install_type (pedestal/recessed/interior) and assembly (FA/KD).

SOURCE HIERARCHY (used when writing/changing this file):
  1. Actual project data + approved Excel workbook (ground truth)
  2. Rules Engine Reference Doc v2 + GFS client responses (confirmed rules)
  3. Flag for client question if neither resolves it
"""

from dataclasses import dataclass, field
from typing import Optional
import re

from extraction.models import ExtractionResult
from extraction.canonical import CanonicalSignals   # canonical-first signals
from rules.rule_confidence import compute_rule_confidence


# ─────────────────────────────────────────────────────────────
# SIGNAL VOCABULARY
# These are the terms captured by the AI extraction layer.
# Add new terms here — never change the decision logic for vocabulary.
# ─────────────────────────────────────────────────────────────

# Special type overrides — checked first, strongest signals
_GLASS_ONLY_TERMS = [
    "replacement", "glass only", "glass replacement", "replace glass",
    "replace the glass", "broken panel", "broke the", "broke a panel",
    "cracked panel", "replace panel", "just glass", "glass-only",
]

_MGDS_TERMS = [
    "mgds", "GFS32X", "GFS48X", "skyfloor catalog",
]
_MGDS_SKU_PATTERN = re.compile(r'GFS\d+X\d+', re.IGNORECASE)

_STAIR_TREAD_TERMS = [
    "stair tread", "stair treads", "staircase glass",
    "glass tread", "glass treads", "glass stair",
]

_EGR_TERMS = [
    "egr",
]

# Walkability signals
_NON_WALKABLE_TERMS = [
    "non-walkable", "non walkable", "not walkable", "non-walk",
    "skylight only", "curb mounted", "curb-mounted",
    "non-structural skylight", "decorative skylight",
]
_WALKABLE_TERMS = [
    "walkable", "walk-on", "walk on", "walk over", "walk-over",
    "glass floor", "glass flooring", "glass deck", "glass bridge",
    "interior glass floor", "interior flooring",
    "WALK-ON SKYLIGHT",  # from architect drawings
]

# Location context — interior vs exterior
_INTERIOR_TERMS = [
    "interior", "inside", "indoors", "interior glass",
    "interior floor", "interior flooring", "interior recessed",
    "above kitchen", "above living", "above bedroom", "above dining",
    "above bathroom", "above office", "above hallway",
    "open below", "open space below",
    "FINISHED INTERIOR", "FIN. INT.", "F.I.",  # drawing labels
    "interior recessed", "recessed interior",
]
_EXTERIOR_TERMS = [
    "exterior", "outside", "outdoors", "roof", "rooftop",
    "roof terrace", "roof deck", "outdoor", "open air",
    "skylight", "above roof", "on roof",
]

# What is below — used to determine IGU requirement
_WINE_CELLAR_TERMS = [
    "wine cellar", "wine room", "wine storage", "wine vault",
    "temperature controlled", "climate controlled wine",
]
_OPEN_BELOW_TERMS = [
    "open below", "open space below", "atrium", "double height",
    "two story", "two-story", "2 story", "void below", "open air below",
    "open stairwell",
]
_CONDITIONED_SPACE_TERMS = [
    "kitchen", "living room", "dining room", "bedroom",
    "bathroom", "office", "hallway", "conditioned",
    "heated space", "hvac", "air conditioned", "living space",
    "conditioned space", "habitable",
]

# Series signals — when customer states explicitly
_SERIES_2000_TERMS = [
    "series 2000", "series2000", "2000 series",
]

_GLASS_2_0_TERMS = [
    "glass 2.0", "2.0 system",
]

_SERIES_1000_TERMS = [
    "series 1000", "series1000", "1000 series",
]
_ECONOFRAME_TERMS = [
    "econoframe", "eframe", "e-frame", "ecoframe",
    "e frame", "ecoframe",
]
_DECK_TERMS = [
    "deck", "glass deck", "deck system", "deck perimeter",
    "new deck", "deck from scratch", "outdoor deck",
]

# IGU explicit signal
_IGU_TERMS = [
    "igu", "with igu", "insulated glass unit", "double pane",
    "double glazed", "thermally broken glass", "gu glass",
]
_THERMALLY_BROKEN_TERMS = [
    "thermally broken", "tb", "thermal break", "thermally-broken",
    "avoid condensation", "prevent condensation",
]


# ─────────────────────────────────────────────────────────────
# OUTPUT MODEL
# ─────────────────────────────────────────────────────────────

@dataclass
class GlassTypeResult:
    """
    Output of Rule 2. Consumed by Rule 3 (frame type) and the
    Proposal Description selector.

    glass_type_code   Internal code for this decision.
    workbook_row_name The exact row label as it appears in the workbook.
                      None = leave glass section blank (glass-only replacement).
    proposal_candidates  Possible Proposal Description numbers (1-15).
                      Narrowed to final selection after Rule 3 adds
                      install_type and assembly_type.
    egr_secondary     True = also mark EGR row. Secondary flag only.
    confidence        HIGH / MEDIUM / LOW / MANUAL
    flags             Plain English notes for estimator review.
    reasoning         Decision steps taken — for audit trail.
    """

    glass_type_code: str           # GLASS_NO_IGU | GLASS_WITH_IGU | GLASS_2_0
                                   # STAIR_TREAD | NON_WALKABLE | EGR
                                   # GLASS_ONLY | MGDS | MANUAL

    workbook_row_name: Optional[str]  # Exact label from workbook Row 9-14

    proposal_candidates: list[int] = field(default_factory=list)

    egr_secondary: bool = False

    confidence: Optional[int] = None

    flags: list[str] = field(default_factory=list)

    reasoning: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# SIGNAL DETECTION HELPERS
# These look inside ExtractionResult — no GFS logic here,
# just vocabulary matching against what AI extracted.
# ─────────────────────────────────────────────────────────────

def _collect_text(extraction: ExtractionResult) -> str:
    """
    Pool all verbatim text from explicit_statements and
    measurement contexts into one lowercase string.
    Rules engine checks signals against this.
    """
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
    for a in extraction.addresses:
        if a.context:
            parts.append(a.context.lower())
    return " ".join(parts)


def _has_any(text: str, terms: list[str]) -> bool:
    return any(re.search(r'\b' + re.escape(t.lower()), text) for t in terms)


def _find_match(text: str, terms: list[str]) -> Optional[str]:
    for t in terms:
        if re.search(r'\b' + re.escape(t.lower()), text):
            return t
    return None


def _is_canadian_address(extraction: ExtractionResult) -> bool:
    """
    Canadian addresses → 5.5% duty rule.
    Checks all addresses for Canadian province codes or postal format.
    """
    ca_provinces = [
        " on ", " bc ", " ab ", " qc ", " sk ", " mb ",
        " ns ", " nb ", " pe ", " nl ", " yt ", " nt ", " nu ",
        "ontario", "british columbia", "alberta", "quebec",
        "ontario,", "canada",
    ]
    for addr in extraction.addresses:
        if addr.value:
            v = addr.value.lower()
            if any(p in v for p in ca_provinces):
                return True
            # Canadian postal code pattern: A1A 1A1
            if re.search(r'[a-z]\d[a-z]\s*\d[a-z]\d', v):
                return True
    return False


# ─────────────────────────────────────────────────────────────
# MAIN DECISION FUNCTION
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# UNIFIED SIGNAL EXTRACTION & DECISION TREE
# ─────────────────────────────────────────────────────────────

@dataclass
class _Rule2Signals:
    is_no_input: bool = False
    is_replacement: bool = False
    is_mgds: bool = False
    mgds_sku: Optional[str] = None
    is_stair_tread: bool = False
    is_econoframe: bool = False
    is_egr: bool = False
    is_non_walkable: bool = False
    is_walkable: Optional[bool] = None
    is_exterior: Optional[bool] = None
    is_interior: Optional[bool] = None
    has_air_gap: Optional[bool] = None
    has_conditioned: Optional[bool] = None
    is_wine_cellar: bool = False
    has_open_below: bool = False
    is_glass_2_0: bool = False
    is_thermally_broken: Optional[bool] = None
    series_stated: Optional[str] = None
    # IGU detected in a glass makeup string (Row 7 of the decision table).
    # Tracked separately from an explicitly named "Series 2000" frame.
    igu_in_makeup: bool = False
    source: str = "text"


def _extract_signals(
    extraction: ExtractionResult,
    canonical: Optional[CanonicalSignals] = None,
) -> _Rule2Signals:
    sig = _Rule2Signals()
    if canonical is not None:
        sig.source = "canonical"
        # 1. EGR
        egr = canonical.get_glass("is_egr")
        if egr and egr.is_true(): sig.is_egr = True

        # 2. Replacement
        repl = canonical.get_glass("is_replacement_glass_only")
        if repl and repl.is_true(): sig.is_replacement = True

        # 3. Stair tread
        stair = canonical.get_glass("is_stair_tread")
        if stair and stair.is_true(): sig.is_stair_tread = True

        # 4. EconoFrame
        ft = canonical.get_frame("frame_type_stated")
        if ft and str(ft.value).upper() == "ECONOFRAME": sig.is_econoframe = True

        # 5. Walkability
        walk = canonical.get_glass("is_walkable")
        if walk is not None and walk.value is not None:
            sig.is_walkable = walk.is_true()
            sig.is_non_walkable = walk.is_false()

        # 6. Location & Air gap
        ext = canonical.get_glass("is_exterior")
        if ext is not None and ext.value is not None:
            sig.is_exterior = ext.is_true()
            sig.is_interior = ext.is_false()

        gap = canonical.get_glass("has_air_gap")
        if gap is not None and gap.value is not None:
            sig.has_air_gap = gap.is_true()
            if gap.is_true():
                sig.igu_in_makeup = True

        cond = canonical.get_glass("has_conditioned_space_below")
        if cond is not None and cond.value is not None:
            sig.has_conditioned = cond.is_true()
            
        g20 = canonical.get_glass("is_glass_2_0")
        if g20 and g20.is_true(): sig.is_glass_2_0 = True
        
        if canonical.get_frame("is_thermally_broken"):
            tb = canonical.get_frame("is_thermally_broken")
            if tb.is_stated():
                sig.is_thermally_broken = tb.value

    # Text fallback / supplementation
    text = _collect_text(extraction)
    if extraction.extraction_status == "NO_CUSTOMER_INPUT":
        sig.is_no_input = True

    if not sig.is_replacement and _find_match(text, _GLASS_ONLY_TERMS):
        sig.is_replacement = True

    mgds_m = _find_match(text, _MGDS_TERMS)
    sku_m = _MGDS_SKU_PATTERN.search(text)
    if mgds_m or sku_m:
        sig.is_mgds = True
        sig.mgds_sku = sku_m.group(0) if sku_m else "unknown"

    if not sig.is_stair_tread and _find_match(text, _STAIR_TREAD_TERMS):
        sig.is_stair_tread = True

    if not sig.is_egr and _has_any(text, _EGR_TERMS):
        sig.is_egr = True

    if not sig.is_econoframe and _has_any(text, _ECONOFRAME_TERMS):
        sig.is_econoframe = True

    if sig.is_walkable is None:
        if _has_any(text, _NON_WALKABLE_TERMS):
            sig.is_non_walkable = True
            sig.is_walkable = False
        elif _has_any(text, _WALKABLE_TERMS):
            sig.is_walkable = True
            sig.is_non_walkable = False

    if sig.is_exterior is None:
        int_match = _has_any(text, _INTERIOR_TERMS)
        ext_match = _has_any(text, _EXTERIOR_TERMS)
        if ext_match and not int_match:
            sig.is_exterior = True
            sig.is_interior = False
        elif int_match and not ext_match:
            sig.is_interior = True
            sig.is_exterior = False
        elif int_match and ext_match:
            # Exterior skylight with interior conditioned room below
            sig.is_exterior = True
            sig.is_interior = True

    if _has_any(text, _WINE_CELLAR_TERMS): sig.is_wine_cellar = True
    if _has_any(text, _OPEN_BELOW_TERMS): sig.has_open_below = True
    if _has_any(text, _CONDITIONED_SPACE_TERMS): sig.has_conditioned = True
    if _has_any(text, _GLASS_2_0_TERMS): sig.is_glass_2_0 = True

    # IGU in a makeup string (Row 7) is glass evidence, not a frame
    # statement — it no longer implies series_stated.
    if _has_any(text, _IGU_TERMS):
        sig.igu_in_makeup = True

    if _has_any(text, _SERIES_2000_TERMS):
        sig.series_stated = "SERIES_2000"
    elif _has_any(text, _SERIES_1000_TERMS):
        sig.series_stated = "SERIES_1000"

    return sig


def decide_glass_type(
    extraction: ExtractionResult,
    canonical: Optional[CanonicalSignals] = None,
) -> GlassTypeResult:
    """
    Rule 2 — Glass Type Decision Tree.
    Single unified decision tree for both Canonical and Text extraction sources.
    """
    sig = _extract_signals(extraction, canonical)
    reasoning: list[str] = [f"[{sig.source}] Unified Rule 2 decision tree execution"]

    # Step 0: No input
    if sig.is_no_input:
        reasoning.append("No customer input found in documents")
        return GlassTypeResult(
            glass_type_code="MANUAL",
            workbook_row_name=None,
            proposal_candidates=[],
            confidence=compute_rule_confidence("MANUAL"),
            flags=["No customer documents found — all fields require manual input"],
            reasoning=reasoning,
        )

    # Step 1: Replacement glass only
    if sig.is_replacement:
        reasoning.append("Replacement glass only detected")
        return GlassTypeResult(
            glass_type_code="GLASS_ONLY",
            workbook_row_name=None,
            proposal_candidates=[9],
            confidence=compute_rule_confidence("HIGH"),
            flags=["Glass-only replacement — frame section left blank (correct, not missing)"],
            reasoning=reasoning,
        )

    # Step 2: MGDS catalog order
    if sig.is_mgds:
        reasoning.append(f"MGDS catalog order detected: SKU={sig.mgds_sku}")
        return GlassTypeResult(
            glass_type_code="MGDS",
            workbook_row_name="Glass - no IGU",
            proposal_candidates=[11],
            confidence=compute_rule_confidence("HIGH"),
            flags=[f"MGDS catalog order — SKU {sig.mgds_sku}"],
            reasoning=reasoning,
        )

    # Step 3: Stair tread
    if sig.is_stair_tread:
        reasoning.append("Stair tread application detected")
        return GlassTypeResult(
            glass_type_code="STAIR_TREAD",
            workbook_row_name="Stair treads - post lamination polish",
            proposal_candidates=[10],
            confidence=compute_rule_confidence("HIGH"),
            flags=["Stair tread application — titanium embeds required (min 4 per tread)"],
            reasoning=reasoning,
        )

    # Step 4: EconoFrame explicit
    if sig.is_econoframe:
        reasoning.append("EconoFrame explicitly stated")
        return GlassTypeResult(
            glass_type_code="GLASS_NO_IGU",
            workbook_row_name="Glass - no IGU",
            proposal_candidates=[7, 8],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH"),
            flags=["EconoFrame stated — glass no IGU confirmed."],
            reasoning=reasoning,
        )

    # Step 5: Non-walkable
    if sig.is_non_walkable:
        reasoning.append("Non-walkable detected")
        return GlassTypeResult(
            glass_type_code="NON_WALKABLE",
            workbook_row_name="Non-Walkable glass",
            proposal_candidates=[],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH"),
            flags=["Non-walkable glass — Series 3000 framing (Rule 3 will confirm)"],
            reasoning=reasoning,
        )

    # Step 6: Walkability check
    if sig.is_walkable is not True:
        reasoning.append("Walkability not confirmed in documents")
        return GlassTypeResult(
            glass_type_code="MANUAL",
            workbook_row_name=None,
            proposal_candidates=[],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("MANUAL"),
            flags=["Cannot determine walkability from documents — estimator must confirm"],
            reasoning=reasoning,
        )

    reasoning.append("Walkable confirmed")

    # Step 6.5: Explicitly Stated Series / Glass Types
    if sig.is_glass_2_0:
        reasoning.append("Glass 2.0 explicitly stated")
        return GlassTypeResult(
            glass_type_code="GLASS_2_0",
            workbook_row_name="Glass 2.0 system",
            proposal_candidates=[5, 6],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH"),
            flags=["Glass 2.0 explicitly stated"],
            reasoning=reasoning,
        )

    # Explicitly named "Series 2000" frame (not an IGU makeup string —
    # that is tracked separately as igu_in_makeup for Row 7). The decision
    # table is silent on explicit frame naming, so the prior WITH_IGU
    # mapping is preserved here.
    if sig.series_stated == "SERIES_2000":
        reasoning.append("Series 2000 explicitly stated")
        return GlassTypeResult(
            glass_type_code="GLASS_WITH_IGU",
            workbook_row_name="Glass - with IGU",
            proposal_candidates=[5, 6, 7, 8],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH"),
            flags=["Series 2000 explicitly stated"],
            reasoning=reasoning,
        )

    # Step 7: Walkable + Interior paths
    if sig.is_interior and not sig.is_exterior:
        if sig.is_wine_cellar:
            reasoning.append("Interior + wine cellar below → Glass 2.0")
            return GlassTypeResult(
                glass_type_code="GLASS_2_0",
                workbook_row_name="Glass 2.0 system",
                proposal_candidates=[5, 6],
                egr_secondary=sig.is_egr,
                confidence=compute_rule_confidence("MEDIUM"),
                flags=["Wine cellar detected — Glass 2.0 for thermal barrier"],
                reasoning=reasoning,
            )

        # Interior + open/conditioned space below → Glass No IGU
        reasoning.append("Interior context → Glass No IGU")
        return GlassTypeResult(
            glass_type_code="GLASS_NO_IGU",
            workbook_row_name="Glass - no IGU",
            proposal_candidates=[5, 6, 7, 8],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH" if (sig.has_open_below or sig.has_conditioned) else "MEDIUM"),
            flags=[] if (sig.has_open_below or sig.has_conditioned) else ["Interior context but 'what is below' not explicitly confirmed"],
            reasoning=reasoning,
        )

    # Step 8: Walkable + Exterior paths
    if sig.is_exterior:
        if sig.is_thermally_broken is False:
            reasoning.append("Explicitly requested non-thermally broken system → Glass No IGU")
            return GlassTypeResult(
                glass_type_code="GLASS_NO_IGU",
                workbook_row_name="Glass - no IGU",
                proposal_candidates=[1, 2, 3, 4],
                egr_secondary=sig.is_egr,
                confidence=compute_rule_confidence("HIGH"),
                flags=["Exterior but explicitly non-thermally broken → no IGU"],
                reasoning=reasoning,
            )

        if sig.has_open_below and not sig.has_conditioned:
            reasoning.append("Exterior + open space below → Glass No IGU")
            return GlassTypeResult(
                glass_type_code="GLASS_NO_IGU",
                workbook_row_name="Glass - no IGU",
                proposal_candidates=[1, 2, 3, 4],
                egr_secondary=sig.is_egr,
                confidence=compute_rule_confidence("MEDIUM"),
                flags=["Exterior + open below → no IGU"],
                reasoning=reasoning,
            )

        # Row 6: Exterior + conditioned space below (any wall condition)
        # → Glass 2.0 system, Series 2000 DEFAULT.
        reasoning.append("Exterior + conditioned space below → Glass 2.0 (Series 2000 default)")
        return GlassTypeResult(
            glass_type_code="GLASS_2_0",
            workbook_row_name="Glass 2.0 system",
            proposal_candidates=[12, 13, 14, 15],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("HIGH" if sig.has_conditioned else "MEDIUM"),
            flags=[] if sig.has_conditioned else ["Exterior context — below unknown, defaulting to Glass 2.0 per Row 6. Estimator must confirm."],
            reasoning=reasoning,
        )

    # Row 7: IGU = YES detected in glass makeup string + walkable
    # → Glass 2.0 system. Evaluated after Rows 3–6 per table order, so an
    # explicit below-condition (open/conditioned) already won above.
    if sig.igu_in_makeup:
        reasoning.append("IGU detected in glass makeup string + walkable → Glass 2.0")
        return GlassTypeResult(
            glass_type_code="GLASS_2_0",
            workbook_row_name="Glass 2.0 system",
            proposal_candidates=[5, 6, 12, 13, 14, 15],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("MEDIUM"),
            flags=["IGU makeup detected — Glass 2.0 per Row 7. Estimator must confirm location context."],
            reasoning=reasoning,
        )

    if sig.series_stated == "SERIES_1000":
        reasoning.append("Series 1000 explicitly stated")
        return GlassTypeResult(
            glass_type_code="GLASS_NO_IGU",
            workbook_row_name="Glass - no IGU",
            proposal_candidates=[1, 2, 3, 4, 5, 6],
            egr_secondary=sig.is_egr,
            confidence=compute_rule_confidence("MEDIUM"),
            flags=["Series 1000 stated — IGU vs no IGU requires estimator confirmation"],
            reasoning=reasoning,
        )

    # Fallback: context unclear — default to GLASS_NO_IGU (conservative safe default)
    reasoning.append("Walkable context unclear — defaulting to GLASS_NO_IGU")
    return GlassTypeResult(
        glass_type_code="GLASS_NO_IGU",
        workbook_row_name="Glass - no IGU",
        proposal_candidates=[5, 6, 7, 8],
        egr_secondary=sig.is_egr,
        confidence=compute_rule_confidence("LOW"),
        flags=["Walkable confirmed but interior/exterior context not found — estimator must confirm glass type"],
        reasoning=reasoning,
    )
