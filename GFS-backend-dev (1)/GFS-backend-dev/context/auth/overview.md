# Auth Module — Overview

## Purpose

Handles all authentication and authorization for the GFS platform. Users cannot self-register — a `SYSTEM_ADMIN` must create every account. Both local (email + password) and OAuth (Microsoft, Google) sign-in are supported.

---

## Roles

| Role | Description |
|------|-------------|
| `SYSTEM_ADMIN` | Can create any user. Cannot sign in via OAuth. |
| `SALES_MANAGER` | Can manage projects and client accounts. |
| `ESTIMATOR` | Creates and manages proposals/estimates. |

Role is stored on the user document and embedded in every JWT access token. Authorization is enforced at the route level by the `authorize(...roles)` middleware.

---

## Architecture

```
auth.router.ts          → wires routes, DI, applies middleware
auth.controller.ts      → HTTP layer: reads request, sets cookies, calls service
auth.service.ts         → business logic: validates, hashes, signs tokens
auth.middleware.ts      → authenticate (JWT verify) + authorize (role check)
auth.types.ts           → shared TypeScript interfaces
```

The controller and service are decoupled via constructor injection. The service depends on `IUserRepository` (interface), not directly on Mongoose — this keeps it testable and persistence-agnostic.

---

## Token Model

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access token | 15 minutes | `accessToken` httpOnly cookie | Proves identity on every request |
| Refresh token | 7 days | `refreshToken` httpOnly cookie | Issues new access tokens silently |

Both tokens are JWTs signed with separate secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`). The refresh token is also hashed with bcrypt and stored in MongoDB — this allows server-side invalidation on logout.

Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` (production only).

### Access token payload

```json
{
  "userId": "64f...",
  "email": "user@company.com",
  "role": "ESTIMATOR",
  "iat": 1700000000,
  "exp": 1700000900
}
```

---

## Endpoints

Base path: `/api/v1/auth`

### POST `/login`

Public. Validates email + password, issues both cookies.

**Request body**
```json
{ "email": "user@company.com", "password": "secret" }
```

**Success `200`**
```json
{ "success": true, "message": "Logged in successfully" }
```
Cookies `accessToken` and `refreshToken` are set.

**Errors**
| Status | Condition |
|--------|-----------|
| 400 | Blank email or password |
| 400 | Account uses OAuth — no password on record |
| 401 | Wrong password or email not found |

---

### POST `/register`

Protected: requires `authenticate` + `authorize(SYSTEM_ADMIN)`.

**Request body**
```json
{
  "email": "new.user@company.com",
  "password": "MinLength8",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "ESTIMATOR"
}
```

**Success `201`**
```json
{ "success": true, "message": "Registered successfully" }
```
Cookies set for the newly created user's session.

**Errors**
| Status | Condition |
|--------|-----------|
| 400 | Missing field, password < 8 chars, invalid role |
| 401 | Not authenticated |
| 403 | Caller is not `SYSTEM_ADMIN` |
| 409 | Email already in use |

Valid roles: `ESTIMATOR`, `SALES_MANAGER`, `SYSTEM_ADMIN`.

---

### POST `/refresh-token`

Public (but requires the `refreshToken` cookie to be present).

**Request**: no body. The `refreshToken` cookie is read automatically.

**Success `200`**
```json
{ "success": true, "message": "Token refreshed successfully" }
```
Both cookies are replaced with fresh tokens.

**Errors**
| Status | Condition |
|--------|-----------|
| 401 | Cookie missing, token invalid, token expired, or user has logged out |

---

### POST `/logout`

Protected: requires `authenticate`.

**Request**: no body.

**Success `200`**
```json
{ "success": true, "message": "Logged out successfully" }
```
Both cookies are cleared (set to expired). The stored refresh token hash is nullified in MongoDB — the refresh token becomes permanently invalid server-side.

---

### GET `/me`

Protected: requires `authenticate`.

**Success `200`**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "64f...",
      "email": "user@company.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "role": "ESTIMATOR",
      "authProvider": "LOCAL",
      "providerId": null,
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

`passwordHash` and `refreshTokenHash` are never included in any response.

---

### GET `/oauth/:provider`

Public. Initiates an OAuth consent flow. `:provider` is `microsoft` or `google`.

**Query params**
| Param | Required | Description |
|-------|----------|-------------|
| `role` | No | `ESTIMATOR` (default) or `SALES_MANAGER`. `SYSTEM_ADMIN` is not allowed via OAuth. |

Redirects the browser to the provider's consent page. Sets a short-lived (10 min) `oauthState` cookie for CSRF protection.

---

### GET `/oauth/:provider/callback`

Public. The OAuth provider redirects here after user consents.

Redirects the browser to:
- `{FRONTEND_URL}/login?oauth=success` — auth cookies set, login complete
- `{FRONTEND_URL}/login?oauth=access_denied` — user cancelled
- `{FRONTEND_URL}/login?oauth=failed` — exchange failed

---

## Middleware

### `authenticate`

Reads the `accessToken` cookie, verifies the JWT, and attaches the decoded payload to `req.user`:

```typescript
req.user = { userId: string; email: string; role: UserRole }
```

Calls `next(AppError(401))` if the token is missing, invalid, or expired.

### `authorize(...roles: UserRole[])`

Returns a middleware that checks `req.user.role` against the allowed roles. Calls `next(AppError(403))` if the role doesn't match or `req.user` is absent.

Usage in route definition:
```typescript
router.post('/register', authenticate, authorize(UserRole.SYSTEM_ADMIN), handler);
```

---

## Error Response Shape

All errors follow the global error handler format:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "statusCode": 401
}
```

---

## Security Notes

- Passwords are hashed with bcrypt (cost factor 10) before storage. Plaintext is never persisted.
- Refresh tokens are also bcrypt-hashed in MongoDB — compromising the DB does not yield usable tokens.
- Logout is server-side: nullifying the stored hash invalidates the token even if it hasn't expired.
- OAuth state is a signed JWT with a nonce — CSRF-protected via cookie comparison on callback.
- `SYSTEM_ADMIN` accounts cannot be created via OAuth, preventing privilege escalation through OAuth provider misconfiguration.
- Cookies are `SameSite=Lax` to prevent CSRF for state-mutating requests.
