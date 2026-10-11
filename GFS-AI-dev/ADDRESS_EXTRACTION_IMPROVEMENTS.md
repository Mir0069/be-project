# Address & Project Information Extraction Improvements

## Overview

This document details the enhancements made to the GFS-AI address and project information extraction system to solve the critical issue of correctly identifying installation addresses when multiple addresses are present in emails and documents.

## Problem Statement

The original system had significant limitations when handling multiple addresses:

- **No address type differentiation**: Could not distinguish between installation site, billing address, company headquarters, or architect office
- **No contextual reasoning**: Address selection was based on document order, not installation intent
- **No ambiguity detection**: Multiple addresses with similar confidence were not flagged for user review
- **No entity linking**: Project specifications (panel sizes, quantities, glass types) were not associated with specific addresses
- **Basic pattern matching**: Only used regex patterns without semantic understanding

## Implemented Improvements

### 1. Enhanced Address Utilities (`classifier/address_utils.py`)

#### New Data Structure
```python
@dataclass
class AddressWithContext:
    raw_address: str
    normalized_address: str
    address_type: str  # INSTALLATION, BILLING, COMPANY, ARCHITECT, UNKNOWN
    confidence: float  # 0.0 to 1.0
    context_keywords: List[str]
    surrounding_text: str
    source_location: str  # EMAIL_BODY, ATTACHMENT, SIGNATURE, TITLE_BLOCK
```

#### Installation Intent Detection
- **Keyword-based detection**: Identifies installation-related phrases like "install at", "site address", "project location", "job site"
- **Context analysis**: Examines 300 characters before and after each address for contextual clues
- **Confidence scoring**: Calculates confidence based on keyword presence and competing address types

#### Address Type Classification
Classifies addresses into five types:
- **INSTALLATION**: Site where glass flooring work will be installed
- **BILLING**: Where invoices/quotes should be sent
- **COMPANY**: Company headquarters or main office
- **ARCHITECT**: Architect or design firm office
- **UNKNOWN**: Cannot determine type from context

#### Smart Address Selection
```python
def select_best_installation_address(addresses_with_context):
    # Prioritizes INSTALLATION type addresses
    # Falls back to UNKNOWN if no installation addresses found
    # Returns None if ambiguity detected (similar confidence scores)
```

#### Ambiguity Detection
```python
def detect_address_ambiguity(addresses_with_context, threshold=0.3):
    # Detects when multiple addresses have similar confidence
    # Returns (is_ambiguous, candidate_addresses)
    # Triggers user confirmation when ambiguous
```

#### Address Ranking System
```python
def rank_addresses_by_installation_likelihood(addresses_with_context):
    # Multi-factor ranking:
    # 1. Address type priority (INSTALLATION > UNKNOWN > others)
    # 2. Confidence score
    # 3. Installation keyword presence
    # 4. Source location (EMAIL_BODY > ATTACHMENT > SIGNATURE)
```

### 2. Cross-Document Reasoning

#### Source Location Classification
```python
def classify_source_location(text, is_email_body=False, is_attachment=False):
    # Classifies text as EMAIL_BODY, ATTACHMENT, TITLE_BLOCK, or SIGNATURE
    # Uses signature detection (regards, thanks, disclaimer patterns)
    # Uses title block detection (project:, location:, site: patterns)
```

#### Cross-Source Confirmation
```python
def apply_cross_document_reasoning(email_addresses, attachment_addresses):
    # Boosts confidence for addresses appearing in multiple sources
    # Applies hierarchical source prioritization
    # Detects cross-source confirmation as a strong signal
```

### 3. Enhanced Classifier Prompt (`classifier/prompt.py`)

#### New Address Extraction Format
**Old format:**
```json
"addresses": ["123 Street Name, City, State"]
```

**New format:**
```json
"addresses": [
  {
    "address": "456 Greenwich Ave, New York, NY",
    "type": "INSTALLATION",
    "context": "install at 456 Greenwich Ave",
    "confidence": 0.9
  },
  {
    "address": "789 Corporate Blvd, Chicago, IL",
    "type": "BILLING",
    "context": "send invoice to 789 Corporate Blvd",
    "confidence": 0.8
  }
]
```

#### Enhanced LLM Instructions
- Explicit address type classification with keyword examples
- Context extraction for each address
- Confidence scoring guidance
- Contextual reasoning requirements

### 4. Classifier Integration (`classifier/classifier.py`)

#### Backward Compatibility
```python
# Handles both old and new address formats
if isinstance(addresses_raw[0], dict):
    # New format with types and context
    # Process with enhanced logic
else:
    # Old format - backward compatibility
    # Use existing logic
```

