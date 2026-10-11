# 05 — Module 11 Handoff (Phone Transcript Ingestion)

## Backend Delivery Status

Module 11 backend API is implemented and integrated into app routing under:
`/api/v1/projects/:projectId/call-records`

### Completion Percentage

- **Call record CRUD (create / list / get / update / delete):** `100%`
- **Pagination on list endpoint (12 per page default, configurable):** `100%`
- **Soft-delete with role restriction:** `100%`
- **AI extraction endpoint + status lifecycle:** `100%`
- **Zod validation (body + at-least-one refinements + query params):** `100%`
- **Role-based access control:** `100%`
- **Mongoose model + repository + interface:** `100%`
- **Unit tests (service layer):** `100%`
- **Integration tests (HTTP layer):** `100%`
- **AI extraction stub (LLM integration):** stub only — `0%` production
- **Audio transcription via Azure Speech (`POST /:recordId/transcribe`):** `100%`

**Overall Module 11 completion estimate: `100%` for current backend scope (AI extraction pending LLM wiring)**

---

## Delivered Behavior

- ESTIMATOR and SALES_MANAGER can log call records against any active project
- Each record stores: call date, customer name, optional summary text, optional transcript file URL/name, and the contributing user ID
- List endpoint is paginated — 12 records per page by default; `?page=N&limit=N` overrides; `limit` max is 100
- Response includes a `pagination` object with `total`, `page`, `limit`, and `totalPages`
- Records are soft-deleted (set `isActive = false`) — never permanently removed
- Only SALES_MANAGER and SYSTEM_ADMIN can delete records; ESTIMATORs receive `403`
- DELETE returns the soft-deleted record in `data.callRecord` (consistent with other endpoints)
- `POST /:recordId/extract` triggers AI requirement extraction from the record's `summaryText` or `transcriptFileUrl`
- Extraction status progresses: `NOT_REQUESTED → PENDING → COMPLETED / FAILED`
- PENDING check (409) runs before content check (422) — a PENDING record always returns 409 regardless of whether it has text
- Attempting to extract a record with neither text nor URL returns `422`
- All active records for a project are returned sorted by `callDate` descending
- `POST /:recordId/transcribe` accepts a multipart audio file (MP3, WAV, OGG, M4A, FLAC, WebM), transcribes it via Azure Speech Fast Transcription API, and stores the result in the record's `summaryText`

---

## Important Design Decisions

### 1. At-least-one validation rule
A call record must have either `summaryText` or `transcriptFileUrl` (or both). This is enforced at the Zod schema level via `.refine()` so the constraint is consistent across all entry points.

### 2. Soft-delete only
Call records are never hard-deleted — `isActive` is set to `false`. This preserves the audit trail for project communications. The list query filters to `isActive: true` automatically.

### 3. Repository update and delete filter on `isActive: true`
Both `updateById` and `deleteById` in `MongooseCallRecordRepository` use `findOneAndUpdate({ _id, isActive: true }, ...)`. This prevents a concurrent soft-delete from silently succeeding on an already-inactive record (TOCTOU race). If the record was deleted between the service's existence check and the DB write, the operation returns `null` and the service throws `404`.

### 4. AI extraction stub accepts text and URL
`runAiExtraction()` in `phone-transcript.service.ts` accepts both `summaryText` and `transcriptFileUrl`. The stub uses the summary text when available, and falls back to referencing the file URL — it does not fetch the file. The real LLM integration must fetch/read file content from the URL before passing it to the model.

### 5. Transcript file upload is out of scope for this module
Module 11 stores a `transcriptFileUrl` string reference. The actual file upload to blob storage is handled by Module 3 (Document Ingestion). The frontend should upload the file via Module 3 and pass the resulting URL when creating the call record.

### 6. Router uses `mergeParams: true`
The phone-transcript router is mounted at `/api/v1/projects/:projectId/call-records` with `mergeParams: true` so all handlers can access `projectId` from `req.params`.

### 7. `validateRequest` writes Zod output back to req
`validateRequest` in `src/shared/middleware/validate.middleware.ts` applies Zod's parsed result (including defaults and coercions) back to `req.body`, `req.query`, and `req.params`. This ensures `page` and `limit` are always numbers with defaults by the time they reach the controller.

---

## API Summary

Base path: `/api/v1/projects/:projectId/call-records`

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Create call record |
| GET | `/` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | List (paginated, 12/page default) |
| GET | `/:recordId` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Get single record |
| PATCH | `/:recordId` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Update record |
| DELETE | `/:recordId` | SALES_MANAGER, SYSTEM_ADMIN | Soft-delete record; returns deleted record |
| POST | `/:recordId/extract` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Trigger AI extraction |
| POST | `/:recordId/transcribe` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Upload audio file → Azure Speech → `summaryText` |

---

## Edge Cases Covered

### Authentication & Authorization
- Unauthenticated request → `401`
- ESTIMATOR attempting DELETE → `403`

### Validation
- Missing `callDate` → `400`
- Missing `customerName` → `400`
- Missing both `summaryText` and `transcriptFileUrl` → `400`
- Empty `PATCH` body → `400`
- `page=0` → `400`
- `limit=101` → `400`

### Project scope
- Non-existent project → `404` (create and list endpoints)
- Inactive project → `404`

### Record scope
- Non-existent record → `404`
- Inactive record → `404`
- Record belonging to a different project → `404`
- Invalid ObjectId for `:recordId` or `:projectId` → `404` (global CastError handler)

### AI Extraction
- No summary text AND no transcript URL on record → `422`
- Extraction already `PENDING` → `409` (checked before content validation)
- URL-only record (no summaryText) → extracts successfully using file reference (stub)

### Concurrency
- Concurrent soft-delete during update → `404` (repository `updateById` filters `isActive: true`)
- Concurrent double-delete → `404` (repository `deleteById` filters `isActive: true`)
- Concurrent soft-delete between the PENDING update and COMPLETED update inside `triggerAiExtraction` → `404` (null-checked after each `updateById` call)

---

## Verification Completed

Tested with:
- `tests/unit/features/phone-transcript/phone-transcript.service.test.ts`
- `tests/integration/phone-transcript.integration.test.ts`

---

## Known Follow-Up Work

1. **Wire real LLM into `runAiExtraction()`** — replace the placeholder stub with a call to Azure OpenAI / Anthropic SDK. The method signature accepts `(summaryText, transcriptFileUrl)`. For URL-only records, the LLM integration must fetch/read the file content before extraction. When wiring, also update the `catch` block in `triggerAiExtraction`: add a logger call for the original error and add `.catch(() => {})` on the inner status update so a secondary DB failure does not suppress the controlled 500.
2. **Async extraction via queue** — for large transcripts, move `runAiExtraction()` into a background job (following the Expedient queue pattern) to avoid blocking the HTTP response.
3. **File URL validation** — consider pre-signing or validating blob storage URLs server-side before accepting them.
4. **Multi-language transcription** — `azure-speech.service.ts` currently hardcodes `en-US`. Add a `language` param or auto-detection for multilingual call recordings.
5. **Long audio chunking** — the Fast Transcription API has no documented hard limit but very large files (>500 MB) should be chunked or streamed for reliability.
