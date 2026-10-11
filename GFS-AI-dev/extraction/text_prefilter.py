"""
text_prefilter.py — Pre-filters drawing pages using Azure DI OCR text before calling Vision Classifier.

Purpose:
Determines whether a drawing page can bypass the Vision Classifier LLM based on its text content.
- If page text explicitly describes non-glass interior rooms (closets, bathrooms, kitchens) with zero glass terms -> SKIP_VISION.
- If page text contains glass product terms, skylights, glazing, schedules, or roof/floor plan markers -> SEND_VISION.
- If text is blank or uncertain -> UNCERTAIN.
"""

import re
import difflib
from typing import Tuple

# ── 1. Glass & GFS Product Keyword Patterns ───────────────────────────────────
GLASS_EXACT_PHRASES = [
    "glass floor", "glass deck", "glass bridge", "glass stair", "glass catwalk",
    "glass walkway", "walkable skylight", "walkable glass", "structural glass",
    "glass railing", "glass balustrade", "glass canopy", "glass panel",
    "glass roof", "glass floor panel", "interior glass floor", "exterior glass floor",
    "skylight", "skylights", "glazing", "curtainwall", "curtain wall",
    "gl flr", "gl. flr.", "skylt"
]

GLASS_SINGLE_TOKENS = [
    "skylight", "skylights", "glazing", "curtainwall",
    "marvin", "velux", "solatube", "lamilux"
]

GLASS_SHORT_CODES = [
    r"\bSK-\d+", r"\bSL-\d+", r"\bWS-\d+", r"\bGL-\d+", r"\bGF-\d+"
]

# Non-glass interior room detail keywords
SKIP_ROOM_PHRASES = [
    "coat closet", "his dressing", "her dressing", "shoes & bag", "shoes and bag",
    "powder room", "guest dressing", "bath elevation", "bathroom elevation",
    "kitchen elevation", "pantry elevation", "vanity detail", "millwork detail",
    "cabinetry detail", "plumbing fixture schedule", "fire protection",
    "telecom", "low voltage", "hvac detail", "stair hall", "cellar vestibule",
    "cellar gym", "foyer elevation", "laundry elevation"
]

SKIP_SINGLE_TOKENS = [
    "closet", "dressing", "cabinetry", "millwork", "plumbing", "telecom",
    "foyer", "vestibule", "gym", "laundry"
]

# Architectural & Structural sheet code pattern (A-100..A-999, S-100..S-999, A1.0, S1.0)
ARCH_STRUCT_SHEET_PATTERN = r"\b(A|S)-?\d{1,3}(\.\d+)?\b"

# Discipline prefixes that NEVER contain GFS structural glass products:
# M (Mechanical/HVAC), E (Electrical), P (Plumbing), FP (Fire Protection),
# C (Civil), L (Landscape), T (Telecom/Low Voltage/Title), S (Structural),
# FR (Framing), AS (Attic/Soffit), D (Demolition)
# Flexible regex matches formats: C1.0, C-1.0, C100, C-100, C1.00, C-100.00
DISCIPLINE_SKIP_PATTERNS = [
    r"\b(C|M|E|P|FP|L|T|S|FR|AS|D)-?(\d+\.\d+|\d{2,})\b"
]

# Standard AIA Sheet series for interior enlarged room elevations/details (A-300 to A-399)
ENLARGED_ROOM_SHEET_CODES = [
    r"\bA-3\d{2}\.\d{2}\b", r"\bA-3\d{2}\b", r"\bAD-3\d{2}\b"
]

KEEP_PLAN_SCHEDULE_TOKENS = [
    "glazing schedule", "window schedule", "railing schedule", "glass schedule",
    "roof plan", "skylight detail", "roof terrace"
]

# Fuzzy match targets for OCR typos (e.g. "skylght", "glas floor")
FUZZY_TARGETS = [
    "skylight", "glazing", "curtainwall", "walkable", "balustrade", "catwalk"
]


