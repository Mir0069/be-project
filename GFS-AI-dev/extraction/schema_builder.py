"""
extraction/schema_builder.py
=============================
Converts the raw extraction JSON (Vision output) into a unified
MongoDB document using the schema defined in config/unified_schema.py.

Usage:
    from extraction.schema_builder import build_unified_doc

    extraction_json = json.loads(Path("final_result.json").read_text())
    doc = build_unified_doc(extraction_json)
    # → store doc in MongoDB
"""

from __future__ import annotations

import dataclasses
import re
from datetime import datetime, timezone
from typing import Any, Optional

from config.unified_schema import build_empty_doc, write_extracted_value, _empty_unit
from utils.io_utils import round_floats
from extraction.spec_codes import sanitize_unit_specs


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_email_format(email: str) -> bool:
    """
    Enhanced email format validation.
    Returns True if email appears to be a valid format, False otherwise.
    """
    if not email or not isinstance(email, str):
        return False
    
    email = email.strip()
    
    # Basic format check
    if "@" not in email:
        return False
    
    parts = email.split("@")
    if len(parts) != 2:
        return False
    
    local, domain = parts
    
    # Local part should not be empty and should not contain spaces
    if not local or len(local) > 64 or " " in local:
        return False
    
    # Domain should not be empty and have valid structure
    if not domain or len(domain) > 255:
        return False
    
    # Domain should have at least one dot and valid TLD
    if "." not in domain:
        return False
    
    domain_parts = domain.split(".")
    if len(domain_parts) < 2:
        return False
    
    # Check that domain parts are not empty (e.g., user@.com)
    if any(not part for part in domain_parts):
        return False
    
    # TLD should be at least 2 characters
    tld = domain_parts[-1]
    if len(tld) < 2:
        return False
    
    # Check for invalid characters
    invalid_chars = r'[<>(),;:\\\"[\]]'
    if re.search(invalid_chars, email):
        return False
    
    return True


def is_gfs_staff_email(email: str) -> bool:
    """
    Check if email appears to be a GFS staff email.
    Returns True if email matches GFS staff patterns, False otherwise.
    """
    if not email or not isinstance(email, str):
        return False
    
    email = email.strip().lower()
    
    # GFS domain patterns
    gfs_domains = [
        "glassflooringsystems.com",
        "gfs.com",
        "glassflooring.com"
    ]
    
    domain = email.split("@")[-1] if "@" in email else ""
    
    if domain in gfs_domains:
        return True
    
    # Check for common GFS staff names
    gfs_staff_names = ["dan", "frank", "wayne", "danielle"]
    local_part = email.split("@")[0] if "@" in email else ""
    
    if any(staff in local_part for staff in gfs_staff_names):
        return True
    
    return False


def normalize_phone_number(phone: str) -> Optional[str]:
    """
    Normalize phone number to a consistent format.
    Returns normalized phone number or None if invalid.
    """
    if not phone or not isinstance(phone, str):
        return None
    
    phone = phone.strip()

    # Extract extension if present (look for 'ext' or 'x' followed by digits),
    # before isolating the number below -- otherwise the extension text gets
    # discarded along with everything else after the first number.
    extension = None
    ext_match = re.search(r'(?:ext\.?|x)\s*(\d+)', phone.lower())
    if ext_match:
        extension = ext_match.group(1)
        phone = phone[:ext_match.start()]

    # A raw value can contain more than one phone number concatenated (e.g.
    # "914.323.8635 Mobile / 347.730.4479 Office" from a signature block with
    # both a mobile and office line) -- keep only the first plausible number.
    # The old character-class filter below (`[^\d+xextEXT-]`) matched 'e','x',
    # 't' as individual letters rather than the word "ext", so words like
    # "Mobile"/"Office" leaked stray letters into the cleaned string and both
    # numbers got concatenated into one garbled value. Isolate the first
    # number instead.
    first_number_match = re.search(r'\+?\d[\d\-.\s()]{5,}\d', phone)
    if first_number_match:
        phone = first_number_match.group(0)

    main_number = phone.strip()
    has_leading_plus = main_number.startswith('+')

    # Check if we have a valid number (at least 7 digits for local numbers)
    digits = re.sub(r'\D', '', main_number)
    if len(digits) < 7:
        return None
    main_number = ('+' if has_leading_plus else '') + digits
    
    # Format: +1 (XXX) XXX-XXXX for US/Canada numbers
    if len(digits) == 10 and main_number.startswith('+1'):
        formatted = f"+1 ({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    elif len(digits) == 10:
        formatted = f"+1 ({digits[0:3]}) {digits[3:6]}-{digits[6:]}"
    elif len(digits) == 11 and digits.startswith('1'):
        formatted = f"+1 ({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    else:
        # For international numbers, keep the + and format reasonably
        if main_number.startswith('+'):
            formatted = main_number
        else:
            formatted = f"+{main_number}"
    
    # Add extension if present
    if extension and extension.isdigit():
        formatted += f" ext. {extension}"
    
    return formatted


def parse_address_components(address: str) -> dict:
    """
    Parse address into components for better validation and normalization.
    Returns dict with street, city, state, zip, country components.
    """
    if not address or not isinstance(address, str):
        return {}
    
    address = address.strip()
    components = {
        "original": address,
        "street": None,
        "city": None,
        "state": None,
        "zip": None,
        "country": None
    }
    
    # Try to extract US/Canadian postal codes
    # US: 5 digits or 5-4 format
    us_zip_pattern = r'\b(\d{5})(?:[-\s]?(\d{4}))?\b'
    zip_match = re.search(us_zip_pattern, address)
    if zip_match:
        components["zip"] = zip_match.group(1)
        if zip_match.group(2):
            components["zip"] += f"-{zip_match.group(2)}"
    
    # Canadian: A1A 1A1 format
    ca_zip_pattern = r'\b([A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)\b'
    ca_match = re.search(ca_zip_pattern, address)
    if ca_match:
        components["zip"] = ca_match.group(1).upper()
        if " " not in components["zip"]:
            components["zip"] = f"{components['zip'][:3]} {components['zip'][3:]}"
        components["country"] = "CA"
    
    # Try to extract US state abbreviations
    us_states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
    for state in us_states:
        pattern = r'\b' + state + r'\b'
        if re.search(pattern, address, re.IGNORECASE):
            components["state"] = state.upper()
            if not components.get("country"):
                components["country"] = "US"
            break
    
    # Try to extract Canadian provinces
    ca_provinces = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']
    for province in ca_provinces:
        pattern = r'\b' + province + r'\b'
        if re.search(pattern, address, re.IGNORECASE):
            components["state"] = province.upper()
            components["country"] = "CA"
            break
    
    return components


def validate_address_completeness(address: str) -> dict:
    """
    Validate address completeness and return quality metrics.
    Returns dict with is_valid, quality_score, and missing_components.
    """
    if not address or not isinstance(address, str):
        return {"is_valid": False, "quality_score": 0, "missing_components": ["address"]}
    
    address = address.strip()
    if len(address) < 5:
        return {"is_valid": False, "quality_score": 0, "missing_components": ["address_too_short"]}
    
    components = parse_address_components(address)
    missing = []
    score = 0
    
    # Check for street address (should have numbers and letters)
    has_street = bool(re.search(r'\d+\s+[A-Za-z]', address))
    if has_street:
        score += 30
    else:
        missing.append("street_number")
    
    # Check for city (usually present before state/zip)
    has_city = bool(re.search(r'[A-Za-z]{3,}', address))
    if has_city:
        score += 20
    else:
        missing.append("city")
    
    # Check for state/province
    if components.get("state"):
        score += 25
    else:
        missing.append("state")
    
    # Check for postal code
    if components.get("zip"):
        score += 25
    else:
        missing.append("postal_code")
    
    return {
        "is_valid": score >= 50,
        "quality_score": score,
        "missing_components": missing,
        "components": components
    }


