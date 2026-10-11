"""
CanonicalSignals — structured output from Vision module (Samarth / Achal).

The rules engine reads ONLY from this model — never from raw document strings.
This eliminates per-project vocabulary maintenance in the rules engine.

Every new vocabulary term (e.g. "SG interlayer", "DG Structural", "on slope")
belongs in Samarth's Vision prompt — not in this file and not in the rules engine.

Schema matches Vision JSON output exactly.
Parse with CanonicalSignals.from_dict(vision_json_dict).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────
# BASE FIELD — every canonical signal has this shape
# ─────────────────────────────────────────────────────────────

@dataclass
class SignalField:
    """
    A single canonical signal extracted by Vision.

    value      — bool | enum string | float | int | None
    confidence — "HIGH" | "MEDIUM" | "LOW"
    verbatim   — exact phrase from document that produced this answer
    page       — source page number (None = email / lead sheet text)
    reasoning  — Vision's own explanation of why it gave this value
                 (chain-of-thought; essential for debugging wrong outputs)
    """
    value: Any
    confidence: str = "LOW"
    verbatim: Optional[str] = None
    page: Optional[int] = None
    reasoning: Optional[str] = None
    citation: Optional[str] = None

    def is_true(self) -> bool:
        """Canonical check: value is explicitly True."""
        return self.value is True

    def is_false(self) -> bool:
        """Canonical check: value is explicitly False."""
        return self.value is False

    def is_stated(self) -> bool:
        """True if value is not null and not NOT_STATED."""
        return self.value is not None and self.value != "NOT_STATED"

    @property
    def extracted_confidence(self) -> Any:
        return self.confidence


def _sig(d: Optional[dict]) -> Optional[SignalField]:
    """Parse a single signal dict into SignalField. Returns None if absent."""
    if not d:
        return None
    return SignalField(
        value=d.get("value"),
        confidence=d.get("confidence", "LOW"),
        verbatim=d.get("verbatim"),
        page=d.get("page"),
        reasoning=d.get("reasoning"),
        citation=d.get("citation"),
    )


# ─────────────────────────────────────────────────────────────
# GLASS SIGNALS  — feeds Rule 2 (glass type decision tree)
# ─────────────────────────────────────────────────────────────

@dataclass
class GlassSignals:
    """
    Boolean signals about the glass application.
    Rules engine reads these — never raw document strings.

    is_walkable:               true = walk-on product
    is_exterior:               true = roof / outdoor / skylight
    has_air_gap:               true = IGU / air spacer present
                               false = SG interlayer / no air gap / monolithic
                               null = not determinable from docs
    has_conditioned_space_below: true = above kitchen/living/basement etc.
    is_stair_tread:            true = glass stair application
    is_egr:                    true = exterior grade railing
    is_replacement_glass_only: true = glass-only reorder, no frame
    is_glass_2_0:              true = customer explicitly named Glass 2.0
    product_type:              "GLASS_ONLY" | "SKYLIGHT" | "INTERIOR_FLOOR"
    """
    is_walkable:                Optional[SignalField] = None
    is_exterior:                Optional[SignalField] = None
    has_air_gap:                Optional[SignalField] = None
    has_conditioned_space_below:Optional[SignalField] = None
    has_wine_cellar_below:      Optional[SignalField] = None
    has_open_space_below:       Optional[SignalField] = None
    is_stair_tread:             Optional[SignalField] = None
    is_egr:                     Optional[SignalField] = None
    is_replacement_glass_only:  Optional[SignalField] = None
    is_glass_2_0:               Optional[SignalField] = None


# ─────────────────────────────────────────────────────────────
# FRAME SIGNALS  — feeds Rule 3 (frame type + proposal desc.)
# ─────────────────────────────────────────────────────────────

@dataclass
class AddonSignals:
    """
    Add-on product signals that CAN appear in customer documents.
    Vision extracts these when explicitly mentioned.
    Rule 5 reads canonical-first, text fallback second.

    has_nanodot:        TRUE = NanoDot anti-slip explicitly named
    has_seeded_organic: TRUE = Seeded Organic texture explicitly named
    has_krypton:        TRUE = Krypton gas explicitly named
    """
    has_nanodot:        Optional[SignalField] = None
    has_seeded_organic: Optional[SignalField] = None
    has_krypton:        Optional[SignalField] = None


@dataclass
class FrameSignals:
    """
    frame_type_stated: ECONOFRAME | SERIES_1000 | SERIES_2000 | SERIES_3000 |
                       PERIMETER_NTB | CAPS | NOT_STATED
                       NOT_STATED is correct for ~80% of projects.

    install_type:      PEDESTAL | RECESSED | DECK_PERIMETER | CURB_MOUNTED | NOT_STATED
    assembly_type:     FA | KD | FACTORY_GLAZED | FIELD_GLAZED | NOT_STATED

    is_existing_structure:    TRUE = inserting into existing opening/curb.
                              Situational signal, same pattern as glass's
                              is_walkable/is_exterior. Null is the expected
                              common answer — most inquiries don't state this.
    is_new_deck_construction: TRUE = building a new deck/structure from
                              scratch. Same situational pattern.
    panel_configuration:      "SINGLE_PANEL" | "MULTI_PANEL"
    is_custom_radius:         TRUE = custom shape/curve explicitly named.
    """
    frame_type_stated: Optional[SignalField] = None
    install_type:      Optional[SignalField] = None
    assembly_type:     Optional[SignalField] = None
    is_thermally_broken: Optional[SignalField] = None
    is_existing_structure:    Optional[SignalField] = None
    is_new_deck_construction: Optional[SignalField] = None
    panel_configuration:      Optional[SignalField] = None
    is_custom_radius:         Optional[SignalField] = None
    product_type:             Optional[SignalField] = None


# ─────────────────────────────────────────────────────────────
# LOCATION SIGNALS  — feeds Rule 5 (duty, expedited)
# ─────────────────────────────────────────────────────────────

@dataclass
class LocationSignals:
    """
    project_country:  "US" | "CANADA" | "NOT_STATED"
    project_address:  full address string
    is_expedited:     true = rush / expedited / ASAP order
    """
    project_country: Optional[SignalField] = None
    project_address: Optional[SignalField] = None
    is_expedited:    Optional[SignalField] = None


# ─────────────────────────────────────────────────────────────
# HEADER SIGNALS  — feeds Excel header cells (not rules engine)
# ─────────────────────────────────────────────────────────────

@dataclass
class HeaderSignals:
    """Populated directly into workbook header rows by cell_mapper."""
    project_name:   Optional[SignalField] = None
    project_address:Optional[SignalField] = None
    project_type:   Optional[SignalField] = None   # RESIDENTIAL | COMMERCIAL
    architect_name: Optional[SignalField] = None
    contact_name:   Optional[SignalField] = None
    contact_phone:  Optional[SignalField] = None
    contact_email:  Optional[SignalField] = None
    contact_address:Optional[SignalField] = None


# ─────────────────────────────────────────────────────────────
# CANONICAL UNIT  — one glass opening / skylight area
# ─────────────────────────────────────────────────────────────

@dataclass
class CanonicalUnit:
    """
    Represents one glass opening that GFS will price.

    unit_label:           "A" | "B" | "C" (always letters, never numbers)
    location_description: free text from document
    width_inches:         always float in inches (Vision converts ft-in and mm)
    length_inches:        always float in inches
    panel_count:          explicit count stated by customer or on drawing
    rafter_count:         if explicitly stated
    dimension_label_type: EXPOSED_FRAME | GLASS | ROUGH_OPENING | UNKNOWN
                          Rules engine uses EXPOSED_FRAME; others flagged for estimator
    confidence:           HIGH | MEDIUM | LOW
    verbatim:             exact source text
    page:                 source page number
    reasoning:            Vision's explanation of dimension selection

    NOTE: All dimensions from Vision are passed through.
    The pipeline does NOT filter or pick dimensions automatically.
    Estimator reviews all units and confirms which to price.
    """
    unit_label:            Optional[str] = None
    location_description:  Optional[str] = None
    drawing_number:        Optional[str] = None
    diameter_inches:       Optional[float] = None
    width_inches:          Optional[float] = None
    length_inches:         Optional[float] = None
    panel_count:           Optional[int] = None
    rafter_count:          Optional[int] = None
    rows:                  Optional[int] = None
    columns:               Optional[int] = None
    vertical_rafter_count: Optional[int] = None
    horizontal_rafter_count: Optional[int] = None
    t_rafter_details:      Optional[str] = None
    layout_source:         Optional[str] = None
    # Per-unit spec overrides (Vision may state these explicitly per opening;
    # otherwise the rules-engine project decision is fanned out downstream).
    # glass_type: GLASS_NO_IGU | GLASS_WITH_IGU | GLASS_2_0 | STAIR_TREAD |
    #             NON_WALKABLE | EGR | null (null = inherit project decision)
    glass_type:            Optional[str] = None
    # frame_type: SERIES_2000_RECESSED | SERIES_2000_PEDESTAL |
    #             SERIES_1000_PEDESTAL | SERIES_1000_RECESSED | PERIMETER_NON_TB |
    #             DECK_PERIMETER | ECONOFRAME | SERIES_3000 | ... | null
    frame_type:            Optional[str] = None
    # glass_thickness: free text exactly as written (e.g. '1-1/2" laminated')
    glass_thickness:       Optional[str] = None
    dimension_label_type:  Optional[str] = "UNKNOWN"
    is_walkable:           Optional[bool] = None
    is_exterior:           Optional[bool] = None
    confidence:            str = "LOW"
    verbatim:              Optional[str] = None
    page:                  Optional[int] = None
    reasoning:             Optional[str] = None
    citation:              Optional[str] = None

    def __post_init__(self):
        if self.width_inches is not None:
            self.width_inches = round(float(self.width_inches), 2)
        if self.length_inches is not None:
            self.length_inches = round(float(self.length_inches), 2)
        if self.diameter_inches is not None:
            self.diameter_inches = round(float(self.diameter_inches), 2)


# ─────────────────────────────────────────────────────────────
# CANONICAL SIGNALS  — top-level model
# ─────────────────────────────────────────────────────────────

@dataclass
class CanonicalSignals:
    """
    Complete canonical output from Vision module.

    Rules engine functions accept canonical: Optional[CanonicalSignals] = None.
    When present → canonical-first logic (reads booleans/enums directly).
    When absent  → text-based fallback (existing _TERMS / _detect_* logic).

    Parse from Vision JSON:
        canonical = CanonicalSignals.from_dict(vision_output_dict)
    """
    project_id:        str
    source_file:       Optional[str] = None
    source_type:       Optional[str] = None
    header_signals:    Optional[HeaderSignals] = None
    glass_signals:     Optional[GlassSignals] = None
    frame_signals:     Optional[FrameSignals] = None
    location_signals:  Optional[LocationSignals] = None
    addon_signals:     Optional[AddonSignals] = None
    explicit_statements: Optional[list] = None
    units:             list[CanonicalUnit] = field(default_factory=list)
    extraction_timing: Optional[str] = None

    # ── Convenience accessors ─────────────────────────────────

    def get_glass(self, field_name: str) -> Optional[SignalField]:
        """Safe access: canonical.get_glass('is_walkable')"""
        if self.glass_signals:
            return getattr(self.glass_signals, field_name, None)
        return None

    def get_frame(self, field_name: str) -> Optional[SignalField]:
        """Safe access: canonical.get_frame('install_type')"""
        if self.frame_signals:
            return getattr(self.frame_signals, field_name, None)
        return None

    def get_location(self, field_name: str) -> Optional[SignalField]:
        """Safe access: canonical.get_location('project_country')"""
        if self.location_signals:
            return getattr(self.location_signals, field_name, None)
        return None

    def primary_panel_count(self) -> Optional[int]:
        """
        Return panel count from first unit that has one.
        Returns None if no unit has panel_count stated.
        """
        for unit in self.units:
            if unit.panel_count is not None:
                return unit.panel_count
        return None

    def is_canadian(self) -> bool:
        """True if project_country canonical signal says CANADA."""
        sig = self.get_location("project_country")
        return sig is not None and sig.value in ("CANADA", "CA")

    def is_expedited(self) -> bool:
        """True if is_expedited canonical signal is explicitly True."""
        sig = self.get_location("is_expedited")
        return sig is not None and sig.is_true()

    # ── Parser ────────────────────────────────────────────────

    @classmethod
    def from_dict(cls, d: dict) -> "CanonicalSignals":
        """
        Parse canonical JSON from Vision module into structured model.
        Handles missing fields gracefully — all sub-objects default to None.
        """
        hdr_d = d.get("header_signals") or {}
        header = HeaderSignals(
            project_name=    _sig(hdr_d.get("project_name")),
            project_address= _sig(hdr_d.get("project_address")),
            project_type=    _sig(hdr_d.get("project_type")),
            architect_name=  _sig(hdr_d.get("architect_name")),
            contact_name=    _sig(hdr_d.get("contact_name")),
            contact_phone=   _sig(hdr_d.get("contact_phone")),
            contact_email=   _sig(hdr_d.get("contact_email")),
            contact_address= _sig(hdr_d.get("contact_address")),
        )

        gs_d = d.get("glass_signals") or {}
        glass = GlassSignals(
            is_walkable=                _sig(gs_d.get("is_walkable")),
            is_exterior=                _sig(gs_d.get("is_exterior")),
            has_air_gap=                _sig(gs_d.get("has_air_gap")),
            has_conditioned_space_below=_sig(gs_d.get("has_conditioned_space_below")),
            has_wine_cellar_below=      _sig(gs_d.get("has_wine_cellar_below")),
            has_open_space_below=       _sig(gs_d.get("has_open_space_below")),
            is_stair_tread=             _sig(gs_d.get("is_stair_tread")),
            is_egr=                     _sig(gs_d.get("is_egr")),
            is_replacement_glass_only=  _sig(gs_d.get("is_replacement_glass_only")),
            is_glass_2_0=               _sig(gs_d.get("is_glass_2_0")),
        )

        fs_d = d.get("frame_signals") or {}
        tb_field = fs_d.get("is_thermally_broken")
        if tb_field is None and "thermally_broken_not_required" in fs_d:
            not_req = _sig(fs_d.get("thermally_broken_not_required"))
            if not_req is not None:
                tb_field = {
                    "value": not not_req.value if not_req.value is not None else None,
                    "confidence": not_req.confidence,
                    "verbatim": not_req.verbatim,
                    "citation": not_req.citation,
                    "page": not_req.page,
                    "reasoning": not_req.reasoning,
                }
        frame = FrameSignals(
            frame_type_stated=_sig(fs_d.get("frame_type_stated") or fs_d.get("frame_type")),
            install_type=     _sig(fs_d.get("install_type")),
            assembly_type=    _sig(fs_d.get("assembly_type")),
            product_type=     _sig(fs_d.get("product_type")),
            is_thermally_broken=_sig(tb_field),
            is_existing_structure=    _sig(fs_d.get("is_existing_structure")),
            is_new_deck_construction= _sig(fs_d.get("is_new_deck_construction")),
            panel_configuration=      _sig(fs_d.get("panel_configuration")),
            is_custom_radius=         _sig(fs_d.get("is_custom_radius")),
        )

        ls_d = d.get("location_signals") or {}
        location = LocationSignals(
            project_country=_sig(ls_d.get("project_country")),
            project_address=_sig(ls_d.get("project_address")),
            is_expedited=   _sig(ls_d.get("is_expedited")),
        )

        as_d = d.get("addon_signals") or {}
        addons = AddonSignals(
            has_nanodot=        _sig(as_d.get("has_nanodot")),
            has_seeded_organic= _sig(as_d.get("has_seeded_organic")),
            has_krypton=        _sig(as_d.get("has_krypton")),
        )

        units = []
        for u in d.get("units") or []:
            units.append(CanonicalUnit(
                unit_label=           u.get("unit_label"),
                location_description= u.get("location_description"),
                drawing_number=       u.get("drawing_number"),
                diameter_inches=      u.get("diameter_inches") or u.get("value_diameter_in") or u.get("extracted_diameter_in"),
                width_inches=         u.get("width_inches"),
                length_inches=        u.get("length_inches"),
                panel_count=          u.get("panel_count"),
                rafter_count=         u.get("rafter_count") or u.get("value_rafter_count") or u.get("extracted_rafter_count"),
                rows=                 u.get("rows") if u.get("rows") is not None else u.get("value_rows"),
                columns=              u.get("columns") if u.get("columns") is not None else (u.get("value_cols") if u.get("value_cols") is not None else (u.get("value_columns") if u.get("value_columns") is not None else u.get("extracted_columns"))),
                vertical_rafter_count= u.get("vertical_rafter_count") if u.get("vertical_rafter_count") is not None else (u.get("value_vertical_rafter_count") if u.get("value_vertical_rafter_count") is not None else u.get("extracted_vertical_rafter_count")),
                horizontal_rafter_count= u.get("horizontal_rafter_count") if u.get("horizontal_rafter_count") is not None else (u.get("value_horizontal_rafter_count") if u.get("value_horizontal_rafter_count") is not None else u.get("extracted_horizontal_rafter_count")),
                t_rafter_details=     u.get("t_rafter_details"),
                layout_source=        u.get("layout_source"),
                glass_type=           u.get("glass_type") or u.get("value_glass_type") or u.get("extracted_glass_type"),
                frame_type=           u.get("frame_type") or u.get("value_frame_type") or u.get("extracted_frame_type"),
                glass_thickness=      u.get("glass_thickness") or u.get("value_glass_thickness") or u.get("extracted_glass_thickness"),
                dimension_label_type= u.get("dimension_label_type", "UNKNOWN"),
                is_walkable=          u.get("is_walkable"),
                is_exterior=          u.get("is_exterior"),
                confidence=           u.get("confidence", "LOW"),
                verbatim=             u.get("verbatim"),
                page=                 u.get("page"),
                reasoning=            u.get("reasoning"),
                citation=             u.get("citation"),
            ))

        return cls(
            project_id=        d.get("project_id", ""),
            source_file=       d.get("source_file"),
            source_type=       d.get("source_type"),
            header_signals=    header,
            glass_signals=     glass,
            frame_signals=     frame,
            location_signals=  location,
            addon_signals=     addons,
            explicit_statements=d.get("explicit_statements"),
            units=             units,
            extraction_timing= d.get("extraction_timing"),
        )


# ─────────────────────────────────────────────────────────────
# UNIT CANONICAL VIEW  — per-unit signal override wrapper
# ─────────────────────────────────────────────────────────────


_WALKABLE_TERMS = ["walkable", "walk-on", "walk on", "plank & glass", "plank and glass",
                   "skyfloor", "sky floor", "91r-plank", "floor glazing", "floor skylight",
                   "walking", "pedestrian"]
_PEDESTAL_TERMS = ["pedestal", "deck", "exterior deck", "flush with deck", "above deck"]
_RECESSED_TERMS = ["recessed", "interior recessed", "flush with floor", "flush floor",
                   "below floor", "sunken"]
_EXTERIOR_TERMS = ["exterior", "outdoor", "outside", "deck", "roof", "rooftop"]
_INTERIOR_TERMS = ["interior", "indoor", "inside", "recessed", "below floor", "lightwell"]
_CURB_MOUNTED_TERMS = ["curb mount", "curb-mount", "curb mounted", "curb-mounted"]
_DECK_PERIMETER_TERMS = ["deck perimeter"]
_THERMALLY_BROKEN_TERMS = ["thermally broken", "tb", "thermal break", "thermally-broken", "avoid condensation", "prevent condensation"]
_NOT_THERMALLY_BROKEN_TERMS = ["do not need to be thermally broken", "not need to be thermally broken", "non-thermally broken", "not thermally broken", "no thermal break"]


def _unit_text(unit: "CanonicalUnit") -> str:
    parts = [unit.verbatim or "", unit.location_description or "", unit.reasoning or ""]
    return " ".join(parts).lower()


def _make_signal(value, confidence="MEDIUM", verbatim=None) -> "SignalField":
    return SignalField(value=value, confidence=confidence, verbatim=verbatim)

import re
def _has_word(text: str, terms: list[str]) -> bool:
    return any(re.search(r'\b' + re.escape(w.lower()), text) for w in terms)



class UnitCanonicalView:
    """
    Wraps a global CanonicalSignals and overrides per-unit signals
    derived from the unit's own verbatim + location_description.
    """

    def __init__(self, global_canonical: "CanonicalSignals", unit: "CanonicalUnit"):
        self._global = global_canonical
        self._unit = unit
        self._text = _unit_text(unit)
        self._build_overrides()

    def _build_overrides(self):
        t = self._text
        
        if self._unit.is_walkable is not None:
            self._is_walkable = _make_signal(self._unit.is_walkable, verbatim=self._unit.verbatim)
        else:
            is_non_walkable = _has_word(t, ["non-walkable", "non walkable", "not walkable", "non-walk"])
            if is_non_walkable:
                walkable = False
            else:
                walkable = _has_word(t, _WALKABLE_TERMS)
            self._is_walkable = _make_signal(walkable, verbatim=self._unit.verbatim)

        if self._unit.is_exterior is not None:
            self._is_exterior = _make_signal(self._unit.is_exterior, verbatim=self._unit.verbatim)
        else:
            is_ext = _has_word(t, _EXTERIOR_TERMS)
            is_int = _has_word(t, _INTERIOR_TERMS)
            if is_ext and not is_int:
                self._is_exterior = _make_signal(True, verbatim=self._unit.verbatim)
            elif is_int and not is_ext:
                self._is_exterior = _make_signal(False, verbatim=self._unit.verbatim)
            else:
                g = self._global.glass_signals
                self._is_exterior = (g.is_exterior if g else None)

        is_tb = _has_word(t, _THERMALLY_BROKEN_TERMS)
        not_tb = _has_word(t, _NOT_THERMALLY_BROKEN_TERMS)
        if not_tb:
            self._is_thermally_broken = _make_signal(False, verbatim=self._unit.verbatim)
        elif is_tb:
            self._is_thermally_broken = _make_signal(True, verbatim=self._unit.verbatim)
        else:
            fs = self._global.frame_signals
            self._is_thermally_broken = fs.is_thermally_broken if fs else None

        # install_type — Check if global extraction strongly confidently stated RECESSED or PEDESTAL
        global_install = self._global.frame_signals.install_type if self._global.frame_signals else None
        is_global_strong = False
        
        if global_install and global_install.is_stated():
            val = str(global_install.value).strip().upper()
            if val in ("RECESSED", "PEDESTAL", "CURB_MOUNTED", "DECK_PERIMETER"):
                conf = global_install.confidence
                if isinstance(conf, str) and conf.upper() == "HIGH":
                    is_global_strong = True
                elif isinstance(conf, (int, float)) and conf >= 80:
                    is_global_strong = True
                    
        if is_global_strong:
            self._install_type = global_install
        elif _has_word(t, _RECESSED_TERMS):
            self._install_type = _make_signal("RECESSED", verbatim=self._unit.verbatim)
        elif _has_word(t, _CURB_MOUNTED_TERMS):
            self._install_type = _make_signal("CURB_MOUNTED", verbatim=self._unit.verbatim)
        elif _has_word(t, _DECK_PERIMETER_TERMS):
            self._install_type = _make_signal("DECK_PERIMETER", verbatim=self._unit.verbatim)
        elif _has_word(t, _PEDESTAL_TERMS):
            self._install_type = _make_signal("PEDESTAL", verbatim=self._unit.verbatim)
        else:
            # Fallback to global if explicitly stated, otherwise NOT_STATED
            if global_install and global_install.is_stated():
                self._install_type = global_install
            else:
                self._install_type = _make_signal("NOT_STATED", confidence="LOW")

    @property
    def project_id(self): return self._global.project_id
    @property
    def source_file(self): return self._global.source_file
    @property
    def units(self): return [self._unit]
    @property
    def location_signals(self): return self._global.location_signals
    @property
    def addon_signals(self): return self._global.addon_signals
    @property
    def header_signals(self): return self._global.header_signals

    @property
    def glass_signals(self):
        if self._global.glass_signals is None:
            return None
        return GlassSignals(
            is_walkable=self._is_walkable,
            is_exterior=self._is_exterior,
            has_air_gap=self._global.glass_signals.has_air_gap,
            has_conditioned_space_below=self._global.glass_signals.has_conditioned_space_below,
            has_wine_cellar_below=self._global.glass_signals.has_wine_cellar_below,
            has_open_space_below=self._global.glass_signals.has_open_space_below,
            is_stair_tread=self._global.glass_signals.is_stair_tread,
            is_egr=self._global.glass_signals.is_egr,
            is_replacement_glass_only=self._global.glass_signals.is_replacement_glass_only,
            is_glass_2_0=self._global.glass_signals.is_glass_2_0,
        )

    @property
    def frame_signals(self):
        if self._global.frame_signals is None:
            return None
        return FrameSignals(
            frame_type_stated=self._global.frame_signals.frame_type_stated,
            install_type=self._install_type,
            assembly_type=self._global.frame_signals.assembly_type,
            is_thermally_broken=self._is_thermally_broken,
            is_existing_structure=self._global.frame_signals.is_existing_structure,
            is_new_deck_construction=self._global.frame_signals.is_new_deck_construction,
            panel_configuration=self._global.frame_signals.panel_configuration,
            is_custom_radius=self._global.frame_signals.is_custom_radius,
            product_type=self._global.frame_signals.product_type,
        )

    def get_glass(self, field_name: str):
        gs = self.glass_signals
        return getattr(gs, field_name, None) if gs else None

    def get_frame(self, field_name: str):
        fs = self.frame_signals
        return getattr(fs, field_name, None) if fs else None

    def get_location(self, field_name: str):
        return self._global.get_location(field_name)

    def is_canadian(self): return self._global.is_canadian()
    def is_expedited(self): return self._global.is_expedited()

    @property
    def diameter_inches(self) -> Optional[float]:
        return getattr(self._unit, "diameter_inches", None)

    def primary_panel_count(self):
        if self._unit.panel_count is not None:
            return self._unit.panel_count
        return self._global.primary_panel_count() if hasattr(self._global, 'primary_panel_count') else None
