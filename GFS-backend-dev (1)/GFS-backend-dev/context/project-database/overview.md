# Module 1 — Core Database Design Overview

## Purpose
The Core Database module establishes the foundational Mongoose schemas and Repository interfaces for the GFS platform. It defines the strict data structures required for the `Project` entity and the highly detailed `ProjectParameter` entity, which stores both human inputs and AI-extracted values.

---

## Key Features
- **Project Schema:** Tracks high-level metadata (customer, status, dates, references).
- **Project Parameter Schema:** A massive, modular schema designed to hold architectural glass dimensions, structural frame selections, hardware consumables, and AI confidence scores.
- **Relational Linking:** Strictly enforces a 1-to-1 relationship between a `Project` and its `ProjectParameter` using MongoDB ObjectIds.
- **Clean Architecture Repositories:** Abstracts all Mongoose operations behind `toDomain` mappers to ensure the business logic layer never interacts with raw database documents.

---

## Architecture

### Data Layer
```text
src/db/models/
├── project.model.ts
└── project-parameter.model.ts

src/repositories/
├── interfaces/
│   ├── i-project.repository.ts
│   └── i-project-parameter.repository.ts
└── mongoose/
    ├── project.repository.ts
    └── project-parameter.repository.ts
```
## Data Model — `ProjectParameter` 

| Field | Type | Description |
|---|---|---|
| `projectId` | ObjectId (ref: Project) | The owning project |
| `isWalkable` | Boolean | Core architectural flag |
| `glassType` | Enum | Classification of the glass build-up |
| `measurements` | Array of Objects | Width, Length, Qty, and SqFt for units |
| `structural` | Object | Rafters, cross-beams, and frame types |
| `confidenceScore` | Enum | AI extraction confidence (HIGH/MEDIUM/LOW) |
| `requiresHumanReview` | Boolean | Forces estimator verification |