#### Enhanced Processing Pipeline
1. **Format detection**: Identifies old vs new address format
2. **Context analysis**: Processes addresses with full context
3. **Cross-document reasoning**: Applies source hierarchy
4. **Smart selection**: Selects best installation address
5. **Ambiguity detection**: Flags uncertain cases
6. **Entity linking**: Associates specifications with addresses

#### Enhanced Output
```python
{
    "classification": "NEW_PROJECT",
    "address": "fallback address for compatibility",
    "installation_address": "best installation address",
    "address_ambiguity_detected": True/False,
    "all_addresses": [...],  # Full address objects with context
    "linked_specifications": {...}  # Entity-linked specifications
}
```

### 5. Entity Linking System (`classifier/entity_linker.py`)

#### Specification Extraction
```python
def extract_specifications_from_text(text, page_num=None):
    # Extracts:
    # - Panel dimensions (6x6, 4'x8', 48"x48")
    # - Quantities (10 panels, 6 units)
    # - Glass types (tempered, laminated, insulated)
    # - Frame types (Series 1000, 2000 series)
```

#### Address-Specification Linking
```python
def link_specifications_to_addresses(specifications, addresses_with_context):
    # Links specifications to addresses based on:
    # - Textual proximity
    # - Contextual keywords
    # - Installation intent
```

#### Project Site Creation
```python
def create_project_sites_from_linked_data(address_specs):
    # Creates structured project site objects:
    {
        "address": "...",
        "address_type": "INSTALLATION",
        "specifications": {
            "PANEL_SIZE": [...],
            "QUANTITY": [...],
            "GLASS_TYPE": [...]
        }
    }
```

#### Consistency Validation
```python
def validate_specification_consistency(project_sites):
    # Validates specification consistency within each site
    # Flags conflicting panel sizes, quantities, etc.
    # Returns validation results with inconsistency details
```

### 6. Enhanced Extraction Prompt (`extraction/extraction_prompt.py`)

#### Updated Instructions for project_address
```
For project_address:
- Extract the project site address where installation will occur
- Use installation context to identify the correct address when multiple addresses are present
- Look for keywords like "install at", "site address", "project location", "job site"
- If multiple addresses are present and you cannot determine which is the installation site, extract the most likely one based on context and set confidence to LOW
- In reasoning, explain why you selected this address over others if multiple were found
```

### 7. Graph Matcher Integration (`classifier/graph_matcher.py`)

#### Backward Compatibility
```python
# Handles new address format in graph matching
if input_addresses and isinstance(input_addresses[0], dict):
    # Extract raw addresses for backward compatibility
    signals["addresses"] = [addr.get("address", "") for addr in input_addresses]
else:
    # Use existing text extraction
    signals["addresses"] = extract_addresses_from_text(combined_text)
```

## Benefits

### 1. Improved Accuracy
- **Context-aware selection**: Addresses are selected based on installation intent, not document order
- **Type classification**: Distinguishes between installation, billing, company, and architect addresses
- **Confidence scoring**: Provides quantitative confidence metrics for address selection

### 2. Ambiguity Handling
- **Automatic detection**: Identifies when multiple addresses have similar confidence
- **User confirmation**: Flags ambiguous cases for human review
- **Ranked alternatives**: Provides ranked candidate addresses when uncertain

### 3. Entity Association
- **Specification linking**: Associates panel sizes, quantities, and glass types with specific addresses
- **Project site structure**: Creates structured project site objects with linked specifications
- **Consistency validation**: Validates specification consistency within each project site

### 4. Cross-Document Intelligence
- **Source hierarchy**: Prioritizes email body over attachments, title blocks over body text
- **Cross-source confirmation**: Boosts confidence when addresses appear in multiple sources
- **Signature detection**: Identifies and de-prioritizes signature addresses

### 5. Backward Compatibility
- **Format handling**: Processes both old (string list) and new (object list) address formats
- **Gradual migration**: Existing systems continue to work while new format is adopted
- **Fallback logic**: Maintains existing behavior when new format is not available

## Testing Results

### Unit Tests Passed
```bash
✓ Basic address utilities (normalize_address, extract_addresses_from_text)
✓ Address type detection (detect_address_type)
✓ Installation address selection (select_best_installation_address)
✓ Classifier import and integration
✓ Graph matcher compatibility
✓ Entity linker functionality
✓ Backward compatibility (old vs new format)
```

### Example Scenarios

#### Scenario 1: Multiple Addresses with Clear Context
**Input:**
```
Please install six 6×6 glass panels at 123 Main Street. 
Send quotation to our headquarters at 456 Corporate Blvd.
```

