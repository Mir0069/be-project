# Outlook Cloud Link Resolver — Implementation Plan

> Owner: Pradeep  
> Based on: Murali's spec (Jun 23 2026)  
> Scope: Outlook only 
> Last updated: 2026-06-26

---

## Context

Email ingestion via Microsoft Graph is working end-to-end for normal file attachments. This document covers the two remaining attachment streams that are not yet handled, plus open questions that need answers before implementation starts.

---

## Current State — What Is Already Working

| Area | File | Status |
|---|---|---|
| Monitored mailbox registration | `src/features/outlook/outlook.service.ts` | Done |
| Delta-sync polling (overlap-safe) | `src/features/outlook/outlook.poller.ts` | Done |
| Email body + metadata saved to MongoDB | `outlook.service.ts → ingestEmail()` | Done |
| **Stream 1**: Normal `fileAttachment` → Azure Blob → SAS URL | `outlook.service.ts → stageAttachments()` | Done |
| **Stream 2**: Outlook Reference Attachments → download via Graph shares API → Stage to Azure Blob | `outlook.service.ts → stageAttachments()` | Done |
| AI queue handoff (body + SAS URLs → Azure Service Bus) | `outlook.service.ts → dispatchEmailPackage()` | Done |
| Mailbox → project mapping + AI-proposed projects | `outlook-association.service.ts` | Done |
| Email status lifecycle (PENDING → LINKED → DRAFT → CONFIRMED → DISCARDED) | `db/models/outlook-email.model.ts` | Done |
| SharePoint/OneDrive share-ID encoding utility | `src/shared/utils/graph.ts` | Done (shared) |

> **Note:** We are running on our own test infrastructure currently. All environment variables and Azure resources below reference our test setup. GFS infra will be configured separately once everything is validated.

---

## What Needs to Be Built

### Stream 2 — Outlook Reference Attachments [COMPLETED]

**Problem:** Graph returns three `@odata.type` values on email attachments:
- `#microsoft.graph.fileAttachment` — handled ✅
- `#microsoft.graph.itemAttachment` — intentionally skipped (calendar items, etc.)
- `#microsoft.graph.referenceAttachment` — handled ✅

A reference attachment is a cloud file link (SharePoint/OneDrive) embedded as a formal attachment in Outlook. It has a `sourceUrl` field instead of binary content.

**What was built:**
1. Added `REFERENCE_ATTACHMENT_ODATA_TYPE = '#microsoft.graph.referenceAttachment'` to `outlook.types.ts` ✅
2. Added `sourceUrl` and `name` fields to `GraphMailAttachment` interface ✅
3. In `stageAttachments()` — after the existing `fileAttachment` branch — added a reference attachment branch: ✅
   - Extract `sourceUrl`
   - Reused `encodeShareUrl()` logic from shared util `src/shared/utils/graph.ts`
   - Downloaded via `/shares/{shareId}/driveItem/content`
   - Staged to Azure Blob same as normal attachments
   - Stored `storageKey` + `blobUrl` on the email attachment record
4. Added `isReference: boolean` field to `IOutlookEmailAttachment` model for traceability ✅

**Files changed:**
- `src/shared/utils/graph.ts` (new shared utility)
- `src/features/outlook/outlook.types.ts` — added type constant + extended `GraphMailAttachment`
- `src/features/outlook/outlook.service.ts` — extended `stageAttachments()` & `backfillUnstaged()`
- `src/db/models/outlook-email.model.ts` — added `isReference` & `sourceUrl` fields to `AttachmentSchema`
- `src/repositories/interfaces/i-outlook-email.repository.ts` — updated `IDomainOutlookEmailAttachment`
- `src/repositories/mongoose/outlook-email.repository.ts` — updated `toDomain` mapping
- `tests/unit/features/outlook/outlook.service.test.ts` — added metadata mapping and staging/backfill unit tests

---

### Stream 3 — Body URL Extraction + Cloud Link Resolver

**Problem:** `dispatchEmailPackage()` sends `bodyHtml` raw to the AI queue. URLs embedded in the email body (Dropbox links, Google Drive links, SharePoint links pasted as text, etc.) are not extracted, classified, or resolved. They are invisible to GFS unless the AI happens to mention them.

**What to build (in order):**

#### Step 1 — `cloud_link_asset` Model (MongoDB)
New Mongoose model to track every cloud link detected from an email.

