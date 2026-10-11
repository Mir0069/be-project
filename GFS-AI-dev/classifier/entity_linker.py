# classifier/entity_linker.py
# ─────────────────────────────────────────────────────────────────────────────
# Entity linking system to associate project specifications with installation addresses.
# Ensures that panel sizes, quantities, glass types, and other specifications
# are linked to the correct project site when multiple addresses are present.
# ─────────────────────────────────────────────────────────────────────────────
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import re

@dataclass
class ProjectSpecification:
    """Represents a project specification extracted from documents."""
    spec_type: str  # PANEL_SIZE, QUANTITY, GLASS_TYPE, FRAME_TYPE, etc.
    value: Any  # The actual value (e.g., "6x6", 10, "tempered")
    context: str  # Surrounding text that provides context
    page_num: Optional[int] = None
    confidence: float = 0.0
    linked_address: Optional[str] = None  # The address this spec is linked to


@dataclass
class AddressWithSpecs:
    """Represents an address with its associated specifications."""
    address: str
    normalized_address: str
    address_type: str
    specifications: List[ProjectSpecification]
    confidence: float = 0.0


def extract_specifications_from_text(text: str, page_num: int = None) -> List[ProjectSpecification]:
    """
    Extract project specifications from text.
    
    Looks for:
    - Panel dimensions (e.g., "6x6", "4'x8'", "48\"x48\"")
    - Quantities (e.g., "10 panels", "6 units")
    - Glass types (e.g., "tempered", "laminated", "insulated")
    - Frame types (e.g., "Series 1000", "2000 series")
    """
    if not text:
        return []
    
    specifications = []
    text_lower = text.lower()
    
    # Panel dimension patterns
    dimension_patterns = [
        r'(\d+\'\s*[x×]\s*\d+\')',  # Feet: 6'x8'
        r'(\d+"\s*[x×]\s*\d+")',    # Inches: 48"x48"
        r'(\d+\s*[x×]\s*\d+\s*(?:feet|ft|inches|in))',  # With units: 6 x 8 feet
        r'(\d+[x×]\d+)',             # Simple: 6x8
    ]
    
    for pattern in dimension_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            context_start = max(0, match.start() - 50)
            context_end = min(len(text), match.end() + 50)
            context = text[context_start:context_end]
            
            specifications.append(ProjectSpecification(
                spec_type="PANEL_SIZE",
                value=match.group(1),
                context=context,
                page_num=page_num,
                confidence=0.7,
                linked_address=None
            ))
    
    # Quantity patterns
    quantity_patterns = [
        r'(\d+)\s*(?:panels?|units?|glass(?:es)?|skylights?)',
        r'(\d+)\s*(?:piece|pieces)',
    ]
    
    for pattern in quantity_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            context_start = max(0, match.start() - 50)
            context_end = min(len(text), match.end() + 50)
            context = text[context_start:context_end]
            
            specifications.append(ProjectSpecification(
                spec_type="QUANTITY",
                value=int(match.group(1)),
                context=context,
                page_num=page_num,
                confidence=0.6,
                linked_address=None
            ))
    
    # Glass type patterns
    glass_types = ["tempered", "laminated", "insulated", "double", "single", "low-e", "tinted"]
    for glass_type in glass_types:
        if glass_type in text_lower:
            idx = text_lower.find(glass_type)
            context_start = max(0, idx - 30)
            context_end = min(len(text), idx + len(glass_type) + 30)
            context = text[context_start:context_end]
            
            specifications.append(ProjectSpecification(
                spec_type="GLASS_TYPE",
                value=glass_type,
                context=context,
                page_num=page_num,
                confidence=0.5,
                linked_address=None
            ))
    
    # Frame type patterns
    frame_patterns = [
        r'(series\s*\d{4})',
        r'(\d{4}\s*series)',
        r'(econoframe|e-frame)',
        r'(caps)',
    ]
    
    for pattern in frame_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            context_start = max(0, match.start() - 30)
            context_end = min(len(text), match.end() + 30)
            context = text[context_start:context_end]
            
            specifications.append(ProjectSpecification(
                spec_type="FRAME_TYPE",
                value=match.group(1),
                context=context,
                page_num=page_num,
                confidence=0.6,
                linked_address=None
            ))
    
    return specifications


