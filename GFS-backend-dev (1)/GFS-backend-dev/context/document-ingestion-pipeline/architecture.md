# Document Ingestion: Architecture & Design Decisions

## 1. System Architecture
This module adopts a **Clean Architecture / Domain-Driven Design** approach, ensuring strict boundaries between HTTP routing, business logic, and infrastructure. This structural clarity allows for rapid iteration and highly testable code.

* **Router (`document-ingestion.router.ts`)**: Acts as the composition root for this module. It wires together external dependencies (Azure, Mongoose, Queue Factory) and maps HTTP verbs to the controller.
* **Controller (`document-ingestion.controller.ts`)**: Handles HTTP request parsing, basic validation, and identity extraction. It delegates all heavy lifting to the Service.
* **Service/Pipeline (`document-ingestion.service.ts`)**: The core business logic orchestrator. It manages the upload flow, versioning, and state mutation.
* **Interfaces (`document-ingestion.types.ts`)**: Infrastructure dependencies (Repositories, Queues, Storage) are defined as interfaces to allow for Dependency Inversion.

## 2. Security Model (Fail-Closed)
Identity and authorization strictly follow a **Fail-Closed** paradigm to prevent BOLA (Broken Object Level Authorization).
* **Identity Context**: The Controller relies exclusively on the session populated by the upstream `auth.middleware.ts`. Missing sessions trigger an immediate `401 Unauthorized`. 
* **Role Boundaries**:
  * `ESTIMATOR`: Can upload, update, and download documents *only* for explicitly assigned projects.
  * `SYSTEM_ADMIN` / `SUPER_ADMIN` / `SALES_MANAGER`: Elevated roles with global access, including execution of administrative `DELETE` operations.

## 3. Infrastructure Integrations
* **Visual Directory Storage (Azure Blob)**: Files are stored using a human-readable, project-isolated pathing strategy: `projects/{projectId}/documents/{originalFileName}`. Azure Blob natively resolves these storage keys into virtual directories, ensuring clean multi-tenant data isolation.
* **Adapter Pattern Queuing**: The pipeline utilizes a `createQueueAdapter` factory. This allows seamless switching between a live `azure_service_bus` provider for production/staging and an `in_memory` provider for isolated local testing without cloud dependencies.
* **Asynchronous AI Handoff**: Post-upload processing (OCR extraction) is decoupled. The backend publishes a payload containing the private `blob_url`, which the AI microservice consumes via a Peek-Lock mechanism.