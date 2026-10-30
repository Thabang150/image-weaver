# Healthy Ways SA Backend

TypeScript, Express, and MongoDB API for the Healthy Ways SA e-commerce platform.

## Requirements and setup

- Node.js 20.19 or newer
- npm
- A reachable MongoDB instance

```powershell
npm install
Copy-Item .env.example .env
```

Configure `.env` locally:

- `MONGODB_URI`: MongoDB connection string.
- `SESSION_SECRET`: replace the `.env.example` placeholder with an unpredictable secret of at least 32 characters. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
- `PORT`: optional API port; defaults to `3000`.
- `NODE_ENV`: `development`, `test`, or `production`.
- `SESSION_SAME_SITE`: session-cookie policy (`lax`, `strict`, or `none`); defaults to `lax`.
- `FRONTEND_ORIGIN`: optional exact HTTP(S) frontend origin. CORS is disabled when omitted.
- `RESEND_API_KEY` and `EMAIL_FROM`: Resend API key and verified sender identity. Required in production alongside `FRONTEND_ORIGIN`; keep the API key in Render's secret environment settings.
- `TRUST_PROXY`: defaults to `false`. Enable only when the deployment is behind a trusted reverse proxy.
- `TOTP_ENCRYPTION_KEY`: required base64 encoding of a separate, randomly generated 32-byte AES key. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Keep a protected backup; losing this key makes existing authenticator secrets unusable.
- `REQUIRE_ADMIN_2FA`: must be `true`; setting it to `false` fails environment validation. Every administrator must complete TOTP before receiving a fully authenticated session.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`: optional, but must be set together. The callback URI must use `/api/v1/auth/google/callback`; use HTTPS outside local development and register the exact URI in Google Cloud.
- `SHIPLOGIC_COLLECTION_STREET_ADDRESS`, `SHIPLOGIC_COLLECTION_LOCAL_AREA`, `SHIPLOGIC_COLLECTION_CITY`, `SHIPLOGIC_COLLECTION_ZONE`, `SHIPLOGIC_COLLECTION_POSTAL_CODE`, and `SHIPLOGIC_COLLECTION_COUNTRY_CODE`: backend-only collection address configuration. The confirmed address is included in `.env.example`; the application maps it to ShipLogic's `street_address`, `local_area`, `city`, `zone`, `code`, and `country` fields. `country` is the two-letter country code (`ZA`) and `code` is the postal code. These values are not exposed through the API.

Never commit `.env` or put credentials in `.env.example`.

## Shipping readiness

The confirmed collection address is configured above. The backend includes a testable request builder for the documented `POST https://api.shiplogic.com/rates` sandbox request. It validates the documented address fields (`street_address`, `local_area`, `city`, `zone`, `country`, and `code`) and positive parcel values (`submitted_length_cm`, `submitted_width_cm`, `submitted_height_cm`, and `submitted_weight_kg`). It does not make provider calls, parse rate responses, or enable quotes or payment checkout: the official authentication page masks the authentication scheme/token syntax, and the accessible rate documentation does not publish a response schema. No shipping price or fixed-rate fallback is used.

The catalogue seed contains 18 products. Twelve capsule listings have individual 90 ml bottle metadata (approximate 4.5 × 4.5 cm base, 8.1 cm height, and 12 g empty bottle); the 25–30 g value is only an estimate for a filled 60-capsule bottle. These are not parcel measurements or verified filled shipment weights. The six non-capsule listings—Valerian Tincture, NaturaFlux Tincture, Cordyceps Powder, Shilajit, Spirulina, and Chlorella—have no applicable verified filled weight or package measurements. No seeded product has a verified complete parcel mapping; no outer courier-bag measurements or multi-item packing rule are available. Accordingly, shipping quotes and payment checkout must remain unavailable until those data and the actual rates response are verified. Existing seed status and price rules also mean none of the seeded products is currently purchasable.

