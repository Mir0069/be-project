# GFS-AI System Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture & Data Flow](#architecture--data-flow)
3. [Pipeline Stages](#pipeline-stages)
4. [File-by-File Documentation](#file-by-file-documentation)
5. [Component Interactions](#component-interactions)
6. [Configuration & Environment](#configuration--environment)
7. [Deployment & Operations](#deployment--operations)

---

## System Overview

GFS-AI is an intelligent document processing system for Glass Flooring Systems that automates the extraction of structured project information from incoming lead documents (emails, PDFs, drawings, and attachments). The system uses a multi-stage AI pipeline combining rule-based extraction, computer vision, and LLM analysis to convert unstructured documents into structured pricing data ready for Excel workbook generation.

### Key Capabilities
- **Multi-document processing**: Handles emails, PDFs, drawings, and spec sheets as unified project leads
- **Hybrid extraction strategy**: Direct text extraction (Docling) + Azure OpenAI Vision fallback
- **Multi-stage pipeline**: 6-stage approval workflow with human-in-the-loop validation
- **Rules engine**: Business logic for glass type, frame type, cross-beam, and add-on decisions
- **Excel integration**: Direct cell mapping to Master Workbook template
- **Azure integration**: Service Bus queues, Blob Storage, and OpenAI Vision

---

## Architecture & Data Flow

### High-Level Flow

```
Outlook/Zoho → Node.js Backend → Azure Blob Storage → Azure Service Bus
                                                              ↓
                                                    ┌─────────────────────┐
                                                    │  Service Bus Queue  │
                                                    └─────────────────────┘
                                                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         GFS-AI Service                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐  │
│  │   Listener   │─────▶│   FastAPI    │─────▶│   Pipeline Runner    │  │
│  │   Worker     │      │   App        │      │                      │  │
│  └──────────────┘      └──────────────┘      └──────────────────────┘  │
│         │                      │                        │                 │
│         │                      ▼                        ▼                 │
│         │              ┌──────────────┐      ┌──────────────────────┐   │
│         │              │ Cover Pipeline│─────▶|  AI Engine (Deep)   │   │
│         │              └──────────────┘      └──────────────────────┘   │
│         │                      │                        │                 │
│         │                      ▼                        ▼                 │
│         │              ┌──────────────┐      ┌──────────────────────┐   │
│         └─────────────▶│  Rules Engine │◀─────│  Extraction Layer    │   │
│                        └──────────────┘      └──────────────────────┘   │
│                               │                        │                 │
│                               ▼                        ▼                 │
│                        ┌──────────────┐      ┌──────────────────────┐   │
│                        │ Cell Mapper   │◀─────│  Canonical Signals   │   │
│                        └──────────────┘      └──────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │  Node.js Backend│
                    │  (MongoDB)      │
                    └─────────────────┘
                              ↓
                    ┌─────────────────┐
                    │  Excel Workbook │
                    │  Generation     │
                    └─────────────────┘
```

### Queue Architecture

The system uses multiple Azure Service Bus queues for different processing stages:

1. **Email Queue** (`ai-ocr-ingestion`): EMAIL_PROPOSAL messages for initial classification
2. **Extraction Queue** (`ai-stage-trigger`): NEW_PROJECT, DOCUMENT_EXTRACTION, and stage transition messages
3. **Rules Queue** (`ai-stage-result`): Rules engine processing (Stages 1-6)
4. **Teams Queue** (`teams-ai-integration`): Microsoft Teams integration

---

## Pipeline Stages

### Stage 0: Document Ingestion & Cover Analysis
**Purpose**: Initial lead intake and basic project identification

**Process**:
1. Service Bus listener receives EMAIL_PROPOSAL message
2. Downloads documents from Azure Blob Storage
3. Runs cover pipeline for fast-path extraction
4. Classifies as CREATE/LINK/NOT_PROJECT
5. Sends webhook to Node.js backend

**Key Files**: `cover_pipeline.py`, `listener/worker.py`

### Stage 1: Header Information Extraction
**Purpose**: Extract project metadata (contact info, address, project details)

**Process**:
1. Azure Document Intelligence (DI) extraction on all documents
2. Text-based parsing for structured fields
3. Human approval required
4. Approved data stored in MongoDB

**Key Files**: `api/pipeline_runner.py` (run_stage_1)

### Stage 2: Dimension Take-off
**Purpose**: Extract unit dimensions, panel counts, rafter information

**Process**:
1. Vision-based extraction from drawings
2. Dimension rescue for unclear measurements
3. Unit reconciliation across multiple documents
4. Human approval required

**Key Files**: `api/pipeline_runner.py` (run_stage_2), `extraction/dimension_rescue.py`

### Stage 3: Deep Technical Extraction
**Purpose**: Extract glass specifications, frame types, installation details

**Process**:
1. Computer vision analysis of drawings and spec sheets
2. Page classification (floor plans, sections, schedules)
3. Tiled rendering for large-format drawings
4. LLM extraction with structured prompts
5. Human approval required

**Key Files**: `ai_engine.py`, `extraction/extraction_runner.py`, `extraction/page_tiler.py`

### Stage 4: Glass Type Decision (Rule 2)
**Purpose**: Determine glass type based on walkability, location, and thermal requirements

**Process**:
1. Analyze canonical signals from extraction
2. Apply decision tree for glass type selection
3. Consider interior/exterior context
4. Determine IGU requirements
5. Human approval required

**Key Files**: `rules/rule2_glass_type.py`

### Stage 5: Frame & Cross-beam Decisions (Rules 3-4)
**Purpose**: Determine frame type, installation method, and cross-beam requirements

**Process**:
1. Frame type decision (Series 1000/2000, EconoFrame, etc.)
2. Installation type (pedestal, recessed, interior)
3. Assembly type (FA/KD)
4. Cross-beam requirements
5. Human approval required

**Key Files**: `rules/rule3_frame_type.py`, `rules/rule4_cross_beam.py`

### Stage 6: Add-ons & Excel Generation (Rules 5-6)
**Purpose**: Determine add-ons and generate Excel cell mappings

**Process**:
1. Add-on decisions (Sentry Glass, Krypton, Heat Soak, etc.)
2. Calculation of man-hours, packaging, hardware
3. Cell mapping to Master Workbook template
4. Generate {cell_address: value} dictionary
5. Backend writes to Excel

**Key Files**: `rules/rule5_addons.py`, `rules/rule6_calculations.py`, `cell_mapper.py`, `pipeline/stage6_excel.py`

---

## File-by-File Documentation

### Entry Points

#### `main.py`
**Purpose**: Application entry point that embeds Service Bus listeners in FastAPI lifespan

**Key Functions**:
- `_lifespan_with_all_listeners()`: Wraps FastAPI startup to launch all listener types
- Manages 4 concurrent listener types:
  - Email listener (single worker)
  - Extraction listener pool (Stage 0, configurable concurrency)
  - Rules listener pool (Stages 1-6, configurable concurrency)
  - Teams listener (separate queue)

**Configuration**: Environment variables for queue names, connection strings, worker concurrency

**Dependencies**: `listener.worker`, `listener.extraction_worker`, `listener.rules_worker`, `listener.teams_worker`

---

#### `cover_pipeline.py`
**Purpose**: Cover page analysis pipeline for fast-path project identification

**Key Functions**:
- `process_lead_files()`: Main orchestration function
- `build_doc_pairs()`: Docling extraction from PDFs/emails
- `run_cover_pipeline()`: Complete cover analysis with timing
- `adapt_docling_output()`: Concatenates text across documents
- `is_sufficient()`: Checks if critical fields (project_address) found
- `build_fast_path_response()`: Returns immediate result without AI call
- `run_vision_fallback()`: Azure OpenAI Vision for missing fields
- `select_cover_pages()`: Identifies relevant pages for analysis

**Flow**:
1. Docling extraction → structured text
2. Content parser → regex-based field extraction
3. Sufficiency check → fast path if address found
4. Vision fallback → render pages → OpenAI analysis
5. JSON output → save to extraction_results/

**Critical Fields**: `project_address` (triggers vision fallback if missing)

---

#### `ai_engine.py`
**Purpose**: Unified pipeline orchestrator for deep technical extraction

**Key Functions**:
- `run_pipeline()`: Main entry point for project folder processing
- `map_non_ai_to_v2()`: Maps Stage 1 results to v2 schema
- `consolidate_project_results()`: Merges multi-file results

**Pipeline Phases**:
1. **Phase 1**: Azure DI extraction on all files (concurrent)
2. **Phase 2**: Text-only LLM extraction on all files (concurrent)
3. **Phase 3**: Classifier + Vision on drawing files only (with customer context)
4. **Phase 4**: Dimension rescue for unclear measurements
5. **Stage 4**: Rules engine execution (Rules 2-6)

**File Discovery**: Recursive scan, skips internal folders (approved documents, shop drawings, etc.)

**Output**: Consolidated v2 schema JSON in `extraction_results/`

---

### API Layer

#### `api/fastapi_app.py`
**Purpose**: FastAPI application with HTTP endpoints for pipeline triggers

**Endpoints**:
- `GET /health`: Health check
- `POST /process-payload`: Main trigger endpoint with routing based on trigger type
- `POST /stage/1` through `POST /stage/5`: Individual stage execution

**Trigger Types**:
- `BEGIN_EXTRACTION`: Start new project
- `STAGE_N_APPROVED_START_N+1`: Transition between stages
- `REVISION`: Handle revision requests

**Response Model**: `PipelineResponse` with status, output, timing

---

#### `api/pipeline_runner.py`
**Purpose**: Stage-specific pipeline execution logic

**Key Functions**:
- `run_new_project()`: Stage 0 - cover analysis
- `run_stage_1()`: Header extraction
- `run_stage_2()`: Dimension take-off
- `run_stage_3()`: Deep technical extraction
- `run_stage_4()`: Glass type decision
- `run_stage_5()`: Frame and cross-beam decisions
- `run_revision()`: Handle revision workflow

**Data Flow**: Reads from MongoDB, applies stage-specific logic, returns results

---

#### `api/models.py`
**Purpose**: Pydantic models for API requests/responses

**Key Models**:
- `TriggerMessage`: Incoming Service Bus message schema
- `StageRequest`: Individual stage execution request
- `PipelineResponse`: Standardized response format

---

#### `api/schemas.py`
**Purpose**: Additional schema definitions and validation

---

#### `api/error_handler.py`
**Purpose**: Centralized error handling and logging

---

### Listener Layer

#### `listener/worker.py`
**Purpose**: Azure Service Bus listener for EMAIL_PROPOSAL messages

**Key Functions**:
- `run_listener()`: Async entry point with reconnection logic
- `_blocking_loop()`: Synchronous receive loop with semaphore-based concurrency
- `_process_single_message()`: Message handling with lock renewal
- `_handle_email_proposal()`: Email classification workflow

**Message Settlement**:
- Success: `complete_message()`
- Transient error: `abandon_message()` (retry)
- Permanent error: `dead_letter_message()`

**Concurrency**: Semaphore-based limiting (default 3 concurrent messages)

---

#### `listener/extraction_worker.py`
**Purpose**: Service Bus listener for extraction stage messages

**Handles**: NEW_PROJECT, DOCUMENT_EXTRACTION, stage transition messages

**Queue**: Separate from email queue (`ai-stage-trigger`)

---

#### `listener/rules_worker.py`
**Purpose**: Service Bus listener for rules engine processing

**Handles**: Stages 1-6 rule execution

**Queue**: `ai-stage-result`

**Concurrency**: Higher than extraction (rules are CPU-only, no external API calls)

---

#### `listener/teams_worker.py`
**Purpose**: Microsoft Teams integration listener

**Queue**: `teams-ai-integration`

**Functionality**: Separate schema and processing for Teams messages

---

#### `listener/message_schema.py`
**Purpose**: Pydantic schema for incoming Service Bus messages

**Key Model**: `IncomingMessage` with validation for correlationId, jobType, payload

---

#### `listener/extraction_schema.py`
**Purpose**: Schema definitions for extraction stage messages

---

#### `listener/config.py`
**Purpose**: Listener configuration constants

---

#### `listener/logger.py`
**Purpose**: Listener-specific logging configuration

---

### Extraction Layer

#### `extraction/extraction_runner.py`
**Purpose**: Parallel batch dispatch for Vision API calls

**Key Functions**:
- `extract_from_pdf()`: Main extraction entry point
- `run_parallel_batches()`: Concurrent batch execution
- `run_batch()`: Single batch processing with image rendering

**Features**:
- Page classification and filtering
- Layout-aware chunking (3 pages per batch)
- Large-format tiling for CAD sheets
- Memory-aware DPI fallback (300→200→150→100→72)

**Dimension Fix**: Uses OCR-located tiles for large-format drawings to ensure dimension callouts are legible

---

#### `extraction/azure_extract.py`
**Purpose**: Azure Document Intelligence integration

**Key Functions**:
- `process_document_bytes()`: Async DI processing
- `extract_email_metadata()`: Email parsing for .eml/.msg files
- `load_ignored_templates()`: Template deduplication

**Output**: Structured document with paragraphs, tables, figures, page-level text

---

#### `extraction/vision_client.py`
**Purpose**: Azure OpenAI Vision API client

**Key Functions**:
- `call_vision_batch()`: Batch API call with retry logic
- `resize_image_bytes()`: Image preprocessing

**Authentication**: Azure OpenAI API key and endpoint

---

#### `extraction/vision_extract.py`
**Purpose**: PDF rendering and page chunking

**Key Functions**:
- `render_pdf_to_images()`: PyMuPDF-based rendering
- `chunk_pages()`: Page grouping for batch processing
- `_encode_image_block()`: Base64 encoding for API

---

#### `extraction/page_classifier.py`
**Purpose**: Page type classification (floor plan, section, schedule, etc.)

**Key Functions**:
- `classify_pages()`: Classifies each page as relevant/irrelevant
- Returns page type hints for extraction

**Page Types**: FLOOR_PLAN, ROOF_PLAN, SECTION, DETAIL, SCHEDULE, COVER, etc.

---

#### `extraction/page_tiler.py`
**Purpose**: Large-format drawing tiling for dimension extraction

**Key Functions**:
- `needs_tiling()`: Determines if page requires tiling
- `render_page_tiles()`: OCR-located tile generation
- `tile_to_image_block()`: Tile encoding for API

**Purpose**: Ensures dimension callouts are legible by sending high-DPI crops instead of full-page downscaling

---

#### `extraction/dimension_rescue.py`
**Purpose**: Targeted OCR for unclear dimensions

**Key Functions**:
- `rescue_dimensions()`: Re-extracts dimensions with OCR tiles
- Uses Azure DI OCR for dimension-specific regions

---

#### `extraction/content_parser.py`
**Purpose**: Regex-based field extraction from text

**Key Functions**:
- `parse_content()`: Extracts project_address, customer_name, etc.

**Usage**: Fast-path extraction before Vision fallback

---

#### `extraction/extraction_parser.py`
**Purpose**: Parse and merge LLM extraction results

**Key Functions**:
- `merge_extraction_results()`: Combine batch results
- `merge_signal_dicts()`: Merge signal dictionaries

---

#### `extraction/extraction_prompt.py`
**Purpose**: Structured prompts for LLM extraction

**Content**: Detailed prompts for glass, frame, location, and unit extraction

---

#### `extraction/canonical.py`
**Purpose**: Canonical signal representation from Vision output

**Key Class**: `CanonicalSignals` with structured getters for glass, frame, location signals

**Purpose**: Provides clean interface to Vision-extracted booleans/enums

---

#### `extraction/repository.py`
**Purpose**: Data access layer for extraction results

**Key Functions**:
- `get_repository()`: Factory for repository instances
- `get()`: Retrieve extraction by project ID

---

#### `extraction/schema_builder.py`
**Purpose**: Build unified schema from extraction results

---

#### `extraction/unit_reconciler.py`
**Purpose**: Deduplicate and reconcile units across documents

**Key Functions**:
- `reconcile_units_with_llm()`: LLM-based unit matching

---

#### `extraction/models.py`
**Purpose**: Data models for extraction results

**Key Models**: `ExtractionResult`, signal models

---

#### `extraction/page_filter.py`
**Purpose**: Filter pages based on relevance

---

#### `extraction/text_prefilter.py`
**Purpose**: Pre-filter text content

---

#### `extraction/visualize_azure.py`
**Purpose**: Visualization tools for Azure DI results

---

#### `extraction/dimension_ocr_locator.py`
**Purpose**: OCR-based dimension location detection

**Purpose**: Identifies regions likely containing dimension callouts

---

### Rules Engine

#### `rules/rule2_glass_type.py`
**Purpose**: Glass type decision tree

**Key Functions**:
- `decide_glass_type()`: Main decision function
- `_decide_from_canonical()`: Canonical-first decision path

**Decision Tree** (per Full Decision Tree table; chain evaluated in order):
1. Replacement glass only → GLASS_ONLY
2. Stair tread → STAIR_TREAD
3. EconoFrame stated → GLASS_NO_IGU
4. Non-walkable → NON_WALKABLE
5. Walkable + interior + open space below → GLASS_NO_IGU
6. Walkable + interior + wine cellar below → GLASS_2_0
7. Walkable + exterior + open below → GLASS_NO_IGU
8. Walkable + exterior + conditioned below → GLASS_2_0 (Series 2000 default)
9. IGU in glass makeup string + walkable → GLASS_2_0
10. EGR supplier mentioned → EGR secondary flag

**Output**: `GlassTypeResult` with glass_type_code, workbook_row_name, proposal_candidates

---

#### `rules/rule3_frame_type.py`
**Purpose**: Frame type, installation type, and assembly type decisions

**Key Functions**:
- `decide_frame_type()`: Main decision function

**Decisions**:
- Frame type: Series 1000/2000, EconoFrame, Series 3000, etc.
- Installation type: Pedestal, Recessed, Interior
- Assembly type: FA (Factory Assembled), KD (Knock Down)
- Proposal number: Maps to workbook rows 128-142

**Output**: `FrameTypeResult`

---

#### `rules/rule4_cross_beam.py`
**Purpose**: Cross-beam requirement decisions

**Key Functions**:
- `decide_cross_beam()`: Main decision function

**Factors**: Panel dimensions, series context, structural requirements

**Output**: `CrossBeamResult` with cross_beam_code, panel_count

---

#### `rules/rule5_addons.py`
**Purpose**: Add-on decisions (Sentry Glass, Krypton, Heat Soak, etc.)

**Key Functions**:
- `decide_add_ons()`: Main decision function

**Add-ons**: nanodot, seeded_organic, krypton_gas, sentry_glass, custom_shape, embeds, duty, heat_soak_testing

**Output**: `AddOnResult` with individual add-on decisions

---

#### `rules/rule6_calculations.py`
**Purpose**: Calculations for man-hours, packaging, hardware

**Key Functions**:
- `calculate()`: Main calculation function

**Calculations**:
- Man hours based on square footage
- Packaging based on unit count
- Hardware quantities (brackets, fasteners, silicone, tape)

**Output**: `CalculationResult` with UnitTakeOff per unit

---

### Configuration

#### `config/workbook_map.py`
**Purpose**: Single source of truth for Excel workbook cell addresses

**Mappings**:
- `PROPOSAL_ROWS`: Proposal description rows (128-142)
- `GLASS_TYPE_ROWS`: Glass type rows (9-14)
- `FRAME_TYPE_ROWS`: Frame type rows (38-47)
- `ADDON_ROWS`: Add-on rows
- `CROSSBEAM_ROWS`: Cross-beam rows
- `HEADER`: Header cell addresses
- `TAKEOFF_COLS`: Take-off column letters
- `UNIT_SELECTOR_COLS`: Unit columns (A-J → D, G, J, ...)

**Design Principle**: If workbook structure changes, update here only

---

#### `config/unified_schema.py`
**Purpose**: Unified schema definitions for extraction results

**Content**: v2 schema structure for all signal types

---

### Pipeline

#### `pipeline/stage6_excel.py`
**Purpose**: Stage 6 Excel output generation

**Key Functions**:
- `build_excel_output()`: Generate {cell: value} dictionary

**Process**:
1. Calls cell_mapper.aggregate()
2. Returns cells_to_write, manual_fields, pending_fields
3. Backend uses output to write Excel

---

### Cell Mapping

#### `cell_mapper.py`
**Purpose**: Map rules engine outputs to Excel cell addresses

**Key Functions**:
- `aggregate()`: Main aggregation function
- `_agg_header()`: Header field mapping
- `_agg_glass()`: Glass type trigger mapping
- `_agg_framing()`: Frame type trigger mapping
- `_agg_cross_beam()`: Cross-beam trigger mapping
- `_agg_addons()`: Add-on trigger mapping
- `_agg_hardware()`: Hardware calculation mapping
- `_agg_takeoff()`: Take-off sheet mapping
- `_agg_proposal()`: Proposal description mapping

**Design Principle**: Rules engine produces field values; this file maps to cells

**Output**: `AggregationResult` with cells_to_write, manual_fields, pending_fields

---

### Utilities

#### `utils/io_utils.py`
**Purpose**: File I/O utilities

**Key Functions**:
- `atomic_write_json()`: Atomic JSON file writing

---

### Legacy

#### `ai_engine_legacy/`
**Purpose**: Legacy code retained for reference

---

#### `services/blob_processor.py`
**Purpose**: DEPRECATED - previously handled blob download

**Status**: Superseded by fastapi_app._download_blob()

---

#### `non_ai/`
**Purpose**: Non-AI extraction modules (Docling, content parser)

**Files**:
- `docling_extractv2.py`: Docling wrapper
- `content_parser.py`: Regex-based extraction

---

---

## Component Interactions

### Message Flow Example: New Project

```
1. Node.js Backend
   ↓ (uploads to Blob Storage)
2. Azure Blob Storage
   ↓ (sends message to Service Bus)
3. Service Bus Queue (ai-ocr-ingestion)
   ↓ (listener/worker.py receives)
4. Email Listener
   ↓ (POST to FastAPI)
5. FastAPI (api/fastapi_app.py)
   ↓ (trigger: BEGIN_EXTRACTION)
6. Pipeline Runner (api/pipeline_runner.py)
   ↓ (run_new_project)
7. Cover Pipeline (cover_pipeline.py)
   ↓ (Docling → Content Parser → Vision fallback)
8. Classifier (classifier/classifier.py)
   ↓ (classify_service_bus_message)
9. Webhook (services/backend_webhook.py)
   ↓ (POST to Node.js)
10. Node.js Backend (MongoDB)
```

### Stage Transition Flow

```
1. Estimator approves Stage N in Frontend
   ↓
2. Node.js Backend sends message to Service Bus
   ↓ (trigger: STAGE_N_APPROVED_START_N+1)
3. Rules Listener (listener/rules_worker.py)
   ↓ (POST to FastAPI)
4. FastAPI routes to run_stage_N+1
   ↓
5. Pipeline Runner executes stage logic
   ↓
6. Rules Engine applies business logic
   ↓
7. Results saved to MongoDB
   ↓
8. Webhook notification to Node.js
```

### Deep Extraction Flow

```
1. ai_engine.run_pipeline(project_folder)
   ↓
2. File Discovery (recursive scan)
   ↓
3. Phase 1: Azure DI (concurrent)
   ↓ (extraction/azure_extract.py)
4. Phase 2: Text LLM (concurrent)
   ↓ (extraction/extraction_runner.py)
5. Build Customer Context
   ↓ (from text results)
6. Phase 3: Vision on drawings (concurrent)
   ↓ (with customer context)
7. Dimension Rescue
   ↓ (extraction/dimension_rescue.py)
8. Consolidate Results
   ↓ (merge across files)
9. Rules Engine (Stages 4-6)
   ↓ (rules/rule2_glass_type.py, etc.)
10. Save Final Result
```

---

## Configuration & Environment

### Required Environment Variables

#### Azure Service Bus
```env
AZURE_SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://...
AZURE_SERVICE_BUS_QUEUE_NAME=ai-ocr-ingestion
AZURE_SERVICE_BUS_EXTRACTION_STAGE_QUEUE_NAME=ai-stage-trigger
AZURE_SERVICE_BUS_EXTRACTION_RESULT_QUEUE_NAME=ai-stage-result
AZURE_SERVICE_BUS_TEAMS_QUEUE_NAME=teams-ai-integration
```

#### Azure OpenAI
```env
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01
```

#### Backend Integration
```env
WEBHOOK_URL=https://backend.example.com/api/v1/outlook/ai-result
APP_BASE_URL=https://backend.example.com
GFS_EMAIL=ai-service@example.com
GFS_PASSWORD=backend-password
GFS_BEARER_TOKEN=optional-token
```

#### Worker Concurrency
```env
EXTRACTION_WORKER_CONCURRENCY=3
RULES_WORKER_CONCURRENCY=10
```

### Dependencies

Key dependencies from `requirements.txt`:
- `openai==2.43.0`: Azure OpenAI API client
- `fastapi>=0.111.0`: Web framework
- `uvicorn[standard]>=0.29.0`: ASGI server
- `azure-servicebus>=7.12.0`: Service Bus client
- `azure-storage-blob>=12.20.0`: Blob Storage client
- `PyMuPDF==1.27.2.3`: PDF rendering
- `rapidfuzz==3.6.1`: Fuzzy string matching
- `networkx==3.2.1`: Graph algorithms
- `pymongo>=4.6.0`: MongoDB client

---

## Deployment & Operations

### Local Development

**Start FastAPI**:
```bash
uvicorn api.fastapi_app:app --reload --port 8000
```

**Start with Listeners**:
```bash
uvicorn main:app --reload --port 8000
```

### Docker Deployment

**Build**:
```bash
docker build -t gfs-ai:latest .
```

**Run**:
```bash
docker run --env-file .env -p 8000:8000 gfs-ai:latest
```

**Startup Script**: `startup.sh` starts `uvicorn main:app` with embedded listeners

### Azure Deployment

**Target**: Azure Container Apps or App Service (containers)

**Steps**:
1. Build and push to Azure Container Registry
2. Deploy with environment variables as secrets
3. Configure health checks on `/health`
4. Set Service Bus queue lock duration to 5 minutes

### Monitoring

**Health Check**: `GET /health` returns `{"status": "ok"}`

**Logging**: Structured JSON logs to stdout with correlation IDs

**Key Loggers**:
- `gfs.listener`: Service Bus message processing
- `gfs.api`: HTTP request handling
- `gfs.pipeline`: Extraction pipeline stages

### Performance Tuning

**Extraction Worker Concurrency**: Keep low (3) - bound by OpenAI/DI rate limits

**Rules Worker Concurrency**: Can be higher (10) - CPU-only work

**Memory Management**: DPI fallback in rendering prevents OOM on large PDFs

**Batch Size**: 3 pages per batch, large-format pages processed alone

---

## Troubleshooting

### Common Issues

**Message Lock Expiration**:
- Increase `MAX_LOCK_RENEWAL_SECONDS` in listener
- Check pipeline duration vs lock duration

**Vision API Rate Limits**:
- Reduce `EXTRACTION_WORKER_CONCURRENCY`
- Implement exponential backoff

**Memory Errors on Large PDFs**:
- DPI fallback automatically handles this
- Check `render_pdf_to_images` logs

**Dead Letter Queue Growth**:
- Check DLQ for schema validation failures
- Review `listener/worker.py` permanent failure conditions

### Debug Mode

Set environment variable:
```env
GFS_BATCH_DUMP_DIR=/path/to/dump
```

Dumps raw Vision API responses for inspection.

---

## Summary

The GFS-AI system is a sophisticated multi-stage document processing pipeline that combines:

1. **Service Bus Integration**: Multi-queue architecture for different processing stages
2. **Hybrid Extraction**: Docling for text + Azure Vision for visual content
3. **Rules Engine**: Business logic for glass, frame, and add-on decisions
4. **Excel Integration**: Direct cell mapping to Master Workbook template
5. **Human-in-the-Loop**: Approval workflow at each stage

The system is designed for scalability, with concurrent processing, automatic retries, and graceful degradation. The modular architecture allows individual components to be updated without affecting the overall pipeline.

For questions or issues, refer to the specific component documentation above or check the logs for the relevant logger (`gfs.listener`, `gfs.api`, `gfs.pipeline`).
