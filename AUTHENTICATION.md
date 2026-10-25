# HealthywaysSA authentication system

This guide describes the implemented authentication system across the backend and the Healthy Ways SA frontend. It uses MongoDB-backed Express sessions, secure cookies, CSRF protection, email verification, customer login email OTP, and administrator TOTP—not application JWTs. Example identities, IDs, timestamps, codes, and tokens are placeholders.

## 1. Authentication overview

The API uses a **server-side Express session stored in MongoDB**, not an application JWT. The server regenerates the session ID after authentication-state transitions and stores the user's ID and session version in the session. For customers, a password plus verified email starts a separate, five-minute email OTP challenge; the fully authenticated session is created only after the OTP is confirmed. Administrators must verify their email and complete authenticator-app TOTP enrollment or login before receiving a fully authenticated session.

Cookie-authenticated state-changing requests also require CSRF protection. The client first obtains a CSRF token from `GET /api/v1/auth/csrf-token`, keeps the returned token, and sends it in the `x-csrf-token` header on POST, PATCH, PUT, and DELETE requests. The browser/client must also retain and send the session and CSRF cookies.

Authentication answers **who is making the request**. `requireAuthentication` loads and validates the current session and account. Authorization answers **whether that user may perform this operation**. Administrator routes additionally use `requireAdministrator` to check the `admin` role, and administrator sessions also require an eligible exact email domain and completed TOTP.

## 2. Repository file map

| File | Responsibility |
|---|---|
| `src/server.ts` | Loads environment settings, connects to MongoDB, initializes indexes, configures Resend where available, creates the app, and listens on `PORT`. |
| `src/app.ts` | Configures Helmet, exact-origin CORS, JSON parsing, Mongo-backed sessions, CSRF protection, route prefixes, and the final 404/error handlers. |
| `src/routes/v1/auth.routes.ts` | Defines the actual `/api/v1/auth` routes, authentication guards, and per-route rate limits. |
| `src/routes/v1/users.routes.ts` | Defines authenticated `/api/v1/users` profile and address routes. |
| `src/controllers/auth.controller.ts` | Parses auth inputs and handles register, login, logout, verification, reset, Google OIDC, and current-user responses. |
| `src/controllers/two-factor.controller.ts` | Handles TOTP enrollment, confirmation, login challenge, status, recovery-code rotation, and disablement. |
| `src/controllers/users.controller.ts` | Handles profile and saved-address operations. |
| `src/controllers/session.controller-utils.ts` | Regenerates and saves authenticated or pending-2FA sessions; provides recent-authentication checks. |
| `src/services/auth.service.ts` | Password hashing and verification, registration, email tokens, profile updates, and saved addresses. |
| `src/services/auth-policy.ts` | Exact `@healtywayssa.co.za` administrator email eligibility policy. |
| `src/services/login-otp.service.ts` | Session-bound, HMAC-hashed, expiring, one-use customer login codes and attempt limits. |
| `src/services/two-factor.service.ts` | TOTP encryption/verification and recovery-code management. |
| `src/services/identity.service.ts` | Creates and links Google identities and resolves active users. |
| `src/services/google-oidc.service.ts` | Performs Google OpenID Connect authorization and callback validation. |
| `src/services/oauth.service.ts` | Persists short-lived, single-use OAuth transactions bound to a session. |
| `src/services/email.service.ts` | Resend and unconfigured adapters for verification, login OTP, and password-reset messages. |
| `src/middleware/require-authentication.ts` | Validates session identity/version/account state and pending 2FA state. |
| `src/middleware/require-administrator.ts` | Checks the `admin` role after authentication. |
| `src/middleware/csrf.ts` | Configures `csrf-csrf` to bind CSRF validation to the Express session ID and `x-csrf-token`. |
| `src/middleware/error-handler.ts` | Converts validation, CSRF, safe HTTP, and unexpected errors into JSON responses. |
| `src/validation/auth.schemas.ts` | Zod validation for credentials, email tokens, profiles, and addresses. |
| `src/validation/two-factor.schemas.ts` | Zod validation for TOTP and recovery codes. |
| `src/models/user.model.ts` | User, role, account, session-version, 2FA, and saved-address fields. |
| `src/models/email-token.model.ts` | Hashed, expiring email verification and password-reset tokens. |
| `src/models/login-otp.model.ts` | Session-bound records for customer login OTPs. |
| `src/models/oauth-transaction.model.ts` and `src/models/external-identity.model.ts` | Google OIDC transaction and linked-identity persistence. |
| `tests/stage2-auth.test.ts`, `tests/stage3-auth.test.ts`, `tests/email.service.test.ts`, `tests/foundation.test.ts` | Auth, CSRF/session, OAuth, 2FA, email, and environment behavior tests. |

