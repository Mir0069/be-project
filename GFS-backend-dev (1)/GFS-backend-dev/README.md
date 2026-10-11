# GFS Backend Service

This is the central backend API for the Glass Flooring Systems (GFS) web application. Built with Node.js, Express, TypeScript, and MongoDB, it serves as the orchestrator for proposal generation, Excel templating, and AI integrations.

## Architecture & Modules

The application is modularized by feature inside the `src/features` directory:

- **Proposal**: The core module. It handles the single-document Proposal workflow (Stages 1-5). It receives inputs from the frontend/AI, manages human-in-the-loop approvals, and ultimately generates a polished `.xlsx` proposal.
- **Excel Template**: Manages the uploading and storage of the master Excel template into MongoDB.
- **Formula Engine**: A real-time calculation engine powered by `HyperFormula`. It loads the Excel template into memory and calculates all derived cells (green cells) natively on the backend, serving as the ultimate source of truth.
- **Auth**: Manages user authentication and authorization.
- **Teams / Zoho**: Integrations with external services.
- **Phone Transcript / Document Ingestion**: Ingests raw data for the AI to process into structured proposal parameters.

## Prerequisites

- **Node.js** (v18+)
- **MongoDB** (Local or Atlas)
- **TypeScript**

## Setup & Execution

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file in the root directory. Ensure there are no trailing whitespaces after your variable names or values.
   ```env
   PORT=3000
   MONGODB_URI=<secret-managed MongoDB connection string>
   ```

3. **Running the Server:**
   The development server uses `nodemon` to automatically restart on file changes. We utilize `--transpile-only` to ensure the server starts even if there are strict TypeScript errors in unconnected modules.
   ```bash
   npm run dev
   ```

4. **Seeding the Database:**
   To test the Excel generation flow without clicking through the frontend, you can run the seed script. It simulates the AI filling out Stages 1-4, an estimator approving them, and finalizes the proposal.
   ```bash
   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/seed-stages.ts
   ```
   User seed scripts require a strong password through their corresponding environment variable (for example, `SEED_ADMIN_PASSWORD`); seed passwords are never stored in source or printed to logs.

## Excel Template Workflow

The application no longer hardcodes its mathematical formulas. It pulls them dynamically from an uploaded `.xlsx` template. 
1. Use Postman to upload the master `.xlsx` template to `POST /api/v1/excel-templates`.
2. As the AI populates fields in stages 1-5, the `FormulaEngineService` intercepts those edits and calculates all derived fields (like Qty and Price) on the fly.
3. The final Excel file is returned by calling `GET /proposals/:projectId/excel`.

## API Documentation

All routes are prefixed with `/api/v1` (or your configured `API_VERSION`). 

### Authentication
Most endpoints require a JWT token passed in the `Authorization` header.
- **Header:** `Authorization: Bearer <your_jwt_token>`
- Some endpoints additionally require the user to have the `ESTIMATOR` role.

---

### 1. Excel Template Management

**`POST /excel-templates`**
- **Auth:** Required (Admin/Estimator)
- **Description:** Uploads a new master `.xlsx` template.
- **Payload (form-data):**
  - `template`: The `.xlsx` file.
- **Response (201 Created):**
  ```json
  {
    "message": "Template uploaded successfully",
    "templateId": "...",
    "version": "..."
  }
  ```

---

### 2. Proposal Workflow (Stages 1-4)

The core proposal lifecycle takes place across 4 main stages (System, Glass, Hardware, Labor).

**`POST /proposals/:projectId/stages`**
- **Auth:** Not required (internal AI service)
- **Description:** Pushes AI-extracted parameters into a specific stage of a project's proposal.
- **Payload (JSON):**
  ```json
  {
    "stage": 1,
    "parameters": [
      { "name": "Project name", "value": "mirr", "row": 2, "column": "C" }
    ]
  }
  ```
- **Response (200 OK):** Stage details with `status: "NEEDS_REVIEW"`.

**`GET /proposals/:projectId/stages`**
- **Auth:** Required (Bearer Token)
- **Description:** Returns an overview of all stages for the estimator dashboard.
- **Response (200 OK):**
  ```json
  {
    "1": { "status": "APPROVED", "updatedAt": "..." },
    "2": { "status": "NEEDS_REVIEW", "updatedAt": "..." }
  }
  ```

**`GET /proposals/:projectId/stages/:stage`**
- **Auth:** Required (Bearer Token)
- **Description:** Retrieves the detailed parameters for a specific stage.
- **Response (200 OK):**
  ```json
  {
    "stage": 1,
    "status": "NEEDS_REVIEW",
    "parameters": [ ... ],
    "recalculatedValues": {
      "Pricing Worksheet": {
        "D45": "150.00"
      }
    }
  }
  ```
  *(Note: `recalculatedValues` is dynamically filtered to only return derived cells related to the requested stage's inputs).*

**`PUT /proposals/:projectId/stages/:stage`**
- **Auth:** Required (Estimator Role)
- **Description:** Saves estimator manual overrides to a stage.
- **Payload (JSON):**
  ```json
  {
    "parameters": [ ... updated list ... ]
  }
  ```
- **Response (200 OK):** Updated stage details, including fresh `recalculatedValues`.

**`POST /proposals/:projectId/stages/:stage/approve`**
- **Auth:** Required (Estimator Role)
- **Description:** Marks a stage as finalized.
- **Response (200 OK):** `{ "message": "Stage 1 approved" }`

---

### 3. Finalizing the Proposal (Stage 5)

**`PUT /proposals/:projectId/proposal`**
- **Auth:** Required (Estimator Role)
- **Description:** Saves the final text descriptions (exclusions, scope of work).
- **Payload (JSON):**
  ```json
  {
    "description": "...",
    "scopeOfWork": "...",
    "exclusions": "..."
  }
  ```

**`POST /proposals/:projectId/proposal/approve`**
- **Auth:** Required (Estimator Role)
- **Description:** Finalizes the entire proposal document.
- **Response (200 OK):** `{ "message": "Proposal approved" }`

---

### 4. Excel Generation

**`GET /proposals/:projectId/excel`**
- **Auth:** Required (Estimator Role)
- **Description:** Downloads the finalized `.xlsx` file. Only available if Stages 1-5 are approved. The formula engine automatically injects all database inputs and cleanly evaluates the spreadsheet.
- **Response (200 OK):** A binary stream of the `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` file.