Before checkout is implemented, calculate the quote server-side from a validated customer address and verified product/parcel data. Persist a snapshot of the selected service, provider amount/currency, parcel inputs, and provider quote/reference/expiry fields supported by the confirmed contract against the order before payment. Revalidate an expired quote before payment and bind quote/order requests to idempotency keys and a cart/address fingerprint. Payment attempts must be uniquely persisted and ITN transitions conditional/idempotent; create a shipment only after verified payment, with a persisted idempotent fulfilment state so retrying a failure cannot duplicate a shipment. None of these quote, payment, or fulfilment flows is currently implemented.

## Development, tests, and production

```powershell
npm run dev
npm test
npm run build
npm start
```

The server validates configuration and connects to MongoDB before listening. `GET /api/v1/health` returns `200` when MongoDB is connected and `503` otherwise. The production server handles `SIGINT` and `SIGTERM`.

The automated integration tests start an isolated MongoDB instance with `mongodb-memory-server`; they do not use the configured application database or require a real email provider.

## Authentication and customer endpoints

- `GET /api/v1/auth/csrf-token`: establishes a session and returns a CSRF token.
- `POST /api/v1/auth/register`: create a customer account. Passwords must be 12–128 characters.
- `POST /api/v1/auth/admin/register`: separate admin registration, restricted server-side to the exact `@healtywayssa.co.za` email suffix.
- `POST /api/v1/auth/login`: verify password and email status; customers receive a five-minute, single-use email OTP challenge, while admins enter TOTP enrollment or verification.
- `POST /api/v1/auth/login/verify-email-otp`: verify the pending customer's six-digit email login code.
- `POST /api/v1/auth/login/resend-email-otp`: send a replacement code for the pending customer login (prior code is invalidated).
- `POST /api/v1/auth/logout`: invalidate the current server-side session.
- `GET /api/v1/auth/me` and `GET /api/v1/users/me`: retrieve the signed-in customer's profile.
- `POST /api/v1/auth/request-verification`: request another verification email.
- `POST /api/v1/auth/verify-email`: verify using `{ "token": "..." }`.
- `POST /api/v1/auth/forgot-password`: request reset instructions; response does not reveal whether an account exists.
- `POST /api/v1/auth/reset-password`: reset using `{ "token": "...", "password": "..." }`.
- `GET /api/v1/auth/google/start`: begin Google OIDC sign-in (returns a redirect to Google).
- `GET /api/v1/auth/google/callback`: registered Google OIDC callback. It validates state, nonce, PKCE, issuer, audience, signature, and token expiry.
- `POST /api/v1/auth/google/link`: start explicit Google identity linking for the currently authenticated account; returns an `authorizationUrl` for the frontend to open.
- `POST /api/v1/auth/2fa/enroll`: begin authenticator enrollment; returns the secret and `otpauth://` provisioning URI once.
- `POST /api/v1/auth/2fa/confirm`: confirm enrollment with `{ "code": "123456" }`; returns single-use recovery codes. The secret and URI are not returned again.
- `POST /api/v1/auth/2fa/verify`: complete a pending login with a TOTP code or recovery code.
- `GET /api/v1/auth/2fa/status`: retrieve the current account's 2FA enabled state.
- `POST /api/v1/auth/2fa/recovery-codes/rotate`: rotate recovery codes using `{ "code": "..." }`.
- `POST /api/v1/auth/2fa/disable`: disable customer 2FA using `{ "code": "..." }`.
- `PATCH /api/v1/users/me`: update display name and/or phone number.
- `POST /api/v1/users/me/addresses`: save an address.
- `PATCH /api/v1/users/me/addresses/:addressId`: update one of the customer's addresses.
- `DELETE /api/v1/users/me/addresses/:addressId`: delete one of the customer's addresses.

Successful registration creates an unverified account and does not sign it in. Customer registration always assigns only the `customer` role. Admin registration assigns `admin` only after the backend checks the normalized exact domain. Registration returns `emailVerificationEmailSent` so a missing provider is not represented as successful delivery. Login failures use a generic response to avoid account enumeration. Roles, account status, verification state, password hashes, and session versions cannot be changed through profile endpoints.

