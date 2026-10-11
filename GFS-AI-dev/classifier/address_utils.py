# classifier/address_utils.py
# ─────────────────────────────────────────────────────────────────────────────
# Address normalization and extraction utilities.
# Used by the knowledge graph matcher to compare addresses consistently.
# Enhanced with installation intent detection and address type classification.
# ─────────────────────────────────────────────────────────────────────────────
import re
from typing import List, Optional, Tuple
from dataclasses import dataclass

# Common US street suffix abbreviations → canonical short form
STREET_ABBREVS = {
    "street": "st",
    "avenue": "ave",
    "boulevard": "blvd",
    "drive": "dr",
    "lane": "ln",
    "road": "rd",
    "place": "pl",
    "court": "ct",
    "circle": "cir",
    "highway": "hwy",
    "parkway": "pkwy",
    "terrace": "ter",
    "way": "way",
}

# Regex pattern for US street addresses (e.g. "464 Greenwich Street")
_ADDRESS_PATTERN = re.compile(
    r'\b(\d{1,6}\s+[A-Za-z][A-Za-z\s]{2,30}'
    r'(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|'
    r'Place|Pl|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Way))\b',
    re.IGNORECASE,
)

# Installation intent keywords - phrases that indicate an address is the installation site
INSTALLATION_INTENT_KEYWORDS = [
    "install at",
    "install",
    "installation",
    "site address",
    "project location",
    "job site",
    "work to be carried out at",
    "installation address",
    "project site",
    "construction site",
    "job location",
    "work location",
    "build at",
    "located at",
    "situated at",
    "positioned at",
]

# Billing/shipping intent keywords
BILLING_INTENT_KEYWORDS = [
    "bill to",
    "billing address",
    "invoice to",
    "payment to",
    "send invoice",
    "quote to",
    "send quotation",
    "correspondence to",
    "mail to",
]

# Company/office intent keywords
COMPANY_INTENT_KEYWORDS = [
    "headquarters",
    "main office",
    "corporate office",
    "company address",
    "business address",
    "our office",
    "our location",
    "company headquarters",
    "main address",
]

# Architect/consultant intent keywords
ARCHITECT_INTENT_KEYWORDS = [
    "architect",
    "designer",
    "consultant",
    "engineering firm",
    "design office",
    "architecture firm",
]

@dataclass
class AddressWithContext:
    """Enhanced address representation with context and classification."""
    raw_address: str
    normalized_address: str
    address_type: str  # INSTALLATION, BILLING, COMPANY, ARCHITECT, UNKNOWN
    confidence: float  # 0.0 to 1.0
    context_keywords: List[str]
    surrounding_text: str
    source_location: str  # EMAIL_BODY, ATTACHMENT, SIGNATURE, TITLE_BLOCK


def normalize_address(raw: str) -> str:
    """
    Normalize a street address for consistent comparison.

    Examples:
        '464 Greenwich Street, New York, NY 10013' → '464 greenwich st'
        '182 Robinson Ave, Suite 4B' → '182 robinson ave'
    """
    if not raw:
        return ""
    if isinstance(raw, dict):
        raw = raw.get("address", "")
    if not raw:
        return ""
    addr = raw.lower().strip()
    # Remove trailing city, state, zip patterns
    addr = re.sub(r',\s*[a-z]{2}\s*\d{5}(-\d{4})?$', '', addr)
    addr = re.sub(r',\s*\w[\w\s]*$', '', addr)
    # Collapse street suffix abbreviations to canonical short form
    for full, short in STREET_ABBREVS.items():
        addr = re.sub(rf'\b{full}\b', short, addr)
    # Remove apartment/suite/unit numbers
    addr = re.sub(r'\b(apt|suite|ste|unit|#)\s*\w+', '', addr, flags=re.IGNORECASE)
    # Collapse whitespace
    return ' '.join(addr.split())


def extract_addresses_from_text(text: str) -> List[str]:
    """
    Extract potential US street addresses from free-form text.

    Returns a list of raw address strings found in the text.
    Example: "Our project at 464 Greenwich Street is ..." → ["464 Greenwich Street"]
    """
    if not text:
        return []
    matches = _ADDRESS_PATTERN.findall(text)
    return [m.strip() for m in matches]


