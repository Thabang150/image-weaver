# Store administration and analytics API

This guide documents the current backend routes. It does not enable payment checkout, process
payments, create shipments, or provide image uploads. Use a local or staging database for
state-changing requests.

## Access, sessions, and CSRF

Every `/api/v1/admin/...` route below requires an authenticated administrator. The backend
authorizes the server-side session; frontend route hiding is not access control. Authentication
uses the existing MongoDB-backed session cookie and CSRF protection. Keep the cookie jar between
requests and send the token from the same session on every `POST`, `PATCH`, and `DELETE`.

PowerShell HTTPie setup (replace the URL if needed):

```powershell
$API = 'http://localhost:3000/api/v1'
$Session = 'healthywayssa-admin'
$csrf = (http --session=$Session GET "$API/auth/csrf-token" | ConvertFrom-Json).csrfToken
```

Complete the documented administrator login and TOTP steps in
[`AUTHENTICATION.md`](./AUTHENTICATION.md), using the same HTTPie session. After login or another
session transition, fetch a new CSRF token:

```powershell
$csrf = (http --session=$Session GET "$API/auth/csrf-token" | ConvertFrom-Json).csrfToken
```

HTTPie stores cookies in its named local session. Protect and remove that session file when done;
do not share it. For safe inspection requests use `http --session=$Session GET ...`. For writes,
include `x-csrf-token:$csrf`. Use only a test administrator and non-production database.

## Current store behavior and limits

- Product SKU and slug are unique. Admin product reads are paginated; writes validate input and
  preserve fields omitted from a PATCH. Product deletion is not offered; set status to `archived`
  to retain historical references.
- Categories can be created, listed and updated. There is no category-delete route, so product
  references are not removed by category deletion.
- Product and category images are externally hosted HTTPS URL references, not uploaded files.
  No image-provider SDK, upload endpoint, credentials, or cleanup process is implemented. Configure
  `PRODUCT_IMAGE_ALLOWED_HOSTS` as exact comma-separated hostnames; an empty list rejects image
  writes. Choose and configure an approved hosting provider separately before adding its hostname.
- Stock is changed through auditable, idempotent inventory adjustments. Order creation atomically
  reserves stock while creating a `pending_payment` order; admin cancellation of such an order
  releases stock. The current backend has no verified payment callback, paid/completed order state,
  refund state, or shipment creation. Do not treat order creation as a sale.
- There is no page-view, session, conversion, or traffic-source event collection. No traffic
  endpoint is provided.

## Product and category routes

All admin routes use the `/api/v1` prefix and require admin session plus CSRF for writes.

| Method and path | Purpose |
| --- | --- |
| `GET /categories` | Public active categories |
| `GET /products` | Public product list |
| `GET /products/:slug` | Public product details |
| `GET /admin/categories` | List categories, including inactive categories |
| `POST /admin/categories` | Create a category |
| `PATCH /admin/categories/:categoryId` | Update category fields |
| `GET /admin/products` | Paginated product list; optional `page`, `limit`, `q`, `categoryId`, `status` |
| `GET /admin/products/:productId` | Get a product |
| `POST /admin/products` | Create a product |
| `PATCH /admin/products/:productId` | Update only supplied product fields |

Product prices are integer cents in ZAR (`priceCents`, optional `salePriceCents`, and optional
`costCents`). A sale price must be below the regular price. `stockQuantity` is not directly
editable through product create/update: use the inventory adjustment route. Optional
`lowStockThreshold` is a non-negative integer. Product status is `draft`, `active`, `inactive`, or
`archived` on updates and admin listing; new products default to `draft`. Public products do not
expose SKU or stock quantity, and a product is available only if active, in stock, and price
confirmed.

Example category creation:

```powershell
http --session=$Session --json POST "$API/admin/categories" `
  "x-csrf-token:$csrf" `
  name='Supplements' slug='supplements' description='Product category' `
  displayOrder:=1 isActive:=true
```

Example product creation (replace the category ID and values with approved test data):

```powershell
$CategoryId = '0123456789abcdef01234567'
http --session=$Session --json POST "$API/admin/products" `
  "x-csrf-token:$csrf" `
  name='Sample Product' sku='SAMPLE-001' description='Test listing' `
  "categoryId:$CategoryId" priceCents:=10000 `
  currency='ZAR' status='draft' imageReferences:='[]'