## Sessions, cookies, CSRF, and frontend deployment

Sessions are stored in MongoDB with `connect-mongo` and use an eight-hour lifetime. Authenticated sessions contain the user ID, session version, and authentication timestamps. Before 2FA is complete, the session contains only a user ID, version, mode, and five-minute challenge expiry; it cannot access authenticated routes. Login and successful 2FA transitions regenerate the session ID; logout destroys the server-side session. Password reset, account linking, 2FA enable/disable, and recovery-code use invalidate older sessions through the session version.

Cookies are `HttpOnly`, use `Secure` in production, and follow `SESSION_SAME_SITE`. The production cookie uses the `__Host-` prefix. `SameSite=none` is required for cross-site frontend deployments and requires HTTPS/Secure cookies. For a cross-origin frontend, set the exact `FRONTEND_ORIGIN`; browser requests must use credentials (`credentials: "include"`). Do not set `TRUST_PROXY=true` unless the service is actually behind a trusted proxy.

Cookie-authenticated state-changing requests must send the `x-csrf-token` header. First call `GET /api/v1/auth/csrf-token` with credentials enabled, retain the returned token, and include it on each `POST`, `PATCH`, `PUT`, or `DELETE`. Fetch a fresh token after login, OTP/TOTP completion, TOTP enrollment confirmation, or logout because the session ID changes. CORS is not a substitute for the CSRF token.

Google sign-in uses the authorization-code OIDC flow with state, nonce, and PKCE. The OIDC library validates the response signature, issuer, audience, expiry, state, nonce, and PKCE before account resolution. Google email must be verified. A customer callback enters the same separate email OTP challenge as password login; an administrator must complete TOTP. Provider tokens are never returned. A verified matching email never auto-links to a local account; sign in locally and use the explicit authenticated link flow. OAuth transactions expire after ten minutes and are atomically consumed once. Use `SESSION_SAME_SITE=lax` for the usual top-level OAuth callback; `strict` may prevent the browser from sending the session cookie on the return from Google.

Customer password or Google sign-in returns HTTP `202` and `{ "emailOtpRequired": true }`. The code is HMAC-hashed with the server session secret, bound to the pending session, expires after five minutes, is single-use, and allows five attempts. Customer accounts that already enrolled TOTP must also complete that challenge. The pending session cannot access profile or admin endpoints. All administrator accounts must use the exact eligible domain and complete TOTP enrollment or verification before full access. Recovery codes are random, stored only as hashes, single-use, and shown only at enrollment confirmation or rotation. Enabling, disabling, rotating codes, and using a recovery code invalidate older sessions. Rotation requires a recent (10-minute) authenticated session and a valid second factor. Admin TOTP cannot be disabled.

TOTP secrets, including pending enrollments, are stored using AES-256-GCM with `TOTP_ENCRYPTION_KEY`, separate from MongoDB. Keep this key stable and backed up; there is no key-rotation migration in this stage. Admin registration is separate and domain-limited; anyone controlling a verified mailbox in the configured domain can request the admin role, so secure domain mailboxes accordingly.

See [`docs/AUTHENTICATION.md`](./docs/AUTHENTICATION.md) for exact request/response examples, complete route table, HTTPie flows, and CSRF integration guidance.

Authentication and CSRF endpoints are limited to 10 requests per client IP in a 15-minute window by default. Limits are per process; deployments with multiple API instances should add a shared rate-limit store before scaling horizontally.

## Product catalogue (Stage 4, Part 1)

