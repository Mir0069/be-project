# Document Ingestion: Developer Handoff & Operations

## 1. Local Environment Configuration
To run or test this module locally, the following environment variables must be present. Ensure these are injected into your local `.env`.

**Azure Infrastructure:**
* `AZURE_STORAGE_CONNECTION_STRING`
* `AZURE_STORAGE_CONTAINER_NAME` (Default: `documents`)
* `AZURE_SERVICE_BUS_CONNECTION_STRING`
* `AZURE_SERVICE_BUS_AI_QUEUE_NAME` (Default: `ai-ocr-ingestion`)

**Queue Provider Factory:**
* `QUEUE_PROVIDER` = `azure_service_bus` (For live integration testing) OR `in_memory` (For local execution without reaching Azure).

**Standard App Dependencies:**
* `MONGODB_URI`
* `JWT_SECRET` & `JWT_REFRESH_SECRET`

## 2. Local Database Initialization
Before testing authentication or document ingestion locally, you must seed a root administrative user to interact with the protected routes:
```bash
npx ts-node src/scripts/seed-super-admin.ts