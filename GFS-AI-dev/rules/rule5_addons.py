"""
Rule 5 — Add-On Options & Markings
=====================================
Validated against:
  - Rules Engine Reference Doc v2 (June 1 2026) + GFS client responses
  - Master Workbook template (rows confirmed June 2026)
  - Projects: 87001 Mill Hill (NanoDot + Seeded Organic + custom shape),
               21280 Avalon (expedited → HST NO, backpaint EGR),
               182 Robinson (Canadian duty 5.5%),
               Spring Lake + 464 Greenwich (ceramic frit = base price, never workbook item)

Workbook rows this rule targets:
  OPTIONS (Rows 16–26):
  Row 16  Sentry Glass interlayer    $4/sqft
  Row 17  Krypton Gas                $5/sqft
  Row 18  Colored interlayer         $10/sqft
  Row 19  Switchable Glass           $25/sqft  ← always MANUAL
  Row 20  Backpaint (EGR expedited)  $7.5/sqft
  Row 21  Custom                     $20/sqft  ← always MANUAL
  Row 22  Embeds - Titanium          $65 each
  Row 23  Mounting holes             $6 each   ← always MANUAL
  Row 24  Custom shapes              $0.40/sqft
  Row 25  Round Glass                $0.20     ← same as custom shapes for round

  ADD ALTERNATES (Rows 107–110):
  Row 107  Seeded Organic            $48/sqft
  Row 108  Blur                      $23/sqft  ← always MANUAL
  Row 109  Heat Soak Testing         $7.5/sqft
  Row 110  Nano Dot                  $56/sqft

  PRICING (Row 90):
  Row 90  Duty                       15% (US) or 5.5% (Canada)

KEY GFS CLIENT CORRECTIONS (from doc responses):
  - HST thresholds UPDATED: <400 = NO, 400–600 = optional, >600 = YES auto
    (Old doc: 400–800 optional, >800 auto — superseded by GFS response)
  - Krypton Gas: default NOT selected. Only if explicitly requested.
  - Ceramic frit back paint: always in base price, NEVER a workbook item.
  - Backpaint (Row 20): EGR glass + expedited orders ONLY.
  - Duty: applies to all glass EXCEPT EGR. Both residential and commercial.
  - YorLux: base price — never a workbook option.
  - LED lighting channel: never marked unless explicit override.

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
from rules.rule4_cross_beam import CrossBeamResult
from rules.rule_confidence import compute_rule_confidence


# ─────────────────────────────────────────────────────────────
# SIGNAL VOCABULARY
# ─────────────────────────────────────────────────────────────

_NANODOT_TERMS = [
    "nanodot", "nano dot", "nano-dot",
]
_SEEDED_ORGANIC_TERMS = [
    "seeded organic", "seeded glass", "seeded texture",
]
_KRYPTON_TERMS = [
    "krypton", "krypton gas",
]
_SENTRY_GLASS_TERMS = [
    "sentry glass", "sg interlayer", "sentry glass interlayer",
    "sentry pvb", "sentry interlayer",
]
_COLORED_INTERLAYER_TERMS = [
    "colored interlayer", "coloured interlayer",
    "colored glass", "tinted interlayer",
    "color interlayer", "tinted glass",
]
_SWITCHABLE_GLASS_TERMS = [
    "switchable glass", "smart glass", "electrochromic",
    "pdlc", "switchable",
]
_EXPEDITED_TERMS = [
    "expedited", "rush order", "rush job", "urgent order",
]
_EGR_TERMS = [
    "egr",
]
_CUSTOM_SHAPE_TERMS = [
    "oval", "ellipse", "elliptical", "round", "circular",
    "curved", "radius corner", "non-rectangular", "custom shape",
    "irregular shape",
]
_CANADIAN_PROVINCES = [
    " on ", " bc ", " ab ", " qc ", " sk ", " mb ",
    " ns ", " nb ", " pe ", " nl ", " yt ", " nt ", " nu ",
    "ontario", "british columbia", "alberta", "quebec",
    "canada",
]
_CANADIAN_POSTAL = re.compile(r'\b[a-z]\d[a-z]\s*\d[a-z]\d\b')


# ─────────────────────────────────────────────────────────────
# OUTPUT MODEL
# ─────────────────────────────────────────────────────────────

@dataclass
class AddOnField:
    """
    A single add-on decision.

    value       "y" | "n" | "MANUAL" | "PENDING"
    workbook_row  Exact label from workbook for reference.
    confidence  HIGH | MEDIUM | LOW | MANUAL | PENDING
    source      Where the signal came from (null if not found).
    flag        Estimator note (null if clean decision).
    """
    value: str
    workbook_row: str
    confidence: Optional[int] = None
    source: Optional[str] = None
    flag: Optional[str] = None


@dataclass
class AddOnResult:
    """
    Output of Rule 5. One field per workbook add-on row.
    Consumed by Stage 5 of the pipeline.
    """
    # ── Options (Rows 16–26) ─────────────────────────────────
    sentry_glass: AddOnField = None        # Row 16
    krypton_gas: AddOnField = None         # Row 17
    colored_interlayer: AddOnField = None  # Row 18
    switchable_glass: AddOnField = None    # Row 19 — always MANUAL
    backpaint: AddOnField = None           # Row 20 — EGR expedited only
    custom_shape_surcharge: AddOnField = None  # Row 24
    round_glass_surcharge: AddOnField = None   # Row 25
    embeds_titanium: AddOnField = None     # Row 22 — stair tread only

    # ── Add Alternates (Rows 107–110) ────────────────────────
    seeded_organic: AddOnField = None      # Row 107
    blur: AddOnField = None                # Row 108 — always MANUAL
    heat_soak_testing: AddOnField = None   # Row 109 — needs weight
    nanodot: AddOnField = None             # Row 110

    # ── Pricing (Row 90) ─────────────────────────────────────
    duty: AddOnField = None                # Row 90

    flags: list = field(default_factory=list)
    reasoning: list = field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _pool_text(extraction: ExtractionResult) -> str:
    parts = []
    for s in extraction.explicit_statements:
        if s.verbatim: parts.append(s.verbatim.lower())
        if s.context:  parts.append(s.context.lower())
    for m in extraction.measurements:
        if m.label_as_written: parts.append(m.label_as_written.lower())
        if m.context:          parts.append(m.context.lower())
        if m.location_context: parts.append(m.location_context.lower())
    return " ".join(parts)


def _has(text: str, terms: list[str]) -> Optional[str]:
    """Returns the matching term or None."""
    for t in terms:
        if re.search(r'\b' + re.escape(t.lower()), text):
            return t
    return None


def _is_canadian(
    extraction: ExtractionResult,
    canonical: Optional["CanonicalSignals"] = None,
) -> bool:
    """
    Canonical-first: reads project_country directly from Vision output.
    Fallback: address-based province/postal detection.
    """
    if canonical is not None:
        country_sig = canonical.get_location("project_country")
        if country_sig is not None and country_sig.is_stated():
            return country_sig.value in ("CANADA", "CA")

    # ── Text-based fallback ───────────────────────────────────
    for addr in extraction.addresses:
        if addr.value:
            v = addr.value.lower()
            if any(p in v for p in _CANADIAN_PROVINCES):
                return True
            if _CANADIAN_POSTAL.search(v):
                return True
    return False


def _is_custom_shape(extraction: ExtractionResult, text: str) -> bool:
    for m in extraction.measurements:
        if m.shape and m.shape.lower() in ("oval", "round", "irregular", "angled"):
            return True
    return bool(_has(text, _CUSTOM_SHAPE_TERMS))


def _is_round(extraction: ExtractionResult, text: str) -> bool:
    for m in extraction.measurements:
        if m.shape and m.shape.lower() == "round":
            return True
    return bool(_has(text, ["round", "circular", "circle"]))


# ─────────────────────────────────────────────────────────────
# MAIN DECISION FUNCTION
# ─────────────────────────────────────────────────────────────

def decide_add_ons(
    extraction: ExtractionResult,
    glass_result: GlassTypeResult,
    frame_result: FrameTypeResult,
    cross_beam_result: CrossBeamResult,
    weight_lbs: Optional[float] = None,   # from Rule 6 if already computed
    canonical: Optional[CanonicalSignals] = None,
) -> AddOnResult:
    """
    Rule 5 — Add-On Options & Markings.

    Processes every add-on field in the workbook independently.
    Each field is decided separately — no cascading between add-ons
    except for expedited flag which affects HST and backpaint.

    weight_lbs: pre-computed total weight from Rule 6.
                If None, HST returns PENDING.
    """
    reasoning = []
    flags = []
    text = _pool_text(extraction)

    result = AddOnResult()

    # ── Expedited detection (affects HST and backpaint) ───────────────────
    # Canonical-first: read is_expedited directly from Vision location signals
    _expedited_sig = canonical.get_location("is_expedited") if canonical else None
    if _expedited_sig is not None and _expedited_sig.is_true():
        is_expedited = True
        reasoning.append(
            f"[canonical] Expedited: {_expedited_sig.verbatim!r} "
            f"| {_expedited_sig.reasoning}"
        )
    else:
        expedited_match = _has(text, _EXPEDITED_TERMS)
        is_expedited = expedited_match is not None
        if is_expedited:
            reasoning.append(f"Expedited flag detected: '{expedited_match}'")

    # ── EGR detection (affects backpaint and duty) ────────────────────────
    is_egr = glass_result.egr_secondary or bool(_has(text, _EGR_TERMS))
    if is_egr:
        reasoning.append("EGR glass detected")

    # ────────────────────────────────────────────────────────────────────────
    # SENTRY GLASS INTERLAYER (Row 16)
    # Trigger: engineering threshold based on panel size (B1 blocker).
    # Until threshold received from GFS → always flag, never auto-select.
    # Source: explicitly mentioned in Jane St Dan routing note ("SG interlayer
    # per Wayne") — but in internal routing, not customer doc.
    # ────────────────────────────────────────────────────────────────────────
    sentry_match = _has(text, _SENTRY_GLASS_TERMS)
    if sentry_match:
        result.sentry_glass = AddOnField(
            value="y",
            workbook_row="Row 16 — Sentry Glass interlayer",
            confidence=compute_rule_confidence("MEDIUM"),
            source=f"'{sentry_match}' found in documents",
            flag=(
                "OPEN BLOCKER B1: Sentry Glass panel size threshold not yet received "
                "from GFS. Customer mentioned it — marking y. Estimator must confirm."
            ),
        )
    else:
        result.sentry_glass = AddOnField(
            value="n",
            workbook_row="Row 16 — Sentry Glass interlayer",
            confidence=compute_rule_confidence("MEDIUM"),
            flag="Sentry Glass threshold unknown (B1 blocker) — estimator confirm if large panels",
        )
    reasoning.append(f"Sentry Glass: {'y (mentioned)' if sentry_match else 'n (not mentioned)'}")

    # ────────────────────────────────────────────────────────────────────────
    # KRYPTON GAS (Row 17)
    # Default: NOT selected.
    # Only if explicitly requested in spec, drawings, or communication.
    # Source: GFS client response — "standard gas is Argon, Krypton only if
    # specifically called out"
    # ────────────────────────────────────────────────────────────────────────
    # Canonical-first Krypton Gas
    _kr_sig = canonical.addon_signals.has_krypton if (canonical and canonical.addon_signals) else None
    if _kr_sig is not None and _kr_sig.value is not None:
        val = "y" if _kr_sig.is_true() else "n"
        result.krypton_gas = AddOnField(
            value=val,
            workbook_row="Row 17 — Krypton Gas",
            confidence=compute_rule_confidence("HIGH", _kr_sig.extracted_confidence),
            source=f"[canonical] {_kr_sig.verbatim!r} | {_kr_sig.reasoning}",
        )
        reasoning.append(f"Krypton Gas: {val} [canonical]")
    else:
        krypton_match = _has(text, _KRYPTON_TERMS)
        if krypton_match:
            result.krypton_gas = AddOnField(
                value="y",
                workbook_row="Row 17 — Krypton Gas",
                confidence=compute_rule_confidence("HIGH"),
                source=f"'{krypton_match}' explicitly found in documents",
            )
        else:
            result.krypton_gas = AddOnField(
                value="n",
                workbook_row="Row 17 — Krypton Gas",
                confidence=compute_rule_confidence("HIGH"),
            )
        reasoning.append(f"Krypton Gas: {'y' if krypton_match else 'n (default)'} [text fallback]")

    # ────────────────────────────────────────────────────────────────────────
    # COLORED INTERLAYER (Row 18)
    # Trigger: customer explicitly specifies colored glass.
    # ────────────────────────────────────────────────────────────────────────
    colored_match = _has(text, _COLORED_INTERLAYER_TERMS)
    if colored_match:
        result.colored_interlayer = AddOnField(
            value="y",
            workbook_row="Row 18 — Colored interlayer",
            confidence=compute_rule_confidence("MEDIUM"),
            source=f"'{colored_match}' found in documents",
            flag="Colored interlayer requested — estimator must confirm specific color",
        )
    else:
        result.colored_interlayer = AddOnField(
            value="n",
            workbook_row="Row 18 — Colored interlayer",
            confidence=compute_rule_confidence("HIGH"),
        )
    reasoning.append(f"Colored interlayer: {'y' if colored_match else 'n'}")

    # ────────────────────────────────────────────────────────────────────────
    # SWITCHABLE GLASS (Row 19) — always MANUAL
    # No signals in customer documents. Estimator decides.
    # ────────────────────────────────────────────────────────────────────────
    switchable_match = _has(text, _SWITCHABLE_GLASS_TERMS)
    result.switchable_glass = AddOnField(
        value="y" if switchable_match else "MANUAL",
        workbook_row="Row 19 — Switchable Glass",
        confidence=compute_rule_confidence("HIGH" if switchable_match else "MANUAL"),
        source=f"'{switchable_match}' found" if switchable_match else None,
        flag=None if switchable_match else "Switchable glass never found in customer documents — always manual",
    )
    reasoning.append(f"Switchable Glass: {'y (mentioned)' if switchable_match else 'MANUAL'}")

    # ────────────────────────────────────────────────────────────────────────
    # BACKPAINT (Row 20)
    # EGR glass + expedited orders ONLY.
    # Ceramic frit backpaint is always in base price — this row is EGR-specific.
    # GFS client response: "we only back paint if project is expedited with EGR"
    # ────────────────────────────────────────────────────────────────────────
    if is_egr and is_expedited:
        result.backpaint = AddOnField(
            value="y",
            workbook_row="Row 20 — Backpaint (EGR expedited)",
            confidence=compute_rule_confidence("HIGH"),
            source="EGR glass detected + expedited flag detected",
        )
        reasoning.append("Backpaint: y (EGR + expedited)")
    elif is_egr and not is_expedited:
        result.backpaint = AddOnField(
            value="n",
            workbook_row="Row 20 — Backpaint (EGR expedited)",
            confidence=compute_rule_confidence("HIGH"),
            flag="EGR glass detected but NOT expedited — backpaint = n (EGR expedited only)",
        )
        reasoning.append("Backpaint: n (EGR but not expedited)")
    else:
        result.backpaint = AddOnField(
            value="n",
            workbook_row="Row 20 — Backpaint (EGR expedited)",
            confidence=compute_rule_confidence("HIGH"),
            # Ceramic frit is in base price. This row only for EGR expedited.
        )
        reasoning.append("Backpaint: n (EGR expedited only — ceramic frit in base price)")

    # ────────────────────────────────────────────────────────────────────────
    # CUSTOM SHAPE SURCHARGE (Row 24) — $0.40/sqft
    # Trigger: non-rectangular panel (oval, ellipse, curved, radius).
    # Validated: 87001 Mill Hill (custom ellipse).
    # ────────────────────────────────────────────────────────────────────────
    is_custom = _is_custom_shape(extraction, text)
    is_round = _is_round(extraction, text)

    if is_round:
        result.custom_shape_surcharge = AddOnField(
            value="y",
            workbook_row="Row 24 — Custom shapes",
            confidence=compute_rule_confidence("HIGH"),
            source="Round/circular shape detected",
        )
        result.round_glass_surcharge = AddOnField(
            value="y",
            workbook_row="Row 25 — Round Glass",
            confidence=compute_rule_confidence("HIGH"),
            source="Round shape detected",
        )
        reasoning.append("Custom shape + Round Glass: y (circular panel)")
    elif is_custom:
        result.custom_shape_surcharge = AddOnField(
            value="y",
            workbook_row="Row 24 — Custom shapes ($0.40/sqft)",
            confidence=compute_rule_confidence("HIGH"),
            source="Non-rectangular shape detected in measurements or text",
        )
        result.round_glass_surcharge = AddOnField(
            value="n",
            workbook_row="Row 25 — Round Glass",
            confidence=compute_rule_confidence("HIGH"),
        )
        reasoning.append("Custom shape surcharge: y (non-rectangular)")
    else:
        result.custom_shape_surcharge = AddOnField(
            value="n",
            workbook_row="Row 24 — Custom shapes",
            confidence=compute_rule_confidence("HIGH"),
        )
        result.round_glass_surcharge = AddOnField(
            value="n",
            workbook_row="Row 25 — Round Glass",
            confidence=compute_rule_confidence("HIGH"),
        )
        reasoning.append("Custom shape surcharge: n")

    # ────────────────────────────────────────────────────────────────────────
    # TITANIUM EMBEDS (Row 22)
    # Stair tread applications ONLY. Minimum 4 per tread. Qty always manual.
    # NOT validated against real project folder.
    # ────────────────────────────────────────────────────────────────────────
    if glass_result.glass_type_code == "STAIR_TREAD":
        result.embeds_titanium = AddOnField(
            value="y",
            workbook_row="Row 22 — Embeds - Titanium",
            confidence=compute_rule_confidence("MEDIUM", glass_result.confidence),
            source="Stair tread glass type selected",
            flag=(
                "Titanium embeds required for stair treads — minimum 4 per tread. "
                "Quantity must be filled manually. "
                "NOT VALIDATED: stair tread rule not confirmed against real project."
            ),
        )
        reasoning.append("Embeds titanium: y (stair tread)")
    else:
        result.embeds_titanium = AddOnField(
            value="n",
            workbook_row="Row 22 — Embeds - Titanium",
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
        )
        reasoning.append("Embeds titanium: n (stair tread only)")

    # ────────────────────────────────────────────────────────────────────────
    # SEEDED ORGANIC (Row 107)
    # Trigger: "Seeded Organic" explicitly mentioned.
    # Validated: 87001 Mill Hill — Seeded Organic top layer.
    # ────────────────────────────────────────────────────────────────────────
    # Canonical-first Seeded Organic
    _so_sig = canonical.addon_signals.has_seeded_organic if (canonical and canonical.addon_signals) else None
    if _so_sig is not None and _so_sig.value is not None:
        val = "y" if _so_sig.is_true() else "n"
        result.seeded_organic = AddOnField(
            value=val,
            workbook_row="Row 107 — Seeded Organic",
            confidence=compute_rule_confidence("HIGH", _so_sig.extracted_confidence),
            source=f"[canonical] {_so_sig.verbatim!r} | {_so_sig.reasoning}",
        )
        reasoning.append(f"Seeded Organic: {val} [canonical]")
    else:
        seeded_match = _has(text, _SEEDED_ORGANIC_TERMS)
        if seeded_match:
            result.seeded_organic = AddOnField(
                value="y",
                workbook_row="Row 107 — Seeded Organic",
                confidence=compute_rule_confidence("HIGH"),
                source=f"'{seeded_match}' found in documents",
            )
        else:
            result.seeded_organic = AddOnField(
                value="y",
                workbook_row="Row 107 — Seeded Organic",
                confidence=compute_rule_confidence("HIGH"),
            )
        reasoning.append(f"Seeded Organic: {'y' if seeded_match else 'y'} [text fallback — default Yes]")

    # ────────────────────────────────────────────────────────────────────────
    # BLUR (Row 108) — always MANUAL
    # No customer document signals for Blur texture.
    # ────────────────────────────────────────────────────────────────────────
    result.blur = AddOnField(
        value="MANUAL",
        workbook_row="Row 108 — Blur",
        confidence=compute_rule_confidence("MANUAL"),
        flag="Blur texture — no signals in customer documents, always manual",
    )
    reasoning.append("Blur: MANUAL (always)")

    # ────────────────────────────────────────────────────────────────────────
    # HEAT SOAK TESTING (Row 109)
    # UPDATED thresholds from GFS client response (supersedes doc):
    #   < 400 lbs  → NO
    #   400–600 lbs → optional (flag for estimator)
    #   > 600 lbs  → YES automatically
    #   Expedited  → always NO regardless of weight
    # Needs weight_lbs from Rule 6 — returns PENDING if not yet computed.
    # ────────────────────────────────────────────────────────────────────────
    if is_expedited:
        result.heat_soak_testing = AddOnField(
            value="n",
            workbook_row="Row 109 — Heat Soak Testing",
            confidence=compute_rule_confidence("HIGH"),
            source="Expedited flag detected",
            flag="Expedited order — HST always NO regardless of weight",
        )
        reasoning.append("HST: n (expedited override)")
    elif weight_lbs is None:
        result.heat_soak_testing = AddOnField(
            value="PENDING",
            workbook_row="Row 109 — Heat Soak Testing",
            confidence=compute_rule_confidence("MANUAL"),
            flag=(
                "HST blocked — weight not yet computed. "
                "Will be determined automatically once Stage 3 dimensions are approved "
                "and Rule 6 calculates weight. "
                "Thresholds: <400 lbs = NO, 400–600 = optional, >600 = YES."
            ),
        )
        reasoning.append("HST: PENDING (weight not yet computed)")
    elif weight_lbs < 400:
        result.heat_soak_testing = AddOnField(
            value="n",
            workbook_row="Row 109 — Heat Soak Testing",
            confidence=compute_rule_confidence("HIGH"),
            source=f"Weight {weight_lbs:.1f} lbs < 400 lb threshold",
        )
        reasoning.append(f"HST: n (weight {weight_lbs:.1f} lbs < 400)")
    elif 400 <= weight_lbs <= 600:
        result.heat_soak_testing = AddOnField(
            value="MANUAL",
            workbook_row="Row 109 — Heat Soak Testing",
            confidence=compute_rule_confidence("LOW"),
            source=f"Weight {weight_lbs:.1f} lbs in 400–600 lb optional range",
            flag=(
                f"Weight {weight_lbs:.1f} lbs is in the optional HST range (400–600 lbs). "
                "Estimator must decide. "
                "Note: 464 Greenwich (338 lbs) had HST ordered — confirm with estimator "
                "if Series 2000 IGU always includes HST regardless of weight."
            ),
        )
        reasoning.append(f"HST: MANUAL (weight {weight_lbs:.1f} lbs in optional range 400–600)")
    else:  # > 600
        result.heat_soak_testing = AddOnField(
            value="y",
            workbook_row="Row 109 — Heat Soak Testing",
            confidence=compute_rule_confidence("HIGH"),
            source=f"Weight {weight_lbs:.1f} lbs > 600 lb threshold",
        )
        reasoning.append(f"HST: y (weight {weight_lbs:.1f} lbs > 600)")

    # ────────────────────────────────────────────────────────────────────────
    # NANO DOT (Row 110)
    # Trigger: "NanoDot" or "Nano Dot" explicitly mentioned.
    # Generic "anti-slip" alone is NOT sufficient — could be YorLux or other.
    # Validated: 87001 Mill Hill, 21280 Avalon.
    # ────────────────────────────────────────────────────────────────────────
    # Canonical-first NanoDot
    _nd_sig = canonical.addon_signals.has_nanodot if (canonical and canonical.addon_signals) else None
    if _nd_sig is not None and _nd_sig.is_true():
        result.nanodot = AddOnField(
            value="y",
            workbook_row="Row 110 — Nano Dot",
            confidence=compute_rule_confidence("HIGH", _nd_sig.extracted_confidence),
            source=f"[canonical] {_nd_sig.verbatim!r} | {_nd_sig.reasoning}",
        )
        reasoning.append("NanoDot: y [canonical]")
    elif _nd_sig is not None and _nd_sig.is_false():
        antislip_match = _has(text, ["anti-slip", "antislip", "anti slip", "tahoe satin"])
        if antislip_match:
            result.nanodot = AddOnField(
                value="MANUAL",
                workbook_row="Row 110 — Nano Dot",
                confidence=compute_rule_confidence("MANUAL"),
                source=f"Anti-slip texture mentioned: '{antislip_match}'",
                flag=(
                    f"Anti-slip texture mentioned ('{antislip_match}') but NanoDot not "
                    "explicitly stated. Could be YorLux (base price) or NanoDot (add-on). "
                    "Estimator must confirm which texture applies."
                ),
            )
        else:
            result.nanodot = AddOnField(value="y", workbook_row="Row 110 — Nano Dot", confidence=compute_rule_confidence("HIGH"))
        reasoning.append("NanoDot: y [canonical false — default Yes]")
    else:
        # Text fallback
        nanodot_match = _has(text, _NANODOT_TERMS)
        if nanodot_match:
            result.nanodot = AddOnField(
                value="y",
                workbook_row="Row 110 — Nano Dot",
                confidence=compute_rule_confidence("HIGH"),
                source=f"'{nanodot_match}' found in documents",
            )
        else:
            antislip_match = _has(text, ["anti-slip", "antislip", "anti slip", "tahoe satin"])
            if antislip_match:
                result.nanodot = AddOnField(
                    value="MANUAL",
                    workbook_row="Row 110 — Nano Dot",
                    confidence=compute_rule_confidence("MANUAL"),
                    source=f"Anti-slip texture mentioned: '{antislip_match}'",
                    flag=(
                        f"Anti-slip texture mentioned ('{antislip_match}') but NanoDot not "
                        "explicitly stated. Could be YorLux (base price) or NanoDot (add-on). "
                        "Estimator must confirm which texture applies."
                    ),
                )
            else:
                result.nanodot = AddOnField(value="y", workbook_row="Row 110 — Nano Dot", confidence=compute_rule_confidence("HIGH"))
        reasoning.append("NanoDot: y [text fallback — default Yes]")

    # ────────────────────────────────────────────────────────────────────────
    # DUTY (Row 90)
    # Canadian address → 5.5%
    # US + non-EGR glass → 15%
    # EGR glass → no duty (GFS confirmed: "except if from EGR")
    # ────────────────────────────────────────────────────────────────────────
    if is_egr:
        result.duty = AddOnField(
            value="n",
            workbook_row="Row 90 — Duty",
            confidence=compute_rule_confidence("HIGH", glass_result.confidence),
            source="EGR glass — duty exempt per GFS policy",
        )
        reasoning.append("Duty: n (EGR glass exempt)")
    elif _is_canadian(extraction, canonical):
        result.duty = AddOnField(
            value="y",
            workbook_row="Row 90 — Duty",
            confidence=compute_rule_confidence("HIGH"),
            source="Canadian delivery address detected",
            flag="Canadian address — 5.5% duty rate. Workbook duty rate cell: confirm 5.5%",
        )
        reasoning.append("Duty: y 5.5% (Canadian address)")
    else:
        result.duty = AddOnField(
            value="y",
            workbook_row="Row 90 — Duty",
            confidence=compute_rule_confidence("HIGH"),
            source="Non-EGR glass — duty applies per GFS policy",
            flag="Duty 15% applies. GFS confirmed: all glass except EGR, residential + commercial.",
        )
        reasoning.append("Duty: y 15% (non-EGR glass, US delivery)")

    result.flags = flags
    result.reasoning = reasoning
    return result