- `GET /api/v1/categories`: list active categories.
- `GET /api/v1/products`: list active products. Supports `page` (default `1`), `limit` (default `20`, maximum `100`), `q` (maximum 100 characters), `categoryId`, `minPriceCents`, `maxPriceCents`, `sortBy` (`createdAt`, `name`, or `priceCents`), and `sortOrder` (`asc` or `desc`).
- `GET /api/v1/products/:slug`: retrieve an active product by slug.
- `GET /api/v1/admin/categories`: administrator-only category list, including inactive categories.
- `POST /api/v1/admin/categories` and `PATCH /api/v1/admin/categories/:categoryId`: administrator-only category management.
- `POST /api/v1/admin/products` and `PATCH /api/v1/admin/products/:productId`: administrator-only product creation and updates.

Confirmed product prices are positive integer ZAR cents. A product may have no price while it remains unconfirmed; `priceConfirmed` distinguishes confirmed selling prices from provisional stored values. Public catalogue responses show `priceCents: null` for unconfirmed products and mark them unavailable. Inventory cannot be added until a price is confirmed. Product SKUs are normalized to uppercase; slugs are normalized to lowercase kebab-case and may be omitted on creation to derive them from the product name. New products default to `draft`; administrators must explicitly set `status` to `active` to publish one. Public catalogue responses only include active products in active categories and omit SKU and publication status. State-changing administrator requests use the existing session authentication, administrator authorization, and CSRF protections.

Products support up to ten image references and optional pack-size and bottle packaging metadata. These are references/metadata only; this stage does not upload or manage image assets. A local, explicitly guarded seed is available for the supplied Healthy Ways SA catalogue; it uses draft visibility and provisional price confirmation state to keep unconfirmed listing data from being purchasable.

Run the product seed only against a local development MongoDB database named `healthywayssa`:

```powershell
$env:PRODUCT_CATALOGUE_SEED = 'true'
npm run seed:product-catalogue
Remove-Item Env:PRODUCT_CATALOGUE_SEED
```

The script refuses non-development mode, non-local MongoDB hosts, other database names, and missing opt-in. It creates the missing supported categories and updates only records whose slug and SKU both match the seed. It preserves unrelated fields such as images and existing stock for products not marked awaiting stock, and refuses to zero an awaiting-stock product that currently has positive stock. Every seeded product receives a temporary placeholder price of R100.00 (10,000 ZAR cents). This is not a confirmed retail price: seeded prices remain unconfirmed and are not shown in public API price fields. Replace the placeholder with each product's correct retail price before the store launches, then explicitly confirm prices as appropriate. Draft products remain drafts, and the four stock-wait products remain active listings with zero stock; assigning a placeholder price does not make either group purchasable.

Inventory is implemented in Stage 4 Part 2. Carts and order creation are documented below; payment and shipping integrations are not implemented.

## Inventory management (Stage 4, Part 2)

- `GET /api/v1/admin/inventory`: administrator-only stock list. Supports `page`, `limit` (maximum `100`), `q` (product name or SKU), `categoryId`, `status`, `lowStockBelow`, and allowlisted `sortBy` (`updatedAt`, `name`, or `stockQuantity`) and `sortOrder`.
- `POST /api/v1/admin/products/:productId/inventory-adjustments`: administrator-only stock adjustment. Send a non-zero signed integer `quantityDelta`, a `reason` (3–200 characters), and an `Idempotency-Key` header (16–128 permitted characters). A positive delta adds units; a negative delta removes units. Idempotency is scoped by operation, product and administrator. Identical retries return the original adjustment without applying it twice; reuse of a key with a different payload in the same scope returns `409`.
- `GET /api/v1/admin/products/:productId/inventory-adjustments`: paginated adjustment history for one product.
- `GET /api/v1/admin/inventory/adjustments`: paginated recent adjustment history across products.

Product stock starts at `0` and is never editable through product creation or update endpoints. An adjustment stores its signed delta, resulting stock balance, reason, timestamp and administrator identity in an append-only ledger. Stock cannot fall below zero, and positive adjustments require a confirmed price. Each adjustment and ledger entry use a MongoDB transaction and commit or roll back together. Therefore the deployment must support multi-document transactions (a replica set or sharded cluster); unsupported deployments return `503` rather than applying a stock-only update. The automated inventory suite uses a separate in-memory replica set.

