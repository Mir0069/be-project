# extraction/local_prefilter.py
import re
import fitz
from pathlib import Path

# Match sheet codes like A-101.00, S-102, FR-100, etc.
# Prefixes: A, G, GL, AD, AG, S, M, E, P, C, L, T, FP, FR, AS, D
SHEET_PATTERN = re.compile(
    r"\b(A|G|GL|AD|AG|S|M|E|P|C|L|T|FP|FR|AS|D)[-.]?(\d{2,4}(?:\.\d+)?)\b",
    re.IGNORECASE
)

SKIP_PREFIXES = {"S", "M", "E", "P", "C", "L", "T", "FP", "FR", "AS", "D"}
KEEP_PREFIXES = {"A", "G", "GL", "AD", "AG"}

GLAZING_OVERRIDE_KEYWORDS = [
    "glass floor", "glass deck", "glass bridge", "glass stair", "glass catwalk",
    "glass walkway", "walkable skylight", "walkable glass", "structural glass",
    "glass railing", "glass balustrade", "glass canopy", "glass panel",
    "glass roof", "skylight", "skylights", "glazing", "curtainwall", "curtain wall",
    "window schedule", "glazing schedule", "glass schedule"
]

def detect_relevant_pages_locally(pdf_path: Path) -> tuple[list[int], str | None]:
    """
    Locally scans each page of the PDF using PyMuPDF.
    Returns:
        kept_pages: list of 1-indexed page numbers to process.
        pages_query_str: comma-separated page ranges (e.g. "1-7,10-26,28-30") or None if all kept.
    """
    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        print(f"[PREFILTER] Failed to open PDF locally: {exc}")
        return [], None

    total_pages = len(doc)
    kept_pages = []
    
    # If the PDF has zero pages, return empty
    if total_pages == 0:
        doc.close()
        return [], None

    # First check: Is there any extractable text at all across the entire doc?
    # If it's a completely scanned/raster image PDF, we won't find any text anywhere,
    # so we fallback to keeping all pages to let post-OCR filter them.
    has_any_text = False
    for page in doc:
        if page.get_text("text").strip():
            has_any_text = True
            break

    if not has_any_text:
        print(f"[PREFILTER] {pdf_path.name} appears to be scanned/raster (no text). Keeping all pages.")
        doc.close()
        return list(range(1, total_pages + 1)), None

    # Scan each page
    for idx, page in enumerate(doc):
        pg_num = idx + 1
        text = page.get_text("text").strip()
        
        if not text:
            # Empty page text -> keep for safety
            kept_pages.append(pg_num)
            continue

        # Find all sheet number matches on page
        matches = SHEET_PATTERN.findall(text)
        if not matches:
            kept_pages.append(pg_num)
            continue

        # Spatial order fallback: actual drawing sheet number is in the title block (bottom-right)
        # which PyMuPDF extracts last. So we use the last match prefix.
        detected_prefix = matches[-1][0].upper()
        text_lower = text.lower()
        has_glazing_keyword = any(k in text_lower for k in GLAZING_OVERRIDE_KEYWORDS)

        if detected_prefix in SKIP_PREFIXES:
            if has_glazing_keyword:
                print(f"[PREFILTER] {pdf_path.name} p{pg_num}: KEEP (Skip prefix '{detected_prefix}' override by glazing keywords)")
                kept_pages.append(pg_num)
            else:
                print(f"[PREFILTER] {pdf_path.name} p{pg_num}: SKIP (Matches prefix '{detected_prefix}')")
        else:
            kept_pages.append(pg_num)

    doc.close()

    # If we kept all pages, return None for query string (Azure DI defaults to all pages)
    if len(kept_pages) == total_pages:
        return kept_pages, None

    # Build ranges for the query string (e.g. 1,2,3,5 -> "1-3,5")
    if not kept_pages:
        # Avoid passing an empty string to Azure DI, default safely to page 1
        return [1], "1"

    ranges = []
    start = kept_pages[0]
    prev = kept_pages[0]

    for p in kept_pages[1:]:
        if p == prev + 1:
            prev = p
        else:
            if start == prev:
                ranges.append(str(start))
            else:
                ranges.append(f"{start}-{prev}")
            start = p
            prev = p
            
    if start == prev:
        ranges.append(str(start))
    else:
        ranges.append(f"{start}-{prev}")

    pages_query_str = ",".join(ranges)
    print(f"[PREFILTER] Finished filtering {pdf_path.name}: Kept {len(kept_pages)}/{total_pages} pages. Range: '{pages_query_str}'")
    return kept_pages, pages_query_str
