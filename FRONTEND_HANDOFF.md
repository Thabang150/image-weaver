# Healthy Ways SA Frontend Integration Handoff

This document describes the backend contract found in this repository's source code. It is an integration reference, not a promise that every configured external service or deployed setting is operational. `IMPLEMENTED` means source code exists; automated-test coverage is identified separately. The deployed service has not been tested as part of preparing this document.

## Contents

1. [Overview and setup](#1-overview-and-setup)
2. [Conventions and errors](#2-conventions-and-errors)
3. [Authentication, sessions, CSRF, and roles](#3-authentication-sessions-csrf-and-roles)
4. [API endpoint inventory](#4-api-endpoint-inventory)
5. [Catalogue](#5-catalogue)
6. [Cart](#6-cart)
7. [Orders and inventory](#7-orders-and-inventory)
8. [Delivery status](#8-delivery-status)
9. [Admin capabilities](#9-admin-capabilities)
10. [Next.js integration examples](#10-nextjs-integration-examples)
11. [Known blockers and implementation status](#11-known-blockers-and-implementation-status)

## 1. Overview and setup

- **Project:** Healthy Ways SA e-commerce backend.
- **Stack:** Node.js, TypeScript, Express 5, Mongoose/MongoDB. Authentication uses `express-session`; password hashing uses Argon2id. These are confirmed by `package.json` and `src`.
- **API prefix:** `/api/v1`.
- **Deployed base URL supplied for this project:** `https://heathywayssa-backend.onrender.com`. The source does not establish that every route or external integration at that host is currently available.
- **Health:** `GET /api/v1/health` returns exactly `{ "status": "ok", "database": "connected" }` with HTTP 200 when connected, or `{ "status": "error", "database": "disconnected" }` with HTTP 503 otherwise. A successful health response confirms the database connection check only; it does not verify email, Google OAuth, transaction workflows, delivery, or payment.
- **Local development:** `npm run dev` runs `tsx watch src/server.ts`; `npm run build` runs `tsc -p tsconfig.json`; `npm start` runs the compiled server. The code default for `PORT` is 3000. Node.js 20.19 or newer and a reachable MongoDB instance are documented prerequisites.
- **Frontend separation:** The backend is a separate API process. No integrated frontend or frontend URL is defined in this repository.
- **CORS:** When `FRONTEND_ORIGIN` is configured, CORS permits that exact origin and `credentials: true`; other origins are not allowed. When it is absent, the CORS middleware is not installed. The current deployed `FRONTEND_ORIGIN`, cookie SameSite setting, and proxy settings are **UNVERIFIED** from repository source.
- **Browser cookies:** Cross-origin frontend requests must use `credentials: "include"`. Cross-site deployments also need a compatible cookie setting and HTTPS; see [cookies and cross-origin constraints](#cookies-and-cross-origin-constraints).
- **MongoDB transactions:** Cart mutations, order creation/cancellation, and inventory adjustment use transactions. Use a MongoDB replica set or sharded deployment that supports transactions. The inventory and cart/order test suites use an in-memory replica set; that does not verify the topology configured in deployment.
- **Environment variable names in backend source:** `NODE_ENV`, `PORT`, `MONGODB_URI`, `SESSION_SECRET`, `SESSION_SAME_SITE`, `TRUST_PROXY`, `FRONTEND_ORIGIN`, `TOTP_ENCRYPTION_KEY`, `REQUIRE_ADMIN_2FA`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. These are server-side settings, not values for the browser. Do not expose secret variables through `NEXT_PUBLIC_`.

For a separately hosted Next.js app, it is reasonable to define `NEXT_PUBLIC_API_BASE_URL=https://heathywayssa-backend.onrender.com` if that is the intended API host. A `NEXT_PUBLIC_` value is included in browser code; it must contain only the non-secret base URL, never credentials, API keys, session secrets, or payment secrets. Configure the backend's exact `FRONTEND_ORIGIN` for the deployed frontend origin.

## 2. Conventions and errors

### Requests and identifiers

- Send JSON bodies with `Content-Type: application/json` and normally request JSON with `Accept: application/json`. The app parses JSON and URL-encoded bodies with a 100 KiB limit; URL-encoded parsing is configured with `extended: false`.
- Validation schemas are strict for the documented request bodies and query objects: unknown properties are rejected. Numeric query parameters are coerced from query strings; JSON numeric body values must be JSON numbers, not numeric strings.
- Mongo ObjectIds in path/body fields are 24 hexadecimal characters. IDs are serialized as strings. Slugs are normalized to lowercase hyphenated text for write schemas; public product detail looks up the slug.
- Dates are JavaScript `Date` values and serialize through JSON as ISO-8601 strings.
- Prices and totals are integer **cents**, with `currency: "ZAR"` where returned. Convert to Rand for display by dividing the integer-cent amount by 100; do not send decimal Rand amounts.
- Optional fields are generally omitted rather than returned as `null`, except where a response explicitly uses `null` (notably unavailable cart items).
- No common success envelope exists. Each endpoint below documents its own outer object.

### Error responses

The application error handler returns a JSON object with an `error` string and does not return stack traces or database error details.

| Condition | Status | Body/behaviour |
|---|---:|---|
| Zod body, path, or query validation failure | 400 | `{ "error": "Invalid request." }` (details are not exposed) |
| Missing/invalid CSRF token | 403 | `{ "error": "Invalid or missing CSRF token." }` |
| Authentication required / expired or invalidated session | 401 | Typically `{ "error": "Authentication required." }`; endpoint-specific challenge messages may differ |
| Authenticated but required role missing | 403 | Endpoint-specific message, e.g. customer/admin access is required |
| Missing resource | 404 | Endpoint-specific message; unmatched route returns `{ "error": "Not found" }` |
| Business conflict, duplicate, insufficient stock | 409 | Endpoint-specific `{ "error": "..." }` |
| Required transaction or integration unavailable | 503 | Endpoint-specific `{ "error": "..." }` |
| Account endpoint rate limit | 429 | `{ "error": "Too many attempts. Please try again later." }` |
| Unhandled server error | 500 | `{ "error": "Internal server error" }` |

Known `HttpError` messages for common cart/order/inventory cases are described in the relevant sections. Do not depend on validation issue details: the middleware intentionally exposes only the generic 400 message. Express parser errors also pass through the generic error handling path; exact malformed/oversized-body messaging is not a frontend contract.

The rate-limited account/authentication routes use a default limit of 10 requests per 15 minutes and send standard rate-limit headers. The limit is an application option, not a frontend-configurable setting.

### Pagination, query filters, and sorting

Paginated responses use:

```json
{
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

`page` defaults to 1 and is bounded at 1,000,000; `limit` defaults to 20 and is bounded at 100. Empty results return `totalPages: 0`. The exact result array key differs (`products`, `orders`, `inventory`, or `adjustments`).

Public products support `q`, `categoryId`, `minPriceCents`, `maxPriceCents`, `sortBy=createdAt|name|priceCents`, and `sortOrder=asc|desc`. Inventory supports `q`, `categoryId`, `status=draft|active|inactive`, `lowStockBelow`, `sortBy=updatedAt|name|stockQuantity`, and `sortOrder=asc|desc`. Product and inventory text searches are escaped literal case-insensitive regex searches (products search name/description; inventory searches name/SKU). History and order listing support only `page` and `limit`. Sort fields are allowlisted.

## 3. Authentication, sessions, CSRF, and roles

### Registration and password login

1. Obtain a CSRF token using `GET /api/v1/auth/csrf-token`.
2. Send `POST /api/v1/auth/register` or `/login`, with credentials included and the token in `X-CSRF-Token`.
3. Registration creates a customer account and sends an email-verification attempt through the configured email service. The repository's default runtime service is unconfigured and returns `false`; successful email delivery is therefore not available merely because the route exists.
4. Password login requires an active, email-verified account. Unknown email, wrong password, disabled account, or unverified account returns the same 401 login message.
5. Successful authentication regenerates the session ID to prevent fixation and sends a session cookie. When a second factor is required, the response is HTTP 202 and the session is a temporary challenge, not an authenticated application session.

Passwords are 12–128 characters at registration/reset; login permits 1–128 characters. Email is trimmed, validated, lowercased, and bounded to 254 characters. Registration optionally accepts a trimmed display name (1–100) and phone number (1–30). Unknown fields are rejected.

### Session cookie

The backend uses a MongoDB-backed `express-session` store, not JWT authentication.

| Environment | Session cookie name |
|---|---|
| Development/test | `hw.sid` |
| Production | `__Host-hw.sid` |

Cookie attributes are `HttpOnly`, `Path=/`, no configured `Domain` (host-only), and `SameSite` from `SESSION_SAME_SITE` (default `lax`). `Secure` is enabled in production and whenever SameSite is `none`. The production `__Host-` cookie name depends on the Secure/host-only/root-path requirements. The cookie lifetime and Mongo session-store TTL are 8 hours. Sessions use rolling expiry: requests refresh the cookie/store lifetime. There is no dedicated refresh-token or session-refresh endpoint.

The session cookie is browser-managed; frontend JavaScript must not try to read it. Include it in fetch requests using `credentials: "include"`. Sessions are invalidated on logout, password reset (session version increment), and other account security changes that increment the session version. An expired, missing, disabled, unverified, or version-mismatched session is rejected; authentication middleware may destroy the stale session and clear both session and CSRF cookies.

### Cookies and cross-origin constraints

- CORS is configured for one exact `FRONTEND_ORIGIN` and enables credentialed requests.
- SameSite `lax` works for same-site requests, including cross-origin subdomains that are still same-site, but browser cookie policy can block cookies in a truly cross-site fetch.
- For truly cross-site browser use, configure `SESSION_SAME_SITE=none`, serve both sides over HTTPS, and ensure the backend is in production or otherwise sets `Secure`. Browser third-party-cookie restrictions may still apply.
- Cookie domain is not configurable in the app. The session cookie is host-only to the API host.
- `TRUST_PROXY` changes Express proxy trust and session proxy handling. Set it only to match the deployment proxy arrangement; deployment values are not established here.

### CSRF rules

The global `csrf-csrf` double-submit protection is installed before API routers. Safe methods such as GET are exempt; unsafe requests (POST, PATCH, PUT, DELETE) require the generated token. This includes login, registration, logout, address mutations, cart mutations, order creation/cancellation, inventory adjustments, and 2FA mutations. There are no special POST exceptions for authentication or logout.

1. Call `GET /api/v1/auth/csrf-token` with `credentials: "include"`.
2. The response is `{ "csrfToken": "<opaque token>" }`. The server also sets its CSRF cookie. Cookie names are `hw.csrf` in development/test and `__Host-hw.csrf` in production; this cookie is `HttpOnly`, root path, host-only, uses the configured SameSite, and uses Secure under the same condition as the session cookie.
3. Keep the returned token in runtime memory (not local storage) and send it verbatim in the `X-CSRF-Token` request header on unsafe requests. Do not attempt to read the HttpOnly CSRF cookie.
4. When the user authenticates or completes a 2FA session transition, the session is regenerated and the CSRF cookie is cleared. Fetch a fresh CSRF token for the new session before the next unsafe request. Refresh it after a CSRF 403 as well; do not retry a non-idempotent mutation automatically unless its request is protected by the endpoint's idempotency mechanism.

The CSRF endpoint initializes and saves the session so the token is tied to the current session identifier. If the browser is not retaining cookies or CORS is not configured for the frontend origin, this flow cannot work.

### Current user, roles, logout, and 2FA

- Current-user retrieval is available at both `GET /api/v1/auth/me` and `GET /api/v1/users/me`; each requires a fully authenticated session and returns `{ "user": <PublicUser> }`.
- `PublicUser` fields: `id`, `email`, optional `displayName`, optional `phoneNumber`, `emailVerified`, `roles` (`customer`, `admin`, or both), `addresses` (saved address objects with `id`), `createdAt`, and `updatedAt`. Password hashes, session version, TOTP secret/recovery hashes, and internal identity data are not returned.
- `POST /api/v1/auth/logout` destroys the session, clears session and CSRF cookies, and returns 204. It requires CSRF but does not require the session to be authenticated.
- There is no session-refresh endpoint. Rolling session expiration occurs as part of normal requests.
- Customer cart/order endpoints require both authentication and the `customer` role. Administrator catalog/inventory/order-cancellation endpoints require authentication and the `admin` role. User profile/address routes require authentication but do not separately check customer role.
- Administrator 2FA is required by default. For an admin without configured TOTP, primary login returns a pending enrollment response; an admin is not authorized for normal protected endpoints until enrollment completes. An admin with TOTP must pass a 2FA challenge after primary authentication.
- TOTP enrollment returns `{ "secret", "provisioningUri" }`; the frontend should present the URI/QR enrollment material securely and not persist or log it. Confirmation accepts exactly a six-digit code. A successful confirmation returns `{ "twoFactorEnabled": true, "recoveryCodes": [...] }` with ten recovery codes; recovery codes are shown once.
- A pending login challenge expires after 5 minutes. `POST /api/v1/auth/2fa/verify` accepts `{ "code": "..." }`: either six digits or a 32-character recovery code matching `[A-Za-z0-9_-]`. A recovery code is one-use. Success returns `{ "user": ... }` and establishes the real authenticated session.
- `GET /api/v1/auth/2fa/status` returns `{ "twoFactorEnabled": boolean }`. Recovery-code rotation and disable require a recent-authenticated session (within 10 minutes) and a current TOTP/recovery code. Admins cannot disable required 2FA.

### Email and Google identity flows

- Verification tokens expire after 24 hours; password-reset tokens expire after 1 hour. The database stores token hashes and consumes tokens once. Password reset invalidates existing sessions.
- The request-verification and forgot-password responses are deliberately generic to avoid account enumeration. The default email adapter does not deliver email; configuring a real delivery service is a deployment prerequisite.
- Google login starts at `GET /api/v1/auth/google/start`, which redirects (302) to Google. The callback is `GET /api/v1/auth/google/callback`. OAuth state, nonce, PKCE verifier, purpose, and linking identity are bound to the browser session via a short-lived database transaction (10 minutes), with state hashed in storage and one-use consumption.
- Google account linking starts with authenticated, CSRF-protected `POST /api/v1/auth/google/link`; it returns `{ "authorizationUrl": "..." }`. The frontend must navigate the browser to that URL. Matching email accounts are not automatically linked; an existing user must authenticate and explicitly link.
- Google OAuth requires all three server variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. The redirect URI must be HTTPS (or local HTTP) and use exactly `/api/v1/auth/google/callback`. When OAuth is not configured, the start/link flow returns 503.
- The callback returns JSON on the backend callback page (`{ user }`, `{ twoFactorRequired: true }`, `{ twoFactorEnrollmentRequired: true }`, or `{ googleAccountLinked: true }` as applicable); no frontend post-login redirect contract is implemented. A polished return-to-frontend flow remains an integration/product decision.

## 4. API endpoint inventory

All paths below are relative to `/api/v1`. For unsafe methods, CSRF is required as described above. Unless noted otherwise, JSON request bodies are strict and invalid schema input returns the generic 400 response.

### Health and authentication

| Method and path | Access / CSRF | Request | Success response | Notes |
|---|---|---|---|---|
| `GET /health` | Public / no | None | 200 `{ status, database }`; 503 when disconnected | Health status only; no external integration checks. |
| `GET /auth/csrf-token` | Public / no | Include cookies | 200 `{ csrfToken }` and CSRF cookie | Rate-limited; initializes/saves a session. |
| `POST /auth/register` | Public / yes | `{ email, password, displayName?, phoneNumber? }` | 201 `{ user, emailVerificationEmailSent }` | Rate-limited. New role is customer. |
| `POST /auth/login` | Public / yes | `{ email, password }` | 200 `{ user }`, or 202 `{ twoFactorRequired: true }`, or 202 `{ twoFactorEnrollmentRequired: true }` | Rate-limited; sets/regenerates session. |
| `POST /auth/logout` | Public (authentication not required) / yes | No required body | 204, no JSON body | Destroys session and clears cookies. |
| `GET /auth/me` | Authenticated / no | Cookie | 200 `{ user }` | Fully authenticated session only. |
| `POST /auth/request-verification` | Public / yes | `{ email }` | 202 `{ message }` | Generic response; rate-limited. |
| `POST /auth/verify-email` | Public / yes | `{ token }` | 200 `{ message: "Email address verified." }` | Token 40–200 chars; token one-use/expiring. |
| `POST /auth/forgot-password` | Public / yes | `{ email }` | 202 `{ message }` | Generic response; rate-limited. |
| `POST /auth/reset-password` | Public / yes | `{ token, password }` | 200 `{ message }` | Password 12–128 chars; token one-use/expiring; sessions invalidated. |
| `GET /auth/google/start` | Public / no | Browser navigation | 302 redirect to Google | OAuth must be configured. |
| `POST /auth/google/link` | Authenticated / yes | No required body | 200 `{ authorizationUrl }` | Then navigate browser to returned URL. |
| `GET /auth/google/callback` | OAuth session transaction / no | Provider query including state/code or error | JSON result described above | One-use session-bound transaction, 10-minute expiry. |

### TOTP / recovery codes

| Method and path | Access / CSRF | Request | Success response | Notes |
|---|---|---|---|---|
| `POST /auth/2fa/enroll` | Authenticated setup access or pending required admin enrollment / yes | No required body | 200 `{ secret, provisioningUri }` | Secret is sensitive enrollment material. |
| `POST /auth/2fa/confirm` | Same enrollment access / yes | `{ code: "123456" }` | 200 `{ twoFactorEnabled: true, recoveryCodes: [...] }` | Establishes authenticated session; show recovery codes once. |
| `POST /auth/2fa/verify` | Valid pending 2FA challenge / yes | `{ code }` | 200 `{ user }` | Six-digit TOTP or 32-character recovery code; challenge expires in five minutes. |
| `GET /auth/2fa/status` | Authenticated / no | Cookie | 200 `{ twoFactorEnabled }` | |
| `POST /auth/2fa/recovery-codes/rotate` | Authenticated and recent authentication / yes | `{ code }` | 200 `{ recoveryCodes: [...] }` | Current factor required; new codes shown once. |
| `POST /auth/2fa/disable` | Authenticated and recent authentication / yes | `{ code }` | 200 `{ twoFactorEnabled: false }` | 403 for admin when admin 2FA is mandatory. |

### Profile and saved addresses

| Method and path | Access / CSRF | Request | Success response | Notes |
|---|---|---|---|---|
| `GET /users/me` | Authenticated / no | Cookie | 200 `{ user }` | Current public user. |
| `PATCH /users/me` | Authenticated / yes | At least one of `{ displayName?, phoneNumber? }` | 200 `{ user }` | `displayName` 1–100; phone 1–30. Other fields rejected. |
| `POST /users/me/addresses` | Authenticated / yes | Address object described below | 201 `{ user }` | Maximum 10 saved addresses. |
| `PATCH /users/me/addresses/:addressId` | Authenticated / yes | Non-empty partial address object | 200 `{ user }` | Address must belong to current user. |
| `DELETE /users/me/addresses/:addressId` | Authenticated / yes | None | 200 `{ user }` | Address must belong to current user. |

Address create fields: required `label` (1–40), `recipientName` (1–100), `phoneNumber` (1–30), `addressLine1` (1–120), `city` (1–80), `province` (1–80), `postalCode` (1–12); optional `addressLine2` (max 120), `deliveryInstructions` (max 300), and `country` (1–80; defaults to `"South Africa"`). Strings are trimmed. Patch accepts those fields optionally, rejects an empty object, and allows setting optional string fields to `""` if they satisfy their schema (addressLine2/instructions permit empty strings). Unknown fields are rejected.

### Catalogue and administrator catalogue/inventory

| Method and path | Access / CSRF | Request | Success response | Notes |
|---|---|---|---|---|
| `GET /categories` | Public / no | None | 200 `{ categories: [...] }` | Active categories only; alphabetical by name. |
| `GET /products` | Public / no | Product query filters below | 200 `{ products: [...], pagination }` | Active products in active categories only. |
| `GET /products/:slug` | Public / no | Lowercase hyphen slug | 200 `{ product }` | Active product/category only; otherwise 404. |
| `GET /admin/categories` | Admin / no | None | 200 `{ categories: [...] }` | Includes active and inactive categories. |
| `POST /admin/categories` | Admin / yes | `{ name, slug?, description?, isActive? }` | 201 `{ category }` | |
| `PATCH /admin/categories/:categoryId` | Admin / yes | Non-empty partial category object | 200 `{ category }` | |
| `POST /admin/products` | Admin / yes | Product create object below | 201 `{ product }` | No stock field; initial stock defaults to zero. |
| `PATCH /admin/products/:productId` | Admin / yes | Non-empty partial product object | 200 `{ product }` | No stock field; inventory changes use adjustment endpoint. |
| `GET /admin/inventory` | Admin / no | Inventory filters below | 200 `{ inventory: [...], pagination }` | Includes draft/inactive products unless filtered. |
| `GET /admin/inventory/adjustments` | Admin / no | `page`, `limit` | 200 `{ adjustments: [...], pagination }` | Recent ledger entries across products. |
| `GET /admin/products/:productId/inventory-adjustments` | Admin / no | `page`, `limit` | 200 `{ adjustments: [...], pagination }` | Product-scoped ledger. |
| `POST /admin/products/:productId/inventory-adjustments` | Admin / yes | `{ quantityDelta, reason }` and `Idempotency-Key` header | 201 first submission or 200 replay: `{ adjustment, replayed }` | Signed non-zero integer delta; key details below. |

Admin category create accepts `name` (1–100), optional `slug` (max 120), optional `description` (1–1000), and optional `isActive` (default true). Patch accepts any non-empty subset and permits `description: null` to clear it. Duplicate slug conflicts return 409. Slugs are normalized from names when omitted.

Admin product create requires `name`, `sku`, `description`, `categoryId`, and positive safe-integer `priceCents`; optional `slug`, `status` (`draft|active|inactive`, default `draft`), `imageReferences` (up to 10 strings), `packaging`, and `shipping`. SKU is uppercased. The admin product serializer returns `id`, `name`, `slug`, `sku`, `description`, `categoryId`, `priceCents`, `status`, `imageReferences`, optional `packaging`, optional `shipping`, `createdAt`, and `updatedAt`. It does **not** include stock quantity; use inventory routes for stock. No admin endpoint lists all product details or deletes products.

Product update accepts `packaging: null` or `shipping: null` to clear the respective optional metadata.

Product filters: `page`, `limit`, `q`, `categoryId`, `minPriceCents`, `maxPriceCents`, `sortBy`, `sortOrder`. Inventory filters: `page`, `limit`, `q`, `categoryId`, `status`, `lowStockBelow`, `sortBy`, `sortOrder`.

### Cart and orders

| Method and path | Access / CSRF | Request | Success response | Notes |
|---|---|---|---|---|
| `GET /cart` | Customer / no | Cookie | 200 `{ cart }` | Empty cart is returned if none is stored yet. |
| `POST /cart/items` | Customer / yes | `{ productId, quantity }` | 200 `{ cart }` | Adds quantity to existing item; current active product/category and stock checked. |
| `PATCH /cart/items/:productId` | Customer / yes | `{ quantity }` | 200 `{ cart }` | Sets quantity; item must already exist. |
| `DELETE /cart/items/:productId` | Customer / yes | None | 200 `{ cart }` | Removing a missing item leaves cart unchanged. |
| `DELETE /cart` | Customer / yes | None | 200 `{ cart }` | Clears the cart. |
| `POST /orders` | Customer / yes | `{ addressId }` and `Idempotency-Key` header | 201 `{ order, replayed: false }`; replay 200 `{ order, replayed: true }` | Transactionally snapshots items/address, reserves stock, writes ledger, and empties cart. |
| `GET /orders` | Customer / no | `page`, `limit` | 200 `{ orders: [...], pagination }` | Only current customer's orders. |
| `GET /orders/:orderId` | Customer / no | ObjectId path | 200 `{ order }` | Only current customer's order; otherwise 404. |
| `POST /admin/orders/:orderId/cancel` | Admin / yes | `{ reason }` | 200 `{ order, replayed }` | Cancels eligible pending-payment order and transactionally releases reserved stock. No admin order list/detail endpoint exists. |

## 5. Catalogue

Public category responses contain `id`, `name`, `slug`, optional `description`, `isActive`, `createdAt`, and `updatedAt`. Public category listing filters inactive categories. Public product responses contain:

```json
{
  "id": "<object-id>",
  "name": "<name>",
  "slug": "<slug>",
  "description": "<description>",
  "category": { "id": "<object-id>", "name": "<category>", "slug": "<category-slug>" },
  "priceCents": "<integer cents placeholder; actual response is a JSON number>",
  "imageReferences": [],
  "packaging": { "amount": "<number>", "unit": "<unit>" },
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}
```

Angle-bracket values in the example are documentation placeholders, not literal JSON values or claims about actual catalogue data. `packaging` is optional and describes consumer packaging, not shipping. Public serializers intentionally omit SKU, stock quantity, product status, shipping measurements, and internal fields. Public queries do not filter out-of-stock products; stock is not in public product responses. Products must have `status: active` and an active category to be visible.

The source provides filtering and sorting described earlier, with a stable `_id` tie-breaker. There is no category detail-by-slug endpoint, no admin product GET/list endpoint, no deletion endpoint, and no public stock endpoint. Whether products are currently seeded is **UNVERIFIED** by this source review; no application database query was made.

Shipping metadata exists on the product model and is admin-writable only:

```json
{
  "shipping": {
    "weightGrams": "<positive integer grams>",
    "dimensionsCm": {
      "length": "<positive finite centimetres>",
      "width": "<positive finite centimetres>",
      "height": "<positive finite centimetres>"
    }
  }
}
```

Angle-bracket values in the example are documentation placeholders, not literal response values or measured product data. Weight is a safe integer from 1 to 1,000,000 grams. Dimensions are positive finite numbers up to 1,000 centimetres each. Shipping is optional and has no default; update accepts `shipping: null` to clear it. Legacy products without shipping metadata remain valid. Public catalogue responses omit `shipping`; admin create/update responses include it when present.

## 6. Cart

Cart records persist in MongoDB by user ID and are independent of the browser session. Logout destroys the session but does not clear the cart. No cart TTL/expiry is configured. A cart may contain at most 50 distinct products, each with integer quantity 1–99. `itemCount` is the number of distinct cart lines, not the sum of quantities.

The cart response is:

```json
{
  "cart": {
    "items": [{
      "productId": "<object-id>",
      "quantity": "<integer>",
      "available": true,
      "product": { "name": "<current-name>", "slug": "<current-slug>" },
      "unitPriceCents": "<integer cents>",
      "lineSubtotalCents": "<integer cents>"
    }],
    "itemCount": "<number of distinct lines>",
    "currency": "ZAR",
    "totalCents": "<integer cents>",
    "hasUnavailableItems": false
  }
}
```

Angle-bracket values are shape placeholders rather than literal JSON values or claims about product pricing.

An empty cart is `{ items: [], itemCount: 0, currency: "ZAR", totalCents: 0, hasUnavailableItems: false }` inside `cart`.

Adding an item checks that the product and category are active, stock is positive, and requested resulting quantity does not exceed current stock or 99. Adding an unavailable product returns 404; stock/limit conflicts return 409. A cart mutation uses a MongoDB transaction; unsupported topology returns 503. Updating an existing line's quantity validates the quantity range but does not itself pre-check current stock/product availability. The response recalculates availability and prices.

Prices and totals are calculated by the backend using the **current** product price, not a price stored on the cart. If the product is inactive, its category inactive, it no longer exists, or stock is below the cart quantity, the response line is:

```json
{
  "productId": "<object-id>",
  "quantity": "<integer>",
  "available": false,
  "product": null,
  "unitPriceCents": null,
  "lineSubtotalCents": null
}
```

Unavailable lines do not contribute to `totalCents`; `hasUnavailableItems` is true. The frontend should retain/display the stale line clearly and allow removal or correction. Adding to cart does **not** reserve inventory. Stock can change between cart retrieval and order creation; order creation revalidates and may return 409.

## 7. Orders and inventory

### Creating an order

The only client-supplied order body field is `{ "addressId": "<saved-address-object-id>" }`. The address must belong to the authenticated user. The caller must send `Idempotency-Key`: a trimmed 16–128 character value matching `[A-Za-z0-9._:-]+`. Generate a unique key for a logical order submission and reuse it only when retrying that same submission.

The server loads the user's cart, current active products and categories, current price and stock, then calculates line subtotals and merchandise subtotal using integer cents. It snapshots item name, SKU, description, quantity and price, plus recipient/address data. It atomically decrements available stock and creates order-reservation ledger entries, creates the order, and clears the cart in one MongoDB transaction. Insufficient/changed availability returns 409 and does not commit partial effects. Unsupported transaction topology returns 503.

Idempotency keys are stored scoped to the authenticated user. Reusing a key with a different address fingerprint returns 409; an identical retry returns the original order. The current fingerprint covers the address ID, not a separate cart payload. The transaction tests cover competing stock/order submissions and rollback scenarios; production transaction behavior depends on deployment MongoDB topology.

The order response includes `id`, `orderNumber`, `customerEmail`, item snapshots (`productId`, `name`, `sku`, `description`, `quantity`, `unitPriceCents`, `lineSubtotalCents`), `subtotalCents`, `totalCents`, `currency: "ZAR"`, `status`, `stockReservationStatus`, `deliveryAddress`, optional `cancellation`, `createdAt`, and `updatedAt`. Customer responses do not include the cancellation actor ID; the administrator cancellation response does.

**Delivery is not included:** `totalCents` currently equals `subtotalCents`; no delivery fee is calculated or persisted. Order creation is not proof of payment. There is no PayFast integration, payment attempt/confirmation, webhook, refund, or customer payment-status flow.

### Status and cancellation lifecycle

The only order status values in the model are `pending_payment` and `cancelled`; stock reservation status is `reserved` or `released`.

- Creation sets `pending_payment` and `reserved`.
- There is no payment integration to transition an order to paid.
- There is no automatic 30-minute reservation expiry worker.
- An administrator can cancel only a pending-payment order with reserved stock. Cancellation records reason, administrator, and timestamp, releases quantities, and appends order-release ledger rows in a transaction.
- Cancellation is effectively idempotent for the same administrator and same reason; a different repeated cancellation request returns 409.
- No automatic cancellation, refund, or late-payment reconciliation exists.

### Inventory

Products have non-negative safe-integer `stockQuantity`, defaulting to zero on new products. Product create/update schemas do not accept stock fields. Use administrator inventory routes, not product patch, to adjust stock.

`GET /admin/inventory` returns each line as `productId`, `name`, `slug`, `sku`, `categoryId`, `status`, `stockQuantity`, and `updatedAt`. Missing legacy `stockQuantity` is serialized as zero. Query filters and pagination are defined above.

For a positive `lowStockBelow` threshold, the database filter includes quantities strictly below the threshold and legacy rows with no stored quantity. With `lowStockBelow=0`, the implementation filters for quantities below zero, so valid non-negative stock rows (including zero) do not match.

Manual adjustment body:

```json
{ "quantityDelta": -1, "reason": "<3-200 character reason>" }
```

`quantityDelta` must be a non-zero safe integer (positive adds stock, negative removes stock). `reason` is trimmed and must be 3–200 characters. The authenticated administrator ID is derived from session, not accepted from the body. The service performs a conditional atomic stock update (preventing below-zero stock), and appends the ledger row in the same transaction. Ledger response fields are `id`, `productId`, `quantityDelta`, `resultingQuantity`, `reason`, `adjustedBy`, `movementType`, optional `referenceOrderId`, and `createdAt`.

`reason` is trimmed and must be 3–200 characters. `Idempotency-Key` for manual stock adjustment is required, 16–128 characters, and accepts `[A-Za-z0-9._:-]+`. Its effective scope is product + administrator + key. An identical retry returns the original adjustment with `replayed: true`; reuse with a different product/delta/reason/actor returns 409. Ledger rows have a unique stored key and are append-only via the exposed application API; clients have no direct ledger-write route.

Both history routes sort newest-first, accept `page`/`limit`, and return `{ adjustments, pagination }`. The product-scoped route first verifies that the product exists. History rows include internal object IDs for the associated actor/product and movement type; they do not populate full user/product documents.

## 8. Delivery status

**Status: FOUNDATION ONLY.** Product shipping metadata and a generic `DeliveryQuoteProvider` interface/helper exist. No Courier Guy or ShipLogic adapter, provider credential configuration, quote route, persisted quote, shipment booking, or tracking API exists. The external Postman collection, if available to the developer, is not proof of a backend implementation.

Generic `DeliveryQuoteRequest` can include collection address, delivery address, and parcels. Each parcel has `weightGrams`, `lengthCm`, `widthCm`, and `heightCm`. The provider interface exposes `isConfigured()` and `getQuote(...)`; a quote contains non-negative integer `deliveryFeeCents`, `currency: "ZAR"`, non-empty `serviceCode`, and optional `providerReference`/`expiresAt`.

The helper fails closed: no configured provider or valid collection address returns 503; missing/invalid delivery address returns 400; missing/invalid parcel information returns 503; invalid/unavailable provider quote returns 503. The helper is not mounted in an API route or wired into order creation. No real or sandbox quote has been tested, no quote is persisted, and delivery is excluded from order totals.

Business/technical prerequisites remain: verified provider API contract and account/credential format, collection address, measured packed product data, packing policy for mixed quantities, service selection, quote expiry/price-change policy, and eventual shipment lifecycle. The frontend must not fabricate a zero quote or treat missing metadata as zero shipping.

## 9. Admin capabilities

| Capability | Current authorization and boundary |
|---|---|
| Category management | Admin-only create/update and list including inactive categories. No delete route. |
| Product management | Admin-only create/update. No product list/detail/delete admin route; public routes show only published products. No stock fields accepted. |
| Product shipping metadata | Admin create/update only; not included in public product response. |
| Inventory | Admin-only paginated listing, adjustment, recent ledger history, and product-scoped history. Mutations require CSRF and idempotency key. |
| Order cancellation | Admin-only cancellation for pending unpaid orders with reserved stock. No admin order list/detail endpoint is registered. |
| User administration | No admin user management route was found. |

Authentication middleware reads the user ID/session version from the Mongo-backed session, rechecks active/email-verified status and current user record, then role middleware checks the public user's `roles`. When admin 2FA is required (default), incomplete admin second factor is denied before ordinary protected routes.

## 10. Next.js integration examples

### Minimal browser API helper

Use a non-secret public base URL and credentials on every request. This example intentionally keeps the CSRF token in memory. It assumes a browser-side client and a successful `GET /auth/csrf-token`.

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;
let csrfToken: string | undefined;

async function refreshCsrfToken(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/auth/csrf-token`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not initialize CSRF protection");
  csrfToken = body.csrfToken;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) await refreshCsrfToken();
    headers.set("X-CSRF-Token", csrfToken!);
  }
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;
    if (response.status === 403 && message === "Invalid or missing CSRF token.") {
      csrfToken = undefined;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body as T;
}
```

After successful login, logout, Google OAuth callback, 2FA confirmation, or another session regeneration, call `refreshCsrfToken()` before the next unsafe request. For safety, do not automatically replay a mutation after 403 unless it uses a stable idempotency key and the UI explicitly handles the retry.

### Current user and public catalogue

```ts
const { user } = await api<{ user: PublicUser }>("/auth/me");

const query = new URLSearchParams({
  page: "1",
  limit: "20",
  sortBy: "name",
  sortOrder: "asc",
});
const { products, pagination } = await api<ProductList>(
  `/products?${query.toString()}`,
);
const { categories } = await api<{ categories: Category[] }>("/categories");
```

Types above are illustrative frontend types: define them from this document and keep optional fields optional. Never assume a product response contains stock, SKU, or shipping measurements.

### Cart, address, and order examples

```ts
const { cart } = await api<{ cart: Cart }>("/cart");

const { cart: updatedCart } = await api<{ cart: Cart }>("/cart/items", {
  method: "POST",
  body: JSON.stringify({ productId, quantity: 1 }),
});

const { user } = await api<{ user: PublicUser }>("/users/me");
const addressId = user.addresses[0]?.id;
if (!addressId) throw new Error("Add a saved delivery address before ordering.");

const key = crypto.randomUUID(); // create once per logical submission; retain for retries
const response = await fetch(`${API_BASE}/api/v1/orders`, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken!,
    "Idempotency-Key": key,
  },
  body: JSON.stringify({ addressId }),
});
```

Handle 409 from cart/order APIs as a business state (changed availability, insufficient stock, empty cart, duplicate key with different request), not as a generic server crash. A successful order response means stock was reserved and the order is `pending_payment`; it does not mean the customer paid. There is no current delivery quote to add to the frontend total.

### Google OAuth and 2FA guidance

- For login, navigate the browser to `${API_BASE}/api/v1/auth/google/start`; do not call it as a normal fetch expecting JSON.
- For linking, POST `/auth/google/link` with the current session and CSRF token, then navigate to the returned `authorizationUrl`.
- The Google callback currently renders JSON from the backend origin rather than redirecting into the frontend. Coordinate a callback UX/redirect change before relying on a seamless SPA flow.
- On a login response with `twoFactorRequired`, show the code form and POST `/auth/2fa/verify`. With `twoFactorEnrollmentRequired`, invoke enrollment and confirmation flow. Treat recovery codes and enrollment secrets as one-time sensitive material; never log or persist them in analytics/client storage.

## 11. Known blockers and implementation status

The status values below use the project's requested vocabulary. `TESTED` means relevant automated test coverage exists in the repository, not that the deployed service was tested. No `LIVE-VERIFIED` claim is made here.

| Feature | Source-backed status | Frontend use / blocker |
|---|---|---|
| Health check | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Available; confirms database connectivity only. |
| Public catalogue | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Usable; catalogue population is UNVERIFIED. |
| Registration/password login/session logout | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Usable with CSRF and cookies; email verification is required for password login. |
| Email verification/password recovery logic | PARTIAL / TESTED / NOT LIVE-VERIFIED | Token routes exist, but default email adapter is unconfigured; real email delivery must be supplied. |
| Google sign-in/link | PARTIAL / TESTED / NOT LIVE-VERIFIED | Requires credentials; callback does not redirect to frontend. |
| TOTP and recovery codes | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Usable when server encryption key is configured; admin policy requires enrollment. |
| Customer profile and saved addresses | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Usable for authenticated session. |
| Persistent cart | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Usable; no stock reservation until order creation. |
| Order creation/history | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Creates unpaid pending-payment orders and reserves stock transactionally. |
| Admin order viewing | NOT IMPLEMENTED | No admin list/detail route; admin cancellation is available only when order ID is already known. |
| Admin order cancellation | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Requires admin + CSRF; only pending-payment reserved orders. |
| Admin product/category operations | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Create/update and category list; no full admin product browse/delete API. |
| Inventory management/ledger | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Requires transaction-capable MongoDB deployment. |
| Product shipping metadata | IMPLEMENTED / TESTED / NOT LIVE-VERIFIED | Admin-only optional fields; legacy missing values expected. |
| Courier Guy/ShipLogic quote | NOT IMPLEMENTED (FOUNDATION ONLY) | No provider adapter, quote endpoint, credentials, persistence, or tested provider call. |
| Delivery fee in order total | NOT IMPLEMENTED | `totalCents` equals merchandise `subtotalCents`. |
| PayFast/payment confirmation | NOT IMPLEMENTED | No initiation, payment attempt, ITN/webhook, or payment-state transition. |
| Automatic reservation expiry | NOT IMPLEMENTED | No expiry worker; admin cancellation is manual. |
| Shipment booking/tracking | NOT IMPLEMENTED | No carrier booking or tracking routes. |
| Production database transaction topology | UNVERIFIED | Confirm deployed MongoDB is replica-set/sharded transaction-capable. |
| Deployed CORS/cookie environment | UNVERIFIED | Confirm exact frontend origin, SameSite, Secure/proxy behavior in deployment configuration. |

Automated tests are declared in `npm test`: foundation, Stage 2/3 auth, Stage 4 catalogue/inventory, and Stage 5 cart/orders. Inventory and order/cart suites use in-memory replica-set MongoDB; these are isolated tests, not a production topology check. No code or deployment configuration was changed to produce this handoff.
