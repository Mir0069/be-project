# Centralized Project Schema

The single canonical project shape the frontend Overview populates and the
creation API returns. One dedicated module (`src/features/project-creation`)
is the only authority that creates projects; both flows — **Zoho-first**
(lead enters "Need to Quote") and **manual / mail-first** (`POST /api/v1/projects`)
— converge on this schema.

The Zoho-sourced fields are **copied onto the Project document** (self-contained),
then kept fresh by the Zoho webhook (real-time) and the 3-hour reconcile poll
(safety net). `lastZohoSyncedAt` on the document records the last reconcile.

## Response contract — `CentralizedProjectView`

```json
{
  "id": "665f1c2a9b1e4a0012a3b4c5",
  "referenceNumber": "PRJ-2026-0007",
  "projectName": "Acme Storefront Glazing",
  "projectAddress": "120 Market St, Suite 4",
  "status": "SETUP_PENDING",
  "projectType": "NEW_ESTIMATE",
  "creationSource": "ZOHO_FIRST",
  "receivedDate": "2026-06-22T09:14:00.000Z",
  "zohoDescription": "Replace 6 shopfront panels, tempered.",
  "client": {
    "customerName": "Jane Doe",
    "customerEmail": "jane@acme.com",
    "customerPhone": "+1-555-0142",
    "company": "Acme Corp",
    "website": "https://acme.com"
  },
  "address": {
    "street": "120 Market St",
    "city": "San Francisco",
    "state": "CA",
    "zipcode": "94103",
    "country": "USA"
  },
  "estimator": {
    "id": null,
    "name": null,
    "email": null,
    "phone": null
  },
  "zohoLeadId": "4876000000312045",
  "createdAt": "2026-06-22T09:15:03.000Z",
  "updatedAt": "2026-06-22T09:15:03.000Z"
}
```

## Field → source table

| View field            | Project doc field      | Origin / how it is set                                                   |
|-----------------------|------------------------|-------------------------------------------------------------------------|
| `id`                  | `_id`                  | Mongo-generated                                                         |
| `referenceNumber`     | `referenceNumber`      | Generated `PRJ-<year>-<seq>` at creation                               |
| `projectName`         | `projectName`          | Zoho: **project address** (jobAddress, else street/city/state/zip/country); falls back to company/name. Manual: request body                       |
| `projectAddress`      | `jobAddress`           | Zoho "Project Address" (`jobAddress`)                                   |
| `status`              | `status`               | Server-set `SETUP_PENDING` on create                                    |
| `projectType`         | `projectType`          | Default `NEW_ESTIMATE`; overridable on manual create                    |
| `creationSource`      | `creationSource`       | `ZOHO_FIRST` \| `MAIL_FIRST` (tag-detected) \| `MANUAL`                  |
| `receivedDate`        | `receivedDate`         | `ZohoLead.createdTime` (ISO)                                            |
| `zohoDescription`     | `description`          | Zoho Description                                                        |
| `client.customerName` | `customerName`         | Zoho full name; manual `client.customerName`                            |
| `client.customerEmail`| `customerEmail`        | Zoho Email                                                              |
| `client.customerPhone`| `customerPhone`        | Zoho Phone                                                              |
| `client.company`      | `company`              | Zoho Company                                                            |
| `client.website`      | `customerWebsite`      | Zoho Website                                                            |
| `address.street`      | `address.street`       | Zoho Street                                                             |
| `address.city`        | `address.city`         | Zoho City                                                               |
| `address.state`       | `address.state`        | Zoho State                                                              |
| `address.zipcode`     | `address.zipcode`      | Zoho Zip_Code                                                           |
| `address.country`     | `address.country`      | Zoho Country                                                            |
| `estimator.id`        | `assignedEstimatorId`  | Set via assign-estimator flow                                           |
| `estimator.name`      | `estimatorName`        | Assign-estimator flow                                                   |
| `estimator.email`     | `estimatorEmail`       | Assign-estimator flow                                                   |
| `estimator.phone`     | `estimatorPhone`       | Assign-estimator flow                                                   |
| `zohoLeadId`          | `zohoLeadId`           | Linked Zoho lead id (idempotency key, unique partial index)            |
| `createdAt`           | `createdAt`            | Mongo timestamp (ISO)                                                   |
| `updatedAt`           | `updatedAt`            | Mongo timestamp (ISO)                                                   |

> Not exposed in the view but present on the document: `lastZohoSyncedAt`
> (last reconcile time), `identifierHash`, `blobStorageURL`, `quoteNumber`,
> `leadStatus`, `dueDate`, `estimatedCost`, `totalSqFt`, `isActive`.

## Create input — `POST /api/v1/projects`

`creationSource` is server-set to `MANUAL`; `status` is server-set to
`SETUP_PENDING`. Requires `SALES_MANAGER`, `SUPER_ADMIN`, or `SYSTEM_ADMIN`.

```json
{
  "projectName": "Acme Storefront Glazing",
  "projectType": "NEW_ESTIMATE",
  "projectAddress": "120 Market St, Suite 4",
  "description": "Replace 6 shopfront panels, tempered.",
  "client": {
    "customerName": "Jane Doe",
    "customerEmail": "jane@acme.com",
    "customerPhone": "+1-555-0142",
    "company": "Acme Corp",
    "website": "https://acme.com"
  },
  "address": {
    "street": "120 Market St",
    "city": "San Francisco",
    "state": "CA",
    "zipcode": "94103",
    "country": "USA"
  }
}
```

Only `projectName` is required. The response is a `CentralizedProjectView`.
