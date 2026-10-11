# AI to Excel Workflow - Detailed Explanation

## Overview: How AI Creates Excel Proposals

The GFS-AI system transforms unstructured documents (PDFs, emails, drawings) into structured Excel workbook data through a multi-stage AI pipeline. Here's how it works end-to-end.

---

## What We Receive: Input Data

### 1. Incoming Documents (Source Data)

**File Types Processed**:
- **Email files**: `.eml`, `.msg` (Outlook emails)
- **PDF documents**: Architectural drawings, spec sheets, quotes
- **Text files**: `.txt` (email bodies)
- **Images**: `.png`, `.jpg`, `.jpeg` (scanned drawings)

**Document Sources**:
- Outlook email attachments
- Zoho CRM uploads
- Customer portal uploads
- Direct file uploads

**What's in These Documents**:
- Project addresses and contact information
- Architectural drawings with dimensions
- Glass specifications and requirements
- Frame type preferences
- Installation details
- Add-on requirements (special glass, coatings, etc.)

### 2. Service Bus Messages (Trigger Data)

**Message Schema** (from `listener/message_schema.py`):
```json
{
  "jobType": "EMAIL_PROPOSAL" | "NEW_PROJECT" | "DOCUMENT_EXTRACTION",
  "correlationId": "unique-trace-id",
  "payload": {
    "subject": "Project inquiry subject",
    "sender": "client@company.com",
    "documents": [
      {
        "documentId": "unique-id",
        "originalName": "drawing.pdf",
        "blobUrl": "https://storage.../drawing.pdf?sas-token"
      }
    ]
  }
}
```

**What This Tells the AI**:
- Which job type to execute
- How to trace this request through the system
- Where to download the documents
- Who sent the request

---

## Where Information Is Stored

### Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA STORAGE LAYERS                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Azure Blob Storage (Temporary)                          │
│     - Original uploaded documents                            │
│     - Downloaded by AI for processing                        │
│     - Deleted after processing                               │
│                                                              │
│  2. Local File System (Processing)                           │
│     - Downloaded documents in temp directories                │
│     - Intermediate extraction results (JSON)                 │
│     - Rendered images for Vision API                         │
│     - Final extraction results                               │
│                                                              │
│  3. MongoDB (Persistent - Node.js Backend)                  │
│     - Approved stage results                                 │
│     - Project metadata                                       │
│     - Estimator approvals                                    │
│     - Final consolidated data                                │
│                                                              │
│  4. Excel Workbook (Output)                                 │
│     - Master Workbook template                               │
│     - Cell values written by backend                         │
│     - Final proposal for customer                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Storage Details

#### Azure Blob Storage
**Purpose**: Temporary document storage from Node.js backend

**Lifecycle**:
1. Node.js uploads documents → Blob Storage
2. Generates SAS URLs (time-limited access tokens)
3. AI downloads using SAS URLs
4. Processes documents
5. Blob storage not responsible for retention

**What's Stored**:
- Original PDFs, emails, images
- No processing artifacts here

#### Local File System (AI Processing)
**Purpose**: Working storage during AI processing

**Directory Structure**:
```
project_folder/
├── original_files/
│   ├── email.eml
│   ├── drawing.pdf
│   └── spec_sheet.pdf
├── non_ai_results/
│   ├── email_structured.json
│   ├── drawing_structured.json
│   └── flagged_figures/
│       ├── figure_1.png
│       └── figure_2.png
├── extraction_results/
│   ├── email_20240731_120000.json
│   ├── drawing_20240731_120001.json
│   ├── drawing_20240731_120001_vision.json
│   └── project_final_result.json
└── azure_results/
    └── di_output.json
```

**What's Stored**:
- Downloaded original files
- Docling extraction results (structured text, tables, figures)
- Cropped figure images for Vision API
- Rendered page images
- LLM extraction results (per file)
- Consolidated project results

**Retention**: Kept for debugging, can be deleted after approval

#### MongoDB (Node.js Backend)
**Purpose**: Persistent storage of approved project data

