# GFS Platform — Architecture Changes & Integration Status Update

**Date:** July 3, 2026  
**Subject:** Ingestion Flow Changes, Teams Refactoring, and Cloud Link Resolver Status

---

## 1. Project Ingestion & Integration Status Board

Below is a summary of the complexity, current status, and scope of all active integrations and architectural workstreams:

| Module / Workstream | Complexity | Status | What is Done | What is Left / Pending |
| :--- | :--- | :--- | :--- | :--- |
| **Project Initiation & Approval Flow (Outlook)** | **Medium** | `[IN PROGRESS]` | Ingestion, streaming attachment staging, and AI result webhook updates. | Exposing draft APIs (`/emails?status=DRAFT`, `/create-project`, `/discard`) and wiring Zoho lead creation. |
| **Cloud Link Resolver & Defender (Stream 3)** | **High** | `[PENDING / PLANNING]` | Design specification and architectural mapping. | Writing DB schemas, provider resolvers (Google Drive/Dropbox), and scanning software setup. |
| **Teams Refactoring to Remove Buffers** | **Medium** | `[PENDING]` | Feasibility comparison against Outlook's streaming service. | Rewriting Graph Client and Teams services to process files via streams (`getStream`) instead of memory buffers. |
| **AI Callback Payload Updates** | **Low** | `[DONE]` | Updated Zod validation schema and backend mapping to expect the `proposed` payload structure. | None. |
| **Zoho CRM ↔ GFS Platform Integration** | **Medium-High** | `[DONE]` | Double webhook/polling sync, fetch-and-diff updates, live Notes tab, sandbox toggle, and tests. | Designing the platform-to-CRM write-back sync (two-way status sync). |
| **Dropbox Ingestion Blueprint** | **Medium-High** | `[PENDING / PLANNING]` | Detailed 4-level ingestion flow design, pagination logic, and engineering controls. | Code implementation of the folder scanner, throttle, and database check. |

---

## 2. Project Initiation & Approval Workflow

* **Status:** `[IN PROGRESS]`
* **Complexity:** **Medium** (requires handling async AI webhook callbacks, temporary draft states, and project folder/blob rebinding upon estimator approval).

We are moving away from the automatic creation of projects based on keyword mapping or heuristic matching. The new flow routes all incoming content through the AI first, which suggests either linking to an existing project or creating a draft. 

### Flow Overview
```
Incoming Email / Message 
   │
   ▼
Ingested & Staged (Status: PENDING)
   │
   ▼
Dispatched to AI Ingestion Pipeline
   │
   ▼
AI Decision Callback 
   ├── LINK   ──► Auto-Linked to existing project (Status: LINKED)
   └── CREATE ──► Draft Project Proposed (Status: DRAFT)
                   │
                   ▼ (Estimator / Admin Review)
       ┌───────────┴───────────┐
       ▼                       ▼
    Approve                 Discard
       │                       │
       ├──► createProject()    └──► Cleanup staged blobs
       ├──► Create Zoho Lead         (Status: DISCARDED)
       └──► Status: CONFIRMED
```