def detect_installation_intent(text: str, address: str) -> Tuple[bool, List[str]]:
    """
    Detect if text around an address indicates installation intent.
    
    Returns:
        (has_installation_intent, matching_keywords)
    """
    if not text or not address:
        return False, []
    
    text_lower = text.lower()
    address_lower = address.lower()
    
    # Find the address in the text and get surrounding context
    address_pos = text_lower.find(address_lower)
    if address_pos == -1:
        return False, []
    
    # Get 200 characters before and after the address for context
    context_start = max(0, address_pos - 200)
    context_end = min(len(text), address_pos + len(address) + 200)
    context = text[context_start:context_end].lower()
    
    # Check for installation intent keywords
    matching_keywords = []
    for keyword in INSTALLATION_INTENT_KEYWORDS:
        if keyword in context:
            matching_keywords.append(keyword)
    
    return len(matching_keywords) > 0, matching_keywords


def detect_address_type(text: str, address: str) -> Tuple[str, float, List[str]]:
    """
    Classify address type based on surrounding context.
    
    Returns:
        (address_type, confidence_score, matching_keywords)
    """
    if not text or not address:
        return "UNKNOWN", 0.0, []
    
    text_lower = text.lower()
    address_lower = address.lower()
    
    # Find the address in the text and get surrounding context
    address_pos = text_lower.find(address_lower)
    if address_pos == -1:
        return "UNKNOWN", 0.0, []
    
    # Get 300 characters before and after the address for context
    context_start = max(0, address_pos - 300)
    context_end = min(len(text), address_pos + len(address) + 300)
    context = text[context_start:context_end].lower()
    
    # Score each address type
    type_scores = {
        "INSTALLATION": 0.0,
        "BILLING": 0.0,
        "COMPANY": 0.0,
        "ARCHITECT": 0.0,
        "UNKNOWN": 0.0
    }
    
    matching_keywords = []
    
    # Check installation keywords
    for keyword in INSTALLATION_INTENT_KEYWORDS:
        if keyword in context:
            type_scores["INSTALLATION"] += 1.0
            matching_keywords.append(keyword)
    
    # Check billing keywords
    for keyword in BILLING_INTENT_KEYWORDS:
        if keyword in context:
            type_scores["BILLING"] += 1.0
            matching_keywords.append(keyword)
    
    # Check company keywords
    for keyword in COMPANY_INTENT_KEYWORDS:
        if keyword in context:
            type_scores["COMPANY"] += 1.0
            matching_keywords.append(keyword)
    
    # Check architect keywords
    for keyword in ARCHITECT_INTENT_KEYWORDS:
        if keyword in context:
            type_scores["ARCHITECT"] += 1.0
            matching_keywords.append(keyword)
    
    # Find the highest scoring type
    max_score = max(type_scores.values())
    if max_score == 0.0:
        return "UNKNOWN", 0.0, []
    
    best_type = max(type_scores, key=type_scores.get)
    
    # Calculate confidence based on score and competing types
    total_score = sum(type_scores.values())
    confidence = max_score / total_score if total_score > 0 else 0.0
    
    return best_type, confidence, matching_keywords


def extract_addresses_with_context(
    text: str, 
    source_location: str = "EMAIL_BODY"
) -> List[AddressWithContext]:
    """
    Extract addresses with full context analysis and classification.
    
    Args:
        text: The text to extract addresses from
        source_location: Where the text came from (EMAIL_BODY, ATTACHMENT, etc.)
    
    Returns:
        List of AddressWithContext objects with classification and confidence
    """
    if not text:
        return []
    
    raw_addresses = extract_addresses_from_text(text)
    addresses_with_context = []
    
    for addr in raw_addresses:
        normalized = normalize_address(addr)
        address_type, confidence, keywords = detect_address_type(text, addr)
        
        # Get surrounding text (300 chars context)
        addr_pos = text.lower().find(addr.lower())
        surrounding = ""
        if addr_pos != -1:
            context_start = max(0, addr_pos - 150)
            context_end = min(len(text), addr_pos + len(addr) + 150)
            surrounding = text[context_start:context_end].strip()
        
        addresses_with_context.append(AddressWithContext(
            raw_address=addr,
            normalized_address=normalized,
            address_type=address_type,
            confidence=confidence,
            context_keywords=keywords,
            surrounding_text=surrounding,
            source_location=source_location
        ))
    
    return addresses_with_context