**Collections**:
- `projects`: Project metadata and stage approvals
- `extractions`: AI extraction results by stage
- `approvals`: Estimator approval decisions

**Data Flow**:
```
AI Stage Result → Webhook → Node.js → MongoDB
```

**What's Stored**:
```json
{
  "projectId": "project-123",
  "stage": "STAGE_3_APPROVED",
  "approvedAt": "2024-07-31T12:00:00Z",
  "approvedBy": "estimator@gfs.com",
  "data": {
    "header_signals": { ... },
    "glass_signals": { ... },
    "frame_signals": { ... },
    "units": [ ... ]
  },
  "correlationId": "trace-id"
}
```

**Why MongoDB**: Flexible schema for evolving AI outputs, queryable for reporting

#### Excel Workbook (Final Output)
**Purpose**: Customer-facing proposal document

**Location**: Generated by Node.js backend, stored in file system or cloud storage

**What's Written**:
- Header information (project name, address, contact)
- Glass type selection (trigger cells)
- Frame type selection (trigger cells)
- Unit dimensions (take-off sheet)
- Add-on selections (trigger cells)
- Calculated values (man-hours, packaging, hardware)

**How It's Written**: Backend uses openpyxl to write cell values from AI output

---

## How AI Works: The Intelligence Pipeline

### AI Components and Their Roles

#### 1. Docling (Non-AI Text Extraction)
**What It Does**: Converts PDFs to structured text without OCR

**Input**: PDF file
**Output**: Structured JSON with:
```json
{
  "n_pages": 5,
  "headings": [
    {"text": "Project Specifications", "page": 1, "level": 1}
  ],
  "paragraphs": [
    {"text": "The project requires walkable glass...", "page": 1}
  ],
  "tables": [
    {"n_rows": 10, "n_cols": 4, "cells": [...]}
  ],
  "figures": [
    {"page": 3, "bbox": [100, 200, 300, 400]}
  ],
  "full_text_by_page": {
    "1": "Complete text of page 1...",
    "2": "Complete text of page 2..."
  }
}
```

**Why It's Used**: Fast, accurate for digital PDFs, no API cost

**When It Fails**: Scanned documents, handwritten text, complex layouts

---

#### 2. Azure Document Intelligence (Formerly Form Recognizer)
**What It Does**: Advanced OCR and layout analysis

**Input**: PDF bytes or image
**Output**: High-precision text with spatial coordinates

**Special Features**:
- Table extraction with cell boundaries
- Handwriting recognition
- Form field extraction
- Document type classification

**Why It's Used**: Better than Docling for scanned documents, provides spatial context

**Cost**: Per-page API cost, but cheaper than Vision

---

#### 3. Azure OpenAI Vision (GPT-4 Vision)
**What It Does**: Understands visual content and extracts structured information

**Input**: Base64-encoded images + text prompt
**Output**: Structured JSON following a schema

**Prompt Example** (simplified):
```
Analyze this architectural drawing and extract:
- Glass type (walkable/non-walkable)
- Dimensions (width, length in inches)
- Frame type indicators
- Installation context (interior/exterior)
- Any special requirements

Return JSON with:
{
  "glass_signals": {...},
  "frame_signals": {...},
  "units": [...]
}
```

**What It Understands**:
- Architectural symbols and annotations
- Dimension lines and callouts
- Text in drawings (even stylized CAD text)
- Spatial relationships between elements
- Context from surrounding text

**Why It's Used**: Can extract information that's only visible in drawings, not in text layer

**Cost**: Most expensive, but necessary for visual content

**Optimization**: 
- Page classifier filters irrelevant pages
- Large-format tiling for dimension legibility
- Batch processing (multiple pages per API call)

---

#### 4. Text-Only LLM (GPT-4)
**What It Does**: Extracts structured information from text content

**Input**: Text content + extraction prompt
**Output**: Structured JSON

**When Used**: 
- Email bodies
- Spec sheets (text-heavy)
- After Vision has processed visual content

