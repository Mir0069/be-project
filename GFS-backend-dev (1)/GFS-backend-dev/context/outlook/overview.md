# Outlook Integration Module — Overview

## Purpose

Ingests **Outlook / Microsoft 365 emails** (and their file attachments) into GFS
and links each email to the right project. An admin chooses which mailboxes (and
folders) to monitor; a scheduled poller (or a manual sync) pulls new mail from
those folders via the Microsoft Graph **mail delta** API, stores it, and
auto-links it to a project by keyword or by an explicit mailbox→project mapping.

What is implemented today:

- **Mailbox discovery + monitoring** — list tenant users and their mail folders,
  register a folder for ingestion.
- **Incremental email ingestion** — Graph delta cursor per mailbox, so each tick
  fetches only new/changed messages.
- **Project association** — mailbox map → keyword match → unlinked, with manual
  override preserved across re-sync.
- **Email body routing** — the email (headers + plain-text body) is uploaded to
  the Document Ingestion Pipeline as a `.txt` document.
- **Attachment routing** — file attachments and OneDrive/SharePoint reference attachments are downloaded and uploaded to the pipeline; inline images (signatures) are skipped.
- **Read endpoints + manual linking** — list ingested emails, manually link an
  email to a project, re-run attachment processing.

This is a **polling, app-only** integration: no per-user OAuth sign-in and no
real-time webhooks (see *Roadmap*).

---

## Authentication (app-only / client-credentials)

Uses an **application** identity — there is no user sign-in and no refresh token.
The token service exchanges the three app credentials for a Graph access token
(~1 hour lifetime), caches it in the `outlooktokens` collection, and re-requests
a fresh one once the cached token is within a 60-second safety window of expiry.

```
POST {OUTLOOK_AUTHORITY}/{OUTLOOK_TENANT_ID}/oauth2/v2.0/token
  grant_type=client_credentials
  client_id={OUTLOOK_CLIENT_ID}
  client_secret={OUTLOOK_CLIENT_SECRET}
  scope=https://graph.microsoft.com/.default
```

The required Graph permission is the **Application** permission `Mail.Read` (with
admin consent). The `OUTLOOK_*` credentials **fall back to the `TEAMS_*`** app
registration, so a single Azure app with both `Mail.Read` and
`ChannelMessage.Read.All` can serve both integrations.

---

## Architecture

```
outlook.router.ts                   → routes, guards, dependency injection
outlook.controller.ts               → HTTP layer (safeJson responses)
outlook.service.ts                  → orchestration: discovery, monitoring, sync, ingestion, linking
outlook-token.service.ts            → app-only token acquisition + caching
outlook.graph-client.ts             → axios wrapper over Graph (paging + delta + binary + errors)
outlook-association.service.ts      → project resolution (mailbox map / keyword / none)
outlook-files.service.ts            → downloads + routes attachments to the pipeline
document-ingestion.port.ts          → IDocumentIngestionPort (decouples from the pipeline)
pipeline-document-ingestion.adapter → adapts the port to DocumentIngestionPipeline
outlook.poller.ts                   → setInterval-based scheduled syncAll()
outlook.types.ts                    → Graph DTOs + internal shapes
outlook.validation.ts               → Zod request schemas
outlook.errors.ts                   → error description helper
```

Ingestion is **trigger-agnostic**: the poller and the `POST /sync` endpoint both
call the same `syncMailbox` / `syncAll` logic, so a webhook trigger can be added
later without touching ingestion. The router builds one shared `OutlookService`
instance and exports it so the poller (started in `server.ts`) reuses it.

---

## Ingestion flow

```
poller tick / POST /sync
  └─ syncAll() → for each active monitored mailbox:
       └─ syncMailbox(mailbox)
            ├─ getDelta(deltaLink ?? .../messages/delta?$select=...)
            ├─ skip @removed (deleted) entries and drafts
            ├─ ingestEmail(message) for each remaining message
            └─ persist new @odata.deltaLink as the mailbox cursor
```

`ingestEmail` ([outlook.service.ts](../../src/features/outlook/outlook.service.ts)):

1. HTML body → plain text via `htmlToText`; original HTML kept in `bodyHtml`.
2. **Resolve project** (see association table). A pre-existing `MANUAL` link is
   preserved instead of being recomputed.
