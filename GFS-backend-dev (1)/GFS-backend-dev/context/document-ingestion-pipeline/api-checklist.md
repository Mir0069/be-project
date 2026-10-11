# Document Ingestion: API Checklist

Use this checklist for manual verification of the Document Ingestion routing and permission boundaries.

### 0. Authentication (Required First)
- [x] **POST** `/api/v1/auth/login`
  - **Payload**: JSON `{ "email": "...", "password": "..." }`
  - **Status**: ✅ Verified. Sets HTTP-only session cookie required for all subsequent routes.

### 1. Upload Document
- [x] **POST** `/api/v1/projects/:projectId/documents`
  - **Payload**: `multipart/form-data` (requires `file` and `documentType`).
  - **Status**: ✅ Verified. Document record is saved in MongoDB, blob exists in Azure visual directory, and an extraction job is enqueued via the Queue Adapter.

### 2. List Documents
- [x] **GET** `/api/v1/projects/:projectId/documents`
  - **Query Params**: `?includeDeleted=true` (optional).
  - **Status**: ✅ Verified. Successfully returns an array of document records sorted by upload date.

### 3. Replace/Update Version
- [x] **POST** `/api/v1/projects/:projectId/documents`
  - **Payload**: `multipart/form-data`. Includes `replaceDocumentId`.
  - **Status**: ✅ Verified. Successfully increments `version` and references the `previousVersionId` while maintaining the root lineage.

### 4. Mark Final Input
- [x] **PATCH** `/api/v1/documents/:documentId/final-input`
  - **Payload**: JSON `{ "isFinalInput": true }`.
  - **Status**: ✅ Verified. Safely mutates the boolean flag in the database.

### 5. Generate Download URL
- [x] **GET** `/api/v1/documents/:documentId/download-url`
  - **Status**: ✅ Verified. Returns a valid, temporarily signed (15-minute) Azure SAS URL that securely bypasses the storage firewall.

### 6. Delete Document
- [x] **DELETE** `/api/v1/documents/:documentId`
  - **Status**: ✅ Verified. Elevated roles can successfully soft-delete the MongoDB record and wipe the physical blob from Azure Storage.