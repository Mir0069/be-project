# Teams Integration Module — Overview

## Purpose

Ingests Microsoft Teams **channel messages** into GFS and links each message to
the right project. An admin chooses which channels to monitor; a scheduled
poller (or a manual sync) pulls new messages from those channels via the
Microsoft Graph API and stores them, auto-linking to a project by keyword or by
an explicit channel→project mapping.

Ingestion now covers all four parts: channel discovery + monitoring, channel
**messages**, file **attachments**, and meeting **transcripts**. Messages, files,
and transcripts are each routed into the Document Ingestion Pipeline for the AI.
Real-time webhooks remain the one planned follow-up — see *Roadmap* below.

**Transcripts are scheduled-meeting only.** A meeting must be scheduled (its
organizer gets a calendar event with a stable `joinWebUrl`); ad-hoc "Meet now"
channel calls expose no resolvable meeting id and are unreachable via Graph.

---

## Authentication (app-only / client-credentials)

Unlike Zoho (user login + refresh token), Teams uses an **application** identity.
There is no user sign-in and no refresh token. The token service exchanges the
three app credentials for a Graph access token (~1 hour lifetime), caches it in
the `teamstokens` collection, and re-requests a fresh one once the cached token
is within a 60-second safety window of expiry.

```
POST {TEAMS_AUTHORITY}/{TEAMS_TENANT_ID}/oauth2/v2.0/token
  grant_type=client_credentials
  client_id={TEAMS_CLIENT_ID}
  client_secret={TEAMS_CLIENT_SECRET}
  scope=https://graph.microsoft.com/.default
```

All four Graph permissions are **Application** permissions with admin consent:
`ChannelMessage.Read.All`, `Files.Read.All`, `OnlineMeetingTranscript.Read.All`,
`Team.ReadBasic.All`.

---

## Architecture

```
teams.router.ts              → routes, guards, dependency injection
teams.controller.ts          → HTTP layer (safeJson responses)
teams.service.ts             → orchestration: discovery, monitoring, sync, linking
teams-token.service.ts       → app-only token acquisition + caching
teams.graph-client.ts        → axios wrapper over Graph (paging + delta + errors)
teams-association.service.ts → project resolution (channel map / keyword / none)
teams.poller.ts              → setInterval-based scheduled syncAll()
teams.types.ts               → Graph DTOs + internal shapes
teams.validation.ts          → Zod request schemas
```

Ingestion is **trigger-agnostic**: the poller and the `POST /sync` endpoint both
call the same `syncChannel` / `syncAll` logic, so a webhook trigger can be added
later without touching ingestion.

---

## Endpoints

Base path: `/api/v1/teams`. All routes require `authenticate`. Routes marked
**(admin)** also require `authorize(SUPER_ADMIN, SYSTEM_ADMIN)`.

> Frontend devs: [frontend-integration.md](./frontend-integration.md) is the full
> request/response + error + TypeScript reference. This section is a quick map.

### GET `/status` (auth)
Connection/config snapshot.
```json
{ "success": true, "data": { "configured": true, "cachedTokenExpiresAt": "2026-05-28T10:59:00.000Z", "monitoredChannelCount": 2 } }
```

### GET `/teams` (admin)
Lists all teams in the tenant (`Team.ReadBasic.All`). Used to pick channels to monitor.

### GET `/teams/:teamId/channels` (admin)
Lists channels of a team.

### GET `/monitored-channels` (admin)
Lists the channels currently being ingested.

### POST `/monitored-channels` (admin)
Start monitoring a channel; optionally map it to a project.
```json
{ "teamId": "...", "teamName": "GFS Construction", "channelId": "...", "channelName": "Project Alpha", "projectId": "<optional>" }
```
**Errors:** `404` mapped project not found · `409` channel already monitored.

### DELETE `/monitored-channels/:id` (admin)
Stops monitoring (soft delete). `404` if not found.

### POST `/sync` (admin)
Manually trigger ingestion. Body optional: `{ "channelDbId": "<monitored channel _id>" }` syncs one channel; empty body syncs all.
```json
{ "success": true, "data": { "channels": [{ "channelId": "...", "channelName": "Project Alpha", "ingested": 3 }], "errors": [] } }
```

### GET `/messages` (auth)
Lists ingested messages. Query: `projectId`, `channelId`, `page`, `limit`.
```json
{ "success": true, "data": { "messages": [ /* ... */ ], "total": 42 } }
```

### POST `/messages/:messageId/link` (admin)
Manually link a message to a project (sets `linkMethod: "MANUAL"`; preserved on re-sync).
Also routes the message + its files to the pipeline.
```json
{ "projectId": "..." }
```
**Errors:** `404` project or message not found.

### POST `/messages/:messageId/process-files` (admin)
Re-runs file routing for one message. `data: { routed: <count> }`. `404` if not found.

### POST `/transcripts/fetch` (admin)
On-demand transcript fetch. Body `{ "userId": "<organizer object id>", "meetingId": "...", "projectId": "<optional>" }`.
Returns a summary of stored transcripts. `404` if `projectId` not found.

### GET `/transcripts` (auth)
Lists stored transcripts. Query: `projectId`, `meetingId`, `page`, `limit`. `data: { transcripts, total }`.
Each item carries full `contentVtt` + `contentText` (can be large).

