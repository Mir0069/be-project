# Implementation Plan - Per-Provider Resolvers + Sandbox + Folder Rules (Steps 4 to 6)

This plan details the implementation of Step 4 (Dropbox + SharePoint/OneDrive Resolvers), Step 5 (Security Sandbox), and Step 6 (Folder Handling Rules) of Stream 3.

## What we need from GFS Backend Deployment (Infra Team)

To ensure the GFS backend can authenticate and download files from shared SharePoint/OneDrive and Dropbox links, the following credentials, permissions, and environment variables should be configured:

> [!IMPORTANT]
> **1. SharePoint / OneDrive (Microsoft Entra ID App Registration)**
> The Azure AD App registration used by Outlook (configured via `OUTLOOK_CLIENT_ID`) must be granted the following **Application** API permissions in the Microsoft Graph portal (with **Admin Consent**):
> - `Files.Read.All` (required to resolve share IDs and read document contents)
> - `Sites.Read.All` (required to read metadata from SharePoint document libraries)
>
> **2. Dropbox (Dropbox Developer Console)**
> - **App Permissions (Scopes):** The Dropbox App must be configured with the `sharing.read` scope (grants access to read public/shared links and list shared folders).
> - **Access Token:** Provide the generated token as the `DROPBOX_ACCESS_TOKEN` environment variable on the GFS backend.
>
> **3. Optional Configuration Environment Variables (Can be configured directly on the GFS backend environment; defaults are applied if omitted):**
> - `CLOUD_LINKS_MAX_FOLDER_DEPTH` (Default: `3` — limits recursion depth on folder links)
> - `CLOUD_LINKS_MAX_FILES_PER_FOLDER` (Default: `50` — caps total downloads per folder link)
> - `CLOUD_LINKS_MAX_FILE_SIZE_MB` (Default: `250` — rejects individual files larger than this)
> - `CLOUD_LINKS_SUPPORTED_EXTENSIONS` (Default: `.pdf,.docx,.dwg,.jpg,.jpeg,.png,.txt,.zip`)

---

## What we need from the AI Team

Since the GFS Backend does the heavy lifting of extracting, authenticating, and downloading the cloud links, here is all that is required from the AI Team:

> [!IMPORTANT]
> **1. No Provider API Credentials Required**
> The AI team does **NOT** need to configure Dropbox API keys or Microsoft Graph tokens. They do not need to implement any custom file-downloading logic for these providers.
>
> **2. Standard Attachments Queue Integration**
> All resolved cloud link files (including individual files inside shared folders) will be appended to the `attachments` array in the standard `EMAIL_PROPOSAL` message. The AI team simply downloads them using the pre-signed SAS `downloadUrl` just like normal attachments:
> ```json
> {
>   "originalName": "staged_file.pdf",
>   "mimeType": "application/pdf",
>   "size": 124500,
>   "storageKey": "documents/staging/...",
>   "downloadUrl": "https://gfssa.blob.core.windows.net/...SAS_TOKEN"
> }
> ```
>
> **3. Stop parsing raw URLs in email bodies**
> The AI team can stop attempting to parse and extract Dropbox, SharePoint, or OneDrive links from the raw email bodies, as the GFS backend will have already resolved, validated, and appended them.

---

## User Review Required

> [!IMPORTANT]
> **AI Review Flow Integration (Synchronized Resolution)**
> To ensure the AI has access to the resolved cloud files (SharePoint documents, Dropbox folders, etc.) when deciding to link to an existing project or create a new one:
> 1. **Resolve Before Dispatch:** Outlook email ingestion will extract and resolve cloud links *before* calling `dispatchEmailPackage()`.
> 2. **Append to Package:** Any files successfully resolved and staged to Azure Blob will be automatically appended to the `attachments` array of the `IEmailPackageBundle` sent to the AI queue.
> 3. **AI Proposal Context:** The AI will receive a single unified queue message containing the email body, the standard attachments, and all resolved cloud files.
>
> **Stream-Based Ingestion (Production Performance)**
> Files will be streamed directly from Microsoft Graph or Dropbox to Azure Blob Storage using `blobStorage.putStream()`, completely bypassing Node.js memory buffers.
>
> **Dropbox Access Token Configuration**
> Dropbox APIs (even for public shared links) require a Bearer token. We will expose `DROPBOX_ACCESS_TOKEN` in `env.ts`. If it is not configured, the Dropbox resolver will fail gracefully (marking the asset as `FAILED` and logging the missing token error in the audit log) without crashing the application.
>
> **Malware Scanning via Azure Defender**
> The malware scanning step will run via **Azure Defender** (currently being implemented by another team member). In this phase, we will implement a stub function `scanForMalware(buffer: Buffer): Promise<boolean>` that logs the scan event and returns `true`, allowing easy integration with the Azure Defender service later.

---

## Open Questions

> [!NOTE]
> **1. Handling of Supported Extensions vs MIME Types**
> Some cloud providers return generic MIME types (like `application/octet-stream`) for binary files. We will validate files by checking if their file extension is within the `SUPPORTED_EXTENSIONS` array. 
> 
> **2. Background Ingestion Context**
> Ingested documents will be linked to the Outlook email in their metadata: `metadata: { source: 'outlook', emailId: <emailId>, messageId: <messageId> }`. This allows the dispatcher to query and retrieve all resolved files for packaging.

---

## Proposed Changes

### Component 1: Configuration