3. Fetch attachment metadata (file attachments and reference attachments; item attachments skipped),
   preserving the `downloaded` flag of files already pulled in a prior sync.
4. **Upsert** the email by `messageId` (idempotent — re-sync never duplicates).
5. Process attachments → download + route each pending file to the pipeline.
6. Route the email body to the pipeline (once, gated on a resolved project).

The delta `$select` requests `subject, from, toRecipients, body, bodyPreview,
receivedDateTime, webLink, hasAttachments, isDraft, conversationId,
internetMessageId` — body included so a single round-trip has everything needed.

---

## Project association

For each ingested email, `OutlookAssociationService.resolveProject` decides the
project:

| Order | Rule | `linkMethod` |
|---|---|---|
| 1 | The monitored mailbox has an explicit `projectId` mapping | `MAILBOX_MAP` |
| 2 | Subject or body contains a project's `projectName`, `referenceNumber`, or `customerName` (case-insensitive) | `AUTO` |
| 3 | No match | `null` (unlinked — can be linked manually) |

A `MANUAL` link set via `POST /emails/:messageId/link` is **never overwritten**
by a later sync.

---

## Pipeline routing

Both content types route into the Document Ingestion Pipeline through
`IDocumentIngestionPort`, gated on a resolved `projectId` and made idempotent via
flags (`routedToPipeline` for the body, `downloaded` per attachment). The adapter
uploads as the system user `outlook-integration` (role `SYSTEM_ADMIN`).

| Content | documentType | Toggle |
|---|---|---|
| Email body (headers + plain text, `email-<id>.txt`, ≥2 chars) | `other` (`metadata.kind: email`) | `OUTLOOK_EMAIL_INGEST_ENABLED` |
| File & Reference attachments (downloaded via `/attachments/{id}/$value` or `/shares/{shareId}/driveItem/content`) | inferred: `.dwg`→`drawing`, images→`photo`, else `other` | `OUTLOOK_FILE_INGEST_ENABLED` |

Inline attachments (signature images etc.) are stored on the email record but
never routed. Per-file and per-email routing errors are caught and logged so one
bad item never aborts a sync.

---

## Endpoints

Base path: `/api/v1/outlook`. All routes require `authenticate`. Routes marked
**(admin)** also require `authorize(SUPER_ADMIN, SYSTEM_ADMIN)`.

### GET `/status` (auth)
Connection/config snapshot.
```json
{ "success": true, "data": { "configured": true, "cachedTokenExpiresAt": "2026-06-15T10:59:00.000Z", "monitoredMailboxCount": 2 } }
```

### GET `/users` (admin)
Lists tenant mail users. Optional `?search=` does a `startswith(mail, …)` filter.
Used to pick a mailbox to monitor.

### GET `/users/:userId/folders` (admin)
Lists the mail folders of a user (to pick the folder to monitor).

### GET `/monitored-mailboxes` (admin)
Lists the mailboxes/folders currently being ingested.

### POST `/monitored-mailboxes` (admin)
Start monitoring a mailbox folder; optionally map it to a project.
```json
{ "userId": "...", "displayName": "Sales Inbox", "folderId": "<optional, defaults to 'inbox'>", "projectId": "<optional>" }
```
**Errors:** `404` mapped project not found · `409` mailbox+folder already monitored.

### DELETE `/monitored-mailboxes/:id` (admin)
Stops monitoring (soft delete — `isActive: false`). `404` if not found.

### POST `/sync` (admin)
Manually trigger ingestion. Body optional: `{ "mailboxDbId": "<monitored mailbox _id>" }`
syncs one mailbox; empty body syncs all.
```json
{ "success": true, "data": { "mailboxes": [{ "mailboxUserId": "...", "displayName": "Sales Inbox", "ingested": 3 }], "errors": [] } }
```

### GET `/emails` (auth)
Lists ingested emails. Query: `projectId`, `mailboxUserId`, `conversationId`, `page`, `limit`.

### POST `/emails/:messageId/link` (admin)
Manually link an email to a project (sets `linkMethod: "MANUAL"`; preserved on
re-sync). Also processes its attachments and routes the email to the pipeline.
```json
{ "projectId": "..." }
```
**Errors:** `404` project or email not found.

### POST `/emails/:messageId/process-attachments` (admin)
Re-runs attachment download/routing for one email. `data: { routed: <count> }`.
`404` if not found.