## 3. Prerequisites and environment

The project requires Node.js `>=20.19.0`, npm, and a reachable MongoDB database. The default local port is `3000`.

Authentication-related environment variables validated in `src/config/env.ts`:

| Variable | Purpose and validation |
|---|---|
| `MONGODB_URI` | MongoDB connection string. The backend stores users, sessions, tokens, identities, and OAuth transactions in MongoDB. |
| `SESSION_SECRET` | Required; trimmed and at least 32 characters. Signs Express sessions and is also used by CSRF protection. |
| `PORT` | Optional integer from 1 to 65535; defaults to `3000`. |
| `NODE_ENV` | `development`, `test`, or `production`; defaults to `development`. Controls cookie naming/security and production email requirements. |
| `SESSION_SAME_SITE` | `strict`, `lax`, or `none`; defaults to `lax`. `none` causes Secure cookies and therefore requires HTTPS. |
| `TRUST_PROXY` | `true` or `false`; defaults to `false`. Set true only behind a trusted proxy that supplies the expected forwarded protocol. |
| `FRONTEND_ORIGIN` | Optional exact HTTP(S) frontend origin, not a URL with a path. Enables credentialed CORS for that exact origin. Required in production and when email delivery is configured. |
| `RESEND_API_KEY` | Resend API key. Required in production; kept server-side. |
| `EMAIL_FROM` | Verified sender identity for Resend. Required in production. |
| `TOTP_ENCRYPTION_KEY` | Required base64 encoding of exactly 32 bytes. Used to encrypt authenticator secrets using AES-256-GCM. |
| `REQUIRE_ADMIN_2FA` | Must be `true`; administrator TOTP is mandatory and `false` fails environment validation. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Optional Google OIDC configuration, but all three must be set together. The callback URI must be HTTPS (HTTP is allowed for localhost) and exactly `/api/v1/auth/google/callback`. |

When `NODE_ENV=production`, the environment validator requires `RESEND_API_KEY`, `EMAIL_FROM`, and `FRONTEND_ORIGIN`. In development, an unconfigured email adapter is used unless all the email settings are supplied. That adapter reports that delivery did not happen.

Create local settings without copying real secrets into source control:

```powershell
Copy-Item .env.example .env
# Edit .env locally: set MONGODB_URI, SESSION_SECRET, and TOTP_ENCRYPTION_KEY.
npm install
npm run dev
```

`npm run dev` runs `tsx watch src/server.ts`. The production scripts are `npm run build` followed by `npm start`.

## 4. Cookie, session, CSRF, CORS, and JWT behavior

### Session cookies

- The session cookie is `hw.sid` in development/test and `__Host-hw.sid` in production.
- It is HTTP-only, has path `/`, uses the configured `SESSION_SAME_SITE`, and has an eight-hour `maxAge`.
- It is Secure in production or when `SESSION_SAME_SITE=none`.
- Sessions are stored by `connect-mongo` in MongoDB's `sessions` collection; the store has an eight-hour TTL and `touchAfter: 60`.
- Sessions use rolling expiration, so activity refreshes the cookie lifetime.
- Successful primary login regenerates the session ID to reduce session fixation risk.
- Password reset increments `sessionVersion`; middleware rejects sessions containing an older version.
- Logout destroys the server-side session and clears both session and CSRF cookies.

