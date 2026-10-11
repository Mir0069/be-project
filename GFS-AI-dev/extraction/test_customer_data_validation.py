"""
Test script for enhanced customer data validation functions.
Tests the new validation, normalization, and quality checking functions.
"""

import sys
import os
import re
from typing import Any, Optional

# Local function definitions for testing
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
    
    # Remove all non-numeric characters except +, x, and extension markers
    cleaned = re.sub(r'[^\d+xextEXT-]', '', phone)
    
    # Extract extension if present (look for 'ext' or 'x' followed by digits)
    extension = None
    ext_match = re.search(r'(?:ext|x)\s*(\d+)', cleaned.lower())
    if ext_match:
        extension = ext_match.group(1)
        cleaned = cleaned[:ext_match.start()].strip()
    
    main_number = cleaned
    
    # Remove dashes and spaces from main number
    main_number = re.sub(r'[-\s]', '', main_number)
    
    # Check if we have a valid number (at least 7 digits for local numbers)
    digits = re.sub(r'[^\d]', '', main_number)
    if len(digits) < 7:
        return None
    
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


def test_email_validation():
    """Test email format validation."""
    print("Testing email validation...")
    
    # Valid emails
    valid_emails = [
        "test@example.com",
        "user.name@company.co.uk",
        "first.last+tag@domain.org",
        "admin@mail-server.com"
    ]
    
    for email in valid_emails:
        result = validate_email_format(email)
        assert result == True, f"Valid email rejected: {email}"
        print(f"[PASS] Valid email accepted: {email}")
    
    # Invalid emails
    invalid_emails = [
        "invalid-email",
        "@example.com",
        "user@",
        "user@.com",
        "user@com",
        "",
        None,
        "user<>@example.com"  # invalid characters
    ]
    
    for email in invalid_emails:
        result = validate_email_format(email)
        assert result == False, f"Invalid email accepted: {email}"
        print(f"[PASS] Invalid email rejected: {email}")
    
    print("Email validation tests passed!\n")


def test_gfs_staff_email_detection():
    """Test GFS staff email detection."""
    print("Testing GFS staff email detection...")
    
    # GFS staff emails
    gfs_emails = [
        "dan@glassflooringsystems.com",
        "frank@gfs.com",
        "wayne@glassflooring.com",
        "danielle@glassflooringsystems.com"
    ]
    
    for email in gfs_emails:
        result = is_gfs_staff_email(email)
        assert result == True, f"GFS staff email not detected: {email}"
        print(f"[PASS] GFS staff email detected: {email}")
    
    # Non-GFS emails
    non_gfs_emails = [
        "john@example.com",
        "customer@company.com",
        "info@client.com",
        "admin@external.org"
    ]
    
    for email in non_gfs_emails:
        result = is_gfs_staff_email(email)
        assert result == False, f"Non-GFS email incorrectly flagged: {email}"
        print(f"[PASS] Non-GFS email accepted: {email}")
    
    print("GFS staff email detection tests passed!\n")


def test_phone_normalization():
    """Test phone number normalization."""
    print("Testing phone normalization...")
    
    test_cases = [
        ("(555) 123-4567", "+1 (555) 123-4567"),
        ("555-123-4567", "+1 (555) 123-4567"),
        ("5551234567", "+1 (555) 123-4567"),
        ("1-555-123-4567", "+1 (555) 123-4567"),
        ("+1 555 123 4567", "+1 (555) 123-4567"),
        ("555-123-4567 ext 123", "+1 (555) 123-4567 ext. 123"),
        ("+44 20 1234 5678", "+442012345678"),  # International (simplified format)
    ]
    
    for input_phone, expected in test_cases:
        result = normalize_phone_number(input_phone)
        assert result == expected, f"Phone normalization failed: {input_phone} -> {result} (expected {expected})"
        print(f"[PASS] Phone normalized: {input_phone} -> {result}")
    
    # Invalid phones
    invalid_phones = ["123", "abc", "", None]
    for phone in invalid_phones:
        result = normalize_phone_number(phone)
        assert result is None, f"Invalid phone normalized: {phone}"
        print(f"[PASS] Invalid phone rejected: {phone}")
    
    print("Phone normalization tests passed!\n")


