# GFS-AI Orchestration Flow Document

This document outlines the orchestration and execution flow in the GFS-AI service, coordinating background service bus listeners, FastAPI API endpoints, the rules engine, and MongoDB storage.

---

## 1. High-Level Architecture Flow

```mermaid
graph TD
    A[Azure Service Bus Queue] -->|Worker Thread| B(listener/extraction_worker.py)
    B -->|POST /process-payload| C(api/fastapi_app.py)
    C -->|Stage 0: Extraction| D(api/pipeline_runner.py)
    C -->|Stages 1-6: Rules Engine| E(api/pipeline_runner.py)
    
    D -->|process_project_payload| F(ai_engine.py / pipeline/fanout_router.py)
    E -->|Rules Evaluation| G(rules/rule2_to_rule6)
    
    F -->|Consolidated V3 Result| H[MongoDB / Backend Webhook]
    G -->|Calculated Row Cell Dict| H
```

1. **Queue Listeners (`listener/`):** Background threads listen to Azure Service Bus queues (e.g. `teams-ai-integration` for Teams summaries, `ai-stage-trigger` for extraction pipelines). When a message arrives, it is parsed and forwarded to the local FastAPI app running on `/process-payload`.
2. **FastAPI App (`api/fastapi_app.py`):** Exposes endpoints that handle stage processing commands and coordinate imports.
3. **Pipeline Runner (`api/pipeline_runner.py`):** Handles rules execution for Stages 1 to 6 by reading unified documents from MongoDB, invoking the corresponding python file in `rules/`, and returning a flat `{cell_address: value}` structure.

---

## 2. Stage 0 Ingestion & Extraction Pipeline Flow

When a new project is created, the system triggers `process_project_payload` in `pipeline/fanout_router.py`. This runs a 5-phase concurrent pipeline:

```mermaid
sequenceDiagram
    autonumber
    participant FR as fanout_router.py
    participant AZ as Azure Layout Client
    participant PC as page_classifier.md
    participant EV as extraction.md
    participant DR as dimension_rescue.md
    participant UR as unit_reconciler.md

    Note over FR: PipelineContext initialized with locks
    
    rect rgb(240, 240, 255)
        Note over FR, PC: Phase 1: Parallel Ingestion & Classification
        FR->>+AZ: Call Azure DI Layout (Per-Page Thread)
        AZ-->>-FR: Returns Text Layout & Table Blocks
        FR->>+PC: Call OpenAI Vision Classifier (Per-Page Thread)
        PC-->>-FR: Returns Sheet Category (e.g., COVER, FLOOR_PLAN)
    end

    rect rgb(240, 255, 240)
        Note over FR, EV: Phase 2: Parallel Signal & Unit Extraction
        Note over FR: Filter out irrelevant pages to save tokens
        FR->>+EV: Call OpenAI Vision Extractor (Batched Pages)
        EV-->>-FR: Returns Extracted Units & Signal Fields
    end

    rect rgb(255, 240, 240)
        Note over FR, DR: Phase 3: Dimension Rescue (Tiny Text Resolution)
        Note over FR: Scan units for null dimensions on relevant sheets
        FR->>+DR: Send Zoomed 2x2 Page Tiles to OpenAI Vision
        DR-->>-FR: Returns Found Dimensions
        Note over FR: Patch found dimensions back into Unit Objects
    end

    rect rgb(255, 255, 240)
        Note over FR, UR: Phase 4: Unit Reconciliation
        FR->>+UR: Send All Extracted Units
        UR-->>-FR: Returns Consolidated, Deduplicated Unit List
    end

    Note over FR: Phase 5: Format V3 Document & Dispatch Webhook
```

### Phase Details:
* **Phase 1: Classification & Layout (Parallel):** Run Azure Document Intelligence and OpenAI Vision Page Classifier concurrently on every page of the documents. Filter out irrelevant trades (plumbing, mechanical, etc.) and save on token costs.
* **Phase 2: Signal & Unit Ingestion (Parallel):** Run Vision Extraction with the central `prompts/extraction.md` template on relevant pages.
* **Phase 3: Dimension Rescue:** Pages where glass was found but dimensions were blank are re-rendered into high-DPI overlapping grid crops (tiles). OpenAI Vision reads these tiles with the narrow `prompts/dimension_rescue.md` prompt to recover tiny numbers.
* **Phase 4: Reconciliation:** Calls `unit_reconciler.py` to reconcile and deduplicate units across drawings, details, schedules, and emails using the `prompts/unit_reconciler.md` logic.
* **Phase 5: Output & Webhook:** Generates the V3 unified schema and triggers the Node.js backend webhook to advance the proposal's stage.

---

## 3. Rules Engine Processing (Stages 1-6)

For subsequent approval loops, the FastAPI `/process-payload` endpoint triggers `api/pipeline_runner.py` which runs the rules engine:
* **Stage 2 (Glass):** Invokes `rules/rule2_glass_type.py` to resolve glass layers.
* **Stage 3 (Frame):** Invokes `rules/rule3_frame_type.py` to resolve Series 1000 vs 2000 perimeter configurations.
* **Stage 4 (Crossbeam):** Invokes `rules/rule4_cross_beam.py` to calculate structural beams.
* **Stage 5 (Add-ons):** Invokes `rules/rule5_addons.py` to calculate testing and finish options.
* **Stage 6 (Excel Generator):** Invokes `pipeline/stage6_excel.py` to compile the approved fields into a flat `{cell_address: value}` mapping, which is written to the GFS Master Excel Workbook template.
