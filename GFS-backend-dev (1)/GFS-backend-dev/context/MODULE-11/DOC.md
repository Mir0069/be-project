# Module 11 — Phone Transcript Ingestion

## Purpose

Module 11 allows estimators and sales managers to capture information from customer phone calls by logging manual text summaries or linking uploaded transcript files directly against a project. All call records appear in the project Communications tab and are available for optional AI requirement extraction.

---

## Key Features

- Log call records against any active project (manual summary text, transcript file URL, or audio upload)
- Both `summaryText` and `transcriptFileUrl` are optional individually — at least one must be provided on creation
- **Audio transcription:** upload an audio file (MP3, WAV, OGG, M4A, FLAC, WebM) against an existing record — Azure Speech transcribes it and stores the result in `summaryText`
- List endpoint is paginated — **12 records per page by default**; override with `?page=N&limit=N` (max limit 100)
- Soft-delete (records are deactivated, not permanently removed)
- Optional AI extraction: reads the transcript text or file reference and identifies key project requirements
- Extraction status tracked through `NOT_REQUESTED → PENDING → COMPLETED / FAILED`
- Full audit trail: every record stores `contributedBy` (user ID), `callDate`, and timestamps
- Role-based access: ESTIMATOR and SALES_MANAGER can create / read / update; only SALES_MANAGER and SYSTEM_ADMIN can delete

---

## Architecture

### Feature module

```
src/features/phone-transcript/
├── phone-transcript.controller.ts   HTTP handlers
├── phone-transcript.service.ts      Business logic
├── phone-transcript.router.ts       Route wiring + middleware
└── phone-transcript.types.ts        Zod schemas + TypeScript types

src/services/
└── azure-speech.service.ts          Azure Speech Fast Transcription API client
```

### Data layer

```
src/db/models/call-record.model.ts
src/repositories/interfaces/i-call-record.repository.ts
src/repositories/mongoose/call-record.repository.ts
```

### Registration

Router is mounted in `src/app.ts`:

```
/api/v1/projects/:projectId/call-records
```

---

## Data Model — `CallRecord`

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | ObjectId (ref: Project) | Owning project |
| `callDate` | Date | When the call took place |
| `customerName` | String | Customer name at time of call |
| `summaryText` | String? | Free-text summary written by the contributor |
| `transcriptFileUrl` | String? | URL to uploaded transcript file in blob storage |
| `transcriptFileName` | String? | Original filename for display |
| `contributedBy` | ObjectId (ref: User) | User who logged the record |
| `aiExtractionStatus` | Enum | `NOT_REQUESTED` \| `PENDING` \| `COMPLETED` \| `FAILED` |
| `aiExtractedRequirements` | String? | Requirements identified by AI extraction |
| `aiExtractedAt` | Date? | When extraction completed |
| `isActive` | Boolean | Soft-delete flag |

---

## Role Access Matrix

| Action | ESTIMATOR | SALES_MANAGER | SYSTEM_ADMIN |
|--------|-----------|---------------|--------------|
| Create | ✅ | ✅ | ✅ |
| List / Get | ✅ | ✅ | ✅ |
| Update | ✅ | ✅ | ✅ |
| Delete | ❌ | ✅ | ✅ |
| Trigger AI extraction | ✅ | ✅ | ✅ |
| Transcribe audio | ✅ | ✅ | ✅ |

---

## Endpoint Contract

Base path: `/api/v1/projects/:projectId/call-records`

All endpoints require authentication (`accessToken` cookie).

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Create call record |
| GET | `/` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | List paginated records |
| GET | `/:recordId` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Get single record |
| PATCH | `/:recordId` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Update record |
| DELETE | `/:recordId` | SALES_MANAGER, SYSTEM_ADMIN | Soft-delete record |
| POST | `/:recordId/extract` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Trigger AI extraction |
| POST | `/:recordId/transcribe` | ESTIMATOR, SALES_MANAGER, SYSTEM_ADMIN | Upload audio → transcribe via Azure Speech |

### 1. `POST /`

Creates a new call record for the project.

**Request body**
```json
{
  "callDate": "2026-05-01",
  "customerName": "Acme Corp",
  "summaryText": "Customer requested 10m x 6m Series 2000 with thermal break.",
  "transcriptFileUrl": "https://...",
  "transcriptFileName": "call-2026-05-01.txt"
}
```

Rules:
- `callDate` and `customerName` are required
- At least one of `summaryText` or `transcriptFileUrl` must be provided

**Success `201`**
```json
{
  "success": true,
  "data": { "callRecord": { ... } }
}
```

---

### 2. `GET /`

Returns paginated active call records for the project, sorted by `callDate` descending.

**Query params**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | integer | `1` | — | Page number (1-based) |
| `limit` | integer | `12` | `100` | Records per page |