An authenticated session contains `userId`, `sessionVersion`, and `authenticatedAt`. Admin 2FA can additionally set `secondFactorVerifiedAt`. An unfinished 2FA login contains a pending user ID, version, mode, and five-minute expiry; it is not an authenticated session and cannot access protected resources.

### CSRF

The CSRF cookie is `hw.csrf` outside production and `__Host-hw.csrf` in production. It is also HTTP-only, uses the session cookie's Secure/SameSite policy, and has path `/`. The app globally installs `doubleCsrfProtection`; the configured token header is `x-csrf-token`, and token/session binding uses the Express session ID.

The route `GET /api/v1/auth/csrf-token` initializes and saves the session, sets cookies, and returns `{ "csrfToken": "..." }`. Use that value in the `x-csrf-token` header for state-changing requests. After login or another session regeneration, fetch a fresh CSRF token before the next state-changing call.

Safe GET requests do not require the CSRF header. The CSRF token endpoint itself is rate-limited. A failed CSRF check returns HTTP `403` and:

```json
{ "error": "Invalid or missing CSRF token." }
```

### CORS

If `FRONTEND_ORIGIN` is configured, CORS allows only that exact origin and sets `Access-Control-Allow-Credentials: true`. Other origins receive no CORS allow-origin header. If the variable is omitted, CORS middleware is not enabled. CORS does not replace CSRF protection. A browser frontend must use credentialed requests (for example, `credentials: "include"`) and send the CSRF header.

### JWT

There is no application JWT route, JWT response, JWT middleware, or bearer-token authentication in the current code. The Google OIDC flow validates Google's authorization response/identity token internally; it then establishes the backend's normal session cookie. Clients must not look for an application JWT or send a JWT bearer token.

## 5. Authentication API routes

All paths below include the actual prefix. Unless stated otherwise, JSON request bodies are strict: unexpected fields are rejected. Any POST/PATCH/DELETE request must include the CSRF header and retain cookies. Authentication is stated separately from CSRF.

Auth routes have a default rate limit of 10 requests per 15 minutes per route limiter instance on the routes where one is installed. The limit response is HTTP `429`:

```json
{ "error": "Too many attempts. Please try again later." }
```

Validation errors are HTTP `400` with `{ "error": "Invalid request." }`. Safe service errors generally return their specific message as `{ "error": "..." }`.

### Session and credentials

| Method and path | Access / CSRF | Input | Success |
|---|---|---|---|
| `GET /api/v1/auth/csrf-token` | Public; no CSRF header; retain cookies | None | `200` `{ "csrfToken": "<returned token>" }`; sets session and CSRF cookies. |
| `POST /api/v1/auth/register` | Public; CSRF required | `email`, `password`; optional `displayName`, `phoneNumber`. Email must be valid and <=254 chars and is lowercased. Password is 12–128 chars. Display name is 1–100 chars; phone is 1–30 chars. | `201` `{ "user": <public user>, "emailVerificationEmailSent": true|false }`. |
| `POST /api/v1/auth/admin/register` | Public; CSRF required | Same strict fields/validation as customer registration. Server accepts only normalized addresses ending exactly in `@healtywayssa.co.za`; client role fields are rejected. | `201` same response shape as customer registration; user receives only `admin` role and remains unverified. |
| `POST /api/v1/auth/login` | Public; CSRF required | `email`, `password`. Valid email; password 1–128 chars. | Customer: `202` `{ "emailOtpRequired": true }`; admin without TOTP: `202` `{ "twoFactorEnrollmentRequired": true }`; admin with TOTP: `202` `{ "twoFactorRequired": true }`. Rotates session into a restricted pending state. |
| `POST /api/v1/auth/login/verify-email-otp` | Pending customer OTP session; CSRF required | `{ "code": "123456" }`; exactly six digits. | Customer: `200` `{ "user": <public user> }`; if customer TOTP is already enabled, `202` `{ "twoFactorRequired": true }`. |
| `POST /api/v1/auth/login/resend-email-otp` | Pending customer OTP session; CSRF required | Empty JSON object | `202` `{ "emailOtpSent": true }`; new code invalidates prior code. |
| `POST /api/v1/auth/logout` | Does not require authentication; CSRF required | Empty body | `204` and no JSON body. Destroys the session and clears cookies. |
| `GET /api/v1/auth/me` | Authenticated; no CSRF header | None | `200` `{ "user": <public user> }`. |