Stored idempotency values are namespaced by operation, product and administrator while retaining the existing unique index. Existing ledger records with the original unscoped key format remain replayable only for their original product and administrator; no index migration or ledger rewrite is required.

For example, a request can send `{"quantityDelta": 12, "reason": "Received supplier delivery"}` with an `Idempotency-Key` header. This adds 12 units. A later `{"quantityDelta": -2, "reason": "Damaged units removed"}` removes 2 units if at least 2 are available. Both requests require an authenticated administrator session, CSRF token and distinct idempotency keys.

## Shopping cart and orders (Stage 5)

All cart and order endpoints require an authenticated, email-verified customer session. Mutations require the existing `x-csrf-token` header. A cart belongs to one user and embeds at most 50 unique product lines; each line quantity is 1–99. Cart prices are never accepted from clients. Cart reads calculate current prices in integer ZAR cents; inactive products/categories and items whose current stock is below the requested quantity are returned as unavailable and excluded from the total. Cart contents do not reserve stock.

- `GET /api/v1/cart`: get the current cart (an absent cart is returned as empty).
- `POST /api/v1/cart/items`: add `{ "productId": "...", "quantity": 1 }` or increment an existing line.
- `PATCH /api/v1/cart/items/:productId`: set `{ "quantity": 1 }`.
- `DELETE /api/v1/cart/items/:productId`: remove a line.
- `DELETE /api/v1/cart`: clear the cart.
- `POST /api/v1/orders`: create an order from the current cart using `{ "addressId": "..." }` and a required `Idempotency-Key` header (16–128 permitted characters). The address must belong to the customer. The response contains a non-guessable `HW-...` order number and an immutable snapshot of product name, SKU, description, quantity, unit price and delivery address. Prices and totals are server-derived.
- `GET /api/v1/orders`: list the current customer's orders, using `page` (default `1`) and `limit` (default `20`, maximum `100`).
- `GET /api/v1/orders/:orderId`: retrieve an order owned by the current customer.
- `POST /api/v1/admin/orders/:orderId/cancel`: administrator-only cancellation with `{ "reason": "..." }`. Only pending-payment orders with reserved stock are eligible; a repeat by the same administrator with the same reason replays safely.

Order total equals the item subtotal in cents; no delivery charge, discount or payment is inferred. New orders start `pending_payment` and are not considered paid. Order creation reserves stock with conditional atomic decrements, creates order-reservation ledger records, snapshots current catalogue/address data, and clears the cart in one MongoDB transaction. Cancellation changes the order to `cancelled`, restores stock, and appends order-release ledger entries in one transaction. The movement type and order reference appear in inventory adjustment history. Stock is released once; order records are retained.

Order idempotency is scoped to the customer, and a unique index prevents concurrent duplicate orders. A repeated key with the same address returns the original order; reuse with a different address returns `409`. The cart itself is the server-side request source, so retries of the same accepted request do not depend on client-supplied line items. The app and test environment require MongoDB replica-set or sharded-cluster transaction support. The Stage 5 tests use an isolated in-memory replica set, not the configured application database.

This stage does not implement payment capture/webhooks, shipping rates/labels/tracking, email delivery, stock reservations with expiry, returns, refunds, or pickup fulfilment. Cancellation stock release can return `409` if restoring reserved units would exceed the supported integer stock maximum; an administrator must correct stock before retrying.

## Email delivery

Production email uses the official Resend SDK. Set `RESEND_API_KEY`, `EMAIL_FROM` to a sender on a Resend-verified domain, and `FRONTEND_ORIGIN` in Render. Production startup fails with a configuration error if any of those values is missing. In development, if no email provider configuration is supplied, the unconfigured adapter reports non-delivery; the API response's `emailVerificationEmailSent` field will be `false`.

