# Teams Module — Frontend Integration Guide

API reference for building the Teams admin UI and the message/transcript views.
For architecture and data models see [overview.md](./overview.md); for auth/cookie
mechanics see [../auth/frontend-integration.md](../auth/frontend-integration.md).

## How it works from the frontend's perspective

- **Same cookie auth as the rest of the app** — httpOnly cookies, send
  `credentials: 'include'` (fetch) / `withCredentials: true` (Axios). No tokens
  in JS.
- **Most ingestion is automatic.** A backend poller pulls new channel content on
  an interval and links it to projects. These endpoints exist for the **admin UI**
  (choose channels, manual sync, manual link) and **read views** (messages,
  transcripts). The frontend never talks to Microsoft Graph directly.
- **Two access levels:** read endpoints (`/status`, `/messages`, `/transcripts`)
  need any logged-in user; everything else is **admin-only**
  (`SUPER_ADMIN` or `SYSTEM_ADMIN`) and returns `403` otherwise.

## Base URL

```
/api/v1/teams
```

All responses use the standard envelope: `{ success: true, data?, message? }` on
success, `{ success: false, message, code? }` on error.

---

## Endpoints

### Connection status — `GET /status` (any user)
```ts
// data
{ configured: boolean; cachedTokenExpiresAt: string | null; monitoredChannelCount: number }
```
Use to show whether the Teams integration is set up.

---

### List teams — `GET /teams` (admin)
```ts
// data
{ teams: { id: string; displayName: string; description?: string }[] }
```

### List a team's channels — `GET /teams/:teamId/channels` (admin)
```ts
// data
{ channels: { id: string; displayName: string; description?: string; webUrl?: string }[] }
```
Use these two to populate the "pick a channel to monitor" picker.

---

### List monitored channels — `GET /monitored-channels` (admin)
```ts
// data
{ channels: MonitoredChannel[] }
```

### Start monitoring a channel — `POST /monitored-channels` (admin)
```ts
// request body
{ teamId: string; teamName: string; channelId: string; channelName: string; projectId?: string }
// success 201 → data
{ channel: MonitoredChannel }
```
| Status | When |
|--------|------|
| 404 | `projectId` given but no such project |
| 409 | channel already actively monitored |

`projectId` is optional: set it to map every item from this channel to a project
automatically (`linkMethod: 'CHANNEL_MAP'`); omit it to rely on keyword matching.

### Stop monitoring — `DELETE /monitored-channels/:id` (admin)
```ts
// success 200 → { success: true, message: 'Channel monitoring stopped' }
```
`:id` is the monitored-channel DB id (`MonitoredChannel.id`), not the Graph
`channelId`. `404` if not found.

---

### Trigger a sync — `POST /sync` (admin)
```ts
// request body (optional)
{ channelDbId?: string }   // omit to sync ALL monitored channels
// success 200 → data
{
  channels: { channelId: string; channelName: string; ingested: number }[];
  errors:   { channelId: string; message: string }[];
}
```
`404` if `channelDbId` is given but not found. This is a **heavy, metered** call
(Graph protected API) — the poller normally handles syncing; expose it as a
manual "Sync now" button only.

---

### List messages — `GET /messages` (any user)
```ts
// query: ?projectId=&channelId=&page=&limit=   (all optional; page/limit are strings; default page 1, limit 50)
// data
{ messages: TeamsMessage[]; total: number }
```

### Link a message to a project — `POST /messages/:messageId/link` (admin)
```ts
// request body
{ projectId: string }
// success 200 → data
{ message: TeamsMessage }
```
Sets `linkMethod: 'MANUAL'` (never overwritten by a later sync) and routes the
message + its files to the AI pipeline. `404` if project or message not found.

### Re-process a message's files — `POST /messages/:messageId/process-files` (admin)
```ts
// success 200 → data
{ routed: number }   // count of attachments newly sent to the pipeline
```
`404` if message not found. Rarely needed from the UI (files route automatically
once a message has a project).

---

### Fetch a meeting's transcript on demand — `POST /transcripts/fetch` (admin)
```ts
// request body
{ userId: string; meetingId: string; projectId?: string }   // userId = organizer AAD object id
// success 200 → data
{
  meetingId: string;
  meetingSubject: string | null;
  transcripts: {
    transcriptId: string;
    stored: boolean;
    projectId: string | null;
    linkMethod: 'AUTO' | 'MANUAL' | null;
    routedToPipeline: boolean;
    byteSize: number;
  }[];
}
```
`404` if `projectId` given but not found. Mostly an admin/debug tool — channel
meeting transcripts are discovered automatically during sync.