---

## Data models

`outlooktokens` — cached app-only token:

| Field | Notes |
|---|---|
| `tokenKey` | unique; always `default` for the single app identity |
| `accessToken` | current Graph token |
| `expiresAt` | absolute expiry; refetched within 60s of this |

`outlookmonitoredmailboxes` — mailboxes/folders to ingest:

| Field | Notes |
|---|---|
| `userId` | Azure AD object id or UPN of the mailbox owner |
| `displayName` | label for the UI |
| `folderId` | mail folder; defaults to well-known `inbox`. `(userId, folderId)` unique |
| `projectId` | optional explicit project mapping (`MAILBOX_MAP`) |
| `deltaLink` | Graph delta cursor for incremental polling |
| `isActive` | soft-delete flag |

`outlookemails` — ingested emails:

| Field | Notes |
|---|---|
| `messageId` | unique Graph message id (idempotent upsert) |
| `internetMessageId` | RFC 2822 Message-ID; stable across mailboxes |
| `mailboxUserId` | source mailbox |
| `conversationId` | thread grouping |
| `subject`, `fromName`, `fromAddress`, `toRecipients[]` | headers |
| `bodyText` / `bodyHtml` | plain (HTML stripped) + original HTML |
| `webLink`, `receivedDateTime` | message metadata |
| `attachments[]` | `{ id, name, contentType, size, isInline, isReference, sourceUrl, downloaded }` |
| `projectId` / `linkMethod` | association result |
| `routedToPipeline` | true once the body was sent to the pipeline |

---

## Files

```
src/features/outlook/
  outlook.router.ts
  outlook.controller.ts
  outlook.service.ts
  outlook-token.service.ts
  outlook.graph-client.ts
  outlook-association.service.ts
  outlook-files.service.ts
  document-ingestion.port.ts
  pipeline-document-ingestion.adapter.ts
  outlook.poller.ts
  outlook.types.ts
  outlook.validation.ts
  outlook.errors.ts

src/db/models/outlook-token.model.ts
src/db/models/outlook-monitored-mailbox.model.ts
src/db/models/outlook-email.model.ts
src/repositories/{interfaces,mongoose}/outlook-token.repository.ts
src/repositories/{interfaces,mongoose}/outlook-monitored-mailbox.repository.ts
src/repositories/{interfaces,mongoose}/outlook-email.repository.ts

tests/unit/features/outlook/*.test.ts
tests/integration/outlook.integration.test.ts
```

---

## Required env vars

```
OUTLOOK_CLIENT_ID=<Application (client) ID>      # falls back to TEAMS_CLIENT_ID
OUTLOOK_CLIENT_SECRET=<client secret Value>      # falls back to TEAMS_CLIENT_SECRET
OUTLOOK_TENANT_ID=<Directory (tenant) ID>        # falls back to TEAMS_TENANT_ID
OUTLOOK_POLLING_ENABLED=true                     # enable the scheduled poller (default false)
# feature toggles (default true):
OUTLOOK_EMAIL_INGEST_ENABLED=true                # route email bodies to the pipeline
OUTLOOK_FILE_INGEST_ENABLED=true                 # download + route attachments
# optional overrides:
OUTLOOK_AUTHORITY=https://login.microsoftonline.com
OUTLOOK_GRAPH_BASE_URL=https://graph.microsoft.com/v1.0
OUTLOOK_SCOPE=https://graph.microsoft.com/.default
OUTLOOK_POLL_INTERVAL_MS=10000                   # 10 seconds
```

Credentials are optional at boot (so the app still starts without them); the
token service raises `OUTLOOK_NOT_CONFIGURED` only when an Outlook feature is
used without them.

---

## Security & operational notes

- **Read-only:** the integration never sends, modifies, or deletes mail.
- The poller uses `setInterval` with an **overlap guard** (a slow run can't
  stack) and an **unref'd** timer (never keeps the process alive on its own).
- Sync isolates failures per mailbox — one bad mailbox does not abort the run;
  errors are collected in the summary.
- Responses go through `safeJson`, which blocks Mongoose internals from leaking.

---

## Roadmap

- **Webhooks (real-time):** Graph change-notification subscriptions for new mail,
  with the ~3-day renewal cron; polling would remain the reliability backstop.
