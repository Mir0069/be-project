# GFS-AI Restructuring & Modularization Guide

This document explains the new restructured layout of the GFS-AI repository (copied under `om/dev-copy/GFS-AI`). The project has been refactored to align with the **Expedient** architecture style: decoupling all system prompts into plain markdown (`.md`) files and separating background queue listeners from FastAPI route handlers.

---

## 1. Directory Structure

```text
GFS-AI/
├── api/
│   ├── fastapi_app.py        # Core FastAPI app (health, /process-payload, and /stage/* endpoints)
│   ├── models.py             # Pydantic schema models for requests and responses
│   └── pipeline_runner.py    # Orchestration runner routing stages to rules engine
├── classifier/
│   ├── address_utils.py      # Standard job site address normalization functions
│   ├── classifier.py         # Pass 1 & Pass 2 email relevance logic (loads markdown prompts)
│   ├── graph_builder.py      # Relationship graph builder using networkx
│   └── graph_matcher.py      # Graph similarity and priority-based signal matching
├── config/
│   ├── unified_schema.py     # Schema helpers to read/write fields inside unified document
│   └── workbook_map.py       # Hardcoded Excel cell-to-signal lookup definitions
├── extraction/
│   ├── azure_extract.py      # Azure Document Intelligence API client wrapper
│   ├── canonical.py          # Value formatting and standard conversion helpers
│   ├── content_parser.py     # Text parser resolving dimensions, quantity, and unit strings
│   ├── dimension_ocr_locator.py # Matches OCR bounding boxes to page coordinates
│   ├── dimension_rescue.py   # High-resolution page tiling logic (loads markdown prompt)
│   ├── extraction_parser.py  # Standardizes visual layout blocks into GFS models
│   ├── extraction_runner.py  # Coordinates document layout analysis
│   ├── models.py             # Model definitions for pages, frames, and glass units
│   ├── page_classifier.py    # Filters drawing vs text pages (loads markdown prompt)
│   ├── page_filter.py        # Logic to omit cover sheets or irrelevant pages
│   ├── page_tiler.py         # Sub-divides large page images for high-res vision analysis
│   ├── repository.py         # Temporary in-memory cache for layout runs
│   ├── schema_builder.py     # Maps raw output lists to standard MongoDB schemas
│   ├── text_prefilter.py     # Filters noisy text strings prior to parsing
│   ├── unified_adapter.py    # Converts MongoDB doc to flat dictionary format for rules engine
│   ├── vision_client.py      # OpenAI GPT-4o-mini layout/text request handler
│   ├── vision_extract.py     # Vision pipeline runner coordinating vision calls
│   └── visualize_azure.py    # Generates visual bounding box debug images
├── listener/
│   ├── extraction_schema.py  # Validation schemas for Stage 0 payloads
│   ├── extraction_worker.py  # Competing consumer pool for slow Stage 0 document extraction
│   ├── message_schema.py     # Validation schemas for incoming emails
│   ├── rules_worker.py       # Competing consumer pool for fast Stage 1–6 rules validations
│   ├── teams_worker.py       # Microsoft Teams chat/meeting transcript summarizer
│   └── worker.py             # Competing consumer pool for incoming emails
├── pipeline/
│   ├── fanout_router.py      # Coordinates concurrent page extraction jobs
│   └── stage6_excel.py       # Generates cell-to-value keymaps for the Master Excel workbook
├── prompts/
│   ├── 0.common_instructions.md # Shared system rules, JSON schemas & coordinate formats
│   ├── prompt_loader.py      # Prepends 0.common_instructions.md to target prompts dynamically
│   ├── 1.classifier_pass1_system.md # Email relevance instructions (Pass 1)
│   ├── 2.classifier_pass2_system.md # GFS project-matching details & summary template (Pass 2)
│   ├── 3.teams_chat.md         # Teams chat transcript summarizer prompt
│   ├── 4.teams_meeting.md      # Teams meeting transcript summarizer prompt
│   ├── 5.page_classifier.md    # Drawing sheet relevance classification prompt
│   ├── 6.extraction.md         # Drawing element parser template
│   ├── 7.dimension_rescue.md   # Tiling extraction recovery prompt
│   └── 8.unit_reconciler.md    # Multi-document unit consolidator rules
├── rules/
│   ├── rule2_glass_type.py   # Stage 2 rules (glass type code assignments)
│   ├── rule3_frame_type.py   # Stage 3 rules (frame type code assignments)
│   ├── rule4_cross_beam.py   # Stage 4 rules (crossbeam support structures)
│   ├── rule5_addons.py       # Stage 5 rules (add-on option codes & markup factors)
│   └── rule6_calculations.py # Stage 6 calculations (area, weight, labor, packaging math)
├── services/
│   ├── auth.py               # Authenticates with GFS backend and fetches JWT cookies
│   ├── backend_config.py     # Decodes backend base URLs and endpoints from environment
│   └── backend_webhook.py    # Dispatches email classification results back to GFS backend
├── ai_engine.py              # Root script coordinating the visual extraction engine
├── cover_pipeline.py         # Entry point for single-page visual extractions
├── main.py                   # Lifespan script starting concurrent background workers
└── requirements.txt          # Python dependency specifications
```