**Why It's Used**: Cheaper than Vision, sufficient for text-only documents

---

#### 5. Rules Engine (Business Logic)
**What It Does**: Applies GFS business rules to extracted data

**Input**: Canonical signals from AI extraction
**Output**: Decisions (glass type, frame type, etc.)

**Example Rule** (simplified from `rules/rule2_glass_type.py`):
```python
if is_walkable and is_exterior and has_air_gap:
    return "GLASS_WITH_IGU"
elif is_walkable and is_exterior and not has_air_gap:
    return "GLASS_NO_IGU"
elif is_walkable and is_interior and conditioned_below:
    return "GLASS_2_0"
```

**Why It's Used**: 
- Encodes expert knowledge
- Consistent decision-making
- Explainable reasoning
- Separates AI extraction from business logic

**Rules**:
- Rule 2: Glass type decision
- Rule 3: Frame type decision
- Rule 4: Cross-beam decision
- Rule 5: Add-on decisions
- Rule 6: Calculations

---

### AI Workflow: Step by Step

#### Stage 0: Cover Analysis (Fast Path)
```
1. Receive email + attachments
2. Download from Blob Storage
3. Docling extraction → text
4. Content parser → regex extraction
5. Check: Is project_address found?
   ├─ Yes → Return immediately (no AI call)
   └─ No  → Vision fallback
6. Vision fallback:
   - Render cover pages as images
   - Send to OpenAI Vision
   - Extract project_address, customer_name
7. Return result to backend
```

**AI Used**: Docling (always), OpenAI Vision (only if needed)

**Time**: 2-3 seconds (fast path), 10-15 seconds (Vision fallback)

---

#### Stage 1: Header Extraction
```
1. Receive approved cover result
2. Download all project documents
3. Azure DI extraction on all files
4. Text-based parsing for:
   - Contact name, email, phone
   - Project address
   - Project name
   - Architect name
5. Return structured header signals
```

**AI Used**: Azure Document Intelligence

**Time**: 5-10 seconds per document

---

#### Stage 2: Dimension Take-off
```
1. Load project documents
2. Identify drawing files (PDFs with figures)
3. For each drawing:
   - Render pages as images
   - Send to Vision with dimension extraction prompt
   - Extract: width, length, panel count, rafters
4. Dimension rescue:
   - If dimensions unclear/missing
   - Use OCR-located tiles for targeted extraction
5. Reconcile units across multiple drawings
6. Return unit list with dimensions
```

**AI Used**: OpenAI Vision, Azure DI (for dimension rescue)

**Time**: 15-30 seconds per drawing

---

#### Stage 3: Deep Technical Extraction
```
1. Load all project documents
2. Page classification:
   - Floor plans, sections, schedules, details
   - Filter irrelevant pages
3. For each relevant page:
   - Text extraction (Docling/Azure DI)
   - If large-format CAD sheet:
     - Use OCR to locate dimension regions
     - Render high-DPI tiles of those regions
     - Send tiles + overview to Vision
   - Else:
     - Render full page at 300 DPI
     - Send to Vision
4. Vision prompt extracts:
   - Glass signals (walkable, exterior, air gap, etc.)
   - Frame signals (frame type, install type)
   - Location signals (country, expedited)
   - Unit details
5. Merge results across all pages
6. Return consolidated extraction
```

**AI Used**: OpenAI Vision (primary), Azure DI (support), Docling (text)

**Time**: 30-60 seconds per document

---

#### Stage 4: Glass Type Decision
```
1. Load Stage 3 extraction results
2. Convert to canonical signals
3. Apply Rule 2 decision tree:
   - Check: is_replacement_glass_only?
   - Check: is_stair_tread?
   - Check: is_non_walkable?
   - Check: frame_type_stated (EconoFrame)?
   - Check: is_exterior + has_air_gap?
   - Check: is_interior + conditioned_below?
   - etc.
4. Return glass type code + reasoning
```

**AI Used**: None (rules engine only)

**Time**: <1 second

