# Project Workspace — Frontend Integration Guide

## Base URL

```text
/api/v1/project-workspace
```

> **Project creation moved.** Projects are no longer created through this router.
> They are created through the centralized creation flow: automatically from a
> Zoho lead reaching "Need to Quote" (zoho-first, and mail-first once that lead is
> created → Zoho webhook), or — for a manual/admin create — via `POST /api/v1/projects`
> (the `project-creation` module). This `project-workspace` router serves only
> read / list / update / status / assign / archive of existing projects.

All endpoints require authentication cookies (`accessToken` and `refreshToken`). Use `credentials: 'include'` on the frontend.

---

## Search, Filter & Pagination Behavior

The `GET /` endpoint is highly dynamic. It powers the main project dashboard and supports advanced data grid requirements.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Pagination page number |
| `limit` | number | `10` | Number of items per page |
| `status` | string | — | Filter by `ProjectStatus` enum |
| `projectType` | string | — | Filter by `ProjectType` enum |
| `customerName` | string | — | Partial text match (case-insensitive search) |
| `referenceNumber`| string | — | Exact or partial match for reference number |
| `assignedEstimatorID` | string | — | Filter by assigned user's ObjectId |
| `isActive` | boolean | `true` | Show active (`true`) or archived (`false`) projects |
| `sortBy` | string | `createdAt` | Field to sort by (`createdAt`, `dueDate`) |
| `sortOrder` | string | `desc` | Sort direction (`asc`, `desc`) |

**Success Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "64f...",
      "referenceNumber": "PRJ-1004",
      "projectName": "Downtown Highrise",
      "status": "SETUP_PENDING"
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 10,
  "totalPages": 15
}
```

---

## Azure Storage Flow

When a project is created, the backend `AzureBlobRepository` may provision a root folder/container for the project in Azure Blob Storage. 
The resulting URI is saved in the `blobStorageURL` field.

**Frontend Rule:** Do not upload files directly to Azure using embedded credentials. Always use the backend endpoints (e.g., Module 3 Document Ingestion) which will route files into the specific project's `blobStorageURL` folder. 

---

## Estimator Assignment Workflow

```text
PATCH /:id/assign
```

**Request:**
```json
{
  "assignedEstimatorID": "64f1a2b3c4d5e6f7g8h9i0j1",
  "estimatorName": "John Doe"
}
```

This endpoint handles the assignment of an estimator. The frontend must supply both the ID and the display name. The backend verifies the ID against the User repository before committing the update.

**UI Consideration:** Before calling this endpoint, fetch the list of available estimators from the User module (filtered by `role: ESTIMATOR`).