```
Fields:
  emailId           ObjectId (ref OutlookEmail)
  projectId         ObjectId | null
  originalUrl       string
  normalizedUrl     string
  provider          enum: SHAREPOINT | ONEDRIVE | GOOGLE_DRIVE | DROPBOX | GENERIC | UNKNOWN
  linkText          string | null   (anchor text or button label)
  sender            string
  subject           string
  receivedAt        Date
  status            enum: DETECTED | RESOLVING | DOWNLOADED | ACCESS_REQUIRED
                          | EXPIRED | FAILED_SECURITY_CHECK | MANUAL_UPLOAD_REQUIRED
  storageKey        string | null   (Azure Blob key after successful download)
  blobUrl           string | null
  documentId        ObjectId | null (ref Document after ingestion)
  firstSeenAt       Date
  lastCheckedAt     Date | null
  retryCount        number (default 0)
  errorMessage      string | null
  auditLog          Array<{ action, timestamp, detail }>
```

#### Step 2 — URL Extractor
Parse `bodyHtml` and `bodyText` from ingested email:
- Extract `href` values from `<a>` tags
- Extract visible URLs from plain text (regex)
- Deduplicate
- Filter out internal/tracking URLs (unsubscribe links, mail client assets, etc.)

Call this from `ingestEmail()` after saving the email, before `dispatchEmailPackage()`.

#### Step 3 — Provider Classifier
Map each extracted URL to a provider:
- SharePoint: `*.sharepoint.com`, `*.sharepoint.com/sites/...`
- OneDrive: `onedrive.live.com`, `1drv.ms`
- Google Drive: `drive.google.com`, `docs.google.com`, `sheets.google.com`, `slides.google.com`
- Dropbox: `dropbox.com`, `www.dropbox.com/sh/...`, `dl.dropboxusercontent.com`
- Generic: any other HTTP/HTTPS URL
- Unknown: anything else

#### Step 4 — Per-Provider Resolvers

**SharePoint / OneDrive (reuse existing Graph infra):**
- Normalize URL → encode to Graph share ID (same `encodeShareUrl()` already in Teams)
- Call `/shares/{shareId}/driveItem` to check if it's a file or folder
- File → download binary → quarantine → stage to Blob → ingest
- Folder → list children via `/shares/{shareId}/driveItem/children` → apply depth/count limits → download each

**Google Drive:**
- Extract file/folder ID from URL patterns (`/d/{id}`, `?id={id}`, `/folders/{id}`)
- Call Google Drive API `files.get` with `fields=id,name,mimeType,capabilities`
- Check `capabilities.canDownload` before attempting
- Google Docs/Sheets/Slides → export to PDF/DOCX/XLSX via `files.export`
- Regular files → download via `files.get?alt=media`
- Folders → `files.list` with `'{id}' in parents`, apply depth/count limits

**Dropbox:**
- Detect shared links (`dropbox.com/s/`, `/sh/`, `/scl/`)
- Public links → Dropbox shared-link API (`/2/sharing/get_shared_link_metadata`)
- Check `link_permissions.can_download`
- Files → download via `/2/sharing/get_shared_link_file`
- Folders → `/2/sharing/list_shared_link_files` with pagination + limits

**Generic URL:**
- HTTP HEAD first → check `Content-Type` and `Content-Length`
- If safe MIME type and within size limit → GET and download
- Follow redirects (max 5 hops)
- Reject: login pages (detect via redirect to auth URL), unknown binary, suspicious domains
- Apply domain denylist check before any request

#### Step 5 — Security Sandbox
Every downloaded file (from any provider) must pass through before ingestion:
1. File size check (reject > configured max, e.g. 250MB)
2. Extension + MIME type validation (allow list only)
3. **Malware scan** — see open question below
4. Only after passing all checks → move to document ingestion pipeline

#### Step 6 — Folder Handling Rules
```
MAX_FOLDER_DEPTH      = 3        (configurable via env)
MAX_FILES_PER_FOLDER  = 50       (configurable via env)
SUPPORTED_EXTENSIONS  = .pdf, .docx, .dwg, .jpg, .jpeg, .png, .txt, .zip
MAX_FILE_SIZE_MB      = 250
```
Partial folder failures: log per-file error, continue remaining files, mark link status as `DOWNLOADED` (partial) with error detail in `auditLog`.

#### Step 7 — Link Lifecycle
- `firstSeenAt` set on creation
- `lastCheckedAt` updated on every resolve attempt
- Retry policy: exponential backoff, max 5 retries, then `MANUAL_UPLOAD_REQUIRED`
- On status `EXPIRED`: flag in UI, preserve `originalUrl`, do not delete record
- Once downloaded: snapshot is stored in Blob; original URL preserved regardless

---

## Infrastructure Requirements