```

Example partial product update:

```powershell
$ProductId = '<product-id-from-the-admin-product-response>'
http --session=$Session --json PATCH "$API/admin/products/$ProductId" `
  "x-csrf-token:$csrf" lowStockThreshold:=5 status='inactive'
```

For an image reference, provide an allowed HTTPS URL in `imageReferences`; optional
`primaryImageReference` must be one of those references. No multipart upload is supported.
Category images use `imageReference` and the same allowlist.

## Inventory routes

| Method and path | Purpose |
| --- | --- |
| `GET /admin/inventory` | Paginated stock list; optional `page`, `limit`, `q`, `categoryId`, `status`, `lowStockBelow`, `sortBy`, `sortOrder` |
| `GET /admin/inventory/adjustments` | Paginated movement history |
| `GET /admin/products/:productId/inventory-adjustments` | Paginated movement history for a product |
| `POST /admin/products/:productId/inventory-adjustments` | Add or remove stock with an audit reason |

Adjustments are transactional and require a unique `Idempotency-Key` header (16–128 permitted
characters). Reuse the same key only when retrying exactly the same operation. Negative deltas
cannot reduce stock below zero. Adding stock also requires a confirmed product price.

```powershell
http --session=$Session --json POST "$API/admin/products/$ProductId/inventory-adjustments" `
  "x-csrf-token:$csrf" 'Idempotency-Key:inventory-restock-test-001' `
  quantityDelta:=10 reason='Test stock receipt'

http --session=$Session GET "$API/admin/inventory?lowStockBelow=5&limit=20"
http --session=$Session GET "$API/admin/inventory/adjustments?limit=20"
```

## Analytics routes

All analytics routes are administrator-only `GET` requests. Optional shared query parameters are
`start` and `end` (both required together, ISO-8601 timestamps with an explicit timezone),
`groupBy` (`day`, `week`, or `month`), `page`, `limit` (maximum 100), `q`, `categoryId`, and
`status`. Date ranges are limited to 366 days. When dates are omitted, the requested range is the
30 days ending at request time. Boundaries are start-inclusive and end-exclusive. `STORE_TIME_ZONE`
is a validated IANA timezone (defaults to `Africa/Johannesburg`); returned period timestamps are
UTC ISO strings and also identify that configured timezone.

| Method and path | Current response |
| --- | --- |
| `GET /admin/analytics/overview` | Period, ZAR, pending/cancelled order counts, low/out-of-stock counts; sales fields are explicitly `null` or empty |
| `GET /admin/analytics/sales` | Explicitly unavailable sales metrics, empty series, and pending/cancelled counts |
| `GET /admin/analytics/products` | Paginated current product/stock information; historical sales metrics are `null` |
| `GET /admin/analytics/inventory` | Current stock page, configured low-stock list, out-of-stock list, and recent movements (up to 50) |
| `GET /admin/analytics/categories` | Current category/product counts; historical sales metrics are `null` |

Sales, refunds, gross profit, sales velocity, and conversion are not reported as zero or estimated:
their values are unavailable because the backend does not yet store verified paid orders/refunds or
traffic events. The code returns a `salesUnavailableReason` for the sales-related endpoints. Product
cost is optional current catalogue data; it is not by itself sufficient to calculate historical
profit.

```powershell
http --session=$Session GET "$API/admin/analytics/overview"
http --session=$Session GET "$API/admin/analytics/sales?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z&groupBy=week"
http --session=$Session GET "$API/admin/analytics/products?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z&limit=20"
http --session=$Session GET "$API/admin/analytics/inventory?limit=20"
http --session=$Session GET "$API/admin/analytics/categories?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z"
```

## Before relying on store or sales reporting

1. Select an image-hosting provider, configure its separate upload process, and allowlist only the
   exact public image hostname. The current API only stores references.
2. Supply verified retail/sale prices, product costs if needed, low-stock thresholds, and product
   details. Keep incomplete/unapproved products unpublished.
3. Implement and verify payment-provider request, webhook signature checks, idempotent paid-state
   transitions, and refund records before showing revenue metrics. The current order is only a
   stock-reserving `pending_payment` record.
4. Decide whether privacy-conscious traffic events are appropriate; implement and collect them
   before presenting traffic or conversion analytics.
5. Test these requests against an isolated local or staging database. No commands in this guide
   authorize production writes or real payments.
