# Auth Module — Frontend Integration Guide

## How auth works from the browser's perspective

All tokens live in **httpOnly cookies** — the frontend never touches the JWT strings directly. This means:

- No `localStorage`, no `Authorization` header, no manual token management.
- Every request must include `credentials: 'include'` (or `withCredentials: true` in Axios).
- The browser sends cookies automatically on same-origin or configured cross-origin requests.
- Token refresh is transparent — call `/refresh-token` when a `401` comes back and retry.

---

## Base URL

```
/api/v1/auth
```

---

## CORS / credentials setup

Your HTTP client must send cookies. Configure once at the client level:

**fetch**
```ts
const api = (path: string, init?: RequestInit) =>
  fetch(`/api/v1${path}`, { ...init, credentials: 'include' });
```

**Axios**
```ts
const api = axios.create({ baseURL: '/api/v1', withCredentials: true });
```

---

## Endpoints

### Login

```
POST /auth/login
```

**Request**
```ts
{
  email: string;    // trimmed, case-insensitive
  password: string;
}
```

**Success `200`**
```ts
{ success: true; message: string }
// cookies accessToken + refreshToken are set automatically
```

**Errors**
| Status | Message | When |
|--------|---------|------|
| 400 | `Email and password are required` | Blank fields |
| 400 | `Please login with your OAuth provider` | Account was created via OAuth, has no password |
| 401 | `Invalid email or password` | Wrong credentials or account not found |

---

### Get current user

```
GET /auth/me
```

Requires the user to be logged in (access token cookie present and valid).

**Success `200`**
```ts
{
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: 'ESTIMATOR' | 'SALES_MANAGER' | 'SYSTEM_ADMIN';
      authProvider: 'LOCAL' | 'MICROSOFT' | 'GOOGLE';
      providerId: string | null;
      isActive: boolean;
      createdAt: string; // ISO 8601
      updatedAt: string; // ISO 8601
    };
  };
}
```

**Errors**
| Status | When |
|--------|------|
| 401 | Not logged in / access token expired |
| 404 | User deleted after token was issued |

---

### Refresh tokens

```
POST /auth/refresh-token
```

Call this when any protected endpoint returns `401`. No body needed — the `refreshToken` cookie is read server-side.

**Success `200`**
```ts
{ success: true; message: string }
// Both cookies are replaced with fresh tokens
```

**Errors**
| Status | When |
|--------|------|
| 401 | Refresh token missing, expired, or invalidated by logout |

If refresh returns `401`, the session is fully expired — redirect the user to `/login`.

---

### Logout

```
POST /auth/logout
```

Requires the user to be logged in.

**Success `200`**
```ts
{ success: true; message: string }
// Both cookies are cleared (set to expired)
```

The server also nullifies the refresh token hash in the database — the session cannot be restored even if the browser cached the old cookie.

---

### Register a new user

```
POST /auth/register
```

**Only callable by a logged-in `SYSTEM_ADMIN`.** Not a self-registration endpoint.

**Request**
```ts
{
  email: string;
  password: string;         // minimum 8 characters; max 72 UTF-8 bytes; uppercase, lowercase, number, and special character required
  firstName: string;
  lastName: string;
  role: 'ESTIMATOR' | 'SALES_MANAGER' | 'SYSTEM_ADMIN';
}
```

**Success `201`**
```ts
{ success: true; message: string }
// Cookies are set for the new user's session
```

**Errors**
| Status | Message | When |
|--------|---------|------|
| 400 | Password-policy message | Password does not meet the current length, complexity, common-password, personal-information, or UTF-8 byte requirements |
| 400 | `Invalid role. Allowed roles: ...` | Unknown role string |
| 401 | — | Caller not authenticated |
| 403 | — | Caller is not `SYSTEM_ADMIN` |
| 409 | `User already exists with this email` | Duplicate email |

---

### OAuth — Microsoft / Google

#### Step 1 — Redirect to provider

Navigate (full-page redirect) to:

```
GET /auth/oauth/microsoft          → Microsoft consent
GET /auth/oauth/google             → Google consent
```

Optional query param:

```
?role=SALES_MANAGER    (default: ESTIMATOR)
```

`SYSTEM_ADMIN` cannot be assigned via OAuth.

```ts
// Trigger from the frontend — this is a full redirect, not a fetch call
window.location.href = '/api/v1/auth/oauth/microsoft?role=ESTIMATOR';
```

#### Step 2 — Handle the callback redirect

After the user consents (or cancels), the backend redirects the browser to:

```
{FRONTEND_URL}/login?oauth=success       → auth cookies set, login complete
{FRONTEND_URL}/login?oauth=access_denied → user cancelled
{FRONTEND_URL}/login?oauth=failed        → exchange error
```

Read the `oauth` query param on your `/login` page and react accordingly:

```ts
const params = new URLSearchParams(window.location.search);
const oauthResult = params.get('oauth');

if (oauthResult === 'success') {
  // cookies are already set — fetch /me to get user data
} else if (oauthResult === 'access_denied') {
  showMessage('Sign-in was cancelled.');
} else if (oauthResult === 'failed') {
  showMessage('Sign-in failed. Please try again.');
}
```

---

## Recommended auth flow

```
App loads
  └─ GET /auth/me
       ├─ 200 → user is logged in, store user data
       └─ 401 → user is not logged in
                 ├─ show login page
                 └─ on 401 from any later request:
                       POST /auth/refresh-token
                         ├─ 200 → retry original request
                         └─ 401 → session expired, redirect to /login
```

### Axios interceptor example

```ts
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      try {
        await api.post('/auth/refresh-token');
        return api(original);
      } catch {
        // refresh also failed — full logout
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);
```

---

## TypeScript types (mirror on the frontend)

```ts
export type UserRole = 'ESTIMATOR' | 'SALES_MANAGER' | 'SYSTEM_ADMIN';
export type AuthProvider = 'LOCAL' | 'MICROSOFT' | 'GOOGLE';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  authProvider: AuthProvider;
  providerId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}
```

---

## Common gotchas

**Cookies not being sent**
Make sure every request sets `credentials: 'include'` (fetch) or `withCredentials: true` (Axios). Without this, the browser silently drops cookies on cross-origin requests.

**`401` on `/me` right after login**
The access token cookie is `SameSite=Lax`. If your frontend and backend are on different origins during development, use a proxy (e.g., Vite `server.proxy`) to make requests appear same-origin, or configure `SameSite=None; Secure` in the backend `.env` for dev.

**Refresh token cleared after logout**
After `POST /logout`, the server-side refresh token hash is nullified. Calling `/refresh-token` afterwards will always return `401` — there is no way to restore the session without logging in again.

**OAuth role assignment**
The role for an OAuth sign-in is locked at first sign-in. If the user's record already exists in the database (matched by `providerId`), the role on the existing record is used — the `role` query param is ignored for returning users.

**`SYSTEM_ADMIN` cannot use OAuth**
The `?role=SYSTEM_ADMIN` query param is silently downgraded to `ESTIMATOR` on the OAuth redirect endpoint. Admin accounts must be created via `POST /register` or the seed script.
