# Zoho CRM Integration — Setup Guide for GFS Admin

This document is for the **Zoho CRM administrator** at GFS. The GFS application connects to your Zoho CRM to read and write deal/project data. Please follow the steps below to generate the credentials our development team needs, and share them securely.

---

## Part A — Credentials & Information Required

Please fill in the values below and share this completed document securely (password manager / encrypted file — **not** email or Slack).

| # | Item | Value |
|---|---|---|
| 1 | **Zoho Region** | ☐ US (.com)  ☐ EU (.eu)  ☐ IN (.in)  ☐ AU (.com.au) |
| 2 | **Zoho Client ID** | `_____________________________________________` |
| 3 | **Zoho Client Secret** | `_____________________________________________` |
| 4 | **Zoho Admin Name** (contact for future re-auth) | `_____________________________________________` |
| 5 | **Zoho Admin Email** | `_____________________________________________` |
| 6 | **Authorized Redirect URI whitelisted** (development) | ☐ Confirmed added |

---

## Part B — Required Permission Scope

The Zoho app must be authorized with the following scope:

```
ZohoCRM.modules.ALL
```

This grants **full read/write access** to CRM records (Leads, Contacts, Deals, etc.) — which the GFS system needs to sync project and deal data.

---

## Part C — Step-by-Step Instructions for Zoho Admin

### Step 1 — Open the Zoho API Console
- **US region:** https://api-console.zoho.com/
- (Use the matching domain for your region: `.eu`, `.in`, `.com.au`)

Sign in with your **Zoho admin account**.

### Step 2 — Create a new client
1. Click **"Add Client"** (or **"GET STARTED"** if this is your first app).
2. For **Client Type**, choose **Server-based Applications**.
3. Click **Create**.

### Step 3 — Fill in the application details

| Field | Value to enter |
|---|---|
| **Client Name** | `GFS Backend Integration` (or your preferred name) |
| **Homepage URL** | `_____________________________________________` *(your company website or app URL)* |
| **Authorized Redirect URI** | Paste the URL provided by the development team — see Step 4 below |

### Step 4 — Add the Authorized Redirect URI

The development team will provide the **development** URL for now. Production and staging URLs will be added later once those environments are finalized.

Add the URL below by clicking the **+** button:

```
Development:  __________________________________________________
```

> ⚠️ **Important:** This URL must be added exactly as provided — character-for-character, including `http`/`https`, port numbers, and the trailing path. Zoho does an exact string match; even a missing slash will break the integration.
>
> 📝 **Note:** Once the production environment is set up, the development team will share additional URLs (staging, production) which you'll need to add to this same list.

### Step 5 — Save and retrieve credentials
1. Click **CREATE**.
2. Zoho will display your **Client ID** and **Client Secret** on the next screen.
3. Copy both into **Part A** of this document.

> 🔒 **Treat the Client Secret like a password.** Anyone with this value can impersonate the GFS application. Do not paste it into chat, email, ticketing systems, or screenshots.

### Step 6 — Confirm your region
At the top of the API Console URL bar, confirm whether you are on `.com`, `.in`, `.eu`, or `.com.au` and tick the matching box in **Part A**.

---

## Part D — Secure Handover

Once the document is complete:

1. **Do NOT** send credentials via:
   - ❌ Email
   - ❌ Slack / Teams / WhatsApp
   - ❌ SMS
   - ❌ Plain text files attached to tickets

2. **DO** use one of the following:
   - ✅ Shared password manager vault (1Password, Bitwarden, LastPass)
   - ✅ Encrypted file (PGP / GPG / age)
   - ✅ Secure secret-sharing service (e.g., onetimesecret.com — link expires after one view)
   - ✅ Verbal phone call (for the Client Secret only)

3. After delivery, **keep your own copy** of the Client ID + Client Secret in your password vault as a backup. (Refresh tokens do not need backing up — they can be regenerated through re-authorization.)

---

## Part E — One-Time Authorization (Required at Each Environment Setup)

Once the development team configures the credentials, you (the Zoho admin) will be asked to perform a **one-time authorization** for each environment (development now, staging and production later):

1. The team will provide you a link similar to:
   `http://<environment-host>/api/v1/zoho/auth`
2. Open the link **while signed in to your Zoho admin account**.
3. Zoho will show a consent screen asking permission for the GFS app to access CRM data.
4. Click **Allow / Accept**.
5. You'll see a confirmation page — that's it.

After this single click per environment, the integration runs automatically forever. Tokens refresh in the background; no further admin action is needed unless:
- You revoke access in Zoho Settings → Connected Apps
- The credentials are rotated for security reasons

> 📝 You'll repeat this single-click authorization later for staging and production once those environments are ready.

---

## Part F — Revocation & Security Incident Response

If the Client Secret or any token is ever exposed (committed to a public repo, leaked in logs, shared with the wrong person):

1. **Immediately** revoke access in **Zoho → Settings → Connected Apps**, OR delete the Self-Client in the API Console.
2. Generate a new Client ID + Client Secret.
3. Notify the development team — they will update the production configuration and re-authorize.

---

## Part G — Checklist (for the Zoho Admin before handover)

Before sending this completed document back to the development team, please confirm:

- [ ] All fields in **Part A** are filled in
- [ ] Region and environment are ticked correctly
- [ ] The development Redirect URI is whitelisted in the Zoho app
- [ ] Client Secret has been delivered via a **secure** channel (not email/chat)
- [ ] You have retained a backup copy of Client ID + Secret in your password vault
- [ ] You are available to perform the one-time authorization when requested
- [ ] You are available to add staging/production Redirect URIs to the same Zoho app later, once those environments are finalized

---

## Contact

For questions, please reach out to:

- **Development Team Lead:** `_____________________________________________`
- **Email:** `_____________________________________________`
- **Preferred response time:** `_____________________________________________`

---

*Document version: 1.0 — Prepared by Amberflux for GFS Zoho CRM Integration*
