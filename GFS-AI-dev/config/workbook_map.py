from __future__ import annotations

# ---------------------------------------------------------------------------
# config/workbook_map.py
#This is fake change
# Single source of truth for all Master Workbook row/column positions.
# If GFS restructures the sheet, update here — nowhere else.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Proposal description rows (C128-C142)
# Maps ProposalDescription enum member name -> Excel row number.
# ---------------------------------------------------------------------------
PROPOSAL_ROWS: dict[str, int] = {
    "S1000_PEDESTAL_FA":     128,
    "S1000_PEDESTAL_KD":     129,
    "S1000_RECESSED_FA":     130,
    "S1000_RECESSED_KD":     131,
    "S1000_RECESSED_INT_FA": 132,
    "S1000_RECESSED_INT_KD": 133,
    "EFRAME_GASKET":         134,
    "EFRAME_CUT":            135,
    "JUST_GLASS":            136,
    "STAIR_TREADS_LAMI":     137,
    "DECK":                  138,
    "S2000_PEDESTAL_FA":     139,
    "S2000_PEDESTAL_KD":     140,
    "S2000_RECESSED_FA":     141,
    "S2000_RECESSED_KD":     142,
}

# ---------------------------------------------------------------------------
# Glass type rows (rows 9-14)
# Maps GlassType enum member name -> Excel row number.
# ---------------------------------------------------------------------------
GLASS_TYPE_ROWS: dict[str, int] = {
    "GLASS_NO_IGU":   9,
    "GLASS_WITH_IGU": 10,
    "GLASS_2_0":      11,
    "STAIR_TREAD":    12,
    "NON_WALKABLE":   13,
    "EGR":            14,
}

# ---------------------------------------------------------------------------
# Frame type rows (rows 38-47)
# Maps frame_type allowed_values (from stage_3.decision.frame_type in the
# rules engine) -> Excel row number on the Pricing Worksheet.
# Each row has per-unit IF formulas: IF(D38="y", $I$115, 0) for unit A, etc.
# None means no frame cost row applies for that type (e.g. MANUAL).
# ---------------------------------------------------------------------------
FRAME_TYPE_ROWS: dict[str, int | None] = {
    "SERIES_2000_RECESSED": 42,
    "SERIES_2000_PEDESTAL":  41,
    "SERIES_1000_PEDESTAL":  38,
    "SERIES_1000_RECESSED":  39,
    "PERIMETER_NON_TB":      40,
    "DECK_PERIMETER":        46,
    "ECONOFRAME":            47,
    "SERIES_3000":           45,
    "MANUAL":                None,
}

# ---------------------------------------------------------------------------
# Add-on rows
# Maps add-on name -> Excel row number.
# ---------------------------------------------------------------------------
ADDON_ROWS: dict[str, int] = {
    "seeded_organic": 107,
    "blur":           108,
    "heat_soak":      109,
    "nano_dot":       110,
    "sentry_glass":   16,
    "krypton_gas":    17,
    "backpaint":      20,
    "duty":           90,
}