def select_best_installation_address(
    addresses_with_context: List[AddressWithContext]
) -> Optional[AddressWithContext]:
    """
    Select the best installation address from a list of classified addresses.
    
    Selection logic:
    1. Prefer addresses classified as INSTALLATION type
    2. Among INSTALLATION addresses, prefer highest confidence
    3. If no INSTALLATION addresses, fall back to UNKNOWN with highest confidence
    4. If multiple addresses have similar confidence, return None (ambiguity)
    
    Returns:
        Best installation address or None if ambiguous
    """
    if not addresses_with_context:
        return None
    
    # Separate installation addresses from others
    installation_addrs = [
        addr for addr in addresses_with_context 
        if addr.address_type == "INSTALLATION"
    ]
    
    if installation_addrs:
        # Sort by confidence descending
        installation_addrs.sort(key=lambda x: x.confidence, reverse=True)
        
        # Check for ambiguity (top 2 have similar confidence)
        if len(installation_addrs) >= 2:
            top_confidence = installation_addrs[0].confidence
            second_confidence = installation_addrs[1].confidence
            # If within 0.2 confidence, consider ambiguous
            if abs(top_confidence - second_confidence) < 0.2:
                return None  # Ambiguous
        
        return installation_addrs[0]
    
    # No installation addresses, fall back to UNKNOWN
    unknown_addrs = [
        addr for addr in addresses_with_context 
        if addr.address_type == "UNKNOWN"
    ]
    
    if unknown_addrs:
        unknown_addrs.sort(key=lambda x: x.confidence, reverse=True)
        
        # Check for ambiguity
        if len(unknown_addrs) >= 2:
            top_confidence = unknown_addrs[0].confidence
            second_confidence = unknown_addrs[1].confidence
            if abs(top_confidence - second_confidence) < 0.2:
                return None  # Ambiguous
        
        return unknown_addrs[0]
    
    # No suitable addresses found
    return None


def detect_address_ambiguity(
    addresses_with_context: List[AddressWithContext],
    threshold: float = 0.3
) -> Tuple[bool, List[AddressWithContext]]:
    """
    Detect if there's ambiguity in address selection.
    
    Returns:
        (is_ambiguous, candidate_addresses)
    """
    if len(addresses_with_context) < 2:
        return False, addresses_with_context
    
    # Get installation addresses or fall back to all addresses
    installation_addrs = [
        addr for addr in addresses_with_context 
        if addr.address_type == "INSTALLATION"
    ]
    
    candidates = installation_addrs if installation_addrs else addresses_with_context
    
    if len(candidates) < 2:
        return False, candidates
    
    # Sort by confidence
    candidates.sort(key=lambda x: x.confidence, reverse=True)
    
    # Check if top candidates have similar confidence
    top_confidence = candidates[0].confidence
    second_confidence = candidates[1].confidence
    
    if abs(top_confidence - second_confidence) < threshold:
        return True, candidates
    
    return False, candidates


def rank_addresses_by_installation_likelihood(
    addresses_with_context: List[AddressWithContext]
) -> List[AddressWithContext]:
    """
    Rank addresses by likelihood of being installation address.
    
    Ranking factors:
    1. Installation type > Unknown type > Other types
    2. Higher confidence within same type
    3. Presence of installation keywords
    4. Source location (EMAIL_BODY > ATTACHMENT > SIGNATURE)
    """
    def rank_score(addr: AddressWithContext) -> float:
        score = 0.0
        
        # Type priority
        type_priority = {
            "INSTALLATION": 100,
            "UNKNOWN": 50,
            "BILLING": 20,
            "COMPANY": 10,
            "ARCHITECT": 15
        }
        score += type_priority.get(addr.address_type, 0)
        
        # Confidence factor
        score += addr.confidence * 20
        
        # Installation keyword boost
        if addr.address_type == "INSTALLATION":
            score += len(addr.context_keywords) * 5
        
        # Source location priority
        source_priority = {
            "EMAIL_BODY": 10,
            "ATTACHMENT": 8,
            "TITLE_BLOCK": 7,
            "SIGNATURE": 2
        }
        score += source_priority.get(addr.source_location, 0)
        
        return score
    
    ranked = sorted(addresses_with_context, key=rank_score, reverse=True)
    return ranked