---

#### Stage 5: Frame & Cross-beam Decisions
```
1. Load Stage 3 extraction + Stage 4 glass type
2. Apply Rule 3 (frame type):
   - Determine series (1000/2000/3000)
   - Determine install type (pedestal/recessed/interior)
   - Determine assembly (FA/KD)
   - Select proposal description row
3. Apply Rule 4 (cross-beam):
   - Check panel dimensions
   - Check series context
   - Determine cross-beam requirement
4. Return frame + cross-beam decisions
```

**AI Used**: None (rules engine only)

**Time**: <1 second

---

#### Stage 6: Add-ons & Excel Generation
```
1. Load all previous stage results
2. Apply Rule 5 (add-ons):
   - Check for Sentry Glass
   - Check for Krypton gas
   - Check for Heat Soak Testing
   - Check for Nanodot
   - Check for Duty (Canadian)
3. Apply Rule 6 (calculations):
   - Calculate man-hours (based on sqft)
   - Calculate packaging (based on unit count)
   - Calculate hardware quantities
4. Cell mapping:
   - Map glass type → trigger cell (e.g., D9)
   - Map frame type → trigger cell (e.g., D38)
   - Map dimensions → take-off cells (e.g., E115, F115)
   - Map add-ons → trigger cells (e.g., D16)
5. Return {cell_address: value} dictionary
```

**AI Used**: None (rules engine + calculations only)

**Time**: <1 second

---

## How Data Flows to Excel

### The Cell Mapping Process

#### Step 1: Rules Engine Output
Each rule produces a structured result:

**Glass Type Result**:
```python
GlassTypeResult(
    glass_type_code="GLASS_WITH_IGU",
    workbook_row_name="Glass - with IGU",
    proposal_candidates=[5, 6, 7, 8],
    confidence="HIGH",
    reasoning=["Exterior + air gap confirmed"]
)
```

**Frame Type Result**:
```python
FrameTypeResult(
    frame_type_code="SERIES_2000_RECESSED",
    install_type="RECESSED",
    assembly_type="FA",
    proposal_number=14,
    confidence="HIGH"
)
```

**Unit Takeoff**:
```python
UnitTakeOff(
    unit_id="A",
    location="Main deck",
    width_inches=48.0,
    length_inches=96.0,
    panel_count=2,
    vertical_rafters=4,
    horizontal_rafters=8
)
```

#### Step 2: Cell Mapping (cell_mapper.py)
The `aggregate()` function maps rule outputs to Excel cells:

```python
# Example: Glass type mapping
glass_code = "GLASS_WITH_IGU"
row = GLASS_ROWS[glass_code]  # row 10

for unit in ["A", "B", "C"]:
    col = UNIT_SELECTOR_COLS[unit]  # D, G, J
    cell_addr = f"{col}{row}"  # D10, G10, J10
    cells_to_write[cell_addr] = "y"  # Trigger cell
```

**What Gets Written**:
- **Trigger cells**: "y" or "Y" to select options
- **Take-off cells**: Numeric values (dimensions, counts)
- **Header cells**: Text values (names, addresses)
- **Calculation cells**: Computed values (man-hours, packaging)

**What Does NOT Get Written**:
- Formula cells (Excel calculates these)
- Price cells (Excel calculates these)
- Manual cells (left blank for estimator)

#### Step 3: Excel Generation (Node.js Backend)
The backend receives the cell mapping:

```json
{
  "cells_to_write": {
    "D10": "y",
    "G10": "y",
    "D42": "y",
    "E115": 48.0,
    "F115": 96.0,
    "C2": "Project at 123 Main St",
    "D90": "Y"
  },
  "manual_fields": [
    {"cell_address": "E73", "field_name": "packaging", "reason": "Manual input required"}
  ],
  "pending_fields": []
}
```

The backend:
1. Opens Master Workbook template
2. Writes values to specified cells
3. Saves as new proposal file
4. Returns to estimator for review

---

## Memory and State Management

### How the System "Remembers"