#### [MODIFY] [env.ts](file:///e:/GFS/GFS-backend/src/config/env.ts)
- Add configurations for Dropbox and Cloud Link resolution limits under `env`:
  ```typescript
  dropbox: {
    accessToken: optionalEnv('DROPBOX_ACCESS_TOKEN', ''),
  },
  cloudLinks: {
    maxFolderDepth: parseInt(optionalEnv('CLOUD_LINKS_MAX_FOLDER_DEPTH', '3'), 10),
    maxFilesPerFolder: parseInt(optionalEnv('CLOUD_LINKS_MAX_FILES_PER_FOLDER', '50'), 10),
    maxFileSizeMb: parseInt(optionalEnv('CLOUD_LINKS_MAX_FILE_SIZE_MB', '250'), 10),
    supportedExtensions: optionalEnv(
      'CLOUD_LINKS_SUPPORTED_EXTENSIONS',
      '.pdf,.docx,.dwg,.jpg,.jpeg,.png,.txt,.zip'
    ).split(',').map(ext => ext.trim().toLowerCase()),
  }
  ```

---

### Component 2: Document Ingestion Pipeline Extension

#### [MODIFY] [document-ingestion.service.ts](file:///e:/GFS/GFS-backend/src/features/document-ingestion/document-ingestion.service.ts)
- Create a new public method `ingestStagedFile` in `DocumentIngestionPipeline` that creates a `DocumentRecord` directly using metadata from a pre-staged file:
  ```typescript
  public async ingestStagedFile(
    ctx: AuthContext,
    input: {
      projectId: string | null;
      originalName: string;
      mimeType: string;
      storageKey: string;
      blobUrl: string;
      sha256: string;
      byteSize: number;
      uploadedBy: string;
      documentType: DocumentTypeTag;
      metadata?: Record<string, string | number | boolean | null>;
    }
  ): Promise<DocumentRecord>;
  ```

---

### Component 3: Resolvers and Security Sandbox

#### [MODIFY] [cloud-link.service.ts](file:///e:/GFS/GFS-backend/src/services/cloud-link.service.ts)
- Implement `extractAndResolveLinks(...)` and `resolveLink(...)`:
  - **`extractAndResolveLinks(options, graphClient): Promise<void>`**:
    Extracts links, normalizes them, and resolves each provider link synchronously (using streams) to ensure they are downloaded prior to email dispatch.
  - **`resolveLink(assetId, graphClient): Promise<void>`**:
    Orchestrates the lifecycle for a single link asset: updates status to `RESOLVING`, calls the corresponding provider resolver (SharePoint/OneDrive or Dropbox), runs pre-download Sandbox validation, streams to Azure Blob using `blobStorage.putStream()`, and registers the document via the pipeline.
  - **`resolveSharePointOneDrive(...)`**:
    Encodes URL to Graph share ID. Checks if file or folder. Checks size/extension, streams file content, lists folder children up to `maxFolderDepth`, and downloads each.
  - **`resolveDropbox(...)`**:
    Queries Dropbox shared link metadata. Checks permissions, size, and extension. Streams files directly via `/2/sharing/get_shared_link_file`, or lists folder contents recursively with pagination up to limits.
  - **`preDownloadSandboxCheck(fileName: string, fileSize: number): void`**:
    Enforces maximum size (250MB), allowed extensions list *before* starting actual download stream.
  - **`postDownloadSandboxCheck(bufferStub: Buffer): Promise<void>`**:
    Calls Azure Defender stubbed malware check.
  - **`scanForMalware(buffer: Buffer): Promise<boolean>`**:
    Azure Defender Stub function (always returns `true`).

---

### Component 4: Integration into Outlook Service Ingestion

#### [MODIFY] [outlook.service.ts](file:///e:/GFS/GFS-backend/src/features/outlook/outlook.service.ts)
- Update `ingestEmail` to trigger `cloudLinkService.extractAndResolveLinks()` before calling `dispatchEmailPackage()`:
  ```typescript
  try {
    if (this.cloudLinkService) {
      await this.cloudLinkService.extractAndResolveLinks({
        emailId: stored.id,
        projectId: stored.projectId,
        bodyHtml,
        bodyText,
        sender: stored.fromAddress || 'unknown',
        subject: stored.subject || 'No Subject',
        receivedAt: stored.receivedDateTime,
      }, this.graphClient);
    }
  } catch (err) {
    console.error(`[OutlookService] Failed to resolve cloud links:`, err);
  }
  ```
- Update `dispatchEmailPackage()` to query and include successfully resolved cloud files from MongoDB `Document` collection in the email package attachments array.

---

## Verification Plan

### Automated Tests
- Extend [`cloud-link.service.test.ts`](file:///e:/GFS/GFS-backend/tests/unit/features/cloud-link/cloud-link.service.test.ts) to verify:
  - Security Sandbox rules (file size exceeding 250MB, unsupported extensions block, malware stub execution).
  - SharePoint/OneDrive file resolver and folder child traversal (mocking Graph API responses).
  - Dropbox file resolver and folder child pagination (mocking Dropbox API responses).
  - Proper state transitioning (`RESOLVING` -> `DOWNLOADED` or `ACCESS_REQUIRED` or `FAILED`).
  - Handling of partial folder failures (continues processing and records error details in audit log).

Run tests:
```powershell
npm run test tests/unit/features/cloud-link/cloud-link.service.test.ts
```