def link_specifications_to_addresses(
    specifications: List[ProjectSpecification],
    addresses_with_context: List
) -> List[AddressWithSpecs]:
    """
    Link specifications to addresses based on textual proximity and context.
    
    Strategy:
    1. Find specifications that appear near addresses in the text
    2. Link specifications to the closest address
    3. Use installation context keywords to strengthen links
    4. Handle ambiguous cases by keeping specifications unlinked
    """
    
    if not specifications or not addresses_with_context:
        return []
    
    # Create AddressWithSpecs objects
    address_specs_map = {}
    for addr_context in addresses_with_context:
        normalized = addr_context.normalized_address
        address_specs_map[normalized] = AddressWithSpecs(
            address=addr_context.raw_address,
            normalized_address=normalized,
            address_type=addr_context.address_type,
            specifications=[],
            confidence=addr_context.confidence
        )
    
    # Link each specification to the closest address
    for spec in specifications:
        best_address = None
        best_distance = float('inf')
        
        for addr_context in addresses_with_context:
            # Calculate distance between spec and address in combined text
            distance = calculate_text_distance(spec.context, addr_context.surrounding_text)
            
            if distance < best_distance:
                best_distance = distance
                best_address = addr_context
        
        # Link if within reasonable distance
        if best_address and best_distance < 500:  # 500 character threshold
            normalized = best_address.normalized_address
            if normalized in address_specs_map:
                spec.linked_address = best_address.raw_address
                address_specs_map[normalized].specifications.append(spec)
    
    return list(address_specs_map.values())


def calculate_text_distance(text1: str, text2: str) -> float:
    """
    Calculate a simple distance metric between two text segments.
    For this implementation, we use a simple character-based approach.
    In a production system, you might use more sophisticated NLP techniques.
    """
    if not text1 or not text2:
        return float('inf')
    
    # Simple heuristic: if addresses appear in the same context as specs, distance is small
    # This is a simplified version - production would use more sophisticated NLP
    common_words = set(text1.lower().split()) & set(text2.lower().split())
    
    if common_words:
        return 100 / (len(common_words) + 1)  # Smaller distance for more common words
    
    return float('inf')


def create_project_sites_from_linked_data(
    address_specs: List[AddressWithSpecs]
) -> List[Dict[str, Any]]:
    """
    Create structured project site objects from linked address-specification data.
    
    Returns a list of project site objects that can be used by downstream systems.
    """
    project_sites = []
    
    for addr_spec in address_specs:
        site = {
            "address": addr_spec.address,
            "normalized_address": addr_spec.normalized_address,
            "address_type": addr_spec.address_type,
            "confidence": addr_spec.confidence,
            "specifications": {},
        }
        
        # Group specifications by type
        for spec in addr_spec.specifications:
            if spec.spec_type not in site["specifications"]:
                site["specifications"][spec.spec_type] = []
            
            site["specifications"][spec.spec_type].append({
                "value": spec.value,
                "context": spec.context,
                "page": spec.page_num,
                "confidence": spec.confidence
            })
        
        project_sites.append(site)
    
    return project_sites


def validate_specification_consistency(
    project_sites: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Validate that specifications are consistent across project sites.
    
    Returns validation results with any inconsistencies flagged.
    """
    validation_results = []
    
    for site in project_sites:
        site_validation = {
            "address": site["address"],
            "is_consistent": True,
            "inconsistencies": []
        }
        
        specs = site.get("specifications", {})
        
        # Check for conflicting panel sizes
        if "PANEL_SIZE" in specs and len(specs["PANEL_SIZE"]) > 1:
            panel_sizes = [s["value"] for s in specs["PANEL_SIZE"]]
            if len(set(panel_sizes)) > 1:
                site_validation["is_consistent"] = False
                site_validation["inconsistencies"].append(
                    f"Multiple panel sizes found: {panel_sizes}"
                )
        
        # Check for conflicting quantities
        if "QUANTITY" in specs and len(specs["QUANTITY"]) > 1:
            quantities = [s["value"] for s in specs["QUANTITY"]]
            if len(set(quantities)) > 1:
                site_validation["is_consistent"] = False
                site_validation["inconsistencies"].append(
                    f"Multiple quantities found: {quantities}"
                )
        
        validation_results.append(site_validation)
    
    return validation_results