### List transcripts — `GET /transcripts` (any user)
```ts
// query: ?projectId=&meetingId=&page=&limit=   (optional; page/limit are strings)
// data
{ transcripts: TeamsTranscript[]; total: number }
```
⚠️ Each item includes the full `contentVtt` **and** `contentText` — these can be
large. For a list view, render `meetingSubject` + `transcriptCreatedDateTime` and
load the text only on detail.

### Link a transcript to a project — `POST /transcripts/:transcriptId/link` (admin)
```ts
// request body
{ projectId: string }
// success 200 → data
{ transcript: TeamsTranscript }
```
Sets `linkMethod: 'MANUAL'` and routes the transcript text to the AI pipeline.
`404` if project or transcript not found.

---

## TypeScript types (mirror on the frontend)

```ts
export type TeamsLinkMethod = 'AUTO' | 'MANUAL' | 'CHANNEL_MAP';
export type TranscriptLinkMethod = 'AUTO' | 'MANUAL';
export type DiscoveredVia = 'CHANNEL_EVENT' | 'MANUAL';

export interface MonitoredChannel {
  id: string;                 // DB id — use for DELETE / sync
  teamId: string;
  teamName: string;
  channelId: string;          // Graph id
  channelName: string;
  projectId: string | null;
  deltaLink: string | null;
  isActive: boolean;
  createdAt: string;          // ISO
  updatedAt: string;
}

export interface TeamsMessageAttachment {
  id: string;
  name: string | null;
  contentType: string | null;
  contentUrl: string | null;
  downloaded: boolean;        // true once routed to the pipeline
}

export interface TeamsMessage {
  id: string;
  messageId: string;          // Graph id
  teamId: string;
  channelId: string;
  parentMessageId: string | null;
  fromName: string | null;
  fromId: string | null;
  contentText: string;        // HTML stripped
  contentHtml: string | null;
  webUrl: string | null;
  createdDateTime: string;    // ISO
  attachments: TeamsMessageAttachment[];
  projectId: string | null;
  linkMethod: TeamsLinkMethod | null;
  routedToPipeline: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamsTranscript {
  id: string;
  transcriptId: string;
  meetingId: string;
  userId: string;             // organizer object id
  meetingSubject: string | null;
  meetingJoinUrl: string | null;
  contentVtt: string;         // raw WebVTT (can be large)
  contentText: string;        // plain text
  byteSize: number;
  transcriptCreatedDateTime: string | null;
  projectId: string | null;
  linkMethod: TranscriptLinkMethod | null;
  routedToPipeline: boolean;
  monitoredChannelDbId: string | null;
  teamId: string | null;
  channelId: string | null;
  discoveredVia: DiscoveredVia | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

## Field meanings the UI cares about

- **`linkMethod`** — how the item got its project: `CHANNEL_MAP` (channel→project
  mapping), `AUTO` (keyword/auto match), `MANUAL` (admin linked), `null`
  (unlinked — show a "Link to project" action). `MANUAL` survives re-syncs.
- **`routedToPipeline`** — whether the content was sent to the AI document pipeline.
  Only becomes `true` once the item has a `projectId`. Use it to show an
  "in AI" indicator.
- **`discoveredVia`** (transcripts) — `CHANNEL_EVENT` (auto from a monitored
  channel meeting) vs `MANUAL` (via `POST /transcripts/fetch`).

## Common gotchas

- **Admin endpoints return `403`** for `ESTIMATOR` / `SALES_MANAGER`. Gate the
  admin UI (channel picker, sync, link, fetch) behind the user's role.
- **Transcripts exist only for *scheduled* meetings.** Ad-hoc "Meet now" channel
  calls produce no transcript via the API — set expectations in the UI ("start
  the meeting from a scheduled calendar invite to capture a transcript").
- **`page`/`limit` are query strings**, not numbers; the server parses them
  (defaults: page 1, limit 50).
- **`/sync` is metered + slow** — debounce the button, show a spinner, and read
  `data.errors[]` to surface per-channel failures.
- **`409` on add** means the channel is already monitored — reflect that in the
  picker instead of erroring out.
