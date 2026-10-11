# Outlook Module — Handover (→ Amritanshu)

Handover of the Outlook ingestion module for integration with the
**document-ingestion pipeline** and **project-workspace** (owned by Amritanshu).

The Outlook side (auth, fetch, store, attachment staging) is built, tested, and
working. What remains is wiring it into the pipeline + project creation + Zoho —
i.e. the seams that touch your code. See also
[EMAIL-AI-PROJECT-FLOW.md](EMAIL-AI-PROJECT-FLOW.md) for the full target design.

## What the Outlook module does today (working + verified)

- **Auth:** app-only (client-credentials) via `OUTLOOK_*` creds, `Mail.Read`.
  Decoupled from Teams/Microsoft. Token cached in Mongo. (`outlook-token.service.ts`)
- **Fetch:** per monitored mailbox, incremental **Graph delta** sync via the
  poller (`OUTLOOK_POLLING_ENABLED`) or `POST /sync`. (`outlook.poller.ts`, `outlook.service.ts`)
- **Store:** each email upserted to Mongo `outlookemails`. (`outlook-email.model.ts`)
- **Attachment staging (new):** every non-inline file attachment and reference attachment (OneDrive/SharePoint link) is downloaded from Graph and stored to Azure Blob **project-less** under `documents/staging/<sha>`, with `storageKey` + `blobUrl` saved on the email's `attachments[]` and `downloaded:true`. Content-addressed (sha256) → automatic dedup. Reference attachments are resolved via `/shares/{shareId}/driveItem/content` using `encodeShareUrl()`. (`OutlookService.stageAttachments`)
- **Linking:** only the explicit per-mailbox `projectId` map remains
  (`MAILBOX_MAP`). The heuristic subject/body matcher was **removed** — every
  email now goes to AI for project decisioning.
- **Email package dispatch (Change 1 — DONE):** after staging, Outlook mints a
  SAS URL per attachment and hands the whole email to the document-ingestion side
  as ONE lightweight bundle (no buffers) via
  `IDocumentIngestionPort.ingestEmailPackage`. Bundle = `correlationId`,
  `conversationId`, `sender`, `to[]`, `subject`, `bodyText`, `receivedDateTime`,
  `attachments[{ originalName, mimeType, size, storageKey, downloadUrl(SAS) }]`.
  (`OutlookService.dispatchEmailPackage`)
- **AI/draft schema (Change 2 — DONE):** each email now has `status`
  (`PENDING | LINKED | DRAFT | CONFIRMED | DISCARDED`, default `PENDING`) and a
  `proposed` object (`IAIProposedProject`) for the AI's extracted project fields.

Verified live against `gfs2@amberflux.in`: token + read, delta ingest (20 mails),
attachments staged to Azure Blob, and each email dispatched as a SAS-bearing
package (multi-attachment emails → one package, e.g. 3 attachments in one call).

## Integration seams (your part)

1. **Wire `ingestEmailPackage` to your pipeline.** Outlook already builds the
   SAS-bearing bundle and calls
   `documentPort.ingestEmailPackage(bundle)` for every email.
   `PipelineDocumentIngestionAdapter.ingestEmailPackage` is currently a logging
   **TODO stub** — replace it with your real impl: fire **one** AI-queue message
   per email carrying the body + attachment SAS URLs + candidate projects.
   (The old `projectId`/file-type blocker is gone — Outlook stages project-less
   and passes SAS URLs, not buffers.)

2. **AI result → project decision.** AI returns `LINK | CREATE | NOT_PROJECT`.
   The email `status` + `proposed` schema **now exist (Change 2)**; what's left is
   the **`/ai-result` handler** that writes the verdict onto the email
   (set `projectId`+`status=LINKED` / `proposed`+`status=DRAFT` / `status=DRAFT`).

3. **Project creation on approval.** Approve a draft → `createProject()`
   (project-workspace) + **rebind staged blobs** (`documents/staging/...`) to the
   new project's folder → `status=CONFIRMED`.

4. **Zoho Lead on approval.** `ZohoService.insertIntoZoho('/Leads', …)` exists as
   a building block; not wired. Save returned id on the project; add a
   `source` (`MAIL`/`ZOHO`) marker for loop prevention.

## Hand-off interfaces (where to plug in)

- `IDocumentIngestionPort` (`document-ingestion.port.ts`) — the abstraction
  Outlook uses to hand files to your pipeline. Methods: `upload` (single doc) and
  **`ingestEmailPackage(bundle)`** (the new unified email handoff).
  `PipelineDocumentIngestionAdapter` is the real impl (its `ingestEmailPackage` is
  the TODO stub to wire); `LoggingDocumentIngestionPort` is the test stub.
- `IEmailPackageBundle` / `EmailPackageAttachment` (`document-ingestion.port.ts`)
  — the agreed bundle shape (SAS URLs, not buffers).