### Already Available (Test Infra)
| Resource | Variable | Notes |
|---|---|---|
| Azure AD app (Outlook) | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID` | Configured |
| Microsoft Graph | `OUTLOOK_GRAPH_BASE_URL` | Working |
| Azure Blob Storage | `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER_NAME` | Working |
| Azure Service Bus | `AZURE_SERVICE_BUS_CONNECTION_STRING`, `AZURE_SERVICE_BUS_AI_QUEUE_NAME` | Working |
| MongoDB | `MONGODB_URI` | Working |

### Permissions Needed — Questions for Infra Team

#### Microsoft Graph (Azure AD App — Outlook app registration)
The current app has `Mail.Read` and `Files.Read.All` (application permissions). For reference attachment download via Graph shares API:

| Permission | Type | Why Needed | Have It? |
|---|---|---|---|
| `Files.Read.All` | Application | Read SharePoint/OneDrive files via `/shares/{id}/driveItem` | **Confirm** |
| `Sites.Read.All` | Application | Needed if SharePoint site enumeration is required for folder links | **Request** |

> **Question for Infra:** Does the current Outlook Azure AD app registration have `Files.Read.All` and `Sites.Read.All` granted? These are needed for Stream 2 reference attachments and Stream 3 SharePoint body links. Tenant admin consent is required for application permissions.

#### Google Drive API (New — not configured)
| Item | Detail |
|---|---|
| GCP Project | Need a GCP project with Drive API enabled |
| Auth approach | Service account (app-to-app) OR OAuth2 per-user — **decision needed** |
| Scope | `https://www.googleapis.com/auth/drive.readonly` |
| New env vars | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_KEY` |

> **Question for Infra:** Should Google Drive use a service account (requires Workspace domain-wide delegation, only works for our own org's Drive) or user OAuth2 (works for any sender's shared link but requires a consent flow)? For an estimating system receiving external client emails, **user OAuth2 per connector is likely the right model** — but this needs a product decision.

#### Dropbox API (New — not configured)
| Item | Detail |
|---|---|
| Dropbox App | Need a Dropbox app registered at dropbox.com/developers |
| Auth approach | App key/secret for public shared links (no auth needed for public); OAuth2 for team/private links |
| Scope | `sharing.read`, `files.content.read` |
| New env vars | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` |

> **Question for Infra:** Public Dropbox shared links work without auth. For private/team links, OAuth2 is required. Do we need to support private Dropbox links from clients, or only public shared links?

#### Malware Scanning — **Decision Required**

> **Open Question:** What do we use for malware scanning?

Options:

| Option | Pros | Cons | Cost |
|---|---|---|---|
| **ClamAV** (self-hosted) | Free, open source, no data leaves our infra | Needs a container/VM to run, slower signature updates, ops overhead | Infra cost only |
| **VirusTotal API** | Best detection rates, easy integration, no infra to run | Files sent to third party (privacy concern for client documents), rate limits on free tier | Free (limited) / paid |
| **Windows Defender via REST** | Already available if running on Azure VMs with Defender | Not suitable as a scanning API in a Node.js service | N/A |
| **Azure Defender for Storage** | Scans blobs automatically on upload, no code change needed, native Azure integration | Async — scan result is not immediate (event-driven), needs Azure Defender for Storage plan | ~$0.009/GB scanned |

**Recommendation for our test infra now:** Run **ClamAV in a Docker container** alongside the backend (`docker-compose` addition). Scan before staging to Blob.  
**For GFS production infra:** Switch to **Azure Defender for Storage** — zero-code-change, scans every blob automatically, fits their Azure-first infrastructure.

> **Question for Infra (test server):** Can we add a ClamAV container to docker-compose on the test server? Or is there a preferred scanning tool already in use?

---

## Open Design Decisions (Need Product/Team Input)

| # | Question | Options | Impact |
|---|---|---|---|
| 1 | Google Drive auth model | Service account vs. OAuth2 per user | Affects which Drive links we can resolve |
| 2 | Dropbox private links | Support or not | Scope of Dropbox connector |
| 3 | Malware scanner choice | ClamAV / VirusTotal / Azure Defender | Security posture, ops overhead |
| 4 | Generic URL handler | Enable or disable by default | Risk surface area |
| 5 | Folder download behavior | Silent skip unsupported files vs. fail entire folder | UX of partial failures |
| 6 | Link retry on expiry | Auto-flag as expired vs. notify project owner | Workflow design |

---

## Questions for CEO / Product Owner

These are decisions that cannot be made at the engineering level — they affect product scope, client commitments, legal exposure, and budget. Answers to these unblock the design before a single line of code is written for Stream 3.

---

### 1. Scope — Which providers must we support at launch?

> Google Drive, Dropbox, and generic URLs each add 1.5–3 weeks of work individually. SharePoint/OneDrive is free because we already have the Microsoft Graph infra.

**Why this matters:** If clients primarily use SharePoint and Dropbox, we can skip Google Drive for v1 and save 3 weeks. Building all three at once without knowing client usage is wasted effort.

**Question:** Which cloud storage providers do our current and prospective clients actually use when sending documents? Can you check with the sales/estimating team what they see most often in client emails?

---

### 2. Legal / Compliance — Are we allowed to download and store client cloud files automatically?

