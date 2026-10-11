# Users Module — Overview

## Purpose

Admin-facing user management. A `SYSTEM_ADMIN` or `SUPER_ADMIN` creates new Estimators or Sales Managers. The new user gets an emailed **setup link** and picks their own password. A parallel **forgot-password** flow lets any user reset their own password by email.

---

## Endpoints

### POST `/api/v1/users/createuser` (admin)

Requires `authenticate` + `authorize(SYSTEM_ADMIN, SUPER_ADMIN)`.

**Request body**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "role": "ESTIMATOR"
}
```
`role` must be `ESTIMATOR` or `SALES_MANAGER`.

**Success `201`**
```json
{
  "success": true,
  "message": "User created. Invite email sent.",
  "data": {
    "user": { "id": "...", "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "role": "ESTIMATOR" },
    "inviteSent": true
  }
}
```
The user is created with **no `passwordHash`**. Their account becomes log-in-able only after they click the invite link and choose a password.

**Errors**

| Status | Condition |
|--------|-----------|
| 400 | Missing/invalid field, role not in allowed set |
| 401 | Not authenticated |
| 403 | Caller is not `SYSTEM_ADMIN` or `SUPER_ADMIN` |
| 409 | Email already exists |

---

### GET `/api/v1/users/getalluser` (admin)

Returns all users with public fields only.

**Success `200`**
```json
{
  "success": true,
  "data": {
    "users": [
      { "id": "...", "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "role": "ESTIMATOR" }
    ]
  }
}
```

---

### POST `/api/v1/auth/forgot-password` (public)

**Request body**
```json
{ "email": "jane@example.com" }
```

**Success `200`** — always, regardless of whether the email exists.
```json
{ "success": true, "message": "If an account exists for that email, a reset link has been sent." }
```
If a LOCAL user with that email exists, a reset link is emailed. Outstanding RESET tokens for that user are invalidated first.

---

### POST `/api/v1/auth/set-password` (public)

Used for **both** the invite flow (new user) and the reset flow (existing user). The token's `purpose` is stored server-side; the user submits the same shape either way.

**Request body**
```json
{ "token": "<raw token from email>", "password": "MyNewPass123" }
```

**Success `200`**
```json
{ "success": true, "message": "Password set successfully. You can now log in." }
```

**Errors**

| Status | Condition |
|--------|-----------|
| 400 | Token missing, unknown, expired, or already consumed |
| 400 | Password shorter than 8 characters |

---

## Token mechanism

`passwordresettokens` collection:

| Field | Notes |
|---|---|
| `userId` | ref User |
| `tokenHash` | sha256 of the raw token; the raw token only exists in the email URL |
| `purpose` | `INVITE` (from createuser) or `RESET` (from forgot-password) |
| `expiresAt` | TTL-indexed; MongoDB auto-purges |
| `consumedAt` | non-null after the token is used |

Raw token: 32 bytes hex (64 chars). One-time use — verified by `consumedAt === null` and `expiresAt > now`.

| Purpose | Expiry | Email link URL |
|---|---|---|
| INVITE | 7 days | `{FRONTEND_URL}/set-password?token=<raw>` |
| RESET | 24 hours | `{FRONTEND_URL}/reset-password?token=<raw>` |

---

## Login behavior with invited users

A LOCAL user without a `passwordHash` (invited but hasn't set a password) gets:

```json
{ "success": false, "message": "Account setup pending. Please use the setup link emailed to you." }
```
Status 400. OAuth-only accounts still get the existing *"Please login with your OAuth provider"* message.

---

## Files

```
src/features/users/
  users.router.ts        → routes + guards + DI
  users.controller.ts    → HTTP layer
  users.service.ts       → create user → issue INVITE token → send invite email
  users.validation.ts    → Zod schema
  users.types.ts         → request/response interfaces

src/features/auth/
  auth.service.ts        → forgotPassword + setPassword + login update
  auth.controller.ts     → handlers
  auth.router.ts         → routes
  auth.validation.ts     → Zod schemas for forgot/set-password

src/db/models/password-reset-token.model.ts
src/repositories/{interfaces,mongoose}/password-reset-token.repository.ts

src/shared/utils/generate-token.ts            → generateRawToken + hashToken (sha256)
src/shared/mailer/templates/invite.template.ts
src/shared/mailer/templates/password-reset.template.ts
```

---

## Required env vars

```
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=<gmail address>
MAIL_PASS=<gmail app password>
MAIL_FROM=<sender address>
FRONTEND_URL=<host the email links point to>
```