---

## 2. Key Refactoring Architecture Principles

### A. Decoupled & Modular Markdown Prompts (`prompts/`)
All OpenAI/Azure OpenAI system prompts are completely decoupled from python code and stored as plain text markdown (`.md`) files. 

To eliminate repetition across multiple long prompts, we introduced a modular prompt-stitching architecture:
1. **`prompts/0.common_instructions.md`:** Holds global GFS instructions (JSON formatting constraints, confidence scales, and coordinate citation formats).
2. **`prompts/prompt_loader.py`:** Implements `load_prompt(filename)`. It reads the target prompt file and prepends the common instructions to it dynamically before it is passed to the LLM.

* **Example Loader Code Pattern:**
  ```python
  from prompts.prompt_loader import load_prompt
  
  EXTRACTION_PROMPT = load_prompt("6.extraction.md")
  ```

### B. Isolated Queue Worker Competing Consumers (`listener/`)
To prevent lightweight rules engine runs (taking seconds) from waiting behind slow Stage 0 document visual extraction jobs (taking 5–10 minutes), the Service Bus listeners are split:
1. **`listener/extraction_worker.py`:** Listens only to `EXTRACTION_STAGE_QUEUE_NAME` (`ai-stage-trigger`) for Stage 0 extraction jobs.
2. **`listener/rules_worker.py`:** Listens only to `RULES_QUEUE_NAME` (`ai-stage-result`) for Stage 1–6 rules processing jobs.
3. **`listener/worker.py`:** Listens only to `EMAIL_QUEUE_NAME` (`ai-ocr-ingestion`) for incoming emails.
4. **`listener/teams_worker.py`:** Listens only to `TEAMS_QUEUE_NAME` (`teams-ai-integration`) for Teams chat and meeting syncs.

### C. Server-Worker Separation
* **FastAPI Server (`api/fastapi_app.py`):** Serves HTTP route requests. It does **not** launch or know about Service Bus listeners. This allows the backend to call rules endpoints synchronously for instant feedback.
* **Worker Pools (`main.py`):** When uvicorn is started, the lifecycles in `main.py` spawn multiple independent, asynchronous listener tasks in the background. If a worker fails or loses connection, it will automatically reconnect without bringing down the HTTP API server.

---

## 3. Verification Commands

To verify that the modular code has no syntax or import bugs, you can run the following diagnostic scripts from the root directory:

1. **Syntax Compilation Check:**
   ```bash
   python -m compileall .
   ```
2. **Import & Prompt Load Validator:**
   ```bash
   python scratch/test_imports.py
   ```
3. **API Local Integration Test:**
   ```bash
   python scratch/test_api_endpoints.py
   ```
