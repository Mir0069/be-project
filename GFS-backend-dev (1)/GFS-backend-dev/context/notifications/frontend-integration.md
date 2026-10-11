# Notifications — Frontend Integration Guide

## Base URL

```text
/api/v1/notifications
```

All endpoints require authentication cookies (`accessToken`). Use `credentials: 'include'`
(axios `withCredentials: true`). Notifications are role-targeted — the API automatically
filters to the logged-in user's role (`ESTIMATOR` / `SALES_MANAGER`); no role param is sent
by the client. The raw `readBy` list is never returned; each item carries a computed
`isRead` for the current user.

## Notification shape

```jsonc
{
  "id": "665f...",
  "type": "PROJECT_CREATED",
  "title": "New project created",
  "message": "Project PRJ-2026-0007 was created for Acme Corp.",
  "projectId": "665e...",            // navigate here on click (may be null)
  "payload": {                        // free-form, type-dependent
    "referenceNumber": "PRJ-2026-0007",
    "projectName": "Acme Corp",
    "zohoLeadId": "8837...."
  },
  "isRead": false,
  "createdAt": "2026-06-24T10:15:00.000Z"
}
```

`type` is an enum — today only `PROJECT_CREATED`. Render icon/route per type and treat
unknown types defensively (more will be added).

---

## `GET /` — list (paginated)

| Query | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | number | `1` | |
| `limit` | number | `20` | max `100` |

**200**
```json
{
  "success": true,
  "data": {
    "items": [ /* Notification shape, newest first */ ],
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3,
    "unreadCount": 5
  }
}
```

## `GET /unread-count` — badge count

**200**
```json
{ "success": true, "data": { "count": 5 } }
```

## `PATCH /:id/read` — mark one read

`:id` is the notification id. **200**
```json
{ "success": true, "message": "Notification marked as read" }
```
`404` if the id does not exist.

## `POST /mark-all-read` — mark all (for my role) read

**200**
```json
{ "success": true, "data": { "modified": 5 } }
```

## `GET /stream` — live updates (SSE)

Server-Sent Events. Open with the browser `EventSource` and **`withCredentials: true`**
(needed so the auth cookie is sent):

```ts
const es = new EventSource(`${VITE_API_BASE_URL}/notifications/stream`, {
  withCredentials: true,
});
```

Messages are line-delimited `data:` JSON frames:

```text
data: {"type":"CONNECTED"}

data: {"type":"NOTIFICATION_CREATED","data": { /* Notification shape, isRead:false */ }}
```

- `CONNECTED` — sent once on connect (handshake; ignore or use to clear error state).
- `NOTIFICATION_CREATED` — a new notification targeting your role. Recommended handling:
  invalidate the `["notifications"]` and `["notifications","unread"]` React Query keys
  (and optionally raise a toast). The badge/list then refetch authoritative state.

The stream only delivers notifications whose `roles` include the connected user's role, so
no client-side role filtering is required.

### Cross-origin / cookies

Local dev frontend (`:5173`) and backend (`:3000`) share the `localhost` site, so the
`accessToken` cookie is sent on both `apiClient` requests and the `EventSource`. Backend
CORS must allow the frontend origin with credentials — ensure backend `FRONTEND_URL` is the
frontend dev origin (e.g. `http://localhost:5173`).
