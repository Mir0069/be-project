"""
page_filter.py — Two-pass sheet-code-based page filter for drawing sets.

Purpose
-------
Large architectural drawing sets (400+ pages) contain many pages irrelevant to
glass estimating: plumbing, electrical, mechanical, general notes, code
compliance, finish schedules, etc. A human estimator only reads architectural
plans (A-prefix), architectural sections (A5xx / A8xx), structural (S-prefix),
and window/skylight schedules. This filter narrows Vision's workload to the
same subset.

How
---
Pass 1 — Find the sheet index page (keyword: 'sheet index', 'drawing index',
'list of drawings', 'sheet list'). Parse it to build the authoritative map of
sheet codes → sheet names for THIS project.

Pass 2 — For each page, look at the last portion of its text (title-block
region) and find which known sheet code appears there. Classify by prefix.

Prefix rules (from Dan Muniz walkthrough, June 2026):
  KEEP: A (architectural), S (structural)
  SKIP: AD (arch details), P (plumbing), E (electrical), M (mechanical),
        G (general/code compliance), C (civil), L (landscape), T (telecom),
        FS (fire suppression), FP (fire protection)

Keyword overrides — always applied regardless of code:
  ALWAYS KEEP: 'walkable', 'walk-on', 'walk on glass', 'window schedule',
               'skylight schedule'
  ALWAYS SKIP: 'finish schedule' (unless walkable/skylight keyword also present)

Safety net: if no sheet index is found (small drawing sets, residential
projects, lead sheets, quotes, transcripts) → return None to disable filtering.
Zero risk of over-filtering documents that don't have this structure.
"""

from __future__ import annotations

import re

# Prefixes that identify sheets a human estimator reads
KEEP_PREFIXES = {"A", "S"}

# Prefixes that identify sheets a human estimator skips
SKIP_PREFIXES = {"AD", "P", "E", "M", "G", "C", "L", "T", "FS", "FP"}

# Keywords that force KEEP regardless of sheet code
ALWAYS_KEEP_KEYWORDS = [
    "walkable",
    "walk-on",
    "walk on glass",
    "window schedule",
    "skylight schedule",
]

# Keywords that force SKIP unless a KEEP keyword also appears
ALWAYS_SKIP_KEYWORDS = [
    "finish schedule",
]

# Keywords that identify a sheet index page
SHEET_INDEX_KEYWORDS = [
    "sheet index",
    "drawing index",
    "list of drawings",
    "sheet list",
]

# Regex for sheet codes in two common formats: A101 style and A5.01 style
# The prefix group allows one or two letters (A, S, AD, FS, FP, etc.)
_SHEET_CODE_RE = re.compile(
    r"\b([A-Z]{1,2})[\-\s]?(\d{1,3}(?:\.\d{1,2})?)\b"
)


def _find_sheet_index_page(full_text_by_page: dict) -> int | None:
    """Return the page number containing a sheet index, or None if not found."""
    for page_num_key, text in full_text_by_page.items():
        if not text:
            continue
        text_lower = text.lower()
        for kw in SHEET_INDEX_KEYWORDS:
            if kw in text_lower:
                try:
                    return int(page_num_key)
                except (ValueError, TypeError):
                    continue
    return None


def _parse_sheet_index(text: str) -> set[str]:
    """
    Extract sheet codes from the sheet index page text.
    Returns a set of normalised codes like {'A1.01', 'A5.01', 'AD-1', 'E4.01'}.
    """
    codes: set[str] = set()
    for m in _SHEET_CODE_RE.finditer(text):
        prefix = m.group(1).upper()
        num = m.group(2)
        if prefix in KEEP_PREFIXES or prefix in SKIP_PREFIXES:
            codes.add(f"{prefix}{num}")
    return codes


def _classify_page(
    page_text: str,
    known_codes: set[str],
) -> tuple[bool, str]:
    """
    Return (keep: bool, reason: str) for a single page.

    Priority order:
      1. ALWAYS_KEEP_KEYWORDS present → KEEP
      2. ALWAYS_SKIP_KEYWORDS present (and no KEEP keyword) → SKIP
      3. Match page's own sheet code from the last portion of text
         → classify by prefix (KEEP or SKIP)
      4. No code found → default KEEP (safe fallback)
    """
    if not page_text:
        return True, "empty page (default keep)"

    text_lower = page_text.lower()

    # Priority 1: always-keep keywords
    for kw in ALWAYS_KEEP_KEYWORDS:
        if kw in text_lower:
            return True, f"keep keyword: {kw}"

    # Priority 2: always-skip keywords
    for kw in ALWAYS_SKIP_KEYWORDS:
        if kw in text_lower:
            return False, f"skip keyword: {kw}"

    # Priority 3: match this page's OWN sheet code from title-block region
    # Title block is typically in the last 25% of Azure DI's page text
    n = len(page_text)
    tail = page_text[int(n * 0.75):]

    # Walk backwards through matches — title block code is typically last
    matches = list(_SHEET_CODE_RE.finditer(tail))
    for m in reversed(matches):
        prefix = m.group(1).upper()
        num = m.group(2)
        code = f"{prefix}{num}"
        if known_codes and code not in known_codes:
            continue
        if prefix in KEEP_PREFIXES:
            return True, f"own sheet code {code} (keep prefix {prefix})"
        if prefix in SKIP_PREFIXES:
            return False, f"own sheet code {code} (skip prefix {prefix})"

    # Priority 4: no code found → default keep
    return True, "no sheet code found (default keep)"


def select_vision_pages(full_text_by_page: dict) -> set[int] | None:
    """
    Return the set of page numbers Vision should process, or None to process all.

    Returns None when:
      - No sheet index page is found (small documents, non-drawing files)
      - The index page is found but no valid sheet codes could be parsed
      - Fewer than 10 pages total (small enough to not need filtering)
    """
    if not full_text_by_page:
        return None

    # Normalise keys to int for consistent lookup
    pages: dict[int, str] = {}
    for k, v in full_text_by_page.items():
        try:
            pages[int(k)] = v or ""
        except (ValueError, TypeError):
            continue

    # Don't filter small documents
    if len(pages) < 10:
        return None

    index_page = _find_sheet_index_page(full_text_by_page)
    if index_page is None:
        return None

    index_text = pages.get(index_page, "")
    known_codes = _parse_sheet_index(index_text)
    if not known_codes:
        return None

    keep: set[int] = {index_page}  # always keep the index page itself

    for page_num, page_text in pages.items():
        if page_num == index_page:
            continue
        should_keep, _reason = _classify_page(page_text, known_codes)
        if should_keep:
            keep.add(page_num)

    return keep
