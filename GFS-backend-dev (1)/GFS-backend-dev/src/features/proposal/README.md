# Proposal Module

This module is responsible for the **Stage-Based Proposal Generation Workflow**. It bridges the gap between AI-extracted data, manual estimator review, and the final generation of a `.xlsx` quote file.

## Architecture & Responsibilities

The module strictly adheres to our clean architecture and repository pattern:
- **`proposal.controller.ts`**: The HTTP Adapter. Parses request bodies, extracts authenticated user data, calls the Service, and handles HTTP responses (`safeJson`).
- **`proposal.service.ts`**: The Core Domain Logic. This file is agnostic of Express/HTTP. It enforces business rules (stage prerequisites, estimator assignment, versioning).
- **`exceljs.generator.ts`**: A pure utility to take a list of parameters and inject them into a `.xlsx` buffer using ExcelJS.
- **Repositories**: We use `IStageParametersRepository` and `IExcelTemplateRepository` to abstract Mongoose entirely away from the service logic.

## Workflow

The proposal generation process is broken into 4 distinct stages (e.g., System Type, Dimensions, Consumables, Labor). Each stage must be sequentially pushed, saved, and approved.

### 1. AI Push
The AI service extracts data from source documents and calls `POST /proposals/:projectId/stages`.
- **Source**: `StageSource.AI`
- **Status**: `StageStatus.PENDING_REVIEW`
- **Prerequisite**: Pushing Stage `N` requires Stage `N-1` to be `APPROVED` (except Stage 1).
- **Versioning**: Every push creates a new document with incremented `version` and archives the old one.

### 2. Estimator Review & Edit
The frontend retrieves the latest parameters for a stage (`GET /proposals/:projectId/stages/:stage`). The Estimator reviews them and submits edits via `PUT /proposals/:projectId/stages/:stage`.
- **Status**: `StageStatus.SAVED`
- Any changed parameters are flagged `isEditedByEstimator = true` to preserve the `originalAiValue`.
- **Guard**: Only the **assigned estimator** for the project can perform this action.

### 3. Estimator Approval
Once satisfied, the Estimator explicitly approves the stage via `POST /proposals/:projectId/stages/:stage/approve`.
- **Status**: `StageStatus.APPROVED`
- This unlocks the AI to begin calculating the subsequent stage.
- **Guard**: Only the **assigned estimator** for the project can perform this action.

### 4. Excel Generation
Once all 4 stages are `APPROVED`, the Estimator can request the final `.xlsx` via `GET /proposals/:projectId/excel`.
- The system pulls the **Active Base Template** from the database (`ExcelTemplateModel`).
- It iterates over every parameter from all 4 stages and writes the `value` into the specific `row` and `column`.
- The file is streamed back to the client.

## Security & Authorization

All routes are protected by the central `authenticate` middleware, which parses the JWT token.
- **AI Webhook (`POST /stages`)**: Explicitly unauthenticated, allowing internal/external AI services to push data.
- **Read Routes (`GET /stages`)**: Authenticated. Any logged-in user can view proposals.
- **Write Routes (`PUT`, `POST`, `GET /excel`)**:
  - Requires the `ESTIMATOR` role (`authorize(UserRole.ESTIMATOR)`).
  - Subject to **Project Assignment Guard**: The `ProposalService` queries the `ProjectModel` and throws a `403 Forbidden` if `project.assignedEstimatorId` does not match the authenticated user.

## Data Models

1. **`Project`**: The root document containing high-level metadata (Customer Name, Status, `assignedEstimatorId`).
2. **`StageParameters`**: A versioned collection storing the raw extracted parameters. Mapped one-to-many from Project.
3. **`ExcelTemplate`**: A binary store for the `.xlsx` templates uploaded by administrators. Only one document can be `isActive: true` at a time.

## Seed Scripts

For testing and local development, two scripts are provided in `src/scripts`:
- **`seed-template.ts`**: Uploads a raw `.xlsx` file from your filesystem into the DB as the active template.
- **`seed-stages.ts`**: Simulates the entire 4-stage lifecycle (AI push -> Estimator edit -> Estimator approve) using exact row/column mapping, resulting in a project completely ready for Excel generation.
