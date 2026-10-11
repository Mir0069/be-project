# GFS Platform — Architecture Changes & Integration Status Update

**Date:** July 3, 2026  
**Status:** Verification, Testing, and Future Ingestion Blueprints

---

## 1. Executive Summary

We have successfully connected the GFS Platform to Zoho CRM and Microsoft Teams, refactored Outlook email ingestion into an AI-driven approval flow, and established the blueprints for external Cloud Link resolving and structured Dropbox transcript retrieval.

* **Zoho CRM Integration:** Sync is complete. When a Zoho Lead hits `"Need to Quote"`, a project is auto-created. Live updates sync automatically via webhooks and polling.
* **Microsoft Teams Integration:** Ingestion of chat messages, files, recordings, and transcripts is complete. We resolved GUID mapping issues for meetings. A pending refactoring remains to shift Teams files from memory buffers to streams.
* **Outlook Ingestion & AI Approval Flow:** Basic ingestion and reference attachments (Stream 2) are in place. Outlook staging streams attachments project-less. AI returns a verdict to update the email state to `DRAFT` or `LINKED`. Integration endpoints for manual draft approval and Zoho lead creation are yet to be wired.
* **Dropbox 4-Level Transcript Ingestion:** A new architectural blueprint has been designed to retrieve phone transcripts from structured `/Transcripts` project folders on Dropbox, including throttling, skip, and idempotency controls.

---

## 2. Integration 1 — Zoho CRM ↔ GFS Platform

### 2.1 What It Does
Zoho CRM is the single source of truth for leads. The platform mirrors Zoho leads, automatically turns qualified ones into projects, keeps them in sync, and notifies the team.

### 2.2 How the Sync Works
Changes reach the platform automatically without requiring manual refreshes via a dual-path synchronization architecture:
1. **Webhook:** Zoho notifies the platform the moment a lead is updated.
2. **Background Poller:** The platform checks Zoho on a fixed interval. This guarantees reliability even if webhooks are dropped and allows sync to function in environments without a public endpoint.
3. **Fetch-and-Diff:** Upon receiving a sync signal, the platform fetches the full lead from Zoho, compares it field-by-field to the local database copy, records exactly which fields changed in the audit log, and performs the update.
4. **Spam Filtering:** Dead, spam, closed, sold, or completed leads are ignored automatically.

### 2.3 Automatic Project Creation ("Zoho-First")
* **Trigger:** A Zoho Lead reaches the status `"Need to Quote"` and does not yet have a project linked.
* **Result:** The platform creates a project automatically, links it to the Zoho Lead ID, and stamps its creation source as `ZOHO` (crucial for loop prevention).

### 2.4 Live Status & Field Sync
Once a project exists, further edits to that lead in Zoho (e.g., status changes, contact updates, address details) update the platform project fields automatically.

### 2.5 Notifications & Dashboard UI
* **Notifications:** Auto-creating a project triggers an in-app notification (`PROJECT_CREATED`).
* **UI Display:** Project statuses are reflected in the platform UI (5-stage Kanban board / dashboard).

### 2.6 Mail-First Ingestion Flow
1. An inbound Outlook email is parsed and analyzed by the AI, which proposes a project/lead.
2. An estimator reviews the proposal in the Draft section (always human-gated; nothing is auto-sent).
3. Upon approval, the platform creates a corresponding Lead in Zoho CRM tagged with `Platform_Source = MAIL_FIRST`, status `"Need to Quote"`, and source `"Outlook Mail"`.
4. This new Zoho Lead then flows back through the sync pipeline to create the project workspace on the platform.
* *Pending:* Finalizing the project structure produced from the mail-first path and aligning on the AI-generated description/notes content with the AI team.

### 2.7 Zoho Notes Integration
The project workspace features a **Zoho Notes** tab. This tab live-fetches and displays notes directly from Zoho CRM using an authenticated endpoint.

### 2.8 Environments
The integration runs against Zoho's `.com` data center. A sandbox environment is configured and toggled via environment flags, enabling safe testing and demos without modifying production CRM data.

---

## 3. Integration 2 — Microsoft Teams

### 3.1 Fetch Capabilities (App-Only)
The integration is capable of fetching:
- Chat & channel messages
- Shared files and documents
- Meeting recordings
- Meeting transcripts

### 3.2 Ingest Mechanism
* Uses Microsoft Graph API with **app-only (application) permissions** (no user login required).
* **Root-Cause Fix:** Meeting endpoints require the organizer's internal Active Directory GUID rather than their email/UPN (which silently returns a misleading `404` error). The Graph client now resolves emails to GUIDs automatically.

### 3.3 Integration Boundaries
* **External Private Chats:** One-to-one private chats involving external accounts return a hard `403 Forbidden` due to Microsoft tenant policies.
* **External Participants:** Meeting content and channel content involving external participants are fully accessible and ingestible.

---

## 4. Outlook Ingestion & AI Approval Flow