def enhance_customer_data_quality(customer_data: dict) -> dict:
    """
    Apply enhanced validation and normalization to customer data fields.
    Returns cleaned customer data dict with quality metrics.
    """
    enhanced = {}
    quality_metrics = {}
    
    # Enhanced email validation
    if customer_data.get("contact_email"):
        email = str(customer_data["contact_email"]).strip().lower()
        if validate_email_format(email):
            enhanced["contact_email"] = email
            quality_metrics["email_valid"] = True
        else:
            quality_metrics["email_valid"] = False
            quality_metrics["email_issue"] = "invalid_format"
    
    # Enhanced phone normalization
    if customer_data.get("contact_phone"):
        phone = str(customer_data["contact_phone"]).strip()
        normalized_phone = normalize_phone_number(phone)
        if normalized_phone:
            enhanced["contact_phone"] = normalized_phone
            quality_metrics["phone_valid"] = True
        else:
            quality_metrics["phone_valid"] = False
            quality_metrics["phone_issue"] = "invalid_format"
    
    # Enhanced address validation
    if customer_data.get("contact_address"):
        address = str(customer_data["contact_address"]).strip()
        address_validation = validate_address_completeness(address)
        enhanced["contact_address"] = address
        quality_metrics["address_validation"] = address_validation
    
    if customer_data.get("project_address"):
        address = str(customer_data["project_address"]).strip()
        address_validation = validate_address_completeness(address)
        enhanced["project_address"] = address
        quality_metrics["project_address_validation"] = address_validation
    
    # Copy other fields as-is
    for key, value in customer_data.items():
        if key not in enhanced and value:
            enhanced[key] = value
    
    enhanced["_quality_metrics"] = quality_metrics
    return enhanced


def validate_extracted_header_signals(header_signals: dict) -> dict:
    """
    Post-extraction validation rules for customer data in header signals.
    Returns validation results with any corrections or warnings.
    """
    validation_results = {
        "is_valid": True,
        "warnings": [],
        "corrections": {},
        "quality_score": 100
    }
    
    if not header_signals or not isinstance(header_signals, dict):
        validation_results["is_valid"] = False
        validation_results["warnings"].append("No header signals provided")
        return validation_results
    
    # Validate contact_name
    contact_name = (header_signals.get("contact_name") or {}).get("value")
    if contact_name:
        contact_name_str = str(contact_name).strip()
        # Check for common extraction errors
        gfs_staff_names = ["dan", "frank", "wayne", "danielle", "gfs", "glass flooring systems"]
        if any(staff in contact_name_str.lower() for staff in gfs_staff_names):
            validation_results["warnings"].append(f"Potential GFS staff name extracted as contact: {contact_name}")
            validation_results["quality_score"] -= 20
        
        # Check for company names being extracted as person names
        company_keywords = ["inc", "llc", "corp", "ltd", "company", "architects", "architecture", "studio"]
        if any(keyword in contact_name_str.lower() for keyword in company_keywords):
            validation_results["warnings"].append(f"Company name possibly extracted as contact person: {contact_name}")
            validation_results["quality_score"] -= 15
    
    # Validate contact_email
    contact_email = (header_signals.get("contact_email") or {}).get("value")
    if contact_email:
        email_str = str(contact_email).strip().lower()
        if not validate_email_format(email_str):
            validation_results["warnings"].append(f"Invalid email format: {contact_email}")
            validation_results["quality_score"] -= 25
        
        # Check for GFS staff emails
        if is_gfs_staff_email(email_str):
            validation_results["warnings"].append(f"GFS staff email detected as customer contact: {contact_email}")
            validation_results["quality_score"] -= 30
        
        # Check for generic/placeholder emails
        generic_emails = ["no-reply", "noreply", "donotreply", "info@", "admin@", "support@"]
        if any(generic in email_str for generic in generic_emails):
            validation_results["warnings"].append(f"Generic email address detected: {contact_email}")
            validation_results["quality_score"] -= 10
    
    # Validate contact_phone
    contact_phone = (header_signals.get("contact_phone") or {}).get("value")
    if contact_phone:
        phone_str = str(contact_phone).strip()
        normalized = normalize_phone_number(phone_str)
        if not normalized:
            validation_results["warnings"].append(f"Invalid phone number format: {contact_phone}")
            validation_results["quality_score"] -= 20
        else:
            validation_results["corrections"]["contact_phone"] = normalized
    
    # Validate contact_address vs project_address
    contact_address = (header_signals.get("contact_address") or {}).get("value")
    project_address = (header_signals.get("project_address") or {}).get("value")
    
    if contact_address and project_address:
        contact_str = str(contact_address).strip().lower()
        project_str = str(project_address).strip().lower()
        
        # Check if addresses are identical (possible extraction error)
        if contact_str == project_str:
            validation_results["warnings"].append("Contact address and project address are identical - possible extraction error")
            validation_results["quality_score"] -= 10
        
        # Validate address completeness
        contact_validation = validate_address_completeness(contact_address)
        project_validation = validate_address_completeness(project_address)
        
        if not contact_validation["is_valid"]:
            validation_results["warnings"].append(f"Contact address has low quality score: {contact_validation['quality_score']}")
            validation_results["quality_score"] -= 15
        
        if not project_validation["is_valid"]:
            validation_results["warnings"].append(f"Project address has low quality score: {project_validation['quality_score']}")
            validation_results["quality_score"] -= 15
    
    # Validate architect_name vs contact_name separation
    architect_name = (header_signals.get("architect_name") or {}).get("value")
    if architect_name and contact_name:
        architect_str = str(architect_name).strip().lower()
        contact_str = str(contact_name).strip().lower()
        
        if architect_str == contact_str:
            validation_results["warnings"].append("Architect name and contact name are identical - verify extraction")
            validation_results["quality_score"] -= 5
    
    # Ensure minimum quality threshold
    validation_results["is_valid"] = validation_results["quality_score"] >= 50
    
    return validation_results