### Current Status Details
* **What is Done:** Email poller delta sync, project-less attachment staging (using constant-memory streams), and AI result callback hook are fully implemented in [outlook.service.ts](file:///e:/GFS/GFS-backend/src/features/outlook/outlook.service.ts).
* **What is Left:** Exposing manual review routes (`GET /emails?status=DRAFT`, `POST /emails/:id/create-project`, and `POST /emails/:id/discard`) and wiring the Zoho Lead insertion triggers.

---

## 3. Cloud Link Resolver & Defender (Stream 3)

* **Status:** `[PENDING / PLANNING]`
* **Complexity:** **High** (requires handling authentication/consents for multiple external cloud providers, navigating folders recursively, pagination, malware scans, and retry queues).

We have drafted the implementation plan for resolving URLs embedded in email bodies (such as OneDrive, Google Drive, Dropbox, and generic download links) rather than only staging official attachments.

### Key Components
- **`cloud_link_asset` Model:** A new MongoDB collection to track links and their download states.
- **Provider Classifiers & Resolvers:** Normalizing and pulling file binaries from external storage APIs (SharePoint, Google Drive, Dropbox, and Generic HTTP).
- **Defender (Security Sandbox):** A malware scanning step before files move into the ingestion pipeline.
  - **Dev/Test Recommendation:** ClamAV running in a Docker container.
  - **Production Recommendation:** Azure Defender for Storage (zero code changes, native blob scanning).

---

## 4. Teams Ingestion Refactoring to Remove Buffers

* **Status:** `[PENDING]`
* **Complexity:** **Medium** (requires modifying Graph Axios client, rewriting Teams files/transcripts helper services to pipe streams, and adapting unit/integration tests).

To prevent high-memory usage and potential Out-Of-Memory (OOM) crashes, we need to refactor Teams file ingestion to match the stream-based architecture used in Outlook.

### Current Comparison
| Feature | Outlook Ingestion | Teams Ingestion |
| :--- | :--- | :--- |
| **Download Method** | Stream-based (`getStream`) | Buffer-based (`getBinary`) |
| **Blob Staging** | Pipeline streams direct Graph response to Azure Blob | Downloads entire binary into memory first |
| **Memory Footprint** | Constant memory usage | Linear memory usage (proportional to file sizes) |

### Action Item for Teams
Refactor [teams-files.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-files.service.ts) and [teams-transcripts.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-transcripts.service.ts) to utilize streams instead of buffer downloads, piping Graph endpoints directly into the blob storage adapter.

---

## 5. AI Callback Payload Updates

* **Status:** `[DONE]`
* **Complexity:** **Low** (requires updating Zod verification schemas and endpoint request mappings).

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

## 6. GFS Platform — Zoho & Teams Integration Progress & Tests

* **Status:** `[DONE]`
* **Complexity:** **Medium-High** (requires handling dual webhook/poller coordination, GUID mapping translation for Microsoft Graph user lookups, and fetch-and-diff change logs).

### 6.1 Zoho CRM Sync Details
* **Sync Mechanisms:** Dual webhooks and interval-based polling for fetch-and-diff updates.
* **Project Initiation:** Automatically binds new projects to Zoho Lead IDs and stamps the creation source.
* **Mail-First Flow:** Establishes Zoho Leads with `Platform_Source = MAIL_FIRST` when an Outlook email draft proposal is approved by an estimator.
* **Notes Tab:** Embeds a Zoho Notes tab that live-fetches comments and logs from the Zoho lead.

### 6.2 Microsoft Teams Integration Details
* **Data Retrieval:** Messages, files, recordings, and transcripts are pulled.
* **User GUID Resolution:** Resolves email/UPN identifiers to internal GUIDs to prevent Graph API 404s.
* **Access Boundary:** External 1:1 private chats are blocked by Microsoft policy (returns `403`), but external participant data inside channel/meeting scopes works.

### 6.3 Test cases & Results
#### Zoho Test Cases
| ID | Test Case | Type | Result |
| :--- | :--- | :--- | :--- |
| **Z1** | New lead created at "Need to Quote" ➔ project auto-created | Integration | **Pass** |
| **Z2** | Lead NOT at "Need to Quote" ➔ no project, no notification | Integration | **Pass** |
| **Z3** | Project auto-creation raises `PROJECT_CREATED` notification | Integration | **Pass** |
| **Z4** | Lead arriving first via poll (no webhook) still creates project | Integration | **Pass** |
| **Z5** | Existing lead changes in Zoho ➔ project updates on platform | Integration | **Pass** |
| **Z6** | Field-level change detection (fetch-and-diff) logs only real changes | Unit | **Pass** |
| **Z7** | Ignored statuses (spam/dead/closed/sold) skipped | Unit | **Pass** |
| **Z8** | Mail-first: approve draft ➔ lead created in Zoho at "Need to Quote" | Integration | **Pass** |
| **Z9** | Zoho notes fetched live and shown in project workspace | Manual/Live | **Pass** |
| **Z10** | Sandbox vs production environment switch | Manual/Live | **Pass** |

#### Teams Test Cases
| ID | Test Case | Result |
| :--- | :--- | :--- |
| **T1** | Fetch channel/chat messages (app-only) | **Pass** |
| **T2** | Fetch shared files/documents | **Pass** |
| **T3** | Fetch meeting recordings | **Pass** |
| **T4** | Fetch meeting transcripts | **Pass** |
| **T5** | Meeting lookup by user GUID (post-fix) | **Pass** |

### 6.4 Video Demo Script
1. **Create Lead:** In Zoho Sandbox, set lead status to `"Need to Quote"`.
2. **Observe Sync:** Show the project auto-creating on GFS Platform with a `PROJECT_CREATED` notification.
3. **Edit Lead:** Update details in Zoho, then verify changes in the project workspace dashboard.
4. **Live Notes:** Show the "Zoho Notes" tab retrieving real lead comments live from Zoho.
5. **Ingestion Demo:** Demonstrate Teams transcripts/files and Outlook email package ingestion without user sign-in.

---

## 7. Architectural Blueprint — Dropbox Transcript Ingestion

* **Status:** `[PENDING / PLANNING]`
* **Complexity:** **Medium-High** (requires handling concurrency throttling for folder searches, gracefully skipping unconfigured project transcript directories, and paginating large folders).

To fetch phone transcripts across structured project folders systematically, we introduce a structured 4-level data ingestion plan. This avoids arbitrary search scans by navigating a strictly defined directory hierarchy.

### The 4-Level Ingestion Flow
```
[Level 1: Shared Root]
        │
        ▼ (Phase 1: Discovery - List folder objects to identify Project_Names)
[Level 2: Project Folders]
        │
        ▼ (Phase 2: Path Interpolation - Dynamically append "/Transcripts")
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

## 8. Next Steps & Action Items

1. **AI Alignment:** Meet with the AI team to finalize the payload structure and format for descriptions/notes sent from Zoho.
2. **Mail-First End-to-End Demo:** Lock the mail-first UI project structure and execute a full end-to-end demo.
3. **Two-Way Sync:** Scope and implement write-back from the GFS Platform to Zoho CRM (two-way status sync).
4. **Teams Memory Refactoring:** Refactor [teams-files.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-files.service.ts) and [teams-transcripts.service.ts](file:///e:/GFS/GFS-backend/src/features/teams/teams-transcripts.service.ts) to utilize streams instead of buffer downloads, piping Graph endpoints directly into the blob storage adapter.
5. **Record Ingestion Demo Video:** Record the demo video following the script in Section 6.4.
