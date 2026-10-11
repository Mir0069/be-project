# Email → AI → Project Flow (Outlook ingestion)

Design spec for how ingested Outlook emails become GFS projects, via AI proposal
and human approval, with Zoho sync.

## Overview

Every email that lands in a monitored mailbox is enriched (attachments stored to
blob), sent to AI, and the AI's decision drives one of three outcomes. **AI never
creates a project or a Zoho record** — it only links to an existing project or
fills a *draft*. A human approves drafts; approval is the single trigger for
project creation + Zoho.

## End-to-end flow

```
Outlook poller / webhook                                          [IMPLEMENTED]
  → email ingested, stored in Mongo (status = PENDING)
  → each attachment:
    • fileAttachment: download from Graph ($value)
    • referenceAttachment: download from Graph via /shares/{shareId}/driveItem/content using encodeShareUrl()
    → stage to Azure Blob → SAS download URL
  → ingestEmailPackage(bundle): one unified package per email (body + SAS URLs)
    handed to document-ingestion, which fires ONE AI-queue message  [adapter TODO]

AI returns a decision:
  • LINK    → backend links the email to the existing project          (AUTO)
  • CREATE  → backend creates a DRAFT, pre-filled with AI fields        (review)
  • NOT_PROJECT → backend still creates a DRAFT, flagged "not a project" (review)

Draft section (UI), admin reviews every draft:
  • Approve → createProject() (new PRJ id) + create Zoho LEAD
              + save zoho id + bind email & staged attachments → CONFIRMED
  • Edit fields, then approve
  • Discard → the only path that deletes anything (cleans up staged blobs)
```

Nothing is auto-discarded. Even mail AI thinks is not a project becomes a draft so
an admin can still promote it.

## Email states

| status        | meaning                                                        |
|---------------|----------------------------------------------------------------|
| `LINKED`      | AI matched an existing project; email linked automatically     |
| `DRAFT`       | Awaiting human review in the Draft section                     |
| `CONFIRMED`   | Admin approved a draft → real project + Zoho Lead created       |
| `DISCARDED`   | Admin discarded; staged attachments cleaned up                 |

AI proposal stored on the email for pre-filling the draft form:

```jsonc
"proposed": {
  "isProject": true,
  "customerName": "Globex",
  "projectName": "Website Redesign Project",
  "projectType": "NEW_ESTIMATE",     // NEW_ESTIMATE | RE_QUOTE | VARIATION
  "summary": "Client requests a quote for…",
  "confidence": 0.0
}
```

Default data model: **one draft per email**. (Future: group emails in the same
`conversationId` into a single draft project.)

## Attachment storage (staging) — IMPLEMENTED

At ingestion time there is no project yet, so attachments are stored project-less:
- Download file attachments from Graph `/users/{m}/messages/{id}/attachments/{id}/$value`.
- Download reference attachments from Graph `/shares/{shareId}/driveItem/content` using `encodeShareUrl(sourceUrl)`.
- Store to Azure Blob (`gfsblobstorage001`) under a project-less `documents/staging/<sha>`
  prefix (content-addressed). `storageKey` + `blobUrl` saved on the email's
  `attachments[]`; `downloaded:true`. (`OutlookService.stageAttachments`)
- Generate a SAS download URL on demand via `createSignedDownloadUrl(storageKey)`
  (the stored `blobUrl` is non-SAS — do not pass it to AI directly).
- Put the SAS URL in the AI job payload.
- On Approve → rebind the blob / `DocumentRecord` to the created project. (TODO)
- Not yet production-hardened — see OUTLOOK-HANDOVER.md (retry, streaming, cleanup).
- On Discard → delete the staged blob.

## AI contract