def normalize_confidence(val: Any, field_name: str = None, validation_result: dict = None) -> Optional[int]:
    """
    Normalizes confidence to an integer between 0 and 100 (canonical store).
    - Classifier emits 0.0-1.0 floats -> scaled x100 (0.9 -> 90). This is the
      "confidence given 2 times" fix: previously 0.9 was stored as 1.
    - Extraction emits 0-100 ints -> clamped as-is.
    - "HIGH" -> 85, "MEDIUM" -> 60, "LOW" -> 30 (backward compat fallback)
    - None -> None
    
    Enhanced: For customer fields, adjusts confidence based on validation results.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    
    base_confidence = None
    if isinstance(val, float) and 0.0 <= val <= 1.0:
        # Ratio scale (classifier addresses/specs) -> percentage scale.
        base_confidence = max(0, min(100, int(round(val * 100))))
    elif isinstance(val, (int, float)):
        base_confidence = max(0, min(100, int(round(val))))
    elif isinstance(val, str):
        val_upper = val.strip().upper()
        if val_upper == "HIGH":
            base_confidence = 85
        elif val_upper == "MEDIUM":
            base_confidence = 60
        elif val_upper == "LOW":
            base_confidence = 30
        else:
            try:
                num = float(val)
                if 0.0 <= num <= 1.0 and "." in val.strip():
                    base_confidence = max(0, min(100, int(round(num * 100))))
                else:
                    base_confidence = max(0, min(100, int(round(num))))
            except ValueError:
                return None
    
    if base_confidence is None:
        return None
    
    # Apply confidence calibration for customer fields based on validation
    if field_name and validation_result:
        customer_fields = ["contact_name", "contact_email", "contact_phone", "contact_address", "project_address"]
        if field_name in customer_fields:
            quality_score = validation_result.get("quality_score", 100)
            warnings = validation_result.get("warnings", [])
            
            # Reduce confidence based on quality score
            if quality_score < 70:
                base_confidence = max(30, base_confidence - 20)
            elif quality_score < 85:
                base_confidence = max(40, base_confidence - 10)
            
            # Additional reduction for specific warnings
            field_specific_warnings = [w for w in warnings if field_name.replace("_", " ") in w.lower()]
            if field_specific_warnings:
                base_confidence = max(30, base_confidence - 15)
    
    return base_confidence


import re

def parse_citation_string(citation_str: str | dict, default_page: int = None, default_file: str = None) -> dict | None:
    if isinstance(citation_str, dict):
        cit = dict(citation_str)
        if not cit.get("pdf_name") and default_file:
            cit["pdf_name"] = default_file
        if not cit.get("page") and not cit.get("page_num") and default_page:
            cit["page"] = default_page
        return cit
    if not citation_str or not isinstance(citation_str, str):
        return None
    coords = re.findall(r"[-+]?\d*\.\d+|\d+", citation_str)
    if len(coords) >= 4:
        try:
            bbox = [float(c) for c in coords[:4]]
            return {
                "pdf_name": default_file,
                "page_num": default_page,
                "bbox_inches": bbox,
                "raw_citation": citation_str
            }
        except ValueError:
            pass
    return {
        "pdf_name": default_file,
        "page_num": default_page,
        "raw_citation": citation_str
    }


# Maps extraction JSON signal groups to unified schema field names
_HEADER_MAP = {
    "project_name":    "project_name",
    "project_address": "project_address",
    "project_type":    "project_type",
    "architect_name":  "architect",
    "contact_name":    "contact_name",
    "contact_address": "contact_address",
    "contact_phone":   "contact_phone",
    "contact_email":   "contact_email",
}

_GLASS_MAP = {
    "is_walkable":                "is_walkable",
    "is_exterior":                "is_exterior",
    "has_air_gap":                "has_air_gap",
    "has_conditioned_space_below":"has_conditioned_space_below",
    "has_wine_cellar_below":      "has_wine_cellar_below",
    "has_open_space_below":       "has_open_space_below",
    "is_stair_tread":             "is_stair_tread",
    "is_egr":                     "is_egr",
    "is_replacement_glass_only":  "is_replacement_glass_only",
    "is_glass_2_0":               "is_glass_2_0",
}

_FRAME_MAP = {
    "product_type":            "product_type",
    "is_custom_radius":        "is_custom_radius",
    "panel_configuration":     "panel_configuration",
    "frame_type_stated":       "frame_type_stated",
    "install_type":            "install_type",
    "is_thermally_broken":     "is_thermally_broken",
    "assembly_type":           "assembly_type",
    "is_existing_structure":   "is_existing_structure",
    "is_new_deck_construction":"is_new_deck_construction",
}

_LOCATION_MAP = {
    "project_country": "project_country",
    "project_address": "project_country",  # location_signals also has address
    "is_expedited":    "is_expedited",
}

_ADDON_MAP = {
    "has_nanodot":        "has_nanodot",
    "has_seeded_organic": "has_seeded_organic",
    "has_krypton":        "has_krypton",
}

# Unit label letters A-J
_UNIT_LABELS = list("ABCDEFGHIJ")


def normalize_lead_metadata(raw: Optional[dict]) -> dict:
    """
    Extract and normalize verified lead/classifier metadata into canonical Stage 1 keys.
    """
    if not raw or not isinstance(raw, dict):
        return {}
    normalized = {}

    sentinels = {"null", "unknown", "unknown customer", "none", "", "pending", "not_stated", "manual"}

    # Sender identities (forwarder/architect/transport). A value that
    # literally matches one of these is a sender fallback — it must never
    # outrank a real client value from any other key.
    try:
        from extraction.extraction_parser import normalize_sender_identity as _norm_sender_ids
    except Exception:
        _norm_sender_ids = None
    if _norm_sender_ids is not None:
        sender_ids = _norm_sender_ids(
            raw.get("sender"), raw.get("senderEmail"), raw.get("sender_email"),
            raw.get("fromAddress"), raw.get("from_address"),
            raw.get("senderName"), raw.get("sender_name"),
            raw.get("fromName"), raw.get("from_name"),
        )
    else:
        sender_ids = set()

    def _is_sender_match(val) -> bool:
        return bool(sender_ids) and isinstance(val, str) and val.strip().lower() in sender_ids

    def _digits(val) -> str:
        return re.sub(r"\D", "", str(val)) if val is not None else ""

    def _is_sender_phone(val) -> bool:
        if not sender_ids:
            return False
        d = _digits(val)
        if len(d) < 7:
            return False
        for s in sender_ids:
            sd = _digits(s)
            if len(sd) < 7:
                continue
            if d == sd:
                return True
            if len(d) >= 10 and len(sd) >= 10 and d[-10:] == sd[-10:]:
                return True
        return False

    # Customer / contact name: explicit CLIENT name first, sender headers last.
    # Sender (forwarder/architect) must never outrank the actual client stated
    # in the lead sheet body/signature — even when the classifier copied the
    # sender into a client-tier key, a non-sender alternative always wins.
    _name_keys = [
        "contact_name", "customerName", "customer_name",
        "clientName", "client_name",
        "senderName", "sender_name", "from_name", "fromName",
    ]
    c_name = None
    _name_is_sender_fallback = False
    for _pass, _allow_sender in (("client", False), ("fallback", True)):
        for _k in _name_keys:
            _v = raw.get(_k)
            if _v and str(_v).strip().lower() not in sentinels:
                if not _allow_sender and _is_sender_match(str(_v).strip()):
                    continue
                c_name = _v
                _name_is_sender_fallback = _is_sender_match(str(_v).strip())
                break
        if c_name:
            break
    if c_name and str(c_name).strip().lower() not in sentinels:
        normalized["contact_name"] = str(c_name).strip()
    if "contact_name" in normalized:
        normalized["_sender_fallback_name"] = bool(_name_is_sender_fallback)

    # Contact email: prioritize CLIENT email over sender/forwarder emails
    # Order of priority: client/customer emails first, then company emails, sender as last resort
    client_emails = []
    company_emails = []
    sender_emails = []
    
    # Collect all available emails
    all_email_fields = {
        "contact_email": raw.get("contact_email"),
        "customerEmail": raw.get("customerEmail"),
        "clientEmail": raw.get("clientEmail"),
        "companyEmail": raw.get("companyEmail"),
        "company_email": raw.get("company_email"),
        "senderEmail": raw.get("senderEmail"),
        "sender": raw.get("sender"),
        "fromAddress": raw.get("fromAddress"),
        "primaryBidderEmail": raw.get("primaryBidderEmail"),
        "bidderEmail": raw.get("bidderEmail"),
        "email": raw.get("email")
    }
    
    for field_name, email_value in all_email_fields.items():
        if email_value and str(email_value).strip().lower() not in sentinels:
            email_candidate = str(email_value).strip().lower()
            if validate_email_format(email_candidate) and not is_gfs_staff_email(email_candidate):
                # Categorize by field type
                if field_name in ["contact_email", "customerEmail", "clientEmail"]:
                    client_emails.append(email_candidate)
                elif field_name in ["companyEmail", "company_email"]:
                    company_emails.append(email_candidate)
                else:
                    sender_emails.append(email_candidate)

    # Prioritize: non-sender client emails > non-sender company emails >
    # sender emails. A client-tier address that literally matches the sender
    # is treated as sender fallback, never as verified client data.
    _email_is_sender_fallback = False
    _ordered_tiers = [client_emails, company_emails, sender_emails]
    _picked = None
    for _tier in _ordered_tiers:
        for _cand in _tier:
            if _cand not in sender_ids:
                _picked = _cand
                break
        if _picked:
            break
    if _picked is None:
        for _tier in _ordered_tiers:
            if _tier:
                _picked = _tier[0]
                _email_is_sender_fallback = True
                break
    else:
        _email_is_sender_fallback = _picked in sender_ids
    if _picked:
        normalized["contact_email"] = _picked
    if "contact_email" in normalized:
        normalized["_sender_fallback_email"] = bool(_email_is_sender_fallback)

    # Contact phone: classifier now provides contactPhone/customerPhone; never
    # leave header phone missing when a signature/body phone was extracted.
    # Same sender rule: a client-tier number matching the sender loses to any
    # non-sender alternative.
    _phone_keys = [
        "contact_phone", "customerPhone", "contactPhone", "companyPhone",
        "phone", "fromPhone", "phoneNumber", "mobile", "officePhone",
    ]
    c_phone = None
    _phone_is_sender_fallback = False
    for _allow_sender in (False, True):
        for _k in _phone_keys:
            _v = raw.get(_k)
            if _v and str(_v).strip().lower() not in sentinels:
                if not _allow_sender and (_is_sender_match(str(_v).strip()) or _is_sender_phone(_v)):
                    continue
                c_phone = _v
                _phone_is_sender_fallback = bool(
                    _is_sender_match(str(_v).strip()) or _is_sender_phone(_v)
                )
                break
        if c_phone:
            break
    if c_phone and str(c_phone).strip().lower() not in sentinels:
        phone_candidate = str(c_phone).strip()
        normalized_phone = normalize_phone_number(phone_candidate)
        if normalized_phone:
            normalized["contact_phone"] = normalized_phone
    if "contact_phone" in normalized:
        normalized["_sender_fallback_phone"] = bool(_phone_is_sender_fallback)

    # Project address / Job address (authoritative installation location).
    # COMPANY/BILLING addresses must never overwrite the job site.
    p_addr = raw.get("project_address") or raw.get("jobAddress") or raw.get("address")
    if p_addr and str(p_addr).strip().lower() not in sentinels:
        normalized["project_address"] = str(p_addr).strip()

    # Contact/company address: company/mailing address from signature block.
    c_addr = (
        raw.get("contact_address")
        or raw.get("companyAddress")
        or raw.get("contactAddress")
        or raw.get("company_address")
        or raw.get("mailingAddress")
        or raw.get("mailing_address")
        or raw.get("businessAddress")
        or raw.get("business_address")
    )
    if c_addr and str(c_addr).strip().lower() not in sentinels:
        address_candidate = str(c_addr).strip()
        address_validation = validate_address_completeness(address_candidate)
        if address_validation["is_valid"]:
            normalized["contact_address"] = address_candidate
    if "contact_address" not in normalized:
        # Fall back to a COMPANY/BILLING-typed address; never use INSTALLATION
        # or ARCHITECT addresses as the contact address.
        all_addrs = raw.get("allAddresses") or raw.get("all_addresses") or []
        if isinstance(all_addrs, list):
            for a in all_addrs:
                if isinstance(a, dict) and str(a.get("type", "")).upper() in ("COMPANY", "BILLING"):
                    _addr = (a.get("address") or "").strip()
                    if _addr and _addr.lower() not in sentinels:
                        normalized["contact_address"] = _addr
                        break

    # Architect
    arch = raw.get("architect") or raw.get("architect_name")
    if not arch:
        all_addrs = raw.get("allAddresses") or raw.get("all_addresses") or []
        if isinstance(all_addrs, list):
            for a in all_addrs:
                if isinstance(a, dict) and a.get("type") == "ARCHITECT":
                    arch = a.get("context") or a.get("address")
                    break
    if not arch:
        comp = raw.get("companyName") or raw.get("company")
        if comp and any(k in str(comp).lower() for k in ["architect", "design firm", "architecture", "architects", "studio"]):
            arch = comp
    if arch and str(arch).strip().lower() not in sentinels:
        normalized["architect"] = str(arch).strip()

    # Project name
    p_name = raw.get("project_name") or raw.get("projectName")
    if p_name and str(p_name).strip().lower() not in (sentinels | {"new gfs project"}):
        normalized["project_name"] = str(p_name).strip()

    # Project type (if set from lead)
    p_type = raw.get("project_type")
    if p_type and str(p_type).strip().upper() in ("RESIDENTIAL", "COMMERCIAL"):
        normalized["project_type"] = str(p_type).strip().upper()

    return normalized


def normalize_project_type_value(val) -> Optional[str]:
    """
    Canonicalize a project_type signal to RESIDENTIAL | COMMERCIAL | NOT_STATED.
    Workers (vision/text/drawing prompts) have historically emitted mixed
    casings ("residential") or descriptive phrases — without this choke point
    those flow raw into stage_1 and mismatch the estimator UI/backend enums.
    Unrecognized non-empty values become NOT_STATED (honest unknown) rather
    than leaking display-breaking text downstream. None stays None.
    """
    if val is None:
        return None
    if not isinstance(val, str):
        return None
    v = val.strip().upper()
    if not v:
        return None
    if v in ("RESIDENTIAL", "COMMERCIAL", "NOT_STATED"):
        return v
    commercial_hints = [
        "COMMERCIAL", "OFFICE", "RETAIL", "STOREFRONT", "RESTAURANT", "HOTEL",
        "SCHOOL", "UNIVERSITY", "CHURCH", "LIBRARY", "HOSPITAL", "WAREHOUSE",
        "MIXED", "PUBLIC", "BUSINESS", "INSTITUTIONAL",
    ]
    residential_hints = [
        "RESIDENTIAL", "HOUSE", "HOME", "APARTMENT", "CONDO", "TOWNHOUSE",
        "TOWNHOME", "DWELLING", "RESIDENCE", "SINGLE FAMILY", "MULTI-FAMILY",
        "MULTIFAMILY", "HOMEOWNER",
    ]
    # Commercial wins on conflict (mixed-use with any commercial component).
    for hint in commercial_hints:
        if re.search(r"\b" + re.escape(hint) + r"\b", v):
            return "COMMERCIAL"
    for hint in residential_hints:
        if re.search(r"\b" + re.escape(hint) + r"\b", v):
            return "RESIDENTIAL"
    return "NOT_STATED"


def rescue_panel_count_from_verbatim(verbatim, reasoning=None) -> Optional[int]:
    """
    Deterministic backstop for the most-missed extraction field: when Vision
    writes a complete verbatim ("14 glass panels with each having dimensions:
    37.4\\" x 25.6\\"") but leaves panel_count null, recover the count here so
    the takeoff always carries the total dimension count.

    Only matches explicit COUNT phrasing — never dimensions. Returns None
    when no unambiguous count is stated. Caps at 999 (larger numbers are
    measurements, drawing numbers, or years — never panel counts).
    """
    texts = []
    if isinstance(verbatim, str) and verbatim.strip():
        texts.append(verbatim)
    if isinstance(reasoning, str) and reasoning.strip():
        texts.append(reasoning)
    elif isinstance(reasoning, list):
        texts.extend([r for r in reasoning if isinstance(r, str)])
    if not texts:
        return None
    text = " ".join(texts)
    patterns = [
        # "14 glass panels", "14 panels", "(14) panels" — not "Series N"
        r"(?<!series\s)(?<!series\s\d)(?:^|[\s\(\[])([1-9]\d{0,2})\s*[\)\]]?\s+(?:glass\s+)?panels?\b",
        # "qty 14", "qty: 14", "quantity 14", "14 nos", "number of panels: 14"
        r"\b(?:qty|quantity|qnty)\b[\s:]*([1-9]\d{0,2})\b",
        r"\b([1-9]\d{0,2})\s+nos\.?\b",
        r"\bnumber\s+of\s+(?:glass\s+)?panels?\b[\s:]*([1-9]\d{0,2})\b",
        # "14 lites", "14 lights", "14 pieces", "14 pcs", "14 sheets"
        r"(?:^|[\s\(\[])([1-9]\d{0,2})\s+(?:lites?|lights?|pieces?|pcs\.?|sheets?)\b",
        # "14x panels", "14 x panels"
        r"(?:^|[\s\(\[])([1-9]\d{0,2})\s*x\s+panels?\b",
        # Bare count directly before a dimension pair, no count noun:
        # "2 4\" x 6'", "2 4x6 walkable skylights", "3 23\" x 46\"".
        # Requires inch/foot markers or an explicit x-pair so years,
        # addresses and sheet numbers never match. Capped at 99.
        r"(?:^|[\s\(\[])([1-9]\d?)\s+(?=\d+\s*(?:'|\"|inch(?:es)?\b|in\b|feet\b|foot\b|ft\b|mm\b)?\s*[x×]\s*\d)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                val = int(m.group(1))
            except (ValueError, IndexError):
                continue
            if 1 <= val <= 999:
                return val
    # Word numbers with a unit noun ("Two skylights 60 x 48") — inherently ≤ 20.
    _word_map = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    }
    m = re.search(
        r"(?:^|[\s\(\[])(one|two|three|four|five|six|seven|eight|nine|ten)\s+"
        r"(?:walkable\s+|glass\s+)?(?:skylights?|panels?|lites?|units?|openings?)\b",
        text, re.IGNORECASE,
    )
    if m:
        return _word_map[m.group(1).lower()]
    return None


def compute_outer_totals(width_in, length_in, panel_count) -> tuple:
    """
    Deterministic total-opening dimensions for display ("14 into 37.4"):
    total width = panel_count × per-panel width (single-row run along width),
    total length = per-panel length unchanged.

    Same single-row convention as formulas.geometry.calculate_outer_dimensions
    (which rule6 recomputes identically at Stage 5), so this early value and
    the Stage-5 value always agree. Stored width/length stay PER-PANEL —
    pricing math depends on it. Diameter-only units are skipped (rule6
    takeoffs require w+l). Returns (outer_width, outer_length) or (None, None).
    """
    try:
        w = float(width_in) if width_in is not None else None
        l = float(length_in) if length_in is not None else None
        n = int(panel_count) if panel_count is not None else 1
    except (ValueError, TypeError):
        return (None, None)
    if w is None or l is None or w <= 0 or l <= 0 or n < 1:
        return (None, None)
    return (round(n * w, 3), round(l, 3))


def _validate_unit_intent_consistency(unit: dict, raw_unit: dict) -> None:
    """Deterministic consistency net so user intent stays coherent.

    - Width is always the shorter side (estimators price per-panel w×l).
    - Implausible per-panel dims (<12in or >200in) are kept but confidence
      is capped at 30 with a flag — never silently trusted at HIGH.
    - panel_count vs rows×cols mismatch is flagged; the explicit
      panel_count wins (grid numbers only describe layout).
    Appends reasoning/flags in place; never drops the unit.
    """
    flags = unit.setdefault("flags", [])
    reasoning = unit.setdefault("reasoning", [])
    # Width = shorter side.
    w, l = unit.get("value_width_in"), unit.get("value_length_in")
    try:
        if w is not None and l is not None and float(w) > float(l):
            unit["value_width_in"], unit["value_length_in"] = round(float(l), 2), round(float(w), 2)
            unit["extracted_width_in"], unit["extracted_length_in"] = unit["value_width_in"], unit["value_length_in"]
            reasoning.append("Normalized width/length so width is the shorter side (per-panel convention).")
    except (ValueError, TypeError):
        pass
    # Implausible dims → cap confidence, flag for estimator.
    for key in ("value_width_in", "value_length_in"):
        v = unit.get(key)
        try:
            if v is not None and (float(v) < 12 or float(v) > 200):
                if isinstance(unit.get("extracted_confidence"), int) and unit["extracted_confidence"] > 30:
                    unit["extracted_confidence"] = 30
                msg = f"Implausible {key}={v}in — verify ft vs inch marks (capped at conf 30)."
                if msg not in reasoning:
                    reasoning.append(msg)
                if "IMPLAUSIBLE_DIM" not in flags:
                    flags.append("IMPLAUSIBLE_DIM")
                break
        except (ValueError, TypeError):
            continue
    # panel_count vs rows×cols.
    pc = unit.get("value_panel_count")
    r, c = unit.get("value_rows"), unit.get("value_cols")
    try:
        if pc is not None and r is not None and c is not None and int(r) >= 1 and int(c) >= 1:
            if int(pc) != int(r) * int(c):
                msg = f"Panel count mismatch: panel_count={pc} != rows({r})×cols({c}) ({int(r) * int(c)}) — panel_count kept, layout needs review."
                if msg not in reasoning:
                    reasoning.append(msg)
                if "PANEL_COUNT_MISMATCH" not in flags:
                    flags.append("PANEL_COUNT_MISMATCH")
    except (ValueError, TypeError):
        pass


def build_unified_doc(extraction_json: dict, lead_metadata: Optional[dict] = None) -> dict:
    """
    Convert extraction JSON to unified MongoDB document.

    extraction_json: the consolidated extraction result from ai_engine.py
                     (the *_final_result.json file)
    lead_metadata: optional verified lead/classifier metadata (from OutlookEmail
                   or Project record in MongoDB) to seed Stage 1 and protect it
                   from being overwritten by CAD blueprint guesses.

    Returns: unified doc ready to insert into MongoDB.
    """
    project_id = extraction_json.get("project_id", "unknown")
    ts = _now()

    doc = build_empty_doc(project_id)

    # ── 0. Seed Stage 1 with authoritative lead/classifier metadata ─────
    norm_lead = normalize_lead_metadata(lead_metadata)
    lead_seeded_keys = set()
    if norm_lead:
        field_configs = {
            "contact_name":    (95, "Extracted from verified customer lead correspondence"),
            "contact_email":   (95, "Extracted from verified company/contact email (signature/body preferred over sender header)"),
            "contact_phone":   (90, "Extracted from customer lead signature/profile"),
            "contact_address": (90, "Extracted from company/mailing address in lead signature/profile"),
            "project_address": (90, "Extracted from verified installation/job address"),
            "architect":       (90, "Identified from lead classification / customer organization"),
            "project_name":    (90, "Extracted from verified lead subject / project title"),
            "project_type":    (85, "Derived from project lead context"),
        }
        raw_lead = lead_metadata if isinstance(lead_metadata, dict) else {}
        # Truthful provenance: only claim signature/body when the value really
        # came from client/company keys. Sender-only fallbacks must say so.
        # A client-tier value that literally matches the sender is also a
        # sender fallback (classifier copied the forwarder) — never verified.
        _has_client_email = any(
            raw_lead.get(k) for k in ("contact_email", "customerEmail", "clientEmail", "companyEmail", "company_email")
        )
        _has_client_name = any(
            raw_lead.get(k) for k in ("contact_name", "customerName", "customer_name", "clientName", "client_name")
        )
        _sender_fb = {
            "contact_email": bool(norm_lead.get("_sender_fallback_email")),
            "contact_name": bool(norm_lead.get("_sender_fallback_name")),
            "contact_phone": bool(norm_lead.get("_sender_fallback_phone")),
        }
        for k, val in norm_lead.items():
            if k in doc.get("stage_1", {}):
                conf, reasoning_text = field_configs.get(k, (90, "From lead metadata"))
                if k == "contact_email" and (not _has_client_email or _sender_fb["contact_email"]):
                    conf, reasoning_text = (50, "Taken from sender header as fallback — verify against document signature/body")
                if k == "contact_name" and (not _has_client_name or _sender_fb["contact_name"]):
                    conf, reasoning_text = (50, "Taken from sender name as fallback — verify against document signature/body")
                if k == "contact_phone" and _sender_fb["contact_phone"]:
                    conf, reasoning_text = (50, "Taken from sender header as fallback — verify against document signature/body")
                doc["stage_1"][k]["value"] = val
                doc["stage_1"][k]["confidence"] = conf
                doc["stage_1"][k]["status"] = "PENDING"
                doc["stage_1"][k]["updated_by"] = "classifier_lead"
                doc["stage_1"][k]["updated_at"] = ts
                doc["stage_1"][k]["reasoning"] = [reasoning_text]
                lead_seeded_keys.add(k)

    source_file = extraction_json.get("source_file")
    
    # Get header validation results for confidence calibration
    header_validation = None
    if "header_signals" in extraction_json:
        header_validation = validate_extracted_header_signals(extraction_json["header_signals"])

    def _map_sig(extraction_key, schema_key, section_name):
        signal = (extraction_json.get(section_name) or {}).get(extraction_key)
        if signal:
            signal = dataclasses.asdict(signal) if dataclasses.is_dataclass(signal) else dict(signal)
            raw_cit = signal.get("citation")
            if isinstance(raw_cit, dict):
                signal["citation"] = raw_cit
            elif raw_cit:
                signal["citation"] = parse_citation_string(raw_cit, signal.get("page"), source_file)
            if "confidence" in signal:
                # Use enhanced confidence normalization for customer fields
                if section_name == "header_signals" and header_validation:
                    signal["confidence"] = normalize_confidence(signal.get("confidence"), schema_key, header_validation)
                else:
                    signal["confidence"] = normalize_confidence(signal.get("confidence"))

            # Guardrail: Never let CAD drawing title block overwrite an authoritative lead field
            # with null, sentinel, or lower-confidence guess.
            # BUT a real document extraction (lead sheet signature/body) MUST be
            # allowed to correct a lead-seeded contact that came from the sender
            # header (forwarder). Otherwise the sender permanently wins and the
            # UI shows sender value + document citation (the reported bug).
            if schema_key in lead_seeded_keys:
                sig_val = signal.get("value")
                sentinels = {None, "", "PENDING", "NOT_STATED", "MANUAL", "NONE", "NULL"}
                if sig_val in sentinels or (isinstance(sig_val, str) and not sig_val.strip()):
                    # Extraction has nothing real — keep lead value, record
                    # provenance WITHOUT overwriting the displayed citation.
                    f = doc.get("stage_1", {}).get(schema_key)
                    if f is not None:
                        f["extracted_value"] = signal.get("value")
                        f["extracted_confidence"] = signal.get("confidence")
                        f["extracted_verbatim"] = signal.get("verbatim")
                        f["extracted_citation"] = signal.get("citation")
                        f["extracted_at"] = ts
                    return
                if schema_key in {"contact_email", "contact_phone", "contact_name", "contact_address"}:
                    f = doc.get("stage_1", {}).get(schema_key)
                    lead_val = (f.get("value") if isinstance(f, dict) else None)
                    norm = lambda v: str(v).strip().lower() if v is not None else ""
                    if lead_val is not None and norm(lead_val) != norm(sig_val):
                        # Genuine conflict: document says X, lead (possibly
                        # sender fallback) says Y. Document body/signature wins
                        # for contacts — it is the actual client, not the
                        # forwarder. Overwrite value + provenance truthfully.
                        if f is not None:
                            f["value"] = signal.get("value")
                            f["confidence"] = signal.get("confidence")
                            f["reasoning"] = (
                                [signal.get("reasoning")]
                                if isinstance(signal.get("reasoning"), str)
                                else (signal.get("reasoning") or ["Corrected from document body/signature over sender-seeded lead"])
                            )
                            f["citation"] = signal.get("citation")
                            f["updated_by"] = "extraction_correction"
                            f["updated_at"] = ts
                            f["extracted_value"] = signal.get("value")
                            f["extracted_confidence"] = signal.get("confidence")
                            f["extracted_verbatim"] = signal.get("verbatim")
                            f["extracted_citation"] = signal.get("citation")
                            f["extracted_at"] = ts
                            f["lead_overridden_value"] = lead_val
                        return
                    # Same value — keep lead, record provenance without
                    # clobbering the displayed citation with a duplicate.
                    if f is not None:
                        f["extracted_value"] = signal.get("value")
                        f["extracted_confidence"] = signal.get("confidence")
                        f["extracted_verbatim"] = signal.get("verbatim")
                        f["extracted_citation"] = signal.get("citation")
                        f["extracted_at"] = ts
                    return

            write_extracted_value(doc, schema_key, signal, now=ts)

    # ── Header signals ────────────────────────────────────────
    # Store header signals in stage_1._signals for reasoning resolution
    if "header_signals" in extraction_json:
        header_signals = extraction_json["header_signals"]

        # project_type's own reasoning is never shown to reviewers: its name
        # collides with the classifier's unrelated `projectType` field (the
        # NEW_ESTIMATE/EXISTING_PROJECT routing decision), which has caused
        # confusing/mislabeled reasoning display. Keep the value/confidence,
        # drop the reasoning text at the source so nothing downstream can
        # surface it.
        pt_signal = header_signals.get("project_type")
        if pt_signal:
            pt_signal = dataclasses.asdict(pt_signal) if dataclasses.is_dataclass(pt_signal) else dict(pt_signal)
            pt_signal.pop("reasoning", None)
            # Canonicalize the enum (workers have emitted mixed casings and
            # descriptive phrases) so stage_1 matches the UI/backend enums.
            if "value" in pt_signal:
                pt_signal["value"] = normalize_project_type_value(pt_signal.get("value"))
            header_signals = dict(header_signals)
            header_signals["project_type"] = pt_signal
            # Also sanitize the source dict in place — _map_sig() below reads
            # extraction_json["header_signals"] directly, not this local copy.
            extraction_json["header_signals"] = header_signals

        doc["stage_1"]["_signals"] = {}
        for extraction_key, schema_key in _HEADER_MAP.items():
            signal = header_signals.get(extraction_key)
            if signal:
                signal = dataclasses.asdict(signal) if dataclasses.is_dataclass(signal) else dict(signal)
                if "confidence" in signal:
                    signal["confidence"] = normalize_confidence(signal.get("confidence"))
                doc["stage_1"]["_signals"][extraction_key] = signal
        # Also store the full header_signals object for backward compatibility
        doc["stage_1"]["header_signals"] = header_signals
    
    # ── Also map header signals to their stage_1 field locations ─────
    for extraction_key, schema_key in _HEADER_MAP.items():
        _map_sig(extraction_key, schema_key, "header_signals")
    
    # ── Apply post-extraction validation to header signals ─────────
    if "header_signals" in extraction_json:
        header_validation = validate_extracted_header_signals(extraction_json["header_signals"])
        doc["stage_1"]["_header_validation"] = header_validation
        
        # Apply any automatic corrections
        if header_validation.get("corrections"):
            for field, corrected_value in header_validation["corrections"].items():
                if field in doc.get("stage_1", {}):
                    doc["stage_1"][field]["value"] = corrected_value
                    doc["stage_1"][field]["corrected"] = True
                    doc["stage_1"][field]["original_value"] = doc["stage_1"][field].get("extracted_value", corrected_value)

    def _normalize_signal_dict(sig: Any) -> dict:
        if dataclasses.is_dataclass(sig):
            return dataclasses.asdict(sig)
        if isinstance(sig, dict):
            return dict(sig)
        return {"value": sig}

    # ── Glass signals ─────────────────────────────────────────
    for extraction_key, schema_key in _GLASS_MAP.items():
        signal = (extraction_json.get("glass_signals") or {}).get(extraction_key)
        if signal is not None:
            signal = _normalize_signal_dict(signal)
            raw_cit = signal.get("citation")
            if isinstance(raw_cit, dict):
                signal["citation"] = raw_cit
            elif raw_cit:
                signal["citation"] = parse_citation_string(raw_cit, signal.get("page"), source_file)
            if "confidence" in signal:
                signal["confidence"] = normalize_confidence(signal.get("confidence"))
            write_extracted_value(doc, schema_key, signal, now=ts)

    # ── Frame signals ─────────────────────────────────────────
    fs_raw = extraction_json.get("frame_signals") or {}
    if "frame_type_stated" not in fs_raw and "frame_type" in fs_raw:
        fs_raw["frame_type_stated"] = fs_raw["frame_type"]
    if "is_thermally_broken" not in fs_raw and "thermally_broken_not_required" in fs_raw:
        tbnr = fs_raw.get("thermally_broken_not_required")
        if tbnr is not None:
            tbnr_dict = _normalize_signal_dict(tbnr)
            val = tbnr_dict.get("value")
            tbnr_dict["value"] = not val if val is not None else None
            extraction_json.setdefault("frame_signals", {})["is_thermally_broken"] = tbnr_dict

    for extraction_key, schema_key in _FRAME_MAP.items():
        signal = (extraction_json.get("frame_signals") or {}).get(extraction_key)
        if signal is not None:
            signal = _normalize_signal_dict(signal)
            raw_cit = signal.get("citation")
            if isinstance(raw_cit, dict):
                signal["citation"] = raw_cit
            elif raw_cit:
                signal["citation"] = parse_citation_string(raw_cit, signal.get("page"), source_file)
            if "confidence" in signal:
                signal["confidence"] = normalize_confidence(signal.get("confidence"))
            write_extracted_value(doc, schema_key, signal, now=ts)

    # ── Addon signals ─────────────────────────────────────────
    for extraction_key, schema_key in _ADDON_MAP.items():
        signal = (extraction_json.get("addon_signals") or {}).get(extraction_key)
        if signal is not None:
            signal = _normalize_signal_dict(signal)
            raw_cit = signal.get("citation")
            if isinstance(raw_cit, dict):
                signal["citation"] = raw_cit
            elif raw_cit:
                signal["citation"] = parse_citation_string(raw_cit, signal.get("page"), source_file)
            if "confidence" in signal:
                signal["confidence"] = normalize_confidence(signal.get("confidence"))
            write_extracted_value(doc, schema_key, signal, now=ts)

    # ── Location signals ──────────────────────────────────────
    loc_signals = extraction_json.get("location_signals") or {}
    for extraction_key in ["project_country", "is_expedited"]:
        signal = loc_signals.get(extraction_key)
        if signal:
            signal = dataclasses.asdict(signal) if dataclasses.is_dataclass(signal) else dict(signal)
            raw_cit = signal.get("citation")
            if raw_cit:
                signal["citation"] = parse_citation_string(raw_cit, signal.get("page"), source_file)
            if "confidence" in signal:
                signal["confidence"] = normalize_confidence(signal.get("confidence"))
            write_extracted_value(doc, extraction_key, signal, now=ts)

    # ── Units ─────────────────────────────────────────────────
    raw_units = extraction_json.get("units") or []

    # Rescue pass: a unit whose verbatim states an explicit count ("14 glass
    # panels ... each ... 37.4 x 25.6") but whose structured panel_count is
    # null gets the count recovered deterministically. Runs BEFORE the
    # _has_data filter so rescued counts also keep dim-less units alive.
    # Dimensions are NEVER touched here — "each" means dims are already
    # per-panel; totals are computed downstream (rule6 sum, backend sum).
    for _ru in raw_units:
        if isinstance(_ru, dict) and _ru.get("panel_count") is None:
            _rescued = rescue_panel_count_from_verbatim(
                _ru.get("verbatim"), _ru.get("reasoning")
            )
            if _rescued is not None:
                _ru["panel_count"] = _rescued
                if _ru.get("confidence") is None:
                    _ru["confidence"] = "LOW"

    def _has_data(u):
        has_dim = u.get("width_inches") is not None or u.get("length_inches") is not None or u.get("diameter_inches") is not None
        has_panels = u.get("panel_count") is not None
        has_loc = bool((u.get("location_description") or "").strip())
        return has_dim or has_panels or has_loc

    raw_units = [u for u in raw_units if _has_data(u)]
    assigned = 0
    for i, raw_unit in enumerate(raw_units):
        if assigned >= 10:
            break

        unit_id = chr(65 + assigned)
        assigned += 1
        unit = _empty_unit(unit_id)

        raw_cit = raw_unit.get("citation")
        parsed_cit = parse_citation_string(raw_cit, raw_unit.get("page"), source_file) if raw_cit else None

        # Check diameter
        dia = raw_unit.get("diameter_inches")
        if dia is None and raw_unit.get("diameter"):
            dia = raw_unit.get("diameter")

        # Also detect if circular in verbatim/reasoning/label when width == length
        if dia is None:
            w_raw = raw_unit.get("width_inches")
            l_raw = raw_unit.get("length_inches")
            verb = str(raw_unit.get("verbatim") or "")
            label = str(raw_unit.get("unit_label") or "")
            rsn = str(raw_unit.get("reasoning") or "")
            is_dia_callout = any(
                re.search(pat, text, re.IGNORECASE)
                for text in (verb, label, rsn)
                for pat in (r"\b\d+['\"-]?\s*dia\b", r"\bdiameter\b", r"Ø\s*\d+", r"\bcircular\b")
            )
            if is_dia_callout and w_raw is not None and (l_raw is None or w_raw == l_raw):
                dia = w_raw

        # Extraction layer
        unit["extracted_diameter_in"] = round(float(dia), 2) if dia is not None else None
        unit["value_diameter_in"]     = round(float(dia), 2) if dia is not None else None
        if dia is not None:
            unit["extracted_width_in"]    = None
            unit["extracted_length_in"]   = None
            unit["value_width_in"]        = None
            unit["value_length_in"]       = None
        else:
            w = raw_unit.get("width_inches")
            l = raw_unit.get("length_inches")
            unit["extracted_width_in"]    = round(float(w), 2) if w is not None else None
            unit["extracted_length_in"]   = round(float(l), 2) if l is not None else None
            unit["value_width_in"]        = round(float(w), 2) if w is not None else None
            unit["value_length_in"]       = round(float(l), 2) if l is not None else None
        unit["extracted_panel_count"] = raw_unit.get("panel_count")
        unit["extracted_rafter_count"]= raw_unit.get("rafter_count")
        unit["extracted_rows"]        = raw_unit.get("rows")
        unit["extracted_columns"]     = raw_unit.get("columns")
        unit["extracted_vertical_rafter_count"] = raw_unit.get("vertical_rafter_count")
        unit["extracted_horizontal_rafter_count"] = raw_unit.get("horizontal_rafter_count")
        unit["t_rafter_details"]      = raw_unit.get("t_rafter_details")
        unit["layout_source"]         = raw_unit.get("layout_source")
        unit["extracted_verbatim"]    = raw_unit.get("verbatim")
        unit["extracted_citation"]    = parsed_cit
        unit["citation"]              = parsed_cit
        unit["extracted_confidence"]  = normalize_confidence(raw_unit.get("confidence"))
        unit["extracted_location"]    = raw_unit.get("location_description")
        unit["extracted_dim_type"]    = raw_unit.get("dimension_label_type")
        unit["extracted_drawing_no"]  = raw_unit.get("drawing_number")
        unit["extracted_frame_type"]  = (raw_unit.get("frame_type") or "").strip().upper() or None
        unit["extracted_glass_type"]  = (raw_unit.get("glass_type") or "").strip().upper() or None
        unit["extracted_product_type"]  = (raw_unit.get("product_type") or "").strip().upper() or None
        unit["unit_label"]            = raw_unit.get("unit_label") or None
        _raw_thick = raw_unit.get("glass_thickness")
        unit["extracted_glass_thickness"] = str(_raw_thick).strip() if _raw_thick not in (None, "") else None
        unit["extracted_at"]          = ts

        # Seed working values from extraction (already seeded above if dia)
        if dia is None:
            unit["value_width_in"]        = raw_unit.get("width_inches")
            unit["value_length_in"]       = raw_unit.get("length_inches")
        unit["value_panel_count"]     = raw_unit.get("panel_count")
        unit["value_rafter_count"]    = raw_unit.get("rafter_count")
        unit["value_rows"]            = raw_unit.get("rows")
        unit["value_cols"]            = raw_unit.get("columns")
        # Canonical alias — backend and some readers use value_columns.
        unit["value_columns"]         = raw_unit.get("columns")
        # Rows/cols from extraction come from an explicitly stated layout
        # (e.g. "3x2 configuration"), so a real 2D layout is confirmed.
        _r = raw_unit.get("rows")
        _c = raw_unit.get("columns")
        unit["value_is_grid_confirmed"] = True if (_r is not None and _c is not None) else None
        # AI internal descriptive label (mark number etc.) for matching this
        # unit across stages/re-extractions. Estimator display uses location.
        _lbl = raw_unit.get("unit_label")
        unit["unit_label"] = str(_lbl).strip() if _lbl not in (None, "") else None
        unit["value_vertical_rafter_count"] = raw_unit.get("vertical_rafter_count")
        unit["value_horizontal_rafter_count"] = raw_unit.get("horizontal_rafter_count")
        unit["value_location"]        = raw_unit.get("location_description")
        unit["value_drawing_no"]      = raw_unit.get("drawing_number") or (parsed_cit.get("pdf_name") if (parsed_cit and parsed_cit.get("pdf_name")) else source_file)
        unit["value_drawing_number"]  = unit["value_drawing_no"]
        unit["drawing_number"]        = unit["value_drawing_no"]
        # Per-unit spec seeds from Vision (null = inherit project decision later).
        unit["value_frame_type"]      = unit["extracted_frame_type"]
        unit["value_glass_type"]      = unit["extracted_glass_type"]
        unit["value_product_type"]    = unit["extracted_product_type"]
        unit["value_glass_thickness"] = unit["extracted_glass_thickness"]
        unit["reasoning"]             = [raw_unit.get("reasoning", "")] if raw_unit.get("reasoning") else []
        unit["updated_at"]            = ts
        unit["updated_by"]            = "extraction"

        _validate_unit_intent_consistency(unit, raw_unit)
        # Vision copies drawing wording ("SERIES 2000", glass make-up); keep only backend codes.
        sanitize_unit_specs(unit, keep_keys=True)
        doc["units"][unit_id] = unit

    # ── Mark extraction complete ──────────────────────────────
    doc["pipeline_status"]["extraction_complete"] = True
    doc["pipeline_status"]["extraction_at"] = ts
    doc["updated_at"] = ts

    # ── Safety net: convert any dataclass instances to plain dicts ────────
    def _make_serializable(obj):
        if dataclasses.is_dataclass(obj):
            return dataclasses.asdict(obj)
        if isinstance(obj, dict):
            return {k: _make_serializable(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_make_serializable(i) for i in obj]
        if isinstance(obj, (str, int, float, bool)) or obj is None:
            return obj
        if hasattr(obj, '__dict__') and not isinstance(obj, type):
            return {k: _make_serializable(v) for k, v in obj.__dict__.items() if not k.startswith('_')}
        return obj

    return round_floats(_make_serializable(doc))


def _ensure_citations_have_pdf_name(doc: dict, source_file: str) -> None:
    if not source_file:
        return
    
    def fix_citation(cit):
        if isinstance(cit, dict):
            if not cit.get("pdf_name") or cit.get("pdf_name") in ("unknown", "null", None):
                cit["pdf_name"] = source_file
        elif isinstance(cit, str):
            parsed = parse_citation_string(cit, None, source_file)
            if parsed:
                return parsed
        return cit

    # Traverse signals
    for group in ["header_signals", "glass_signals", "frame_signals", "addon_signals"]:
        if group in doc:
            for field_key, field_val in doc[group].items():
                if isinstance(field_val, dict):
                    if "extracted_citation" in field_val:
                        field_val["extracted_citation"] = fix_citation(field_val["extracted_citation"])
                    if "citation" in field_val:
                        field_val["citation"] = fix_citation(field_val["citation"])

    # Traverse units
    if "units" in doc and isinstance(doc["units"], dict):
        for unit_id, unit_val in doc["units"].items():
            if isinstance(unit_val, dict):
                if "extracted_citation" in unit_val:
                    unit_val["extracted_citation"] = fix_citation(unit_val["extracted_citation"])
                if "citation" in unit_val:
                    unit_val["citation"] = fix_citation(unit_val["citation"])


def update_from_new_document(
    existing_doc: dict,
    new_extraction_json: dict,
) -> dict:
    """
    Merge new extraction signals into an existing unified doc using an LLM call.

    The LLM receives the full existing unified schema and the new extraction
    result, and returns a revised unified schema with:
    - All unchanged fields preserved exactly as-is
    - Fields updated only where new extraction provides clearer/corrected values
    - Units matched by location/context (not position) — no phantom duplicates
    - Fields with _meta.manual=true never overwritten
    - No units removed

    Falls back to returning existing_doc unchanged if the LLM call fails.
    Returns: updated doc (does not save to MongoDB — caller handles that).
    """
    import json
    import logging
    import re
    logger = logging.getLogger("gfs.schema_builder")

    try:
        from extraction.vision_client import call_vision_batch

        prompt = f"""You are updating an existing GFS project unified schema with new information from a revised document.

EXISTING UNIFIED SCHEMA:
{json.dumps(existing_doc, indent=2, default=str)}

NEW EXTRACTION RESULT:
{json.dumps(new_extraction_json, indent=2, default=str)}

INSTRUCTIONS:
1. Return the COMPLETE updated unified schema as a single JSON object.
2. Keep every field EXACTLY as-is unless the new extraction provides a clearer, corrected, or additional value.
3. Never overwrite any field where _meta.manual is true — preserve those values exactly.
4. For fields where status is "APPROVED" and the new extraction disagrees: set status to "NEEDS_REVIEW" and append a flag describing the conflict. Do NOT change the value.
5. For units: match new units to existing units by location description and context. Do not create a new unit if it clearly refers to the same physical element as an existing unit. Only add a genuinely new unit (different location/element).
6. Never remove existing units.
7. Update extracted_value, extracted_confidence, extracted_verbatim, extracted_citation, extracted_at fields with the new extraction data where relevant.
8. Output ONLY the raw JSON object. No explanation, no markdown, no code fences."""

        result = call_vision_batch(image_blocks=[], prompt=prompt)

        if not result.get("ok", True) or not result.get("text"):
            logger.warning("LLM revision merge failed: %s — returning existing schema unchanged", result.get("error"))
            return existing_doc

        raw_text = result["text"].strip()
        # Strip markdown fences if present
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        updated_doc = json.loads(raw_text)
        
        # Post-process to ensure all citations preserve the source_file name
        source_file = new_extraction_json.get("source_file") or new_extraction_json.get("pdf_name")
        if source_file:
            _ensure_citations_have_pdf_name(updated_doc, source_file)
            
        logger.info("LLM revision merge succeeded — schema updated")
        return updated_doc

    except Exception as exc:
        logger.error("LLM revision merge exception: %s — returning existing schema unchanged", exc)
        return existing_doc


def _update_from_new_document_rule_based(
    existing_doc: dict,
    new_extraction_json: dict,
) -> dict:
    """
    LEGACY rule-based merger — kept for reference.
    Replaced by update_from_new_document (LLM-based).
    """
    ts = _now()

    # Update signal fields
    signal_groups = [
        ("header_signals", _HEADER_MAP),
        ("glass_signals",  _GLASS_MAP),
        ("frame_signals",  _FRAME_MAP),
        ("addon_signals",  _ADDON_MAP),
    ]
    for group_key, field_map in signal_groups:
        for extraction_key, schema_key in field_map.items():
            signal = (new_extraction_json.get(group_key) or {}).get(extraction_key)
            if not signal or signal.get("value") is None:
                continue

            from config.unified_schema import _ensure_field
            f = _ensure_field(existing_doc, schema_key)
            if f is None:
                continue
            new_val = signal.get("value")

            # Always update extraction audit trail
            f["extracted_value"]     = new_val
            f["extracted_confidence"]= normalize_confidence(signal.get("confidence"))
            f["extracted_verbatim"]  = signal.get("verbatim")
            f["extracted_citation"]  = signal.get("citation")
            f["extracted_at"]        = ts

            # Update value only if not approved, or flag if approved and changed
            if f["status"] == "APPROVED":
                if f["value"] != new_val:
                    f["status"] = "NEEDS_REVIEW"
                    if "flags" not in f:
                        f["flags"] = []
                    f["flags"].append(
                        f"New document changed this value: was '{f['value']}', "
                        f"new extraction says '{new_val}' "
                        f"(from {signal.get('citation', 'unknown file')})"
                    )
            else:
                f["value"]      = new_val
                f["confidence"] = normalize_confidence(signal.get("confidence"))
                f["reasoning"]  = [signal.get("reasoning", "")] if signal.get("reasoning") else []
                f["updated_at"] = ts
                f["updated_by"] = "extraction"

    # Update units
    new_units = new_extraction_json.get("units") or []
    for i, raw_unit in enumerate(new_units):
        if i >= len(_UNIT_LABELS):
            break
        unit_id = _UNIT_LABELS[i]
        if unit_id not in existing_doc["units"]:
            # New unit — add it fresh
            from config.unified_schema import _empty_unit
            unit = _empty_unit(unit_id)
            existing_doc["units"][unit_id] = unit

        u = existing_doc["units"][unit_id]
        new_w = raw_unit.get("width_inches")
        new_l = raw_unit.get("length_inches")
        new_p = raw_unit.get("panel_count")
        new_r = raw_unit.get("rafter_count")
        new_rows = raw_unit.get("rows")
        new_cols = raw_unit.get("columns")
        new_v_raf = raw_unit.get("vertical_rafter_count")
        new_h_raf = raw_unit.get("horizontal_rafter_count")

        # Update extraction audit
        u["extracted_width_in"]    = new_w
        u["extracted_length_in"]   = new_l
        u["extracted_panel_count"] = new_p
        u["extracted_rafter_count"] = new_r
        u["extracted_rows"]        = new_rows
        u["extracted_columns"]     = new_cols
        u["extracted_vertical_rafter_count"] = new_v_raf
        u["extracted_horizontal_rafter_count"] = new_h_raf
        u["extracted_citation"]    = raw_unit.get("citation")
        u["extracted_confidence"]  = normalize_confidence(raw_unit.get("confidence"))
        u["extracted_at"]          = ts

        # Update working value if not approved
        if u["status"] != "APPROVED":
            u["value_width_in"]    = new_w
            u["value_length_in"]   = new_l
            u["value_panel_count"] = new_p
            u["value_rafter_count"] = new_r
            u["value_rows"]        = new_rows
            # value_cols is the canonical grid-column key (value_columns alias).
            u["value_cols"]        = new_cols
            u["value_columns"]     = new_cols
            if new_rows is not None and new_cols is not None:
                u["value_is_grid_confirmed"] = True
            u["value_vertical_rafter_count"] = new_v_raf
            u["value_horizontal_rafter_count"] = new_h_raf
            u["updated_at"]        = ts
            u["updated_by"]        = "extraction"
        else:
            # Approved but dimensions changed → flag
            if (u["value_width_in"] != new_w or
                u["value_length_in"] != new_l or
                u["value_panel_count"] != new_p):
                u["status"] = "NEEDS_REVIEW"
                if "flags" not in u:
                    u["flags"] = []
                u["flags"].append(
                    f"New document changed unit dimensions: "
                    f"was {u['value_width_in']}x{u['value_length_in']} "
                    f"p={u['value_panel_count']}, "
                    f"new says {new_w}x{new_l} p={new_p} "
                    f"(from {raw_unit.get('citation', 'unknown')})"
)

    existing_doc["updated_at"] = ts
    return existing_doc