Example registration request:

```json
{
  "email": "learner@example.test",
  "password": "<PLACEHOLDER: at least 12 characters>",
  "displayName": "Example User",
  "phoneNumber": "+27123456789"
}
```

Example successful public-user shape (IDs and times are placeholders):

```json
{
  "user": {
    "id": "<user-id>",
    "email": "learner@example.test",
    "displayName": "Example User",
    "phoneNumber": "+27123456789",
    "emailVerified": false,
    "roles": ["customer"],
    "addresses": [],
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  },
  "emailVerificationEmailSent": true
}
```

Customer registration always assigns `roles: ["customer"]`; administrator registration assigns `roles: ["admin"]` only after the backend exact-domain check. Both flows hash with Argon2id, create an unverified account, and do not create a login session. Duplicate email returns `409` `{ "error": "An account with this email already exists." }`. Invalid or extra fields (including `roles`) return `400`. Ineligible admin-domain registration returns `400` with an actionable domain message.

Login returns the same generic HTTP `401` response for unknown email, wrong password, disabled account, or unverified email:

```json
{ "error": "Invalid email or password." }
```

Passwords are hashed and verified with Argon2id. For an unknown email, the service also verifies against a dummy Argon2 hash to reduce timing differences. Login failures for unknown email, wrong password, disabled account, or unverified email intentionally share `401` `{ "error": "Invalid email or password." }` to avoid account enumeration. A verified active customer receives a random six-digit code by email; its HMAC is bound to the regenerated session, expires in five minutes, allows at most five attempts, and is deleted on successful use. The route also has an IP rate limit. An enabled customer TOTP is required after email OTP. Administrator accounts receive a pending TOTP setup or TOTP challenge instead. Pending sessions cannot access protected routes.

Email OTP is distinct from the registration verification token: registration verification proves mailbox ownership and is single-use for 24 hours; login OTP is generated separately on each customer login and is single-use for five minutes.

### Email verification and password reset

| Method and path | Access / CSRF | Input | Success |
|---|---|---|---|
| `POST /api/v1/auth/request-verification` | Public; CSRF required | `{ "email": "learner@example.test" }`; valid email <=254 chars | `202` `{ "message": "If the account needs verification, and email delivery is configured, instructions can be sent." }` |
| `POST /api/v1/auth/verify-email` | Public; CSRF required | `{ "token": "<verification token from email>" }`; 40–200 chars | `200` `{ "message": "Email address verified." }` |
| `POST /api/v1/auth/forgot-password` | Public; CSRF required | `{ "email": "learner@example.test" }`; valid email <=254 chars | `202` `{ "message": "If an account matches that email, and email delivery is configured, reset instructions can be sent." }` |
| `POST /api/v1/auth/reset-password` | Public; CSRF required | `{ "token": "<reset token from email>", "password": "<new password>" }`; token 40–200 chars; password 12–128 chars | `200` `{ "message": "Password reset successfully. Sign in again to continue." }` |

Invalid/expired/reused verification tokens return `400` `{ "error": "The verification link is invalid or expired." }`. Invalid/expired/reused reset tokens return `400` `{ "error": "The password reset link is invalid or expired." }`.

Email tokens are random, single-use, stored as SHA-256 hashes, and have a database TTL index. Verification tokens expire after 24 hours; reset tokens expire after one hour. Requesting another token replaces the prior token for the same purpose. A successful password reset increments the account's session version and removes all outstanding email tokens for that user, invalidating old sessions.

The response to a verification resend and password-reset request is intentionally generic to avoid revealing whether an account exists. Email messages link to `{FRONTEND_ORIGIN}/verify-email?token=...` and `{FRONTEND_ORIGIN}/reset-password?token=...`; the frontend must read the token and POST it to the corresponding API route. If no email service is configured or Resend delivery fails, registration can still return `201`, but `emailVerificationEmailSent` is `false`; the user cannot log in until verified.