### POST `/transcripts/:transcriptId/link` (admin)
Manually link a transcript to a project (`linkMethod: "MANUAL"`) and route it to the pipeline.
**Errors:** `404` project or transcript not found.

---

## Project association (feature #5)

For each ingested message, `TeamsAssociationService.resolveProject` decides the project:

| Order | Rule | `linkMethod` |
|---|---|---|
| 1 | The channel has an explicit `projectId` mapping | `CHANNEL_MAP` |
| 2 | Message text or channel name contains a project's `projectName`, `referenceNumber`, or `customerName` (case-insensitive) | `AUTO` |
| 3 | No match | `null` (unlinked — can be linked manually) |

A `MANUAL` link set via `POST /messages/:id/link` is **never overwritten** by a later sync.

---

## Data models

`teamstokens` — cached app-only token:

| Field | Notes |
|---|---|
| `tokenKey` | unique; always `default` for the single app identity |
| `accessToken` | current Graph token |
| `expiresAt` | absolute expiry; refetched within 60s of this |

`teamsmonitoredchannels` — channels to ingest:

| Field | Notes |
|---|---|
| `teamId` / `teamName` | Graph team |
| `channelId` / `channelName` | Graph channel; `(teamId, channelId)` unique |
| `projectId` | optional explicit project mapping |
| `deltaLink` | Graph delta cursor for incremental polling |
| `isActive` | soft-delete flag |

`teamsmessages` — ingested messages:

| Field | Notes |
|---|---|
| `messageId` | unique Graph id (idempotent upsert) |
| `teamId` / `channelId` | source |
| `parentMessageId` | set for replies |
| `fromName` / `fromId` | sender |
| `contentText` / `contentHtml` | plain (HTML stripped) + original |
| `attachments[]` | `{ id, name, contentType, contentUrl, downloaded }` (feeds #3 later) |
| `projectId` / `linkMethod` | association result |
| `webUrl`, `createdDateTime` | message metadata |

---

## Files

```
src/features/teams/
  teams.router.ts
  teams.controller.ts
  teams.service.ts
  teams-token.service.ts
  teams.graph-client.ts
  teams-association.service.ts
  teams.poller.ts
  teams.types.ts
  teams.validation.ts

src/db/models/teams-token.model.ts
src/db/models/teams-monitored-channel.model.ts
src/db/models/teams-message.model.ts
src/repositories/{interfaces,mongoose}/teams-token.repository.ts
src/repositories/{interfaces,mongoose}/teams-monitored-channel.repository.ts
src/repositories/{interfaces,mongoose}/teams-message.repository.ts

tests/unit/features/teams/*.test.ts
tests/integration/teams.integration.test.ts   (gated: TEAMS_INTEGRATION_TESTS=1)
```

---

## Required env vars

```
TEAMS_CLIENT_ID=<Application (client) ID>
TEAMS_CLIENT_SECRET=<client secret Value>
TEAMS_TENANT_ID=<Directory (tenant) ID>
TEAMS_POLLING_ENABLED=true            # enable the scheduled poller (default false)
# optional overrides:
TEAMS_AUTHORITY=https://login.microsoftonline.com
TEAMS_GRAPH_BASE_URL=https://graph.microsoft.com/v1.0
TEAMS_SCOPE=https://graph.microsoft.com/.default
TEAMS_POLL_INTERVAL_MS=300000         # 5 minutes
```

Credentials are optional at boot (so the app still starts without them); the
token service raises `TEAMS_NOT_CONFIGURED` only when a Teams feature is used
without them.

---

## Security & operational notes

- Read-only: the integration never posts, modifies, or deletes Teams content.
- **Metered API:** reading channel messages with application permissions is a
  Microsoft *protected/metered* Graph API. Trial tenants have an evaluation cap;
  production needs an Azure subscription linked for billing.
- Responses go through `safeJson`, which blocks Mongoose internals from leaking.

---

## Pipeline routing

All three content types route into the Document Ingestion Pipeline through
`IDocumentIngestionPort`, gated on a resolved `projectId` and idempotent
(`routedToPipeline` / `downloaded` flags):

| Content | documentType | Toggle |
|---|---|---|
| File attachments | inferred (`drawing`/`photo`/`other`) | `TEAMS_FILE_INGEST_ENABLED` |
| Meeting transcripts (plain text from VTT) | `transcript` | `TEAMS_TRANSCRIPT_INGEST_ENABLED` |
| Channel messages (non-trivial, ≥2 chars) | `other` (`metadata.kind: channel-message`) | `TEAMS_MESSAGE_INGEST_ENABLED` |

Transcript meeting-id resolution: `discoverFromChannelEvent` uses
`eventDetail.meetingId` when present, else resolves the organizer's
`calendarView` → `joinWebUrl` → `onlineMeetings` (channel meetings only,
`@thread.tacv2`). The organizer id must be the AAD **object id** (Graph
`/onlineMeetings` rejects the UPN). `getAllTranscripts` is not used in the
production path (it omits channel meetings); it remains for diagnostics.

## Roadmap

- **Webhooks (real-time):** Graph change-notification subscriptions with the
  ~1-hour renewal cron; polling remains the reliability backstop.
