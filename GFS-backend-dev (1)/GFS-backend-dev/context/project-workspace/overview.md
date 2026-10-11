# Project Workspace Module — Overview

## Purpose

The Project Workspace module serves as the central operational hub for the GFS platform. It manages the complete lifecycle of projects—from initial setup and estimator drafting to administrative packaging. It provides a robust CRUD API, strict business validation, and a state machine for project statuses. All subsequent project communications, documents, and proposals attach to a Project Workspace.

---

## Key Features

- **Project CRUD Operations:** Create, list, retrieve, update, and soft-delete/archive projects.
- **Workflow & Lifecycle Engine:** Strict state machine enforcement for project status transitions (`SETUP_PENDING`, `WAITING_FOR_INPUTS`, `READY_FOR_ESTIMATOR`, etc.).
- **Estimator Assignment:** Assign projects to specific estimators, updating relevant fields and validating user IDs.
- **Search & Pagination:** Advanced querying with filtering by status, type, customer name, date, and assigned estimator.
- **Role-Based Access Control:** Differentiated access levels for ESTIMATOR, SALES_MANAGER, and SYSTEM_ADMIN.
- **Azure Blob Storage Integration:** Integration readiness for storing project-related documents.

---

## Architecture

### Feature Module

```text
src/features/project-workspace/
├── project-workspace.controller.ts   HTTP request/response handlers
├── project-workspace.service.ts      Core business logic & orchestration
├── workflow.service.ts               State machine and lifecycle validations
├── project-workspace.router.ts       Route wiring, DI registration, and middleware
└── project-workspace.types.ts        Zod schemas, enums, and TypeScript interfaces
```

### Data Layer

```text
src/repositories/interfaces/i-project.repository.ts
src/repositories/mongoose/project.repository.ts
src/repositories/azure/azure-blob.repository.ts
src/repositories/mongoose/sequence.repository.ts
```

### Registration

Router is mounted in the main application under:

```text
/api/v1/projects
```

---

## Data Model — `ProjectWorkspace`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (ObjectId) | Unique identifier |
| `referenceNumber` | string | Auto-generated sequential reference (e.g. PRJ-1001) |
| `projectName` | string | Name of the project |
| `customerName` | string | Client or customer name |
| `status` | Enum | `SETUP_PENDING` \| `READY_FOR_ESTIMATOR` \| `ESTIMATOR_DRAFTING` \| `ESTIMATOR_FINAL` \| `ADMIN_PACKAGING` \| `WAITING_FOR_INPUTS` |
| `projectType` | Enum | `NEW_ESTIMATE` \| `RE_QUOTE` \| `VARIATION` |
| `blobStorageURL` | string? | Reference to the project's root container in Azure |
| `assignedEstimatorID` | string? | Reference to the User assigned to the project |
| `estimatorName` | string? | Denormalized estimator name for quick display |
| `dueDate` | Date? | Project deadline |
| `estimatedCost` | number? | Monetary estimate value |
| `totalSqFt` | number? | Project size parameter |
| `isActive` | boolean | Soft-delete/Archive flag |

---

## Endpoint Contract

Base path: `/api/v1/projects`

### 1. `POST /`
Creates a new project. 
**Body:** `projectName`, `customerName`, `projectType`, `dueDate` (optional).
**Success:** `201 Created`

### 2. `GET /`
Returns paginated list of projects. Supports filtering.
**Query Params:** `page`, `limit`, `status`, `projectType`, `customerName`, `assignedEstimatorID`, `isActive`, `sortBy`, `sortOrder`.
**Success:** `200 OK` (Returns `data` array and `pagination` object)

### 3. `GET /:id`
Retrieves a single project by its ID.
**Success:** `200 OK` / `404 Not Found`

### 4. `PUT /:id`
Updates an existing project (partial updates allowed).
**Body:** Any updatable field except protected fields like `referenceNumber`.
**Success:** `200 OK` / `400 Bad Request`

### 5. `PATCH /:id/archive`
Soft-deletes the project by setting `isActive: false`.
**Success:** `200 OK`

### 6. `PATCH /:id/status`
Transitions the project to a new status, strictly validated by the `WorkflowService`.
**Body:** `status`
**Success:** `200 OK` / `400 Bad Request` (Invalid transition)

### 7. `PATCH /:id/assign`
Assigns an estimator to the project.
**Body:** `assignedEstimatorID`, `estimatorName`.
**Success:** `200 OK`