Registration and `POST /api/v1/auth/request-verification` send a verification email linking to `{FRONTEND_ORIGIN}/verify-email?token=...`. The checked-out frontend currently has no verification route. It must implement `/verify-email`, read the one-time token from the query string, then call `POST /api/v1/auth/verify-email` with JSON `{ "token": "..." }`, the `x-csrf-token` header, and the same credentialed session/cookie context established by `GET /api/v1/auth/csrf-token`. The frontend should remove the token from the address bar after reading it and avoid logging or analytics capture of the token. The API returns `200 {"message":"Email address verified."}` on success; invalid, expired, or reused tokens return `400`.

Password-reset email uses `{FRONTEND_ORIGIN}/reset-password?token=...`; the frontend must provide that route and submit `POST /api/v1/auth/reset-password` with `{ "token": "...", "password": "..." }`, CSRF header, and session cookies. Verification tokens expire in 24 hours; password-reset tokens expire in one hour. Both are single-use, stored as SHA-256 hashes, and never returned from registration/resend responses or included in application logs. Provider failures are logged without provider details or tokens; registration reports `emailVerificationEmailSent: false`, and the verification resend endpoint keeps its generic response.

For Render, add the three environment variables in the service's environment settings, verify the sender domain in Resend, and redeploy. Do not commit `.env` or API keys. The repository tests mock the email sender and never send real messages. Configure Google OAuth consent, client credentials, and the exact callback URI in Google Cloud before testing a real login.

Google sign-in is implemented but cannot be verified against Google until valid project credentials and a registered redirect URI are configured.

## Product catalogue and demo data

The existing product model uses optional integer `priceCents`, `priceConfirmed`, a category reference, stock quantity, publication status (`draft`, `active`, or `inactive`), image references, and optional packaging metadata. Missing or unconfirmed prices serialize publicly as `priceCents: null`; availability requires an active product, positive stock, and a confirmed price. Catalogue additions are optional for existing records so they remain readable without fabricating details:

- `shortDescription` is used for product cards; older records fall back to `description`.
- `currency` is `ZAR` and defaults to `ZAR`.
- `productForm` is currently `capsules` when the format has been confirmed.
- `packaging` can represent a pack size and optional, separate bottle specifications; estimated filled-bottle weight is not ingredient net weight.
- `isMockData` identifies demo records. `mockFields` and `requiresConfirmation` remain internal and are not returned by public API responses.

Normal public catalogue reads include only active, non-demo products in active, non-demo categories. Product availability is returned as `isAvailable`, derived from active status and positive recorded stock; stock quantities are not returned. Image-less products return `imageReferences: []`.

### Catalogue API response shapes

`GET /api/v1/categories` returns `{ "categories": [...] }`. Each category has `id`, `name`, `slug`, `isActive`, `createdAt`, `updatedAt`, and `description` when present.

`GET /api/v1/products` returns `{ "products": [...], "pagination": { "page", "limit", "total", "totalPages" } }`. Each public product includes `id`, `name`, `slug`, `shortDescription`, `description`, `category` (`id`, `name`, `slug`), `priceCents` (integer cents or `null`), `priceConfirmed`, `currency`, `imageReferences`, `isMockData`, `isAvailable`, timestamps, and `productForm` and `packaging` when known.

`GET /api/v1/products/:slug` returns `{ "product": { ...same public product fields... } }`. It does not return SKU, status, stock count, `mockFields`, or `requiresConfirmation`.

Example product response:

