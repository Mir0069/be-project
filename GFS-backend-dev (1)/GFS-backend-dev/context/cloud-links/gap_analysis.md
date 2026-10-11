# Gap Analysis — Cloud Link Ingestion & Notifications

After cross-referencing the walkthrough against the actual implementation in `outlook.service.ts` and `cloud-link.service.ts`, here is the status.

---

## ✅ What IS Covered

### Cloud Link Ingestion (Stream 3 — Body URLs)

| Scenario | Covered? | How |
|---|---|---|
| Dropbox **file** link in body | ✅ | `resolveDropbox()` downloads file stream → blob → `ingestStagedFile()` |
| Dropbox **folder** link in body | ✅ | `resolveDropbox()` downloads folder as ZIP → streaming unzip → each file staged |
| SharePoint/OneDrive **file** link in body | ✅ | `resolveSharePointOneDrive()` downloads via Graph `/shares/{id}/driveItem/content` |
| SharePoint/OneDrive **folder** link in body | ✅ | Downloads as ZIP stream → recursive unzip → each child file staged |
| Nested `.zip` inside folders | ✅ | Recursive `extractEntry()` detects `.zip` and pipes into secondary parser |
| Unsupported file extensions blocked | ✅ | `preDownloadSandboxCheck()` and extension check in folder extraction |
| Unsupported providers (Google Drive, etc.) | ✅ | Marked `MANUAL_UPLOAD_REQUIRED` immediately |

### Reference Attachment Ingestion (Stream 2 — Outlook Attachments)

| Scenario | Covered? | How |
|---|---|---|
| Regular file attachment (binary) | ✅ | `stageOne()` downloads bytes via Graph → uploads to blob |
| Reference attachment — **file** | ✅ | `stageOneReference()` checks `isFolder=false`, downloads via Graph shares API |
| Reference attachment — **folder** | ✅ | `stageOneReference()` checks `isFolder=true`, streams ZIP → recursive unzip |
| Reference attachment — missing `sourceUrl` | ✅ | Skipped with warning log (Graph v1.0 doesn't return sourceUrl) |
| Backfill retries for failed staging | ✅ | `backfillUnstaged()` retries up to `MAX_STAGE_ATTEMPTS` |
| `FOLDER_STAGED` attachments excluded from dispatch | ✅ | `dispatchEmailPackage()` skips `storageKey === 'FOLDER_STAGED'` |
| Extracted folder children included in dispatch | ✅ | `dispatchEmailPackage()` queries `DocumentModel.find({ 'metadata.emailId': email.id, status: 'STAGING' })` |

### Notification Coverage

| Scenario | Notification Sent? | How |
|---|---|---|
| Cloud link in body → unsupported provider | ✅ | `notifyCloudLinkFailed()` with failed URLs |
| Cloud link in body → auth/permission error | ✅ | `resolveLink()` sets `ACCESS_REQUIRED` → picked up by refreshed status check → `notifyCloudLinkFailed()` |
| Cloud link in body → download error (max retries) | ✅ | After 5 retries → `MANUAL_UPLOAD_REQUIRED` → `notifyCloudLinkFailed()` |
| Cloud link in body → transient error (first few tries) | ✅ | Caught, added to `failedLinks` → notification emitted |

---

## ⚠️ Gaps Fixed

### Gap 1: No Notification for Failed Reference Attachment Staging
* **Fixed** ✅: Any reference attachment that fails to stage (e.g. OneDrive link expired) is now caught, merged into `failedLinks`, and a notification is sent to the Sales Manager via `notifyCloudLinkFailed()`.

### Gap 2: No Notification for Individual File Failures Inside a Folder
* **Fixed** ✅: File failures within folder unzipping are tracked in a list. In `ingestEmail()`, a warning is added to the notification details specifying which files could not be staged (e.g. `"Folder partially extracted — 3 file(s) could not be staged: doc.docx"`).

---

## Summary

| Area | Status |
|---|---|
| Dropbox file/folder download | ✅ Fully covered |
| SharePoint/OneDrive file/folder download | ✅ Fully covered |
| Recursive nested ZIP extraction | ✅ Fully covered |
| Reference attachment file staging | ✅ Fully covered |
| Reference attachment folder staging | ✅ Fully covered |
| Body URL notification on failure | ✅ Fully covered |
| Reference attachment failure notification | ✅ Fully covered |
| Partial folder extraction notification | ✅ Fully covered |
| Unsupported provider notification | ✅ Fully covered |
| Backfill retry mechanism | ✅ Fully covered |
| `FOLDER_STAGED` dispatch exclusion | ✅ Fully covered |
| Folder child documents in dispatch | ✅ Fully covered |
