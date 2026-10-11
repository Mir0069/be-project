# Project Workspace — Integration & Architecture

## Feature-Based Clean Architecture

The module strictly follows the repository pattern and feature-based routing, ensuring decoupled and testable logic:

1. **Router (`project-workspace.router.ts`)**: Handles DI wiring and middleware (auth, zod validation).
2. **Controller (`project-workspace.controller.ts`)**: HTTP protocol handling, parsing req, wrapping res.
3. **Service (`project-workspace.service.ts` / `workflow.service.ts`)**: Core business and orchestration logic. Ignorant of HTTP.
4. **Repository (`MongooseProjectRepository`)**: Database abstraction. 

---

## Future Module Integrations

The Project Workspace is designed as the root entity for several upcoming modules:

### 1. Outlook Integration
**Future Flow:** Emails ingested from Outlook will need to be associated with a Project. The Outlook service will query the Project Workspace API (`GET /?referenceNumber=PRJ-123`) to resolve the project ID, then store the email thread under that `projectId`. 

### 2. Document Ingestion (Module 3)
**Current/Future Flow:** The Project Workspace initializes a base Azure Blob container URL. When Module 3 uploads documents (e.g., architectural plans), it will reference the project's `blobStorageURL` and attach the document metadata to the project's ID.

### 3. Proposal Generation
**Future Flow:** Once a project reaches `ESTIMATOR_FINAL`, the Proposal Generation module takes over. It will pull the `estimatedCost`, `totalSqFt`, and assigned estimator details from the Workspace to auto-populate the PDF proposal templates.

### 4. Teams Integration
**Future Flow:** Significant status transitions (e.g., `READY_FOR_ESTIMATOR` or `ESTIMATOR_FINAL`) triggered via the `WorkflowService` will emit events. The Teams Integration module will listen for these events to send Webhook notifications to a configured Microsoft Teams channel.
