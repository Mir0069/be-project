# 06 — Module 11 Manual API Checklist

Use this checklist while testing Module 11 behavior in Postman or a REST client.

**Prerequisites:**
- A running GFS backend with a reachable MongoDB instance
- A valid project ID (create one via Module 2 / Project Workspace, or seed directly)
- Auth cookies from `POST /api/v1/auth/login` — use the `withCredentials` / `Cookie` header pattern

**Users needed:**
- One `SALES_MANAGER` account (for delete-restricted tests)
- One `ESTIMATOR` account (for role-restriction negative tests)

---

## 1. Create Call Record — summary text

Endpoint:
`POST /api/v1/projects/:projectId/call-records`

Body:
```json
{
  "callDate": "2026-05-01",
  "customerName": "Acme Corp",
  "summaryText": "Customer wants 10m x 6m Series 2000 glass enclosure with thermal break and frosted glass panels."
}
```

Checklist:
- ✅ Returns `201`
- ✅ Response includes `data.callRecord` with `id`, `callDate`, `customerName`, `summaryText`
- ✅ `aiExtractionStatus` is `NOT_REQUESTED`
- ✅ `contributedBy` matches the authenticated user's ID
- ✅ `isActive` is `true`

---

## 2. Create Call Record — transcript file URL

Endpoint:
`POST /api/v1/projects/:projectId/call-records`

Body:
```json
{
  "callDate": "2026-05-10",
  "customerName": "BuildRight Pty Ltd",
  "transcriptFileUrl": "https://storage.example.com/transcripts/call-001.txt",
  "transcriptFileName": "call-001.txt"
}
```

Checklist:
- ✅ Returns `201`
- ✅ `transcriptFileUrl` and `transcriptFileName` are stored
- ✅ `summaryText` is `undefined` / absent (not required when URL provided)

---

## 3. Create Call Record — validation failures

Checklist:
- ✅ Missing `callDate` → `400`
- ✅ Missing `customerName` → `400`
- ✅ Neither `summaryText` nor `transcriptFileUrl` provided → `400`
- ✅ Invalid `transcriptFileUrl` (not a URL) → `400`
- ✅ Non-existent `projectId` → `404`
- ✅ Unauthenticated request → `401`

---

## 4. List Call Records

Endpoint:
`GET /api/v1/projects/:projectId/call-records`

Default (no query params):
`GET /api/v1/projects/:projectId/call-records`

Explicit pagination:
`GET /api/v1/projects/:projectId/call-records?page=2&limit=12`

Checklist:
- ✅ Returns `200`
- ✅ Response includes `data.callRecords` array
- ✅ Response includes `data.pagination` object with `total`, `page`, `limit`, `totalPages`
- ✅ Default `limit` is `12` and default `page` is `1`
- ✅ `page=2&limit=12` with 15 records returns 3 records and `totalPages: 2`
- ✅ `page=0` returns `400` (must be a positive integer)
- ✅ `limit=101` returns `400` (max is 100)
- ✅ Records are sorted by `callDate` descending (newest first)
- ✅ Soft-deleted records do not appear in the list
- ✅ Records from other projects do not appear
- ✅ Non-existent project returns `404`
- ✅ Unauthenticated request returns `401`

---

## 5. Get Single Call Record

Endpoint:
`GET /api/v1/projects/:projectId/call-records/:recordId`

Checklist:
- ✅ Returns `200` with `data.callRecord`
- ✅ Non-existent `recordId` returns `404`
- ✅ `recordId` from a different project returns `404`
- ✅ Invalid (non-ObjectId) `recordId` returns `404` (not `500`)

---

## 6. Update Call Record

Endpoint:
`PATCH /api/v1/projects/:projectId/call-records/:recordId`

Body (update customer name):
```json
{
  "customerName": "Updated Corp Name"
}
```

Checklist:
- ✅ Returns `200` with updated `callRecord`
- ✅ Only provided fields are changed; others remain the same
- ✅ Empty body `{}` returns `400`
- ✅ Non-existent record returns `404`
- ✅ Both ESTIMATOR and SALES_MANAGER can update

---

## 7. Delete Call Record

Endpoint:
`DELETE /api/v1/projects/:projectId/call-records/:recordId`

Checklist:
- ✅ SALES_MANAGER: returns `200` with `data.callRecord` containing `isActive: false`
- ✅ `isActive` is `false` in MongoDB after deletion
- ✅ Record no longer appears in `GET /` list after deletion
- ✅ ESTIMATOR attempting delete returns `403`
- ✅ Non-existent record returns `404`

---

## 8. Trigger AI Extraction — summary text

Endpoint:
`POST /api/v1/projects/:projectId/call-records/:recordId/extract`

**Pre-condition:** Record must have `summaryText` set.

Checklist:
- ✅ Returns `200`
- ✅ `aiExtractionStatus` is `COMPLETED`
- ✅ `aiExtractedRequirements` is populated (stub text while LLM not wired)
- ✅ `aiExtractedAt` is a valid ISO timestamp

---

## 9. Trigger AI Extraction — transcript file URL only

Endpoint:
`POST /api/v1/projects/:projectId/call-records/:recordId/extract`

**Pre-condition:** Record has `transcriptFileUrl` set but no `summaryText`.

Checklist:
- ✅ Returns `200` (stub uses the file URL reference as extraction source)
- ✅ `aiExtractionStatus` is `COMPLETED`
- ✅ `aiExtractedRequirements` references the file URL

---

## 10. AI Extraction — edge cases

Checklist:
- ✅ Record with no `summaryText` and no `transcriptFileUrl` → `422`
- ✅ Record whose `aiExtractionStatus` is already `PENDING` → `409`
- ✅ Non-existent record → `404`

---

## 11. Authorization negative cases

Checklist:
- ✅ Any endpoint without auth cookie → `401`
- ✅ ESTIMATOR calling `DELETE /:recordId` → `403`
- ✅ Accessing call records of a project the user does not own → responds normally (no project-scoped ownership restriction beyond project existence check — access is role-based only)

---

## 12. Transcribe audio — happy path

Endpoint:
`POST /api/v1/projects/:projectId/call-records/:recordId/transcribe`

**Request:** `multipart/form-data`, field name `audio`, file must be MP3 / WAV / OGG / M4A / FLAC / WebM (max 50 MB)

**Pre-condition:** Call record must exist and be active. It can have a placeholder `summaryText` — the transcription will overwrite it.

Checklist:
- ✅ Returns `200`
- ✅ `data.callRecord.summaryText` contains the transcribed text from the audio
- ✅ Other fields (`callDate`, `customerName`, `aiExtractionStatus`) are unchanged
- ✅ MP3 file works (routed via Azure Fast Transcription API)
- ✅ WAV file works (same API)

---

## 13. Transcribe audio — edge cases

Checklist:
- ✅ No file attached → `400` with `"Audio file is required"`
- ✅ Audio with no detectable speech (silence / tone) → `422` with `"No speech detected in the audio file"`
- ✅ Non-existent `recordId` → `404`
- ✅ `recordId` from a different project → `404`
- ✅ Unauthenticated request → `401`