**Success `200`**
```json
{
  "success": true,
  "data": {
    "callRecords": [ ... ],
    "pagination": {
      "total": 45,
      "page": 1,
      "limit": 12,
      "totalPages": 4
    }
  }
}
```

---

### 3. `GET /:recordId`

Returns a single call record by ID.

**Success `200`** / **`404`** if not found or belongs to a different project.

---

### 4. `PATCH /:recordId`

Updates fields on an existing call record. At least one field must be provided.

**Request body** (all fields optional)
```json
{
  "callDate": "2026-05-02",
  "customerName": "Updated Name",
  "summaryText": "Revised summary after follow-up.",
  "transcriptFileUrl": "https://...",
  "transcriptFileName": "updated-transcript.txt"
}
```

**Success `200`** / **`400`** if body is empty / **`404`** if not found.

---

### 5. `DELETE /:recordId`

Soft-deletes the call record (`isActive` set to `false`). Record is no longer returned in list queries. Returns the deleted record in the response body.

**Roles:** `SALES_MANAGER`, `SYSTEM_ADMIN` only.

**Success `200`**
```json
{
  "success": true,
  "data": { "callRecord": { "isActive": false, ... } }
}
```

**`403`** for ESTIMATOR / **`404`** if not found.

---

### 6. `POST /:recordId/extract`

Triggers AI extraction of key project requirements from the call's `summaryText` or `transcriptFileUrl`.

- Returns `409` if extraction is already `PENDING`
- Returns `422` if the record has neither `summaryText` nor `transcriptFileUrl`
- On success, sets `aiExtractionStatus = COMPLETED` and populates `aiExtractedRequirements`

> **Note:** The current AI extraction implementation is a stub (`runAiExtraction` in `phone-transcript.service.ts`). When wiring the real LLM: the method accepts both `summaryText` and `transcriptFileUrl` — for URL-only records the LLM integration must fetch/read the file content before extraction.

**Success `200`**
```json
{
  "success": true,
  "data": {
    "callRecord": {
      "aiExtractionStatus": "COMPLETED",
      "aiExtractedRequirements": "...",
      "aiExtractedAt": "2026-05-17T..."
    }
  }
}
```

---

## Validation

Zod schemas are defined in `phone-transcript.types.ts` and applied via the `validateRequest` middleware:

| Schema | Validates |
|--------|-----------|
| `CreateCallRecordSchema` | `body.callDate`, `body.customerName`, at-least-one-of refinement |
| `UpdateCallRecordSchema` | `body.*` (all optional), at-least-one refinement |
| `ListCallRecordsQuerySchema` | `query.page` (positive int, default `1`), `query.limit` (positive int, default `12`, max `100`) |

> **Important:** `validateRequest` writes Zod-parsed values (including defaults and coercions) back to `req.body`/`req.query`/`req.params`. Query param defaults apply only when the middleware runs — the route must include `validateRequest(ListCallRecordsQuerySchema)`.

---

## Error Response Shape

All errors follow the global handler format:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Human-readable error message",
    "statusCode": 404
  }
}
```

Invalid ObjectId values in URL params (`:projectId`, `:recordId`) are caught by the global error handler and returned as `404` rather than `500`.

---

### 7. `POST /:recordId/transcribe`

Accepts a multipart audio file upload, transcribes it via Azure Speech Fast Transcription API, and stores the resulting text in `summaryText` on the call record.

**Request:** `multipart/form-data`, field name `audio` (max 50 MB)

**Supported formats:** MP3, WAV, OGG, M4A, FLAC, WebM

- Returns `422` if no speech is detected in the audio
- Returns `404` if the record does not exist or belongs to a different project
- On success, overwrites `summaryText` with the transcribed text

**Success `200`**
```json
{
  "success": true,
  "data": {
    "callRecord": {
      "summaryText": "Dear Sir, we have done the WQT as per client requirement...",
      ...
    }
  }
}
```

**Azure Speech config** (via `env.speech`):

| Env var | Purpose |
|---------|---------|
| `AZURE_SPEECH_KEY` | Subscription key |
| `AZURE_SPEECH_REGION` | Region (e.g. `centralus`) |
| `AZURE_SPEECH_ENDPOINT` | Optional custom endpoint URL |

Uses the **Fast Transcription API** (`/speechtotext/transcriptions:transcribe?api-version=2025-10-15`) — no 60-second limit, supports compressed formats natively. Implementation in `src/services/azure-speech.service.ts`.

---

## Current Boundaries

- Does not record or transcribe live calls — audio must be uploaded as a file
- Audio transcription overwrites `summaryText` — it does not append
- Transcript file URL upload (Module 3) and audio transcription (Module 11 `/transcribe`) are two separate flows — both land in `summaryText`
- AI extraction is stubbed — requires LLM integration before production use; the stub handles both text and URL-reference inputs