# ---------------------------------------------------------------------------
# Add-on trigger character lookup — single source of truth.
# Keys are (row_number, selector_col_letter).
# Values are the exact character the workbook formula expects ("y" or "Y").
# Never hardcode "y" or "Y" for add-on cells anywhere in the codebase —
# always look up from this dict using (row, selector_col) as the key.
# Verified against Master Workbook template Jun 2026.
# ---------------------------------------------------------------------------
ADDON_TRIGGER_CASE: dict[tuple[int, str], str] = {
    (107, "D"): "y", (107, "G"): "y", (107, "J"): "y", (107, "M"): "y",
    (107, "P"): "y", (107, "S"): "y", (107, "V"): "y", (107, "Y"): "y",
    (107, "AB"): "y", (107, "AE"): "y",
    (108, "D"): "y", (108, "G"): "y", (108, "J"): "y", (108, "M"): "y",
    (108, "P"): "y", (108, "S"): "y", (108, "V"): "y", (108, "Y"): "y",
    (108, "AB"): "y", (108, "AE"): "y",
    (109, "D"): "Y", (109, "G"): "Y", (109, "J"): "Y", (109, "M"): "Y",
    (109, "P"): "Y", (109, "S"): "Y", (109, "V"): "Y", (109, "Y"): "Y",
    (109, "AB"): "Y", (109, "AE"): "Y",
    (110, "D"): "Y", (110, "G"): "y", (110, "J"): "y", (110, "M"): "y",
    (110, "P"): "Y", (110, "S"): "Y", (110, "V"): "Y", (110, "Y"): "Y",
    (110, "AB"): "Y", (110, "AE"): "Y",
    # Row 16 — Sentry Glass interlayer: per-unit "y"
    (16, "D"): "y", (16, "G"): "y", (16, "J"): "y", (16, "M"): "y",
    (16, "P"): "y", (16, "S"): "y", (16, "V"): "y", (16, "Y"): "y",
    (16, "AB"): "y", (16, "AE"): "y",
    # Row 17 — Krypton Gas: per-unit "y"
    (17, "D"): "y", (17, "G"): "y", (17, "J"): "y", (17, "M"): "y",
    (17, "P"): "y", (17, "S"): "y", (17, "V"): "y", (17, "Y"): "y",
    (17, "AB"): "y", (17, "AE"): "y",
    # Row 20 — Backpaint: per-unit "y"
    (20, "D"): "y", (20, "G"): "y", (20, "J"): "y", (20, "M"): "y",
    (20, "P"): "y", (20, "S"): "y", (20, "V"): "y", (20, "Y"): "y",
    (20, "AB"): "y", (20, "AE"): "y",
    # Row 90 — Duty: GLOBAL (column D only), uppercase "Y"
    (90, "D"): "Y",
}

# ---------------------------------------------------------------------------
# Crossbeam target rows.  Keyed by (crossbeam_value, series_context).
# series_context = "ANY" when the crossbeam value already carries series info
# (e.g. I_BEAM_TB_2000), otherwise "SERIES_1000" or "SERIES_2000".
# All crossbeam writes are GLOBAL: column D only, lowercase "y".
# ---------------------------------------------------------------------------
CROSSBEAM_ROWS: dict[tuple[str, str], int] = {
    ("I_BEAM_TB_2000", "ANY"):         58,
    ("T_SECTION_NTB",  "SERIES_1000"): 55,
    ("T_SECTION_TB",   "SERIES_1000"): 53,
    ("T_SECTION_TB",   "SERIES_2000"): 57,
    ("I_BEAM_TB",      "SERIES_1000"): 54,
    ("I_BEAM_TB",      "SERIES_2000"): 58,
}

# ---------------------------------------------------------------------------
# Take-off section
# ---------------------------------------------------------------------------

# Row number for Unit A in the take-off section.
# Unit A -> 115, B -> 116, ... J -> 124.
TAKEOFF_FIRST_ROW: int = 115

# Column letters for the take-off section per field.
TAKEOFF_COLS: dict[str, str] = {
    "location":        "B",
    "drawing_no":      "C",
    "width":           "E",
    "length":          "F",
    "num_panels":      "G",
    "num_units":       "J",
    "rafter_width":    "K",
    "rafter_length":   "L",
    "glass_thickness": "M",
}

# ---------------------------------------------------------------------------
# Unit selector columns
# Maps unit letter -> Excel column letter for the glass-type / add-on selector.
# Pattern: column index = 4 + 3*N (1-based), N is 0-indexed unit position.
# A->D(4), B->G(7), C->J(10), D->M(13), E->P(16), F->S(19),
# G->V(22), H->Y(25), I->AB(28), J->AE(31)
# ---------------------------------------------------------------------------
UNIT_SELECTOR_COLS: dict[str, str] = {
    "A": "D",
    "B": "G",
    "C": "J",
    "D": "M",
    "E": "P",
    "F": "S",
    "G": "V",
    "H": "Y",
    "I": "AB",
    "J": "AE",
}

# ---------------------------------------------------------------------------
# Recessed TB rows
# Proposal description rows that trigger the +4in rule in Stage 2.
# ---------------------------------------------------------------------------
RECESSED_TB_ROWS: frozenset[int] = frozenset({
    130,  # S1000_RECESSED_FA
    131,  # S1000_RECESSED_KD
    132,  # S1000_RECESSED_INT_FA
    133,  # S1000_RECESSED_INT_KD
    141,  # S2000_RECESSED_FA
    142,  # S2000_RECESSED_KD
})

