"""
Content Parser — Parses Docling's Markdown output into GFS field candidates.
Uses regex + heuristics to extract known patterns without any LLM.
"""

import re
from typing import Optional

def extract_emails(text: str) -> list[str]:
    """Find all email addresses in text."""
    return list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)))


def extract_phones(text: str) -> list[str]:
    """Find all phone numbers in text."""
    patterns = [
        r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        r'\d{3}[-.\s]\d{3}[-.\s]\d{4}',
    ]
    phones = []
    for pat in patterns:
        phones.extend(re.findall(pat, text))
    return list(set(phones))


def extract_address(text: str) -> Optional[str]:
    """Find a US/Canada street address."""
    addr_pattern = r'\d{1,5}\s+[\w\s]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr(?:ive)?|Blvd|Boulevard|Ln|Lane|Way|Ct|Court|Pl|Place)\b[^,]*,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?'
    matches = re.findall(addr_pattern, text, re.IGNORECASE)
    return matches[0] if matches else None


def extract_quote_number(text: str) -> Optional[str]:
    """Find quote/order/proposal number."""
    patterns = [
        r'(?:Quote|Order|Proposal|Est)\s*#?\s*:?\s*(\d{4,6}(?:\s+Rev\s+\w+)?)',
        r'(?:Q|O|P|Est)#\s*(\d{4,6})',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def extract_dimensions_from_table(text: str) -> list[dict]:
    """
    Parse text for dimension data.
    """
    units = []
    seen: set = set()
    lines = text.split("\n")

    _dim_re = re.compile(
        r"(\d+(?:\.\d+)?)\s*(?:''|['\"])?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:''|['\"])?"
    )

    for line in lines:
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.split("|") if c.strip()]
        for cell in cells:
            dim_match = _dim_re.search(cell)
            if dim_match:
                w = float(dim_match.group(1))
                h = float(dim_match.group(2))
                key = (min(w, h), max(w, h))
                if key not in seen:
                    seen.add(key)
                    raw_label = dim_match.group(0).strip()
                    units.append({"width": min(w, h), "length": max(w, h), "raw": raw_label})

    for line in lines:
        if "|" in line:
            continue
        for dim_match in _dim_re.finditer(line):
            w = float(dim_match.group(1))
            h = float(dim_match.group(2))
            if w < 4 or h < 4 or w > 5000 or h > 5000:
                continue
            key = (min(w, h), max(w, h))
            if key not in seen:
                seen.add(key)
                units.append({"width": min(w, h), "length": max(w, h), "raw": ""})

    return units


def extract_unit_labels(text: str) -> list[str]:
    """Find unit labels (A, B, C, etc.) in text."""
    matches = re.findall(r'(?:Unit|UNIT)\s+([A-Z])', text)
    if matches:
        return list(set(matches))

    matches = re.findall(r'\|\s*([A-Z])\s*\|.*\d+\s*[xX×]', text)
    if matches:
        return list(set(matches))

    return []


def extract_glass_type(text: str) -> Optional[str]:
    """Determine glass type from text."""
    text_lower = text.lower()

    if "insulated glass" in text_lower or "igu" in text_lower or "with igu" in text_lower:
        return "Glass - with IGU"
    if "glass 2.0" in text_lower:
        return "Glass 2.0 system"
    if "non-walkable" in text_lower or "skylight" in text_lower:
        return "Non-Walkable glass"
    if "stair" in text_lower and "tread" in text_lower:
        return "Stair treads"
    if "back paint" in text_lower or "egr" in text_lower:
        return "EGR"
    if "no igu" in text_lower or "single pane" in text_lower:
        return "Glass - no IGU"

    return None


