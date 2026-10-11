# Module 1 — Database Integration & Architecture

## Repository Pattern Usage
All database interactions MUST go through the Repository interfaces. Services should inject `IProjectRepository` or `IProjectParameterRepository` rather than importing Mongoose models directly. 

This ensures that the Service layer only receives clean `IDomainProject` or `IDomainProjectParameter` objects, stripped of Mongoose-specific internals (`_id`, `__v`, `.save()`).


## Module Integrations

### 1. Document Ingestion (Module 3)
When new documents are ingested, they will be verified against the `Project` repository to ensure the target `projectId` exists before processing.

### 2. AI Extraction Engine (Python/FastAPI Backend)
The `ProjectParameter` schema is specifically designed as the target payload for the AI Extraction Engine. 
- The AI pipeline will output structured JSON that maps directly to the `IProjectParameter` interface.
- Fields like `confidenceScore` and `requiresHumanReview` are built natively into the schema to flag uncertain AI extractions for the human Estimator.

### 3. Project Workspace (Module 2)
The Workspace module handles the state transitions (e.g., `SETUP_PENDING` -> `READY_FOR_ESTIMATOR`). The `Project` schema provides the enums and strict typing required to validate these state machine transitions.