### Request (GFS → AI), per email
```jsonc
{
  "correlationId": "outlookEmail:<mongoId>",   // echoed back on the result
  "source": "OUTLOOK",
  "mailbox": "gfs2@amberflux.in",
  "email": {
    "messageId": "<graph id>",
    "conversationId": "<graph conversationId>",
    "from": { "name": "Mouli", "address": "mouli@amberflux.com" },
    "to": ["gfs2@amberflux.in"],
    "subject": "Request for Quotation - Website Redesign",
    "bodyText": "full plain-text body…",
    "receivedDateTime": "2026-06-18T16:51:27Z"
  },
  "attachments": [
    { "name": "drawing.pdf", "contentType": "application/pdf",
      "size": 84213, "downloadUrl": "<SAS url to blob>" }
  ],
  "candidateProjects": [
    { "projectId": "…", "referenceNumber": "PRJ-2026-0007",
      "projectName": "Website Redesign", "customerName": "Globex",
      "status": "SETUP_PENDING" }
  ]
}
```

### Response (AI → GFS)
```jsonc
{
  "correlationId": "outlookEmail:<mongoId>",   // must match the request
  "action": "LINK" | "CREATE" | "NOT_PROJECT",
  "projectId": "…",                 // required when action = LINK
  "extracted": {                    // required when action = CREATE
    "customerName": "Globex",
    "projectName": "Website Redesign Project",
    "projectType": "NEW_ESTIMATE",
    "summary": "…"
  },
  "confidence": 0.0,
  "reasoning": "short text"          // optional, stored for audit
}
```

### Transport (AI dev picks one)
- **Callback (recommended):** AI `POST`s the result to `/api/v1/outlook/ai-result`
  (secured with a shared secret / HMAC).
- **Result queue:** AI writes to a Service Bus result queue GFS consumes.
- **DB write:** not recommended (couples AI to our schema).

### Operational requirements from AI
- Echo `correlationId` on every result.
- Idempotent per `correlationId` (retries must not double-process).
- Fetch attachment bytes from the provided SAS `downloadUrl`.
- Signal failure (or don't ack on the queue → existing DLQ handles retry).
- State a rough latency SLA.

## Backend endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/outlook/ai-result` | AI callback → LINK / DRAFT(CREATE) / DRAFT(NOT_PROJECT) |
| `GET`  | `/api/v1/outlook/emails?status=DRAFT` | Draft review queue |
| `POST` | `/api/v1/outlook/emails/:id/create-project` | Approve draft → createProject + Zoho Lead + bind |
| `POST` | `/api/v1/outlook/emails/:id/discard` | Discard draft + clean up staged blobs |
| `POST` | `/api/v1/outlook/emails/:id/link` | Manual link/override (exists) |

## Zoho

- On **Approve**, create a Zoho **Lead** via `insertIntoZoho('/Leads', payload)`
  and store the returned id on the project.
- Zoho creation happens only for human-approved projects (no junk in CRM).

## Loop prevention

Projects carry a `source` marker (`MAIL` | `ZOHO`). A Zoho-originated project must
not be pushed back to Zoho, and a mail-originated project must not be re-created
when the inbound Zoho sync sees it.

## Open items (need confirmation)

1. **AI transport** — callback vs. result queue.
2. **Zoho field mapping** — which extracted fields map to which Zoho Lead fields.
3. **Draft grouping** — one draft per email (default) vs. group by `conversationId`.
4. **Path 1 (Zoho → project)** — polling vs. webhook (separate workstream).

## Build order

1. ✅ **DONE** — Ingestion-time attachment staging (blob + storageKey) for both file attachments and reference attachments (OneDrive/SharePoint links). Heuristic
   matcher removed (all emails go to AI). Not yet prod-hardened (retry/streaming).
1b. ✅ **DONE** — Email-package dispatch: `ingestEmailPackage(bundle)` with SAS
   URLs per email (Outlook side). Adapter→pipeline wiring is Amritanshu's TODO.
2. ✅ **DONE** — Email states (`status`) + `proposed` field (schema + mapping).
2b. ✅ **DONE** — Stream 2: Support reference attachments (retrieve `sourceUrl`, encode share ID, download from shares endpoint, stage to blob).
3. `/ai-result` handler (LINK auto / CREATE→draft / NOT_PROJECT→draft).
4. Draft endpoints: review list, `create-project` (approve), `discard`.
5. Zoho Lead creation on approve + `source` marker.
6. Path 1 (Zoho → project inbound sync) — later.
```