# ---------------------------------------------------------------------------
# Header cell addresses
# Maps logical field name -> Excel cell reference for the job header section.
# If GFS restructures the sheet, update here — nowhere else.
# ---------------------------------------------------------------------------
HEADER: dict[str, str] = {
    "project_name":    "C2",
    "quote_no":        "I2",
    "person_quoting":  "L2",
    "contact_name":    "C3",
    "contact_phone":   "I3",
    "contact_email":   "L3",
    "project_type":    "C4",
    "project_address": "F2",
    "architect":       "F4",
}


# ---------------------------------------------------------------------------
# Proposal tab cell coordinates
# ---------------------------------------------------------------------------
PROPOSAL_TAB_HEADER: dict[str, str] = {
    "quote_no":        "K2",
    "date":            "K3",
    "project_name":    "K4",
    "project_address": "K5",
    "project_type":    "K6",
    "architect":       "K7",
    "contact_name":    "K8",
    "contact_phone":   "K9",
    "contact_email":   "K10",
    "person_quoting":  "K11",
}

PROPOSAL_UNIT_FIRST_ROW: int = 23

PROPOSAL_UNIT_COLS: dict[str, str] = {
    "unit_label":    "B",
    "drawing_no":    "C",
    "drawing_date":  "D",   # source TBD
    "location":      "E",
    "width":         "F",
    "separator":     "G",   # "x"
    "length":        "H",
    "description":   "J",   # source TBD
}

# ---------------------------------------------------------------------------
# Unit Qty columns (Row 71 Man Hours, Qty columns, etc.)
# A->E, B->H, C->K, D->N, E->Q, F->T, G->W, H->Z, I->AC, J->AF
# ---------------------------------------------------------------------------
UNIT_QTY_COLS: dict[str, str] = {
    "A": "E",
    "B": "H",
    "C": "K",
    "D": "N",
    "E": "Q",
    "F": "T",
    "G": "W",
    "H": "Z",
    "I": "AC",
    "J": "AF",
}
UNIT_QTY_COL = UNIT_QTY_COLS  # alias for backward compatibility

# Row number for Man Hours
MAN_HOURS_ROW: int = 71
# Row number for Packaging
PACKAGING_ROW: int = 73

# ---------------------------------------------------------------------------
# Backward-compatibility aliases and helper functions (used by cell_mapper.py)
# ---------------------------------------------------------------------------
GLASS_ROWS: dict[str, int] = GLASS_TYPE_ROWS
FRAME_ROWS: dict[str, int | None] = FRAME_TYPE_ROWS
CROSS_BEAM_ROWS = CROSSBEAM_ROWS

FABRICATION: dict[str, str] = {
    "man_hours": "E71",
    "packaging": "E73",
}

HARDWARE: dict[str, str] = {
    "tape_3m_trigger": "D69",
}

PRICING: dict[str, str] = {
    "duty_y": "D90",
}

OPTIONS_ROWS: dict[str, int] = {
    "sentry_glass":       16,
    "krypton_gas":        17,
    "colored_interlayer": 18,
    "backpaint":          20,
    "round_glass":        21,
    "embeds_titanium":    22,
    "custom_shapes":      24,
}

ADD_ALT_ROWS: dict[str, int] = {
    "seeded_organic":    107,
    "heat_soak_testing": 109,
    "nanodot":           110,
}

TAKEOFF_ROWS: dict[str, int] = {
    chr(ord("A") + i): TAKEOFF_FIRST_ROW + i for i in range(10)
}


def cell(unit_id: str, row: int) -> str:
    """Return cell address for unit QTY column at given row."""
    col = UNIT_QTY_COLS.get(unit_id.upper(), "E")
    return f"{col}{row}"


def trigger_cell(unit_id: str, row: int) -> str:
    """Return cell address for unit selector/trigger column at given row."""
    col = UNIT_SELECTOR_COLS.get(unit_id.upper(), "D")
    return f"{col}{row}"


def takeoff_cell(unit_id: str, col_key: str) -> str:
    """Return cell address in take-off section for given unit and column key."""
    row = TAKEOFF_ROWS.get(unit_id.upper(), 115)
    col = TAKEOFF_COLS.get(col_key, "E")
    return f"{col}{row}"


def proposal_cell(unit_id: str, col_key: str) -> str:
    """Return cell address in proposal units section for given unit and column key."""
    unit_index = ord(unit_id.upper()) - ord("A")
    row = PROPOSAL_UNIT_FIRST_ROW + unit_index
    col = PROPOSAL_UNIT_COLS.get(col_key, "B")
    return f"{col}{row}"