> When a client emails a Dropbox link, auto-downloading that file and storing it in our Azure Blob means we are pulling data from their storage without an explicit "download" action by the user.

**Why this matters:** Some clients — especially in construction and government — have data governance policies. Automatically pulling files from their cloud storage without an explicit consent mechanism could be a problem in contracts or audits.

**Question:** Do we need explicit client consent (e.g. a checkbox in the project settings: "Allow GFS to auto-download linked files") before we pull from external cloud storage? Or is the act of emailing the link considered consent?

---

### 3. What happens when auto-download fails — who is responsible?

> When a Dropbox link expires, or a Google Drive file becomes inaccessible, the estimator may not realise a document was never received. The system will show "Access Required" but someone has to act on it.

**Why this matters:** This is a workflow and accountability question, not just a UI one. If no one is notified, failed cloud links become silent data gaps in estimates.

**Question:** When a cloud link cannot be resolved (expired, permission denied, etc.), who gets notified — the estimator, the project owner, or the person who sent the email? Is an in-app notification enough, or do we need an email alert?

---

### 4. Priority vs. other Outlook work — is this Stream 3 or is something else more urgent?

> Stream 2 (reference attachments) is 2–3 days and clearly worth doing now. Stream 3 (body URL extraction + cloud link resolver) is 8–10 weeks of work.

**Why this matters:** If there are other Outlook features (e.g. reply tracking, calendar integration, better project matching) that clients are asking for more urgently, Stream 3 could wait.

**Question:** From a client/sales perspective, is the inability to auto-download Dropbox/Drive links from emails a pain point clients have specifically mentioned? Or is this a proactive feature we are building ahead of demand?

---

### 5. Data retention — how long do we keep downloaded cloud files?

> Once we download a file from a client's Google Drive or Dropbox, we store a snapshot in Azure Blob. If the client later updates that file in their Drive, we have an old copy. If the project is closed, do we delete it?

**Why this matters:** Storage costs, GDPR/privacy obligations, and version confusion if the client updates the source file after we've snapshotted it.

**Question:** What is the retention policy for documents ingested from external cloud links? Should we keep them as long as the project exists, or apply the same retention as manually uploaded documents?

---

### 6. Generic URL handler — is this in or out of scope?

> The generic URL handler attempts to download any HTTP/HTTPS link found in an email body. This is useful (e.g. a client pastes a direct download link to a PDF on their website) but also the highest security risk — it hits arbitrary external URLs.

**Why this matters:** A wrong decision here is either a security hole (if too permissive) or a gap in functionality (if disabled). This needs an explicit product call, not an engineering default.

**Question:** Should GFS ever attempt to auto-download from a generic URL in an email body, or should non-SharePoint/Drive/Dropbox links always be flagged as "Manual Upload Required" without attempting a download?

---

### 7. Client-facing visibility — do clients see that their cloud links are being accessed?

> When we download a file from a client's Dropbox or Google Drive, the access is logged in their Dropbox/Drive activity log. The client can see "GFS app downloaded your file."

**Why this matters:** This could be surprising to clients who didn't expect automated access. It could also be reassuring (proof we received the file). Either way, it should be a deliberate product decision.

**Question:** Should we inform clients (in the project portal or email acknowledgement) when we successfully auto-downloaded a cloud file they linked? Or is silent download the preferred UX?

---

## Implementation Order

| Priority | Task | Effort | Blocks |
|---|---|---|---|
| 1 | Stream 2: reference attachment handling in `stageAttachments()` | **Done** ✅ | Nothing |
| 2 | `cloud_link_asset` model + URL extractor from email HTML | 1 week | Nothing |
| 3 | Provider classifier | 2 days | Step 2 |
| 4 | SharePoint/OneDrive resolver (reuse Teams Graph logic) | 1 week | Steps 2–3, Graph permissions confirmed |
| 5 | Security sandbox (ClamAV on test infra) | 1 week | ClamAV on test server |
| 6 | Google Drive connector | 2–3 weeks | GCP project + auth decision |
| 7 | Dropbox connector | 1.5 weeks | Dropbox app registered |
| 8 | Generic URL handler | 1 week | Steps 2–3, 5 |
| 9 | Link lifecycle (retry scheduler, expiry detection) | 1 week | Steps 2–4 |

**Total estimate:** ~11–12 weeks solo. Start Priority 1 immediately — no blockers, reuses existing code.

---

## Notes

- All cloud link records preserve `originalUrl` regardless of download success or failure.
- Even if auto-download fails, the link remains visible in the project workspace as an actionable item.
- We do **not** scrape login-protected pages, use server-side browser sessions, or bypass password restrictions.
- Every download/failure is recorded in `auditLog` on the `cloud_link_asset` record.
- Test infra and GFS production infra will have separate env vars and Azure resource configurations — no shared secrets.