def apply_cross_document_reasoning(
    email_addresses: List[AddressWithContext],
    attachment_addresses: List[AddressWithContext]
) -> List[AddressWithContext]:
    """
    Apply cross-document reasoning to prioritize addresses based on source hierarchy.
    
    Source hierarchy priority:
    1. Email body with installation context (highest priority)
    2. Attachment title blocks with installation context
    3. Attachment body text with installation context
    4. Email body without clear context
    5. Attachment body text without clear context
    6. Signatures (lowest priority)
    
    This function also detects when the same address appears in multiple sources
    and boosts its confidence.
    """
    all_addresses = email_addresses + attachment_addresses
    
    # Group addresses by normalized form to detect cross-source confirmation
    address_groups = {}
    for addr in all_addresses:
        normalized = addr.normalized_address
        if normalized not in address_groups:
            address_groups[normalized] = []
        address_groups[normalized].append(addr)
    
    # Boost confidence for addresses that appear in multiple sources
    for normalized, group in address_groups.items():
        if len(group) > 1:
            # Same address appears in multiple sources - boost confidence
            for addr in group:
                addr.confidence = min(1.0, addr.confidence + 0.2)
                # Add cross-source confirmation to context keywords
                if "cross_source_confirmed" not in addr.context_keywords:
                    addr.context_keywords.append("cross_source_confirmed")
    
    # Re-rank based on cross-document analysis
    ranked = rank_addresses_by_installation_likelihood(all_addresses)
    
    return ranked


def detect_title_block_addresses(text: str) -> List[str]:
    """
    Detect addresses that appear in document title blocks.
    Title blocks typically contain:
    - Project name
    - Address
    - Architect info
    - Date
    
    This is a heuristic detection based on common title block patterns.
    """
    if not text:
        return []
    
    # Look for addresses near title block indicators
    title_block_indicators = [
        "project:",
        "location:",
        "site:",
        "address:",
        "client:",
        "project name:",
        "job name:",
    ]
    
    text_lower = text.lower()
    title_block_addresses = []
    
    for indicator in title_block_indicators:
        indicator_pos = text_lower.find(indicator)
        if indicator_pos != -1:
            # Get text after indicator (next 500 characters)
            context_start = indicator_pos
            context_end = min(len(text), indicator_pos + len(indicator) + 500)
            context = text[context_start:context_end]
            
            # Extract addresses from this context
            addresses = extract_addresses_from_text(context)
            title_block_addresses.extend(addresses)
    
    return title_block_addresses


def classify_source_location(
    text: str, 
    is_email_body: bool = False,
    is_attachment: bool = False
) -> str:
    """
    Classify the likely source location of text based on content patterns.
    
    Returns: EMAIL_BODY, ATTACHMENT, TITLE_BLOCK, or SIGNATURE
    """
    if is_email_body:
        # Check if it looks like a signature
        signature_indicators = [
            "sent from my",
            "get outlook for",
            "regards,",
            "best regards,",
            "sincerely,",
            "thanks,",
            "thank you,",
            "--",
            "confidentiality notice",
            "email disclaimer",
        ]
        text_lower = text.lower()
        if any(indicator in text_lower for indicator in signature_indicators):
            return "SIGNATURE"
        return "EMAIL_BODY"
    
    if is_attachment:
        # Check if it looks like a title block
        title_block_indicators = [
            "project:",
            "location:",
            "site:",
            "address:",
            "client:",
            "drawn by:",
            "date:",
            "sheet:",
        ]
        text_lower = text.lower()
        if any(indicator in text_lower for indicator in title_block_indicators):
            return "TITLE_BLOCK"
        return "ATTACHMENT"
    
    return "UNKNOWN"
