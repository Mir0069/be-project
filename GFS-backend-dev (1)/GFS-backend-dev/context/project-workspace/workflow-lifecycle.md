# Project Workspace — Workflow & Lifecycle

The Project Workspace module enforces strict business rules around how a project progresses from creation to completion. This is governed by the `WorkflowService`.

---

## Project Status State Machine

A project must follow a specific sequence. Ad-hoc status updates that skip steps are rejected with a `400 Bad Request`.

**Allowed Transitions:**

| Current Status | Allowed Next Status(es) |
|----------------|--------------------------|
| `SETUP_PENDING` | `WAITING_FOR_INPUTS`, `READY_FOR_ESTIMATOR` |
| `WAITING_FOR_INPUTS` | `READY_FOR_ESTIMATOR` |
| `READY_FOR_ESTIMATOR` | `ESTIMATOR_DRAFTING` |
| `ESTIMATOR_DRAFTING` | `ESTIMATOR_FINAL`, `WAITING_FOR_INPUTS` (if more info needed) |
| `ESTIMATOR_FINAL` | `ADMIN_PACKAGING` |
| `ADMIN_PACKAGING` | *(Terminal state - no further transitions)* |

Attempting an invalid transition (e.g., `SETUP_PENDING` → `ESTIMATOR_FINAL`) will fail validation.

---

## Validation Behaviors

Zod schemas enforce payload integrity via the `validateRequest` middleware:

1. **At Creation:** 
   - `projectName` and `customerName` are strictly required and cannot be empty strings.
   - `projectType` must strictly match the `ProjectType` enum.
2. **At Update (`PUT /:id`):** 
   - The payload cannot be completely empty (enforced by a `.refine` check).
   - `estimatedCost` and `totalSqFt` must be positive numbers.
3. **Reference Numbers:** 
   - The `referenceNumber` is automatically generated (e.g., via the Sequence repository) and is immutable. It is ignored if passed in a PUT request.
4. **Dates:** 
   - `dueDate` strictly expects a standard ISO 8601 Datetime string.

---

## Archiving (Soft Delete)

```text
PATCH /:id/archive
```

Projects are never hard-deleted from the database. Instead, `isActive` is set to `false`. 
- Archived projects are excluded from default `GET /` list queries unless `isActive=false` is explicitly requested.
- Preserves audit trails and relational integrity for dependent modules (e.g., call records, files).