#### 1. Correlation IDs
Every request has a unique `correlationId` that flows through the entire system:

```
Service Bus Message → AI Processing → MongoDB → Excel Generation
     ↓                    ↓                ↓              ↓
correlationId    correlationId    correlationId   correlationId
```

**Purpose**: Trace any request end-to-end through logs and databases

#### 2. MongoDB State
After each stage approval, data is persisted to MongoDB:

```javascript
// Stage 1 approved
{
  projectId: "proj-123",
  stage: "STAGE_1_APPROVED",
  approvedAt: ISODate("2024-07-31T12:00:00Z"),
  data: {
    header_signals: {
      project_name: {value: "123 Main St", confidence: "HIGH"},
      contact_email: {value: "client@example.com", confidence: "HIGH"}
    }
  }
}

// Stage 2 approved
{
  projectId: "proj-123",
  stage: "STAGE_2_APPROVED",
  approvedAt: ISODate("2024-07-31T13:00:00Z"),
  data: {
    units: [
      {unit_id: "A", width_inches: 48, length_inches: 96}
    ]
  }
}
```

**Purpose**: When Stage 3 starts, it loads all previous stage data

#### 3. File System State
Intermediate results are saved to disk:

```
extraction_results/
├── proj123_stage1.json
├── proj123_stage2.json
├── proj123_stage3.json
├── proj123_stage4.json
├── proj123_stage5.json
└── proj123_final.json
```

**Purpose**: Debugging, re-running stages without re-processing

#### 4. Service Bus Locks
Long-running operations (Vision API) use message locks:

```python
renewer.register(
    receiver=receiver,
    renewable=message,
    max_lock_renewal_duration=7200  # 2 hours
)
```

**Purpose**: Prevents message re-delivery during long AI operations

---

### What Happens When Something Fails

#### Transient Failures (Retry)
- Network timeout → Abandon message → Retry
- API rate limit → Abandon message → Retry
- Temporary service outage → Abandon message → Retry

#### Permanent Failures (Dead Letter)
- Invalid schema → Dead letter
- Unsupported file type → Dead letter
- Permanent backend error → Dead letter

#### Human Intervention Required
- Low confidence → Flag for estimator review
- Missing critical data → Flag as MANUAL
- Conflicting signals → Flag for clarification

---

## Summary: The AI-to-Excel Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                    INPUT: Unstructured Documents                │
│  (PDFs, emails, drawings from customer)                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AI EXTRACTION LAYER                           │
│  Docling → Azure DI → OpenAI Vision → Text LLM                  │
│  Extract: glass, frame, dimensions, location, units             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    RULES ENGINE LAYER                           │
│  Rule 2: Glass type decision                                    │
│  Rule 3: Frame type decision                                   │
│  Rule 4: Cross-beam decision                                   │
│  Rule 5: Add-on decisions                                      │
│  Rule 6: Calculations                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CELL MAPPING LAYER                            │
│  Map decisions → Excel cell addresses                          │
│  Generate {cell: value} dictionary                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPUT: Excel Workbook                       │
│  Master Workbook with populated cells                           │
│  Ready for estimator review and customer delivery              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Takeaways

1. **AI extracts, Rules decide**: AI pulls information from documents; rules engine makes business decisions

2. **Multi-stage approval**: Each stage requires human approval before proceeding, ensuring quality control

3. **Persistent state**: MongoDB stores approved results; file system stores intermediate artifacts

4. **Traceability**: Correlation IDs trace every request through the entire pipeline

5. **Excel as output**: The final product is a cell mapping that the backend writes to Excel

6. **Memory is distributed**: No single "memory" - state is in MongoDB, file system, and Service Bus queues

7. **AI is specialized**: Different AI components for different tasks (Docling for text, Vision for images, LLM for understanding)

8. **Fallback mechanisms**: If one AI fails, another tries (Docling → Azure DI → Vision)

This architecture ensures reliable, traceable, and explainable transformation from unstructured documents to structured Excel proposals.