def extract_system_type(text: str) -> Optional[str]:
    """Determine system type from text."""
    text_upper = text.upper()

    system_types = [
        ("Series 1000 Pedestal TB - FA", ["SERIES 1000", "PEDESTAL", "FULLY ASSEMBLED"]),
        ("Series 1000 Pedestal TB - KD", ["SERIES 1000", "PEDESTAL", "KNOCK DOWN"]),
        ("Series 1000 Recessed TB - FA", ["SERIES 1000", "RECESSED", "FULLY ASSEMBLED"]),
        ("Series 1000 Recessed TB - KD", ["SERIES 1000", "RECESSED", "KNOCK DOWN"]),
        ("Series 2000 Pedestal TB - FA", ["SERIES 2000", "PEDESTAL", "FULLY ASSEMBLED"]),
        ("Series 2000 Pedestal TB - KD", ["SERIES 2000", "PEDESTAL", "KNOCK DOWN"]),
        ("Series 2000 Recessed TB - FA", ["SERIES 2000", "RECESSED", "FULLY ASSEMBLED"]),
        ("Series 2000 Recessed TB - KD", ["SERIES 2000", "RECESSED", "KNOCK DOWN"]),
        ("eFrame and Gasket", ["ECONOFRAME", "EFRAME", "GASKET"]),
        ("eFrame Cut to Size", ["ECONOFRAME", "CUT TO SIZE"]),
        ("Just Glass", ["GLASS ONLY", "REPLACEMENT GLASS"]),
        ("Stair Treads", ["STAIR", "TREAD"]),
        ("Deck", ["DECK", "MGDS"]),
    ]

    for name, keywords in system_types:
        if all(kw in text_upper for kw in keywords):
            return name

    if "SERIES 2000" in text_upper and "RECESSED" in text_upper:
        return "Series 2000 Recessed TB - FA"
    if "SERIES 1000" in text_upper and "RECESSED" in text_upper:
        return "Series 1000 Recessed TB - FA"
    if "SERIES 2000" in text_upper:
        return "Series 2000 Recessed TB - FA"
    if "SERIES 1000" in text_upper:
        return "Series 1000 Recessed TB - FA"
    if "SKYFLOOR" in text_upper:
        return "Series 2000 Recessed TB - FA"

    return None


def extract_addons(text: str) -> dict:
    """Extract add-on selections from text."""
    text_lower = text.lower()

    return {
        "nano_dot": "Y" if "nanodot" in text_lower or "nano dot" in text_lower else "N",
        "seeded_organic": "Y" if "seeded organic" in text_lower else "N",
        "heat_soak_testing": "Y" if "heat soak" in text_lower or "hst" in text_lower else "N",
        "back_paint": "Y" if "back paint" in text_lower else "N",
    }


def parse_content(extraction_result: dict) -> dict:
    """
    Parse Docling extraction output into GFS field candidates.
    """
    text = extraction_result.get("text_content", "")
    flagged = extraction_result.get("flagged_items", [])

    emails = extract_emails(text)
    phones = extract_phones(text)
    address = extract_address(text)
    quote = extract_quote_number(text)
    unit_labels = extract_unit_labels(text)
    dimensions = extract_dimensions_from_table(text)
    glass_type = extract_glass_type(text)
    system_type = extract_system_type(text)
    addons = extract_addons(text)

    missing = []
    if not address:
        missing.append("project_address")
    if not unit_labels and not dimensions:
        missing.append("dimensions")
    if not glass_type:
        missing.append("glass_type")
    if not system_type:
        missing.append("system_type")

    for item in flagged:
        if item["type"] == "image":
            missing.append(f"image:{item['file']}")
        elif item["type"] == "scanned_pdf":
            missing.append(f"scanned:{item['file']}")

    return {
        "extracted_fields": {
            "contact_email": emails[0] if emails else None,
            "contact_phone": phones[0] if phones else None,
            "project_address": address,
            "quote_number": quote,
            "unit_labels": unit_labels,
            "glass_type": glass_type,
            "system_type": system_type,
            "nano_dot": addons["nano_dot"],
            "seeded_organic": addons["seeded_organic"],
            "heat_soak_testing": addons["heat_soak_testing"],
            "back_paint": addons["back_paint"],
            "dimensions_from_table": dimensions,
        },
        "needs_llm": missing,
        "flagged_items": flagged,
        "raw_text": text[:5000],
    }