**Output:**
```json
{
  "installation_address": "123 Main Street",
  "address_ambiguity_detected": false,
  "all_addresses": [
    {
      "address": "123 Main Street",
      "type": "INSTALLATION",
      "confidence": 0.95,
      "context": "install at 123 Main Street"
    },
    {
      "address": "456 Corporate Blvd",
      "type": "BILLING",
      "confidence": 0.85,
      "context": "send quotation to our headquarters"
    }
  ]
}
```

#### Scenario 2: Ambiguous Addresses
**Input:**
```
Project at 123 Main Street and 456 Oak Avenue. 
Need glass flooring for both locations.
```

**Output:**
```json
{
  "installation_address": null,
  "address_ambiguity_detected": true,
  "all_addresses": [
    {
      "address": "123 Main Street",
      "type": "UNKNOWN",
      "confidence": 0.5,
      "context": "Project at 123 Main Street"
    },
    {
      "address": "456 Oak Avenue",
      "type": "UNKNOWN",
      "confidence": 0.5,
      "context": "456 Oak Avenue"
    }
  ]
}
```

#### Scenario 3: Entity Linking
**Input:**
```
Install 6x6 panels at 123 Main Street. 
Use tempered glass. Quantity: 10 panels.
```

**Output:**
```json
{
  "installation_address": "123 Main Street",
  "linked_specifications": {
    "project_sites": [
      {
        "address": "123 Main Street",
        "specifications": {
          "PANEL_SIZE": [{"value": "6x6", "confidence": 0.7}],
          "QUANTITY": [{"value": 10, "confidence": 0.6}],
          "GLASS_TYPE": [{"value": "tempered", "confidence": 0.5}]
        }
      }
    ],
    "validation": [
      {
        "address": "123 Main Street",
        "is_consistent": true,
        "inconsistencies": []
      }
    ]
  }
}
```

## Migration Guide

### For Existing Systems

#### Immediate Action Required
No immediate changes required - the system is backward compatible.

#### Recommended Updates
1. **Update address processing**: Handle new address format in your downstream systems
2. **Use installation_address**: Prefer `installation_address` over generic `address` field
3. **Handle ambiguity**: Check `address_ambiguity_detected` flag and implement user confirmation
4. **Use linked specifications**: Process `linked_specifications` for entity-linked data

#### Code Example
```python
# Old way
address = classification_result.get("address")

# New way (recommended)
installation_address = classification_result.get("installation_address") or classification_result.get("address")
if classification_result.get("address_ambiguity_detected"):
    # Request user confirmation
    candidates = classification_result.get("all_addresses", [])
    installation_address = request_user_selection(candidates)

# Process linked specifications
linked_specs = classification_result.get("linked_specifications")
if linked_specs:
    project_sites = linked_specs.get("project_sites", [])
    for site in project_sites:
        specs = site.get("specifications", {})
        # Process specifications for this site
```

## Future Enhancements (Not Implemented)

The following improvements were identified but not implemented in this phase:

### Long-term Improvements
1. **Human-in-the-Loop System**: Implement review queue for low-confidence extractions
2. **Active Learning**: Learn from user corrections to improve extraction accuracy
3. **Advanced NLP Models**: Fine-tune models for construction industry address extraction
4. **Geospatial Validation**: Validate addresses using geospatial services
5. **Entity Resolution**: Advanced entity resolution for address normalization

### Additional Address Types
1. **Shipping Address**: Separate handling for delivery vs installation addresses
2. **Site Contact Address**: Specific contact person addresses at job sites
3. **Owner Address**: Property owner vs contractor addresses

### Advanced Cross-Document Analysis
1. **Document Type Recognition**: Automatically identify document types (lead sheet, drawing, invoice)
2. **Temporal Analysis**: Consider document dates and revision history
3. **Relationship Mapping**: Map relationships between different addresses in project documents

## Files Modified

1. **classifier/address_utils.py** - Enhanced address utilities with context analysis
2. **classifier/prompt.py** - Updated classifier prompt for address type extraction
3. **classifier/classifier.py** - Integrated enhanced address processing
4. **classifier/graph_matcher.py** - Added backward compatibility for new address format
5. **extraction/extraction_prompt.py** - Enhanced extraction instructions
6. **classifier/entity_linker.py** - New entity linking system

## Summary

The implemented improvements provide a comprehensive solution to the address extraction problem:

- **Smart classification**: Addresses are now classified by type with confidence scores
- **Context-aware selection**: Installation addresses are identified using contextual reasoning
- **Ambiguity detection**: Uncertain cases are flagged for human review
- **Entity linking**: Specifications are associated with correct installation addresses
- **Backward compatibility**: Existing systems continue to work without modification
- **Cross-document intelligence**: Addresses are prioritized based on source hierarchy

These improvements significantly reduce the risk of selecting incorrect addresses for installation while maintaining system stability and providing a clear migration path for enhanced functionality.