```json
{
  "id": "<product-id>",
  "name": "Canna Caps",
  "slug": "canna-caps",
  "shortDescription": "Capsule-format listing; product information is being confirmed.",
  "description": "Capsule-format product. Ingredients, formulation details, directions, and intended use are awaiting confirmation.",
  "category": {
    "id": "<category-id>",
    "name": "Specialty Supplements",
    "slug": "specialty-supplements"
  },
  "priceCents": null,
  "priceConfirmed": false,
  "currency": "ZAR",
  "productForm": "capsules",
  "packaging": {
    "amount": 60,
    "unit": "capsules",
    "bottle": {
      "material": "HDPE",
      "capacityMl": 90,
      "neckSizeMm": 38,
      "baseWidthMm": 45,
      "baseDepthMm": 45,
      "baseDimensionsApproximate": true,
      "heightMm": 81,
      "emptyWeightGrams": 12,
      "emptyWeightApproximate": true,
      "estimatedFilledWeightGrams": { "min": 25, "max": 30 }
    }
  },
  "imageReferences": [],
  "isMockData": false,
  "isAvailable": false,
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

### Demo catalogue preparation

The demo records use the 12 owner-supplied product names and provisional prices, converted to cents: Magnesium Glycinate (R224), Ashwagandha (R200), Moringa Powder (R135), Collagen Powder (R180), Nettle Root (R165), Milk Thistle (R175), Activated Charcoal (R133), Lion's Mane Powder (R240), Dandelion Powder (R150), Olive Leaf Powder (R140), Canna Caps (R240), and Reishi Powder (R225). These are mock prices, not approved retail prices.

The owner confirmed the customer-facing capsule format. Each 60-capsule pack size is provisional demo data. Product names are preserved, including names containing “Powder”; the products are described as capsules. No ingredients, quantities, dosage, directions, warnings, health outcomes, or images have been inferred. The blank image arrays should be rendered using a neutral frontend placeholder.

The first 12 capsule listings use the supplied 60-capsule HDPE bottle metadata: 90 ml capacity, 38 mm neck, approximately 45 × 45 mm base, 81 mm height without lid, approximately 12 g empty-bottle weight, and estimated 25-30 g filled-bottle weight. Filled weight is packaging weight, not ingredient net weight or a shipping weight. The other six products have no bottle specifications. Confirm actual packaging, prices, ingredients, directions, warnings, imagery, approved claims, and product SKUs with the owner before publication.

The seed only connects when `NODE_ENV=development`, `DEMO_CATALOGUE_SEED=true`, and the database name in `MONGODB_URI` is exactly `healthywayssa_demo`. Configure those values locally, then run:

```powershell
$env:NODE_ENV = "development"
$env:DEMO_CATALOGUE_SEED = "true"
npm run seed:demo-catalogue
```

The seed is repeatable, creates the `Supplements` category only if its slug does not already exist, and updates only product records already marked `isMockData: true`. It stops on a real-product slug/SKU conflict and does not clear collections or set stock quantities. Run only against a dedicated demo database; do not run the seed against production or an unknown database.

For read-only storefront preview, set `DEMO_CATALOGUE_ENABLED=true` in the demo server environment and keep `NODE_ENV=development`. The environment loader rejects this flag in production. This mode makes draft demo records visible to the public catalogue API but does not change their draft status; cart/order eligibility remains controlled by the existing active-status and stock checks. Keep the flag false outside the demo environment. Replace mock values with owner-approved data and explicitly review publication status before launch.

The administrator product update endpoint accepts `isMockData: false` as an explicit confirmation transition; it clears the internal mock and confirmation markers. A mock product cannot be activated in the same request unless that confirmation is explicitly provided. Only do this after replacing the provisional price, pack size, and other outstanding product details with owner-approved values. If the seed created the demo-only `Supplements` category, the administrator category update endpoint also accepts `isDemoData: false` to make that category eligible for normal public listing after review.

Product image writes require HTTPS URLs whose exact hostnames appear in `PRODUCT_IMAGE_ALLOWED_HOSTS`, a comma-separated environment setting (for example, `images.example.test`). An empty allowlist rejects all image writes. Do not add a host until the image provider is configured and approved; Cloudinary integration is not part of this stage.

For current administrator product/category routes, image-reference requirements, stock adjustment
rules, analytics endpoints and safe HTTPie examples, see
[`docs/STORE_ADMIN_ANALYTICS.md`](./docs/STORE_ADMIN_ANALYTICS.md). Sales reporting deliberately
returns unavailable values until verified payment and refund records exist; no traffic events are
currently collected.
