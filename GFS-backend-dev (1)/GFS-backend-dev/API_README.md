# GFS Proposal Backend API Documentation

This document outlines the end-to-end API lifecycle for generating, editing, approving, and streaming proposals.

## Real-Time Updates (SSE Webhook)

The frontend must connect to the Server-Sent Events (SSE) stream to receive real-time updates whenever the AI pushes parameters or when stages are approved.

**`GET /api/v1/proposals/:projectId/stream`**
- **Auth:** Required (Bearer Token)
- **Description:** Establishes a persistent SSE connection.
- **Events Emitted:**
  - `CONNECTED`: Sent immediately on connection.
  - `STAGE_PUSHED`: Emitted when the AI pushes new parameters to a stage.
  - `STAGE_UPDATED`: Emitted when an estimator saves edits.
  - `STAGE_APPROVED`: Emitted when an estimator approves a stage.

**Payload structure for events:**
```json
{
  "type": "STAGE_PUSHED", // or STAGE_UPDATED, STAGE_APPROVED
  "data": {
    "publicId": "uuid-...",
    "stage": 1,
    "stageName": "System & Setup",
    "version": 1,
    "status": "PENDING_REVIEW", // or APPROVED
    "source": "AI",
    "parameters": [
      {
        "uniqueId": "123e4567-e89b-12d3-a456-426614174000",
        "name": "Project name",
        "value": "mirr",
        "row": 2,
        "column": "C",
        "isEditedByEstimator": false
      }
    ],
    "recalculatedValues": {
      "Pricing Worksheet": {
        "D45": "150.00"
      }
    }
  }
}
```

---

## 1. AI Input (Pushing Stages)

**`POST /api/v1/proposals/:projectId/stages`**
- **Auth:** Internal / API Key
- **Description:** Called by the AI to push extracted parameters to the backend. The backend automatically assigns a `uniqueId` to each parameter and broadcasts the `STAGE_PUSHED` event to the SSE webhook.
- **Payload:**
  ```json
  {
    "stage": 1,
    "parameters": [
      {
        "name": "Project name",
        "value": "mirr",
        "row": 2,
        "column": "C"
      }
    ]
  }
  ```
- **Response (201 Created):** Returns a high-level summary (e.g. `{ "success": true, "stage": 1, "status": "PENDING_REVIEW" }`). Full data goes over SSE.

---

## 2. Estimator Endpoints

### Get All Stages (Dashboard)
**`GET /api/v1/proposals/:projectId/stages`**
- **Auth:** Required (Bearer Token)
- **Description:** Returns an overview of all stages.
- **Response (200 OK):**
  ```json
  {
    "stages": {
      "1": { "status": "APPROVED", "parameterCount": 15 },
      "2": { "status": "PENDING_REVIEW", "parameterCount": 8 }
    },
    "allApproved": false,
    "readyForExcel": false
  }
  ```

### Get Stage Detail
**`GET /api/v1/proposals/:projectId/stages/:stage`** (e.g. `stage` = `1`)
- **Auth:** Required (Bearer Token)
- **Description:** Retrieves the detailed parameters and recalculated values for a specific stage.
- **Response (200 OK):** Exactly matches the `data` payload of the SSE events (see SSE section).

### Edit Stage Parameters
**`PUT /api/v1/proposals/:projectId/stages/:stage`**
- **Auth:** Required (Estimator Role)
- **Description:** Saves estimator manual edits. **Important:** The frontend must send back the exact `uniqueId` for the parameter being edited.
- **Payload:**
  ```json
  {
    "parameters": [
      {
        "uniqueId": "123e4567-e89b-12d3-a456-426614174000",
        "name": "Project name",
        "value": "New Edited Name",
        "row": 2,
        "column": "C"
      }
    ]
  }
  ```
- **Response (200 OK):** Full updated stage detail.

### Approve Stage
**`POST /api/v1/proposals/:projectId/stages/:stage/approve`**
- **Auth:** Required (Estimator Role)
- **Description:** Approves the stage. Emits `STAGE_APPROVED` over SSE.
- **Response (200 OK):** `{ "success": true, "status": "APPROVED" }`

---

## 3. Final Proposal Text Stage (Stage 5 / "PROPOSAL")

**`GET /api/v1/proposals/:projectId/proposal`**
- **Auth:** Required
- **Response:**
  ```json
  {
    "stage": "PROPOSAL",
    "introductionText": "...",
    "installationSteps": "...",
    "exclusions": "..."
  }
  ```

**`PUT /api/v1/proposals/:projectId/proposal`**
- **Payload:**
  ```json
  {
    "introductionText": "Updated text",
    "installationSteps": "Updated steps",
    "exclusions": "Updated exclusions"
  }
  ```

**`POST /api/v1/proposals/:projectId/proposal/approve`**
- Finalizes the text stage. Requires stages 1-4 to be approved first.

---

## 4. Excel Generation

**`GET /api/v1/proposals/:projectId/excel`**
- **Auth:** Required (Estimator Role)
- **Description:** Downloads the finalized `.xlsx` file. Only available if Stages 1-4 and the Proposal text stage are fully APPROVED.
- **Response (200 OK):** Binary stream (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