def test_address_parsing():
    """Test address parsing and validation."""
    print("Testing address parsing...")
    
    # Valid addresses
    valid_addresses = [
        "123 Main St, Springfield, IL 62701",
        "456 Oak Avenue, New York, NY 10001",
        "789 Pine Road, Los Angeles, CA 90001-1234",
        "321 Elm Street, Toronto, ON M5H 2N2",  # Canadian
    ]
    
    for address in valid_addresses:
        components = parse_address_components(address)
        validation = validate_address_completeness(address)
        assert validation["is_valid"], f"Valid address rejected: {address}"
        print(f"[PASS] Valid address parsed: {address}")
        print(f"  Components: {components}")
        print(f"  Quality score: {validation['quality_score']}")
    
    # Invalid/incomplete addresses
    invalid_addresses = [
        "123",  # Too short
        "",  # Empty
        "Main Street",  # No number
    ]
    
    for address in invalid_addresses:
        validation = validate_address_completeness(address)
        assert not validation["is_valid"], f"Invalid address accepted: {address}"
        print(f"[PASS] Invalid address rejected: {address}")
    
    print("Address parsing tests passed!\n")


def test_header_validation():
    """Test header signal validation."""
    print("Testing header signal validation...")
    
    # Valid header signals
    valid_headers = {
        "contact_name": {"value": "John Smith", "confidence": "MEDIUM"},
        "contact_email": {"value": "john.smith@example.com", "confidence": "MEDIUM"},
        "contact_phone": {"value": "555-123-4567", "confidence": "MEDIUM"},
        "contact_address": {"value": "123 Main St, Springfield, IL 62701", "confidence": "MEDIUM"},
        "project_address": {"value": "456 Oak Ave, Chicago, IL 60601", "confidence": "MEDIUM"},
    }
    
    validation = validate_extracted_header_signals(valid_headers)
    assert validation["is_valid"], "Valid header signals rejected"
    assert validation["quality_score"] >= 90, f"Quality score too low: {validation['quality_score']}"
    print(f"[PASS] Valid header signals accepted (quality score: {validation['quality_score']})")
    
    # Header signals with issues
    problematic_headers = {
        "contact_name": {"value": "Dan from GFS", "confidence": "MEDIUM"},  # GFS staff
        "contact_email": {"value": "dan@glassflooringsystems.com", "confidence": "MEDIUM"},  # GFS staff email
        "contact_phone": {"value": "123", "confidence": "MEDIUM"},  # Invalid phone
        "contact_address": {"value": "123 Main St", "confidence": "MEDIUM"},  # Incomplete address
        "project_address": {"value": "123 Main St", "confidence": "MEDIUM"},  # Same as contact
    }
    
    validation = validate_extracted_header_signals(problematic_headers)
    assert not validation["is_valid"], "Problematic header signals accepted"
    assert len(validation["warnings"]) > 0, "No warnings generated for problematic data"
    print(f"[PASS] Problematic header signals detected (quality score: {validation['quality_score']})")
    print(f"  Warnings: {validation['warnings']}")
    
    print("Header validation tests passed!\n")


def run_all_tests():
    """Run all test functions."""
    print("=" * 60)
    print("Running Enhanced Customer Data Validation Tests")
    print("=" * 60 + "\n")
    
    try:
        test_email_validation()
        test_gfs_staff_email_detection()
        test_phone_normalization()
        test_address_parsing()
        test_header_validation()
        
        print("=" * 60)
        print("All tests passed successfully!")
        print("=" * 60)
        return True
    except AssertionError as e:
        print(f"\n[FAIL] Test failed: {e}")
        return False
    except Exception as e:
        print(f"\n[FAIL] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)