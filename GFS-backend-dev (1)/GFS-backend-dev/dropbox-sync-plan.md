# Dropbox Folder Creation and Project Synchronization Plan (2-Way Sync)

This plan details how we will implement a robust **2-way sync** between GFS and Dropbox for approved projects. This ensures that files uploaded in GFS (from Outlook, Teams, or Manual Uploads) are automatically uploaded to Dropbox, and files uploaded directly to Dropbox are automatically imported into GFS.

---

## Infrastructure and Dropbox App Requirements

To enable folder creation and file uploads/downloads, the GFS application needs a registered Dropbox App with specific permissions. 

> [!WARNING]
> **Dropbox App Status & Required Actions**:
> The credentials (`DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, and `DROPBOX_REFRESH_TOKEN`) are already present in the `.env` file and connection was verified. However, the app (ID: `7565587`) **lacks write permissions**.
> 
> The owner of the app (**Pradeep Kalsaria**) must perform the following actions:
> 1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) and select the app `7565587`.
> 2. Go to the **Permissions** tab, check the box for **`files.content.write`**, and save changes.
> 3. Re-generate the `DROPBOX_REFRESH_TOKEN` (since scope changes require a new token) using the authorization code exchange flow.
> 4. Update the `DROPBOX_REFRESH_TOKEN` in the `.env` file.

### 1. App Configuration Check list
* **Dropbox Client ID (`DROPBOX_CLIENT_ID`)**: Configured in `.env`.
* **Dropbox Client Secret (`DROPBOX_CLIENT_SECRET`)**: Configured in `.env`.
* **Dropbox Refresh Token (`DROPBOX_REFRESH_TOKEN`)**: Configured in `.env` (needs regeneration for write scopes).
* **Dropbox Root Path (`DROPBOX_ROOT_PATH`)**: Defaults to `"/GFS Projects"`.

### 2. Generating the New Refresh Token (Instructions for App Owner)
1. Open this URL in your browser:
   `https://www.dropbox.com/oauth2/authorize?client_id=8n63zfo5o3itxpc&token_access_type=offline&response_type=code`
2. Authorize the app and copy the temporary code.
3. Exchange the code for a permanent refresh token by running this command in a terminal:
   ```bash
   curl https://api.dropbox.com/oauth2/token \
     -d code=<AUTHORIZATION_CODE> \
     -d grant_type=authorization_code \
     -u 8n63zfo5o3itxpc:x3ayj35j066adpn
   ```
4. Update the `DROPBOX_REFRESH_TOKEN` value in `.env` with the new token.

---

## Dropbox Folder Structure & Document Mapping

When a project is approved, GFS will create the root folder: `/GFS Projects/Project Name - PRJ-YYYY-XXXX` and exactly three subfolders:
1. **`/Customer Provided Info & Project drawings`**
2. **`/Worksheets and quotes`**
3. **`/Telephone Transcripts`**

### Document Mapping Rules:
* **Drawings Category**: Files inside `/Customer Provided Info & Project drawings` map to **`drawing`** in GFS (and any fallback categories like `spec` or `photo` will also go here).
* **Quotes Category**: Files inside `/Worksheets and quotes` map to **`quote`** in GFS.
* **Transcripts Category**: Files inside `/Telephone Transcripts` map to **`transcript`** in GFS (from MS Teams or manual uploads of other meeting providers like Zoom/Google Meet/Webex).
* **Fallback for Other GFS File Types**: Files with other GFS categories (like `spec`, `photo`, `other`) will map to the `/Customer Provided Info & Project drawings` folder in Dropbox during outward sync.
* **User-Created Folders**: If a user manually creates any other subfolder directly inside Dropbox, its contents will import into the **`other`** (general) category in GFS.

---

## Stress-Test & Performance Analysis (1GB+ Files)

To evaluate how GFS handles high-load scenarios (e.g. multiple 1 GB files arriving simultaneously from Mail, Teams, Dropbox, and Manual uploads) under a **8GB RAM server capacity**, we have established the following architectural constraints:

1. **Manual Upload Guardrails (Synchronous Web Request)**:
   - Manual uploads through the estimator web UI are capped at **250 MB** via the `multer` configuration (`limits: { fileSize: 250MB }`).
   - Large customer files (> 250MB) should instead be dropped directly in **Dropbox** or sent via **Mail/Teams**, where they are processed asynchronously in the background.

2. **Background Ingestion Memory Footprint**:
   - GFS uses **Node.js Streams** to pipeline chunks of data (64KB blocks) from the source API directly to Azure Blob Storage.
   - The server never holds the full 1 GB file in memory. Peak memory usage remains at **10–20MB of RAM** total.

3. **Sequential Sync Queue**:
   - During 2-way sync, file uploads/downloads are processed **sequentially (one by one)** rather than in parallel. This keeps CPU and RAM usage flat.

4. **Transfer Speeds & Time Estimates (Cloud-to-Cloud)**:
   - **Average Speed (20 MB/s)**: Syncing a 1 GB file takes **~50 seconds**. Total time for 4 GB of files is **~3.3 minutes**.
   - **High-Speed (50 MB/s)**: Syncing a 1 GB file takes **~20 seconds**. Total time for 4 GB of files is **~1.3 minutes**.

5. **Resilient Upload Resuming**:
   - GFS uploads files in 4MB chunks using the Dropbox Session Upload API. If the connection fails at 800MB, GFS resumes uploading from the 201st chunk (800MB mark) rather than re-uploading the whole 1 GB.

---

## 2-Way Sync Design

We use a loop-prevention **reconciliation mechanism** based on MongoDB metadata:

1. **Loop Prevention using `metadata`**:
   Every document in GFS will have two metadata fields in MongoDB:
   - `metadata.dropboxPath`: The absolute path of the file in Dropbox (e.g., `/GFS Projects/Project Name - PRJ-2026-0001/Customer Provided Info & Project drawings/plan.pdf`).
   - `metadata.syncedToDropbox`: A boolean flag indicating that the file is synced and present in Dropbox.

2. **Outward Sync (GFS $\rightarrow$ Dropbox)**:
   - Query all project documents in MongoDB where `isDeleted: false`, `status: { $in: ['PROCESSED', 'STAGING'] }`, and `metadata.syncedToDropbox` is not `true`.
   - Download the file stream from Azure Blob Storage and upload it to the corresponding Dropbox project subfolder.
   - Mark `metadata.syncedToDropbox = true` and `metadata.dropboxPath` in MongoDB.

3. **Inward Sync (Dropbox $\rightarrow$ GFS)**:
   - Recursively list files in `/GFS Projects/<ProjectName> - <ProjectRef>`.
   - Check if a Document already exists in MongoDB with matching `metadata.dropboxPath`. If yes, skip it.
   - If new, download file stream from Dropbox, upload to Azure Blob Storage, and stage it in MongoDB with `metadata.dropboxPath = <dropbox_path>` and `metadata.syncedToDropbox = true`.

4. **Detailed Inbound Email Flow (Outlook $\rightarrow$ GFS $\rightarrow$ Dropbox)**:
   - Email attachments are staged (status: `STAGING`, `projectId: null`).
   - Upon draft project approval, GFS creates the project and links the documents (status: `PROCESSED`).
   - GFS immediately creates the Dropbox folder structure and runs an **immediate Outward Sync** to push these email attachments to Dropbox.

---

## Proposed Changes

### Component 1: Dropbox Utility Enhancements (Backend)
- Modify [dropbox.ts](file:///e:/GFS/GFS-backend/src/shared/utils/dropbox.ts):
  - `createDropboxFolder(path, token)`
  - `listDropboxPath(path, token)`
  - `downloadDropboxFileByPath(path, token)`
  - `uploadDropboxFileByPath(path, stream, fileSize, token)` (Uses Chunked Uploads for files >= 15MB).

### Component 2: Project Model & Repository (Backend)
- Modify [project.model.ts](file:///e:/GFS/GFS-backend/src/db/models/project.model.ts), [i-project.repository.ts](file:///e:/GFS/GFS-backend/src/repositories/interfaces/i-project.repository.ts), and [project.repository.ts](file:///e:/GFS/GFS-backend/src/repositories/mongoose/project.repository.ts):
  - Add and map `dropboxFolderPath` (type `String`, default `null`).

### Component 3: Folder Creation on Approval (Backend)
- Modify [project-creation.service.ts](file:///e:/GFS/GFS-backend/src/features/project-creation/project-creation.service.ts):
  - In `provisionStorage`, create Dropbox folder `/GFS Projects/${project.projectName} - ${project.referenceNumber}` along with its 3 subfolders, save `dropboxFolderPath`, and trigger immediate Outward Sync.

### Component 4: Sync Service, Scheduler, and Endpoints (Backend)
- Create `DropboxSyncService` in `src/features/projects/dropbox-sync.service.ts` for inward/outward reconciliation and periodic poller (every 30 mins).
- Register `POST /:projectId/sync-dropbox` in [projects.router.ts](file:///e:/GFS/GFS-backend/src/features/projects/projects.router.ts) and controller [projects.controller.ts](file:///e:/GFS/GFS-backend/src/features/projects/projects.controller.ts).

### Component 5: Frontend UI integration (Frontend)
- Modify [documentSource.ts](file:///e:/GFS/GFS-frontend/src/features/estimator/workspace/utils/documentSource.ts) to support the `dropbox` source badge.
- Add a "Sync Dropbox" button on the project documents page.

---

## Development Timeline (1-Week Solo Developer Target)
- **Day 1**: Core Dropbox utilities (Component 1) + Database updates (Component 2).
- **Day 2**: Automated folder creation on project approval (Component 3) + unit testing.
- **Day 3**: Core 2-Way Sync Service (`DropboxSyncService`) development and verification.
- **Day 4**: API routes, controller integration, and background poller scheduler.
- **Day 5**: Frontend Documents page UI integration (Sync button + source badge styling).
- **Day 6**: End-to-end integration testing, QA, and validation.