### Google OpenID Connect

| Method and path | Access / CSRF | Input | Success |
|---|---|---|---|
| `GET /api/v1/auth/google/start` | Public; no CSRF header; retain session cookies through redirect | None | `302` redirect to Google's authorization URL. |
| `POST /api/v1/auth/google/link` | Authenticated; CSRF required | No body is read by the controller (an empty JSON object may be sent) | `200` `{ "authorizationUrl": "<Google authorization URL>" }`. |
| `GET /api/v1/auth/google/callback` | Browser redirect; no CSRF header; same session cookie as start/link required | OAuth query parameters from Google, including `state` and authorization response | Customer login: `202` `{ "emailOtpRequired": true }`; admin login: pending TOTP `202`; link: `200` `{ "googleAccountLinked": true }`. |

Google sign-in requires all three `GOOGLE_*` settings. Without them, the public start route and an authenticated link attempt return `503` `{ "error": "Google sign-in is not configured." }`. The callback validates state, nonce, PKCE verifier, issuer, audience, expiry, and Google's verified-email claim. Transactions are bound to the session, expire after ten minutes, and are consumed once. A callback with missing/expired state returns `400` `{ "error": "Google sign-in was cancelled or expired." }`; a failed OIDC validation returns `401` `{ "error": "Google sign-in could not be verified." }`. Google customer login also uses the separate email OTP challenge; Google administrator login still requires TOTP.

An existing local account is not silently linked by matching email; the user must sign in and explicitly use the link flow. Google-created users are marked email-verified and receive only the `customer` role. A Google identity already linked elsewhere or a conflicting local account returns `409`.

### Two-factor authentication

TOTP enrollment and confirmation use six-digit `code` values. Login verification, recovery-code rotation, and disablement accept either a six-digit TOTP code or a 32-character recovery code matching `[A-Za-z0-9_-]`.

| Method and path | Access / CSRF | Request | Success |
|---|---|---|---|
| `POST /api/v1/auth/2fa/enroll` | Authenticated user, or pending admin enrollment; CSRF required | Empty JSON object | `200` `{ "secret": "<authenticator secret>", "provisioningUri": "otpauth://totp/..." }` |
| `POST /api/v1/auth/2fa/confirm` | Enrollment access; CSRF required | `{ "code": "123456" }` | `200` `{ "twoFactorEnabled": true, "recoveryCodes": ["<one-time code>", "..."] }` |
| `POST /api/v1/auth/2fa/verify` | Valid pending TOTP login challenge; CSRF required | `{ "code": "123456" }` or a recovery code | Admin: `200` `{ "user": <public user> }`; customer with email OTP already validated: `200` `{ "user": <public user> }`; establishes authenticated session. |
| `GET /api/v1/auth/2fa/status` | Authenticated; no CSRF header | None | `200` `{ "twoFactorEnabled": true }` or false. |
| `POST /api/v1/auth/2fa/recovery-codes/rotate` | Authenticated, recent authentication (within 10 minutes); CSRF required | `{ "code": "123456" }` or recovery code | `200` `{ "recoveryCodes": ["<new one-time code>", "..."] }` |
| `POST /api/v1/auth/2fa/disable` | Authenticated, recent authentication; CSRF required | `{ "code": "123456" }` or recovery code | `200` `{ "twoFactorEnabled": false }` |

Enrollment returns the secret once; both secret and provisioning URI responses are marked `Cache-Control: no-store`. The authenticator secret is encrypted using AES-256-GCM with `TOTP_ENCRYPTION_KEY`. Ten recovery codes are generated; only their SHA-256 hashes are stored, and each code can be used once. A TOTP time step can be consumed only once. Successful enrollment, recovery-code use/rotation, password reset, and account linking update session version and therefore invalidate prior sessions. Invalid factors return `401`; already-enabled enrollment returns `409`. Admins cannot disable TOTP; `REQUIRE_ADMIN_2FA` must be `true`.

## 6. Authenticated profile and address routes

These are not under `/auth`, but they use the same session authentication and are part of the account flow.

