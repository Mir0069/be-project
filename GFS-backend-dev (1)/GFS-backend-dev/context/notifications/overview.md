# Notifications — Module Overview

In-app notification center for estimators and sales managers. Surfaces project-related
events (the first being a project being auto-created from a Zoho lead) with a per-user
read/unread state and a live unread badge.

## Data model

`Notification` ([src/db/models/notification.model.ts](../../src/db/models/notification.model.ts)) — one row per event, **shared** by everyone it targets.

| Field | Meaning |
|-------|---------|
| `type` | `NotificationType` enum. Today: `PROJECT_CREATED`. Extension point for future events. |
| `title` / `message` | Display text. |
| `projectId` | Optional link to a `Project`; the frontend navigates here on click. |
| `roles` | `UserRole[]` the notification targets (e.g. `[ESTIMATOR, SALES_MANAGER]`). List/count queries filter by the caller's role. |
| `payload` | Free-form context (`referenceNumber`, `projectName`, `zohoLeadId`, …). |
| `readBy` | `ObjectId[]` of users who have read it — the **only** per-user state. |

Index: `{ roles: 1, createdAt: -1 }`.

### Shared row, per-user read state

There is exactly one document per event. The content is shared; the only thing that
differs between people is whether their id is in `readBy`. Reading is `$addToSet`
(atomic + idempotent), so one person reading never changes what another sees. The API
never returns the raw `readBy` array — it returns a computed `isRead` for the requester.

- **Unread count** = `countDocuments({ roles: myRole, readBy: { $ne: myId } })`
- **Mark read** = `$addToSet: { readBy: myId }`

## Emit flow (PROJECT_CREATED)

1. A Zoho lead reaches status `Need to Quote`. `ZohoSyncService.syncLead` creates a
   Project via `ZohoProjectService.createProjectFromLead`, which now returns the created
   `Project` (or `null` when it was an idempotent skip).
   ([src/features/zoho/zoho-sync.service.ts](../../src/features/zoho/zoho-sync.service.ts))
2. Only on a genuine creation, `ZohoSyncService` calls
   `notifier.notifyProjectCreated(...)`. The notifier is an optional dependency typed by
   the `IProjectCreatedNotifier` port
   ([src/features/zoho/project-notifier.port.ts](../../src/features/zoho/project-notifier.port.ts)),
   satisfied by `NotificationService` — so zoho has no import dependency on the
   notifications feature, and no circular reference.
3. The `zohoSyncService` singleton wired in
   [zoho.router.ts](../../src/features/zoho/zoho.router.ts) is the one used by **both** the
   webhook and the poller, so notifications fire on webhook **and** poll. The standalone
   sync scripts build their own service with no notifier, so bulk backfill never spams
   notifications.

## Real-time delivery (SSE)

`NotificationService.create` persists the row, then emits on an in-process
`EventEmitter` (`notificationEventBus`,
[notification.events.ts](../../src/features/notifications/notification.events.ts)). The
`GET /stream` endpoint subscribes per connected client and forwards a notification only
if its `roles` include that client's role. This mirrors the existing proposal SSE stream.

**Scaling note:** the event bus is in-process, so live push works within a single server
instance. If the API is scaled horizontally, move the fan-out onto the shared queue layer
(`src/shared/queues`) — the REST endpoints already read from MongoDB, so history/badge
stay correct regardless; only the live push is instance-local.

## Deferred (pending meeting)

Actionable **Yes/No** notifications (the mail-first project suggestion) are not built yet.
The schema is additive — they will later add optional `kind`/`status`/`actions`/
`resolvedBy`/`resolvedAt` fields, a `POST /:id/action` endpoint with a per-`type` resolver
registry, and **shared** resolution (first responder resolves for everyone, unlike
`readBy`). Existing `INFO` rows stay valid.