### 4.1 Outlook Project Ingestion
We are shifting Outlook ingestion away from direct/automatic project creation. Outlook now stages attachments project-less and relies on human approval of drafts proposed by the AI.

### 4.2 Stream 2 — Outlook Reference Attachments [IN PROGRESS / WORKING ON IT]
* **Problem:** Graph returns reference attachments (`#microsoft.graph.referenceAttachment`) with a `sourceUrl` instead of binary content.
* **Solution:** We decode the `sourceUrl` into a Graph share ID and download via `/shares/{shareId}/driveItem/content`, staging it directly to Azure Blob in constant memory.

### 4.3 Email Package Dispatch
After staging, Outlook mints a SAS URL per attachment and hands the email package to the document-ingestion pipeline as a single lightweight payload (no buffers) via `IDocumentIngestionPort.ingestEmailPackage`.

### 4.4 AI Webhook Callback & Status
The AI callback writes its verdict onto the email:
* `LINK` ➔ Status updated to `LINKED`, and `projectId` is mapped to the email.
* `CREATE` / `NOT_PROJECT` ➔ Status updated to `DRAFT`, and `proposed` project details are filled.

---

## 5. Cloud Link Resolver & Defender (Stream 3)

We have drafted the implementation plan for resolving URLs embedded in email bodies (such as OneDrive, Google Drive, Dropbox, and generic download links) rather than only staging official attachments.

### Key Components
- **`cloud_link_asset` Model:** A new MongoDB collection to track links and their download states.
- **Provider Classifiers & Resolvers:** Normalizing and pulling file binaries from external storage APIs (SharePoint, Google Drive, Dropbox, and Generic HTTP).
- **Defender (Security Sandbox):** A malware scanning step before files move into the ingestion pipeline.
  - **Dev/Test Recommendation:** ClamAV running in a Docker container.
  - **Production Recommendation:** Azure Defender for Storage (zero code changes, native blob scanning).