| Method and path | Request | Success |
|---|---|---|
| `GET /api/v1/users/me` | None | `200` `{ "user": <public user> }` |
| `PATCH /api/v1/users/me` | One or both of `displayName` (1–100 chars) and `phoneNumber` (1–30 chars); at least one required | `200` `{ "user": <public user> }` |
| `POST /api/v1/users/me/addresses` | Required `label`, `recipientName`, `phoneNumber`, `addressLine1`, `city`, `province`, `postalCode`; optional `addressLine2`, `country` (defaults to `South Africa`), `deliveryInstructions` | `201` `{ "user": <public user> }` |
| `PATCH /api/v1/users/me/addresses/:addressId` | A nonempty subset of the saved-address fields | `200` `{ "user": <public user> }` |
| `DELETE /api/v1/users/me/addresses/:addressId` | No body | `200` `{ "user": <public user> }` |

Address limits: label 1–40 characters; recipient 1–100; phone 1–30; address lines up to 120; city/province up to 80; postal code up to 12; country up to 80; delivery instructions up to 300. At most ten saved addresses are allowed. These routes reject unknown fields; profile/address inputs cannot set roles, account status, email verification, passwords, or session versions.

## 7. Admin authorization and the requested email-domain rule

`src/models/user.model.ts` defines `customer` and `admin` roles. Customer registration explicitly writes `roles: ["customer"]`; administrator registration assigns `["admin"]` only through the server-side `/auth/admin/register` flow after checking the normalized email domain. Google-created accounts still receive only `["customer"]`. The profile schemas are strict and contain no role field.

Admin authorization is enforced on backend routes. For example, catalogue routes under `/api/v1/admin` run `requireAuthentication` and then `requireAdministrator`. A signed-in customer without the admin role receives HTTP `403` `{ "error": "Administrator access is required." }`. Admin sessions always require TOTP: an unverified admin cannot log in, an eligible verified admin without TOTP receives a restricted five-minute enrollment session, and an enabled admin must complete TOTP before a fully authenticated session exists. Pending enrollment/challenge sessions cannot call protected routes.

**Status of the domain rule: enforced for public administrator registration and admin sessions.** The backend normalizes addresses and requires the exact `@healtywayssa.co.za` suffix; lookalike domains are rejected. This is an eligibility rule, not mailbox verification or proof that TOTP is enabled. The public administrator registration route assigns `admin` only after the domain check; successful email verification and mandatory TOTP remain required for administrator access. Users cannot assign roles through customer registration, profile updates, or other user-controlled inputs.

**Security implication:** anyone controlling a verified mailbox at this domain can register for an administrator role and, after TOTP setup, access admin functions. The application does not add a separate approval workflow because the configured business rule is domain-based eligibility. Protect domain email accounts and keep backend administrator authorization checks enabled.

## 8. HTTPie: local manual flow

The commands below use PowerShell and HTTPie 3.x-style syntax. Start the backend first in a separate terminal. They retain cookies in the same HTTPie session file. Replace the example email/password and any placeholder token with values available to you; never put real secrets in source files.

### 8.1 Configure and start

In the repository:

```powershell
Copy-Item .env.example .env
# Edit .env with a local MONGODB_URI, a unique SESSION_SECRET (32+ chars),
# and TOTP_ENCRYPTION_KEY (base64 for 32 random bytes).
npm install
npm run dev
```

Use a second PowerShell terminal:

```powershell
$base = 'http://localhost:3000'
$session = 'healthyways-auth.json'
```

### 8.2 Obtain CSRF token and register

```powershell
$csrf = (http --body --session=$session GET "$base/api/v1/auth/csrf-token" | ConvertFrom-Json).csrfToken
$csrf
http --json --session=$session POST "$base/api/v1/auth/register" "x-csrf-token:$csrf" email=learner@example.test password='<PLACEHOLDER: at least 12 characters>' displayName='Example User'
```

Expected success shape:

```json
{
  "user": {
    "id": "<user-id>",
    "email": "learner@example.test",
    "displayName": "Example User",
    "emailVerified": false,
    "roles": ["customer"],
    "addresses": [],
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  },
  "emailVerificationEmailSent": true
}
```