def evaluate_page_text(page_text: str) -> Tuple[str, str]:
    """
    Evaluates Azure DI OCR text for a single page.
    Returns:
        (decision, reason)
        decision is one of: "SEND_VISION", "SKIP_VISION", "UNCERTAIN"
    """
    if not page_text or not page_text.strip():
        return "UNCERTAIN", "Page text is empty."

    text_lower = page_text.lower()

    # ── Step 1: Check for EXPLICIT GLASS keywords/phrases (Glazing Override) ─────
    for phrase in GLASS_EXACT_PHRASES:
        if phrase in text_lower:
            return "SEND_VISION", f"Found explicit glass term: '{phrase}'"

    for code_pattern in GLASS_SHORT_CODES:
        if re.search(code_pattern, page_text, re.IGNORECASE):
            return "SEND_VISION", f"Found glass callout code matching '{code_pattern}'"

    # Regex word boundaries for single tokens (prevent 'fiberglass' matching 'glass')
    for token in GLASS_SINGLE_TOKENS:
        if re.search(rf"\b{token}\b", text_lower):
            return "SEND_VISION", f"Found glass keyword token: '{token}'"

    # ── Step 2: Check for Fuzzy Matching (OCR typos) ─────────────────────────
    words = re.findall(r"\b[a-z]{4,15}\b", text_lower)
    for word in words:
        for target in FUZZY_TARGETS:
            if word != target and len(word) >= len(target) - 2:
                ratio = difflib.SequenceMatcher(None, word, target).ratio()
                if ratio >= 0.82:
                    return "SEND_VISION", f"Found fuzzy match '{word}' ~ '{target}' (ratio: {ratio:.2f})"

    if re.search(r"\bglas\s+(floor|deck|panel|railing|roof)\b", text_lower):
        return "SEND_VISION", "Found OCR typo 'glas [product]'"

    # ── Step 3: Check for Schedules / Roof Plans ──────────────────────────────
    for plan_token in KEEP_PLAN_SCHEDULE_TOKENS:
        if plan_token in text_lower:
            return "SEND_VISION", f"Found plan/schedule keyword: '{plan_token}'"

    # ── Step 4: Check for Non-Architectural Engineering/Structural Sheet Codes (M, E, P, FP, C, L, T, S, FR, AS, D) ──
    # Since we already checked for glazing overrides, matching a trade prefix means we can safely skip!
    # Spatial/Ordering check: find the sheet number, which is typically the last matched code on the page.
    all_disc_matches = []
    for disc_pattern in DISCIPLINE_SKIP_PATTERNS:
        matches = re.findall(disc_pattern, page_text, re.IGNORECASE)
        if matches:
            all_disc_matches.extend(matches)
    
    # If the page contains a skip prefix drawing code, check if there's any architectural reference that might suggest a keep.
    # To prevent references in specs from skipping, we only trigger skip if no KEEP prefixes (A, G, GL) are found in the text.
    has_keep_ref = bool(re.search(r"\b(A|G|GL|AD|AG)-?(\d{2,4}(?:\.\d+)?)\b", page_text, re.IGNORECASE))
    if all_disc_matches and not has_keep_ref:
        # Get the prefix of the last matched trade code
        last_prefix = all_disc_matches[-1][0].upper()
        return "SKIP_VISION", f"Matched engineering discipline sheet code prefix: '{last_prefix}'"

    # ── Step 5: Check for EXPLICIT SKIP keywords across the ENTIRE page ──────
    for skip_phrase in SKIP_ROOM_PHRASES:
        if skip_phrase in text_lower:
            return "SKIP_VISION", f"Matched non-glass interior detail: '{skip_phrase}'"

    # Check title block sheet codes / title lines across full text
    for skip_token in SKIP_SINGLE_TOKENS:
        if re.search(rf"\b{skip_token}\b", text_lower):
            return "SKIP_VISION", f"Matched non-glass room title token: '{skip_token}'"

    # Check AIA A-300 series sheet numbers (Interior Enlarged Plans & Elevations)
    for sheet_pattern in ENLARGED_ROOM_SHEET_CODES:
        if re.search(sheet_pattern, page_text, re.IGNORECASE):
            return "SKIP_VISION", f"Matched enlarged room elevation sheet series A-300+: '{sheet_pattern}'"

    # ── Step 6: Default to UNCERTAIN (Safe Fallback to Vision Classifier) ─────
    return "UNCERTAIN", "Text inconclusive, defaulting to Vision Classifier."