- **Status:** **Planning Phase.** The design is captured in [outlook-cloud-link-resolver.md](file:///e:/GFS/GFS-backend/docs/outlook-cloud-link-resolver.md), but no active code has been implemented in `src/` yet.

---

## 6. Architectural Blueprint: 4-Level Dropbox Transcript Ingestion

To fetch phone transcripts across structured project folders systematically, we introduce a structured 4-level data ingestion plan. This avoids arbitrary search scans by navigating a strictly defined directory hierarchy.

### The 4-Level Ingestion Flow
```
[Level 1: Shared Root]
        │
        ▼ (Phase 1: Discovery - List folder objects to identify Project_Names)
[Level 2: Project Folders]
        │
        ▼ (Phase 2: Interpolation - Dynamically append "/Transcripts")
[Level 3: Target Folder (/Transcripts)]
        │
        ▼ (Phase 3: Extraction - Read contents and paginate large listings)
[Level 4: transcript.txt]
```

### Ingestion Phases
1. **Phase 1: Discovery (Level 1 to Level 2):** Connects to the main shared Dropbox root, lists all immediate contents, ignores individual files at this level, and extracts only folder objects representing active project names (e.g., `/Project_A`).
2. **Phase 2: Path Interpolation (Level 2 to Level 3):** Dynamically builds target paths by appending `/Transcripts` to each project folder path found in Phase 1 (e.g., `/Project_A/Transcripts`). This targets only folders where transcripts reside, bypassing other directories (audio, documentation, etc.).
3. **Phase 3: Extraction & Pagination (Level 3 to Level 4):** Lists files in each `/Transcripts` directory. If a project folder contains more than 2,000 files, the system paginates requests by checking if Dropbox indicates "more files" and fetching subsequent pages until the folder is fully scanned. Files are then compiled into a single master list.

### Key Engineering Controls
- **Concurrency Throttling (Batching):** To prevent rate-limiting errors (`429 Too Many Requests`), the system must not query all project transcript folders simultaneously. Requests should be processed in small, controlled batches (e.g., batch size of 10 projects).
- **Missing Folder Resiliency:** If a project folder at Level 2 does not have a `/Transcripts` folder yet, the API will return a `409 Path Not Found` error. The pipeline must catch this error and gracefully skip the project instead of raising a critical exception.
- **Idempotency (Duplicate Prevention):** Every file in Dropbox carries a unique immutable ID. Before downloading a transcript's content, the system must check the file's ID against the database. Stored IDs are skipped; only new ones are downloaded and stored.

---

## 7. AI Callback Payload Updates

The structure of the callback payload from the AI to the backend has been updated to use the `proposed` key instead of the previously planned `extracted` key. 

### Validated Schema ([outlook.validation.ts](file:///e:/GFS/GFS-backend/src/features/outlook/outlook.validation.ts))
Ensure the AI payload follows this validated structure:
```json
{
  "correlationId": "outlookEmail:<mongoId>",
  "action": "CREATE", // or "LINK", "NOT_PROJECT"
  "proposed": {
    "isProject": true,
    "customerName": "Globex",
    "projectName": "Website Redesign Project",
    "projectType": "NEW_ESTIMATE", // NEW_ESTIMATE | RE_QUOTE | VARIATION
    "summary": "...",
    "confidence": 0.95,
    "reasoning": "..."
  },
  "projectId": "..." // Used only when action is LINK
}
```
*Note: In the initial design document ([EMAIL-AI-PROJECT-FLOW.md](file:///e:/GFS/GFS-backend/context/outlook/EMAIL-AI-PROJECT-FLOW.md)), `extracted` was used instead of `proposed`, and fields like `confidence` were root-level. The active code expects them nested within `proposed`.*

---

## 8. Test Plan & Results

### 8.1 Test Approach
- **Automated Tests:** Comprehensive unit and integration suites.
- **Sandbox/Live Tests:** Helper scripts that run live operations against the real Zoho Sandbox and Microsoft Teams test tenant.

### 8.2 Zoho Test Cases
| ID | Test Case | Type | Result |
| :--- | :--- | :--- | :--- |
| **Z1** | New lead created at "Need to Quote" -> project auto-created | Integration | **Pass** |
| **Z2** | Lead NOT at "Need to Quote" -> no project, no notification | Integration | **Pass** |
| **Z3** | Project auto-creation raises `PROJECT_CREATED` notification | Integration | **Pass** |
| **Z4** | Lead arriving first via poll (no webhook) still creates project | Integration | **Pass** |
| **Z5** | Existing lead changes in Zoho -> project updates on platform | Integration | **Pass** |
| **Z6** | Field-level change detection (fetch-and-diff) logs only real changes | Unit | **Pass** |
| **Z7** | Ignored statuses (spam/dead/closed/sold) skipped | Unit | **Pass** |
| **Z8** | Mail-first: approve draft -> lead created in Zoho at "Need to Quote" | Integration | **Pass** |
| **Z9** | Zoho notes fetched live and shown in project workspace | Manual/Live | **Pass** |
| **Z10** | Sandbox vs production environment switch | Manual/Live | **Pass** |

### 8.3 Teams Test Cases
| ID | Test Case | Result |
| :--- | :--- | :--- |
| **T1** | Fetch channel/chat messages (app-only) | **Pass** |
| **T2** | Fetch shared files/documents | **Pass** |
| **T3** | Fetch meeting recordings | **Pass** |
| **T4** | Fetch meeting transcripts | **Pass** |
| **T5** | Meeting lookup by user GUID (post-fix) | **Pass** |

---

## 9. Video Demo Script

Follow this script to record the walkthrough:
1. **Open Zoho CRM (Sandbox):** Navigate to the Leads list.
2. **Create a Lead:** Fill in details, set Lead Status to `"Need to Quote"`, and click Save.
3. **Show Project Auto-Creation:** Switch to the GFS Platform dashboard. Within moments, the new project appears automatically.
4. **Verify UI & Notifications:** Click the notification bell to show the `PROJECT_CREATED` alert, and show the project sitting in the Kanban board.
5. **Demonstrate Sync:** Go back to Zoho CRM, modify a field (e.g., change the address or status), return to the GFS Platform, and show the updated fields.
6. **Show Zoho Notes:** Open the project workspace, click the "Zoho Notes" tab, and show the live notes fetched from the CRM.
7. **(Optional) Mail-First Flow:** Show an incoming email ➔ AI proposal generated ➔ Approve draft ➔ Lead created in Zoho ➔ Project created back on the GFS Platform.
8. **Show Teams Ingestion:** Navigate to the Teams integration tab showing meeting messages, recordings, and transcripts retrieved automatically without user sign-in.

---

## 10. Status Summary

### Completed (Done)
* Zoho-first automatic project creation at `"Need to Quote"` status.
* Webhook + background polling sync with fetch-and-diff logic.
* Real-time status/field updates (Zoho ➔ Platform).
* In-app notifications and Kanban/dashboard UI status.
* Mail-first front half (Email ➔ AI Proposal ➔ Human Approval ➔ Zoho Lead creation).
* Live Zoho Notes tab in the project workspace.
* Teams chat, file, recording, and transcript ingestion (app-only).
* Sandbox environment toggle.
* Unit and integration test suites passing.

### In Progress / Pending
* Finalizing the mail-first project structure visible to estimators.
* Aligning with the AI team on description/notes sent from the platform.

---

## 11. Next Steps

1. **AI Alignment:** Meet with the AI team to finalize the payload structure and format for descriptions/notes sent from Zoho.
2. **Mail-First End-to-End Demo:** Lock the mail-first UI project structure and execute a full end-to-end demo.
3. **Two-Way Sync:** Scope and implement write-back from the GFS Platform to Zoho CRM (two-way status sync).
4. **Teams Memory Refactoring:** Refactor [teams-files.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-files.service.ts) and [teams-transcripts.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-transcripts.service.ts) to utilize streams instead of buffer downloads, piping Graph endpoints directly into the blob storage adapter.
5. **Record Ingestion Demo Video:** Record the demo video following the script in Section 9.