Fields not applicable to that user (such as `phoneNumber`) are omitted. If email is not configured/delivered, the registration still succeeds but returns `"emailVerificationEmailSent": false`. Configure Resend and check the mailbox to obtain the verification token; the token is not returned by the API.

### 8.3 Verify email and log in

After retrieving the token from the verification email, post it using the current cookie session:

```powershell
http --json --session=$session POST "$base/api/v1/auth/verify-email" "x-csrf-token:$csrf" token='<PLACEHOLDER: token from verification email>'
http --json --session=$session POST "$base/api/v1/auth/login" "x-csrf-token:$csrf" email=learner@example.test password='<PLACEHOLDER: same password used at registration>'
```

Customer login returns `202` `{ "emailOtpRequired": true }` and rotates to a pending session. Read the separate five-minute code from the test mailbox, refresh CSRF using the same HTTPie session, and submit it:

```powershell
$csrf = (http --body --session=$session GET "$base/api/v1/auth/csrf-token" | ConvertFrom-Json).csrfToken
http --json --session=$session POST "$base/api/v1/auth/login/verify-email-otp" "x-csrf-token:$csrf" code=123456
```

The response is `200` with `{ "user": <public user> }`. A customer who already enabled TOTP receives `202` `{ "twoFactorRequired": true }`; fetch a fresh CSRF token and POST the authenticator/recovery code to `/api/v1/auth/2fa/verify`.

For eligible admins, register at `/api/v1/auth/admin/register`. After verifying the email, login returns `202` `{ "twoFactorEnrollmentRequired": true }` until TOTP is enrolled and confirmed. The backend returns the one-time authenticator secret and provisioning URI from `/api/v1/auth/2fa/enroll`; use them in an authenticator app, then POST `{ "code": "123456" }` to `/api/v1/auth/2fa/confirm`. Once enrolled, future admin login returns `202` `{ "twoFactorRequired": true }` and must be completed at `/api/v1/auth/2fa/verify`.

### 8.4 Call a protected route

```powershell
http --session=$session GET "$base/api/v1/users/me"
```

Expected response: `{ "user": { ...public user fields... } }`. This endpoint requires the session cookie but not a CSRF header because it is a GET request.

### 8.5 Log out

Fetch a fresh token after login, then send it with the retained cookies:

```powershell
$csrf = (http --body --session=$session GET "$base/api/v1/auth/csrf-token" | ConvertFrom-Json).csrfToken
http --json --session=$session POST "$base/api/v1/auth/logout" "x-csrf-token:$csrf"
```

Expected result is HTTP `204 No Content`; the response clears the session and CSRF cookies. A subsequent `GET /api/v1/users/me` with that session should return `401`.

### 8.6 Optional admin check

An ordinary customer can confirm backend authorization is active:

```powershell
http --session=$session GET "$base/api/v1/admin/categories"
```

Expected for a customer: HTTP `403` and `{ "error": "Administrator access is required." }`. A successful admin test requires a legitimately provisioned admin account and completed admin 2FA; neither is provisioned by ordinary registration.

## 9. Current limitations and security observations

- **No JWT:** clients must use session cookies, not bearer tokens.
- **Domain-based administrator eligibility:** a verified mailbox ending exactly in `@healtywayssa.co.za` can self-register for the admin role, but still must complete TOTP. This design does not include a separate human approval workflow.
- **No email delivery in an unconfigured development setup:** registration can succeed while email verification delivery fails, making password login unavailable until verification occurs through a configured flow.
- **Frontend lives in a separate repository:** the companion Healthy Ways SA frontend now provides account forms and a shared CSRF-aware API client; both repositories must be configured for the same frontend origin/API base URL.
- **Admin email-domain rule:** the exact suffix is enforced server-side on admin registration and admin authentication; it remains an eligibility rule, not separate proof of mailbox security.
- **Google sign-in requires external setup:** no live Google flow can complete until Google client credentials and an exactly registered callback URI are configured.
- **Cookie deployment must match the frontend:** cross-origin browser use requires exact `FRONTEND_ORIGIN`, credentialed requests, HTTPS for Secure cookies, and CSRF headers. `SameSite=none` requires Secure cookies.
- **Proxy trust is opt-in:** incorrect `TRUST_PROXY` configuration can affect secure-cookie/protocol behavior; only trust the actual deployment proxy.
- **Recovery codes are shown once:** the client should store them safely at enrollment/rotation and never log them.
- **Security assurance is based on code/tests, not a live deployment audit:** this guide does not verify production environment values, MongoDB topology/permissions, reverse-proxy headers, DNS, email deliverability, or Google Cloud configuration.