- `blobStorage` (`AzureContentAddressedBlobStorage`) — exported from
  `document-ingestion.router.ts`; `put` / `createSignedDownloadUrl` / `delete`.
  Used by Outlook staging; reuse for rebind/cleanup.
- `IProjectRepository` / `ProjectWorkspaceService.createProject()` — project
  creation seam.
- Attachment `storageKey` on `outlookemails.attachments[]` — the link from an
  email to its staged blob, for rebind/AI.

## Status of changes

- **Committed** (`ap/feat/outlook`): attachment staging, matcher removal, docs.
- **Working tree:**
  - Change 1 — email-package dispatch: `document-ingestion.port.ts`
    (`IEmailPackageBundle` + `ingestEmailPackage`), `pipeline-document-ingestion.adapter.ts`
    (stub), `outlook.service.ts` (`dispatchEmailPackage`).
  - Change 2 — AI/draft schema: `outlook-email.model.ts`
    (`OutlookEmailStatus`, `IAIProposedProject`, `status`+`proposed`),
    `i-outlook-email.repository.ts`, `outlook-email.repository.ts`.
  - Stream 2 — Reference Attachments: Added support for reference attachments. Includes `REFERENCE_ATTACHMENT_ODATA_TYPE` and `sourceUrl` fields, staging via Graph shares API, `isReference` traceability flags, and full unit test coverage.
- Dev/verify scripts under `src/scripts/`: `outlook-verify`, `outlook-ingest-test`,
  `outlook-attachment-demo`, `outlook-staging-verify`, `outlook-ai-contract-check`,
  `blob-check`, `db-check`, `seed-test-projects`.
- Type-checks clean; outlook unit tests pass (42/42).

## Env / infra notes

- Outlook testing app is in tenant `amberflux.in` (`69e2dd4c…`); production
  `@amberflux.com` needs a dedicated app in tenant `667fa9d7…`.
- Azure Blob verified working; container `gfsblobstorage001` (a machine-level
  `AZURE_STORAGE_CONTAINER_NAME=expedient-uploads` override was cleared).
- Cosmos Mongo is firewalled for dev IPs — local Mongo used for now.

## AI contract readiness (verified against Mongo)

The contract **request** (GFS → AI) is fully buildable from current data — verified
with `src/scripts/outlook-ai-contract-check.ts`, which constructs the request from
a real `outlookemails` doc and checks every field. Three gotchas for the job builder:

1. **`downloadUrl` is NOT stored.** Mint it on demand from the attachment's
   `storageKey` via `blobStorage.createSignedDownloadUrl(storageKey, mins)`. The
   stored `blobUrl` is the **non-SAS** URL and will 403 for the AI worker — do not
   pass it directly.
2. **`candidateProjects` is NOT on the email.** Fetch from the projects collection
   (`projectRepository.listActive()`) and map to
   `{ projectId, referenceNumber, projectName, customerName, status }`.
3. **`correlationId` is derived**, not stored — use `outlookEmail:<_id>`.

The contract **response** (AI → GFS) now has storage: the email's `status` and
`proposed` fields exist (Change 2). What remains is the **`/ai-result` handler**
that writes the AI verdict onto the email (build item 3).

## Production-readiness — blob staging (must close before prod)

The staging path is verified; the two 🔴 blockers are now resolved:

1. ✅ **RESOLVED — retry + backfill.** Transient failures retry with backoff
   (`withRetry`); attachments that still fail are left unstaged with an
   incremented `stageAttempts`, and `backfillUnstaged()` (run at the start of each
   sync) re-attempts them up to `MAX_STAGE_ATTEMPTS` — so the advancing delta
   cursor no longer causes a permanent miss.
2. ✅ **RESOLVED — streaming.** Attachments stream Graph → blob via
   `graphClient.getStream` + `blobStorage.putStream` (constant memory, no full
   buffer). Staged blobs use a deterministic key (`stagingKey`) so streaming
   needs no pre-hash and re-stage is idempotent.
3. **🟠 No cleanup/lifecycle for staged blobs.** `documents/staging/…` grows
   unbounded until rebind-on-approve / delete-on-discard exist (or an Azure
   lifecycle policy on the prefix).
4. **🟠 Auth = account key in env.** Prefer managed identity / key rotation; add a
   startup assertion on the container name (the `AZURE_STORAGE_CONTAINER_NAME`
   override incident showed it can silently point at the wrong container).
5. **🟡 No AV/malware scan** of externally-sourced attachments (if required).
6. **🟡 Observability** — only `console.*`; add structured logs + a staging-failure
   metric/alert.

For controlled testing/MVP it's usable; for prod, close at least #1 and #2.

## Open decisions (carried over)

1. ~~Pipeline `projectId` for pre-AI emails~~ — RESOLVED: Outlook stages
   project-less and hands SAS URLs via `ingestEmailPackage`.
2. AI transport for `ingestEmailPackage` (callback vs result queue) — your call.
3. Zoho Lead field mapping (which extracted fields → which Lead fields).
4. Draft grouping: one-per-email vs by `conversationId`.