## 10. Error responses and troubleshooting

| Status | Typical response | Meaning / next step |
|---|---|---|
| `400` | `{ "error": "Invalid request." }` | Zod validation failed, often an invalid email, short password, missing field, or unexpected field. Check exact schema and field names. |
| `400` | `{ "error": "The verification link is invalid or expired." }` | Token is invalid, expired, already used, or replaced by a resend. Request a fresh email. |
| `400` | `{ "error": "The password reset link is invalid or expired." }` | Token is invalid, expired, or already used. Request another reset. |
| `401` | `{ "error": "Invalid email or password." }` | Credentials invalid, account unverified, or account disabled. The response intentionally does not distinguish them. |
| `401` | `{ "error": "Authentication required." }` | No valid session, session version is stale, account is disabled/unverified, or pending 2FA has not been completed. |
| `403` | `{ "error": "Invalid or missing CSRF token." }` | Obtain a fresh token and send it in `x-csrf-token` with the matching cookies. |
| `403` | `{ "error": "Administrator access is required." }` | Authenticated account lacks the admin role. |
| `409` | `{ "error": "An account with this email already exists." }` | Registration email is already in use. |
| `429` | `{ "error": "Too many attempts. Please try again later." }` | Wait for the per-route 15-minute authentication rate limit window. |
| `503` | Configuration message | Commonly Google OIDC or 2FA is unavailable because the necessary settings are absent. Check server-side configuration. |
| `500` | `{ "error": "Internal server error" }` | Unexpected server/provider/database failure; inspect server logs without exposing credentials or token values. |

The error middleware logs error category and status, not request bodies. It returns generic messages for unexpected server errors. Unknown API routes return `404` `{ "error": "Not found" }`.

## 11. End-to-end manual verification checklist

1. Start local MongoDB and configure `.env` with `MONGODB_URI`, a strong `SESSION_SECRET`, and a base64 32-byte `TOTP_ENCRYPTION_KEY`.
2. For a manual registration/login flow, configure Resend settings and a frontend origin so the verification message can be delivered. The normal unconfigured development email adapter does not deliver verification messages; the recording email adapter is used only by automated tests.
3. Start `npm run dev`.
4. Use HTTPie `--session` to call `GET /api/v1/auth/csrf-token`; retain the session and token.
5. Register with a valid email and 12–128 character password; verify the response assigns only `customer`.
6. Retrieve the email token and POST it to `/api/v1/auth/verify-email`.
7. Customer login returns `202` `{ "emailOtpRequired": true }`; obtain the five-minute code from email, refresh CSRF, and POST it to `/api/v1/auth/login/verify-email-otp`. If the customer has TOTP enabled, complete `/api/v1/auth/2fa/verify` after OTP.
8. An admin login returns `202` with `twoFactorEnrollmentRequired` or `twoFactorRequired`; complete the restricted enrollment/verification flow before attempting protected routes.
9. Call `GET /api/v1/users/me` to confirm the session cookie authenticates the request.
10. Try an admin-only GET as a customer and confirm the backend returns `403`.
11. Obtain a fresh CSRF token, POST `/api/v1/auth/logout`, and confirm the protected profile route returns `401` afterward.

Relevant automated evidence is in `tests/stage2-auth.test.ts` (registration, password login, cookies, CSRF, email tokens), `tests/stage3-auth.test.ts` (Google OIDC and 2FA), and `tests/foundation.test.ts` (configuration and app behavior). No test or build was run as part of this documentation-only audit.
