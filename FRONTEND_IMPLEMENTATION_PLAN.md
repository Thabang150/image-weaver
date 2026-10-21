# Healthy Ways SA Frontend Implementation Plan

## Scope and audit basis

This document began as the Phase 1 audit. Phase 2 added the generic API foundation and integer-cent formatter; later phases added the public catalogue and a backend-backed cart. The official `/` page remains the pre-launch countdown, and storefront development is isolated to `/preview`. Delivery, payment, and checkout submission remain out of scope.

The repository inspected is `Thabang150/image-weaver`. Its current application is a React 19 / TanStack Start application built with Vite, not a Next.js application. Repository guidance in `AGENTS.md` says to keep TanStack Start and to retain exactly the `/` and `/preview` content routes. The current routes README also documents file-based TanStack routing and says not to use Next.js `app/` or `pages/` conventions.

The supplied [FRONTEND_HANDOFF.md](./FRONTEND_HANDOFF.md) is the contract source for the API integration below. Its source-backed endpoint descriptions are not proof of deployed availability or configuration. The backend base URL is `https://heathywayssa-backend.onrender.com`; it was not contacted or verified.

## 1. Current repository state

### Runtime, scripts, and dependencies

- `package.json` defines `dev`, `build`, `build:dev`, `preview`, `lint`, `format`, `test`, and `test:watch` scripts.
- The runtime is Vite with the Lovable TanStack config, TanStack Start/Router, React 19, TypeScript 5, Tailwind CSS 4, and Vitest. TanStack Query is used for catalogue and cart requests.
- Dependencies include Radix UI, shadcn-style component primitives, React Hook Form, Zod, and Lucide. No Next.js package, API client library, browser automation framework, or commerce-specific implementation was found.
- `tsconfig.json` enables strict TypeScript checks, path aliases, and `noEmit`; there is no dedicated typecheck script.
- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which provides the TanStack Start/Vite setup. `vitest.config.ts` runs tests in jsdom.
- `bun.lock` is present. `.env.example` now documents the public `VITE_BACKEND_BASE_URL`; no local `.env` file was created or overwritten.

### Routes, screens, and components

- `src/routes/index.tsx` renders only the branded pre-launch page: botanical hero image, brand, launch countdown, launch date, WhatsApp/email/phone contact actions, and footer. It does not mount the catalogue or cart provider.
- `src/routes/preview.tsx` hosts the development storefront: catalogue, product detail through validated `?product=<slug>` search state, cart trigger, and cart sheet.
- `src/routes/__root.tsx` supplies document metadata, the shared stylesheet, not-found/error views, `QueryClientProvider`, and the route outlet. Cart state is mounted by `/preview`, not the root shell.
- `src/components/wellness.tsx` contains reusable brand and botanical `<img>` elements, a browser-hydrated countdown, contact actions, and footer. Its image sources use static `/images/...` paths under `public/`, as required by the repository guidance.
- `src/components/ui/` contains a broad set of shadcn/Radix primitives suitable for forms, dialogs, tables, alerts, navigation, and skeleton states. `src/hooks/use-mobile.tsx` and `src/lib/utils.ts` provide existing utilities.
- `src/styles.css` defines the Tailwind theme and the current launch/preview styling. `src/lib/countdown.ts` computes the Johannesburg launch time from the explicit offset `2026-11-01T00:00:00+02:00`.
- The catalogue, product details, and backend-backed cart are implemented under `/preview`. Customer registration, email verification, login/2FA, password reset, account/profile, saved-address management, and read-only order history are also available as in-page views under `/preview`. Admin tools use the existing authenticated session. Checkout/order creation and payment/delivery flows remain unimplemented.

### API, authentication, tests, and build state

- `src/lib/api/client.ts` provides API-prefix URL composition, cookie credentials, JSON request/response handling, explicit HTTP/response errors, abort-signal support, an in-memory CSRF-token lifecycle, and concurrent token acquisition. The default CSRF provider calls the documented `GET /auth/csrf-token` endpoint and validates its `{ csrfToken }` response. A CSRF-specific 403 refreshes the token without replaying the rejected mutation.
- `src/lib/api/auth.ts` defines the documented public user/role shape and provides validated registration, verification, password reset, session, login/logout, 2FA, profile, and saved-address operations. `src/lib/auth/authorization.ts` centralizes the UI's verified-admin role/domain check. A 401 from `/auth/me` maps to unauthenticated; other errors (including 403) remain errors. Session transitions refresh CSRF. No password, cookie, CSRF token, or account data is persisted in browser storage.
- `src/lib/api/orders.ts` validates the documented customer order-history response; the account view shows `pending_payment` orders as unpaid. It does not create orders.
- `src/lib/money.ts` formats safe integer ZAR cents. Vitest covers API client, authentication contracts, catalogue, cart, routing, admin access gating, order-history response validation, and money/countdown behavior. Full end-to-end browser accessibility coverage is not configured.
- ESLint 9 and Prettier integration are configured. Vitest is the existing test runner. No E2E setup was found.
- Dependencies were restored without changing package manifests or creating a lockfile. Current Phase 2 test, typecheck, targeted lint, build, and full-lint outcomes are recorded under Phase 2 below.
- The worktree was clean at the start of the audit. No backend request was made, so the deployed backend has not been verified.

### Existing inconsistencies to check before customer-facing launch

- `src/routes/index.tsx` uses `info@healtywayssa.co.za`; `src/components/wellness.tsx` separately exports a contact action using `hello@healthywayssa.co.za`. The two addresses differ in both mailbox and spelling. Confirm the correct business contact before choosing one; do not silently rewrite either.
- `Countdown` renders `.countdown-value`, while the stylesheet includes rules for `.countdown-number`. Check the rendered styling when dependencies are available; do not treat this as a known runtime failure without visual verification.
- Contact markup/data currently appears in the launch route and also in the exported `ContactActions` component. Confirm intended ownership when the storefront header/footer are designed, and consolidate only if the current launch experience can be preserved.

## 2. Existing components and conventions worth keeping

- Keep TanStack Start, file-based routes, the generated route tree, Vite, React, TypeScript, and existing build/test/lint tooling. Do not convert the repository to Next.js as part of backend integration preparation.
- Keep exactly the two content routes `/` and `/preview`. `/` is reserved for the official pre-launch experience. All catalogue, product, cart, and future customer shopping flows live under `/preview`, using validated search state for product selection instead of adding routes.
- Keep the root shell, error boundary/not-found treatment, TanStack Query provider, Tailwind theme, accessible Radix/shadcn primitives, mobile hook, and standard image tags with static `/images/...` sources.
- Keep the launch countdown utility, contact details, and footer on `/`; storefront requests and cart failures must not gate that page.
- Do not edit `src/routeTree.gen.ts` manually; allow the configured TanStack file-route generation to update it when routes are changed, while maintaining the two-route constraint.

## 3. Backend contract comparison: gaps and mismatches

The frontend has contract-driven client/session helpers and customer storefront views wired to them. No live frontend request was made or backend deployment verified; the comparison below distinguishes code-backed UI from deployment confirmations.

| Contract area                       | Required behavior from the task                                                                                                                                                        | Current frontend / plan                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend origin and API prefix       | Use the supplied backend base URL and `/api/v1` prefix.                                                                                                                                | `.env.example` documents the source-provided public base URL; `src/lib/api/client.ts` normalizes `/api/v1` exactly once. The host is documented but not live-verified.                                                                                  |
| Session cookies                     | Send `credentials: "include"` for session-dependent requests; do not read or persist session cookies in JavaScript.                                                                    | The generic request method sets `credentials: "include"` and does not read/store cookies. Verify backend CORS/cookie-domain/SameSite settings for the deployed frontend origin.                                                                         |
| CSRF                                | `GET /auth/csrf-token` returns `{ csrfToken }`; unsafe methods (POST/PATCH/PUT/DELETE) require `X-CSRF-Token`. Refresh after a CSRF 403; do not automatically replay failed mutations. | The default in-memory provider uses the documented endpoint and validates the exact field. The client adds the header for all methods except GET/HEAD/OPTIONS, refreshes on the documented CSRF 403, and propagates the original 403 without replaying. |
| Authentication/session regeneration | Login, logout, Google callback, 2FA confirmation, or another session regeneration requires refreshing the CSRF token before the next unsafe call.                                      | Auth helpers refresh after password login, logout, 2FA verification, and confirmation. Google OAuth remains a browser-navigation flow with callback UX not yet integrated; other future session transitions must explicitly refresh.                    |
| Price representation                | Treat ZAR values as integer cents.                                                                                                                                                     | Catalogue/cart and order-history models use validated integer cents and the shared ZAR formatter; frontend does not calculate authoritative cart/order totals.                                                                                        |
| Response/error contract             | Match current backend response shapes and error statuses.                                                                                                                              | Auth, catalogue, cart, admin, and customer order-history helpers validate documented response shapes. UI maps common errors to safe user-facing messages without exposing stack traces.                                                                |
| Roles and authorization             | Customer/admin role requirements apply.                                                                                                                                                | `/preview` uses the backend session and verified admin role for account/admin navigation; the admin page explains that no public admin registration/invitation endpoint is provided. Backend authorization remains authoritative.                       |
| Product privacy                     | Product responses do not expose public stock or shipping metadata.                                                                                                                     | `/preview` renders documented product fields only. It does not synthesize public stock or shipping data; availability messages follow backend cart outcomes.                                                                                          |
| Cart persistence and stale items    | Respect backend cart persistence and handle stale/unavailable items.                                                                                                                   | The `/preview` cart uses backend persistence and retains unavailable lines with nullable product/prices; visitors receive a sign-in path and no guest cart is stored or merged.                                                                        |
| Order creation                      | Requires a saved `addressId` and `Idempotency-Key`.                                                                                                                                    | No checkout or order creation exists. The account can read documented customer order history only. The handoff specifies `{ addressId }`, a 16–128 character idempotency key, and pending-payment response for a future checkout implementation.          |
| Order status                        | Successful order creation results in `pending_payment`, not a paid order.                                                                                                              | Customer order history displays `pending_payment` as “Pending payment — not paid”; no order-creation UI exists.                                                                                                                                      |
| Delivery                            | No delivery quote endpoint or delivery automation is currently available.                                                                                                              | Do not display a live quote, promise a shipping cost/ETA, or initiate a courier integration. Confirm fulfillment business rules and endpoint availability later.                                                                                        |
| Payment                             | PayFast is not currently integrated.                                                                                                                                                   | Do not initiate PayFast, collect payment details, or mark orders paid. Confirm provider onboarding, callback/webhook ownership, and payment-state contract before implementation.                                                                       |
| Reservation expiry                  | Reservation-expiry automation is absent.                                                                                                                                               | Do not represent inventory/cart reservations as guaranteed or assume automatic expiry/release behavior. Confirm required business behavior with the backend/business owner.                                                                             |

**Deployment blocker:** the source contract is now available, but the deployed backend's availability, exact configured CORS origin, cookie SameSite/Secure behavior, and production transaction capability remain unverified. Do not interpret documented routes as live verification.

## 4. Proposed frontend architecture

Keep TanStack Start and separate page-specific UI from transport/session logic. A possible structure (add only as each stage needs it):

```text
src/
  routes/
    __root.tsx
    index.tsx                 # pre-launch countdown; route stays /
    preview.tsx               # storefront views; route stays /preview
  components/
    layout/                   # storefront header, footer, navigation
    storefront/               # catalogue, product, cart, checkout views
    account/                  # sign-in, profile, addresses, order history
    admin/                    # admin dashboard and inventory views
    ui/                       # keep existing shared primitives
  hooks/
    use-mobile.tsx
  lib/
    api/
      client.ts               # origin/prefix, credentials, CSRF, errors
      contracts.ts            # handoff-derived request/response types
      errors.ts               # typed backend errors/status mapping
    auth/                     # session/role state and route-view guards
    money.ts                  # integer-cent ZAR formatting
    utils.ts
  test/
    ...                       # existing Vitest setup plus focused tests
```

- **Routes and shared layout:** keep the root shell and the two existing route definitions. `/` remains the official countdown, contact, and footer page. Compose catalogue/product/cart/account/admin development views within `/preview`, using validated search state for shareable product selection and browser Back/Forward without adding content routes.
- **Typed API client:** define typed contracts from the handoff, not guesses. Centralize the configured public backend origin plus `/api/v1`, JSON parsing, `credentials: "include"`, CSRF headers for unsafe methods, abort signals, and typed HTTP errors. Never convert failures into success-shaped defaults.
- **Session and CSRF management:** let the browser manage HttpOnly session cookies. Keep the CSRF token in short-lived in-memory state only; acquire it using the documented endpoint and refresh it after session regeneration/authentication. Coordinate simultaneous token refreshes and surface acquisition failures instead of proceeding with an unsafe request.
- **Authentication and roles:** derive logged-in identity/role from documented backend session behavior. Protect customer/admin views for navigation clarity, but always handle backend `401`/`403` responses because UI checks are not security boundaries. Do not put passwords, cookies, CSRF tokens, or sensitive account data in browser storage.
- **Catalogue and product:** render backend-returned catalog data, loading/empty/error states, and documented product fields. Use integer-cent amounts and an `Intl.NumberFormat`/shared formatter for ZAR. Never show made-up price, stock, or shipping metadata.
- **Cart:** backend cart is authoritative/persistent. Reflect server-confirmed quantities and totals. On stale/unavailable items, preserve the backend's response, explain which items need attention, and require user action before checkout. Do not automatically create orders.
- **Account and addresses:** use documented customer operations to manage profile and saved addresses. Checkout must select an already-saved address and send its documented `addressId`.
- **Admin:** expose only documented admin-authorized category/product/inventory operations. Reuse existing form, dialog, alert, table, and skeleton primitives; never expose customer-only screens or private inventory data to unauthenticated/public users.
- **States and accessibility:** every data view needs loading, empty, validation, unauthorized, not-found, stale-data, and recoverable error states where applicable. Use semantic headings/landmarks, labels and descriptions, keyboard-operable dialogs/menus, visible focus, accessible status announcements, and reduced-motion support. Keep the existing responsive style conventions.
- **Testing:** extend Vitest/jsdom with API-client unit tests and component/state tests using mocked `fetch` at the boundary (not permanent hardcoded product fixtures). Add integration/browser tooling only if required and agreed; none is configured currently. Keep lint/build checks and consider adding an explicit typecheck script once implementation work begins.

### Environment and secret handling

Use the repository's Vite/TanStack environment mechanism. `.env.example` provides `VITE_BACKEND_BASE_URL` containing only the public API host documented in the handoff; the client accepts either that origin or the same origin with `/api/v1` already appended. Do not put server-side credentials, signing keys, payment secrets, or provider tokens in any client bundle. The backend handoff requires exact `FRONTEND_ORIGIN` CORS configuration and compatible credentialed cookie attributes; whether the deployed backend is configured for the eventual frontend origin remains unverified. If a server-side proxy is needed, decide that from actual deployment requirements rather than assuming it.

## 5. Phased implementation plan

Phase 1 established the baseline, and Phase 2 now implements the API/session foundation. The test, lint, and build commands below remain the checks for later phases; `npm run typecheck` is not declared, so use `npx tsc --noEmit` unless a script is added.

### Phase 1 — Repository audit and cleanup

- **Likely files:** `FRONTEND_IMPLEMENTATION_PLAN.md`; later, only if approved, `package.json`, `README.md`, and specific UI files requiring confirmed cleanup. The audit is complete.
- **Behavior:** establish a verified baseline and make explicit decisions about the TanStack-vs-Next.js naming/deployment mismatch, existing launch experience, duplicated contact content, and conflicting contact addresses. Do not remove current behavior pending confirmation.
- **Dependencies:** repository inspection and the supplied `FRONTEND_HANDOFF.md`; business contact/deployment decisions remain outstanding.
- **Acceptance criteria:** current routes/assets/scripts/tests are documented; keep the existing runtime and two content routes; preserve existing launch behavior and contact data pending confirmation.
- **Commands:** baseline commands and current validation outcomes are recorded in Phase 2 below.

### Phase 2 — API client, environment, session, and CSRF

- **Likely files:** `.env.example`, `README.md`, `FRONTEND_IMPLEMENTATION_PLAN.md`, `src/lib/api/client.ts`, `src/lib/api/auth.ts`, `src/lib/money.ts`, `src/vite-env.d.ts`, `src/test/api-client.test.ts`, `src/test/auth.test.ts`, `src/test/money.test.ts`.
- **Behavior:** implemented API prefix and public base URL configuration, cookie credentials, documented CSRF endpoint/schema, unsafe-method header, CSRF-403 refresh without replay, login/logout/2FA CSRF refresh, typed current-session helper, and integer-cent ZAR formatting.
- **Dependencies:** backend API contract is documented in `FRONTEND_HANDOFF.md`. Production frontend origin/CORS/cookie settings still need deployment confirmation.
- **Acceptance criteria:** verify CSRF request URL and `{ csrfToken }` parsing, cookie credentials, safe/unsafe methods, request blocking on token failure, 403 refresh without a mutation retry, session-transition token refresh, 401/403 distinctions, and ZAR cents formatting. No auth UI or unverified endpoint is added.
- **Commands:** `npm test`; `npx eslint src/lib/api/client.ts src/lib/api/auth.ts src/lib/money.ts src/vite-env.d.ts src/test/api-client.test.ts src/test/auth.test.ts src/test/money.test.ts`; `npx tsc --noEmit`; `npm run build`. Full `npm run lint` remains subject to existing repository-wide line-ending/Prettier failures.
- **Validation results:** `npm test` passed (25 tests in 5 files); targeted ESLint passed; `npx tsc --noEmit` passed; `npm run build` passed. Full `npm run lint` reports 5,012 errors and 6 warnings, primarily pre-existing Prettier/CRLF issues in untouched files; changed TypeScript files pass targeted lint. Unit tests mock `fetch`; no live backend request was made.

### Phase 3 — Public storefront and catalogue

- **Files:** `src/routes/index.tsx`, `src/components/storefront/catalogue.tsx`, `src/lib/api/catalogue.ts`, `src/styles.css`, `src/test/catalogue.test.tsx`, and `src/test/app-routing.test.tsx`.
- **Behavior:** the catalogue and product detail view run only under `/preview`. Loads public categories and products using the Phase 2 client; supports documented category/search filters, integer-cent min/max price bounds, sort fields/orders, and pagination. Product detail uses validated `/preview?product=<slug>` search state and browser history. Runtime-checks response fields and displays accessible image placeholders for absent or failed URLs. Only handoff-documented fields and integer-cent prices are rendered.
- **Dependencies:** Phase 2 API client and documented public category/product response shapes. `imageReferences` contains up to 10 HTTPS URLs whose exact hostnames are checked against backend `PRODUCT_IMAGE_ALLOWED_HOSTS`; configure the matching public frontend allowlist `VITE_PRODUCT_IMAGE_ALLOWED_HOSTS` before rendering remote images. No production image host, product imagery, or populated live catalogue is assumed.
- **Acceptance criteria:** no invented product records, prices, claims, stock, or shipping metadata; errors are recoverable; missing optional packaging is omitted; `/` remains a launch-only page; `/preview` owns storefront content; exactly two routes remain; product selection supports browser Back/Forward.
- **Commands:** `npm test`; `npx eslint src/lib/api/catalogue.ts src/components/storefront/catalogue.tsx src/routes/index.tsx src/test/catalogue.test.tsx src/test/app-routing.test.tsx`; `npx tsc --noEmit`; `npm run build`; `git diff --check`; `npx prettier --check` for changed TypeScript and documentation.
- **Review follow-up:** runtime validation rejects malformed required response fields; non-JSON upstream error bodies are not surfaced; tests cover malformed list/detail data, safe error display, image allowlisting/failure placeholders, search/filter query construction, and Back/Forward selection. Prior validation records successful checks; the current follow-up must rerun checks after the new search/admin work. Production availability and frontend CORS/cookie integration remain unverified.

### Phase 4 — Product detail views and cart

- **Status:** product detail and Phase 4A cart UI are implemented under `/preview`.
- **Files:** `src/components/storefront/catalogue.tsx`, `src/components/storefront/cart.tsx`, `src/lib/api/cart.ts`, `src/lib/api/client.ts`, `src/lib/money.ts`, `src/routes/preview.tsx`, and focused catalogue/cart/routing tests.
- **Behavior:** uses documented authenticated customer cart endpoints and CSRF-aware API requests; displays backend-derived pricing and totals; supports add, quantity update, remove, and clear; exposes recoverable loading/API error states. No guest cart or merge behavior is implemented.
- **Acceptance criteria:** integer cents are formatted as ZAR; cart contents and totals follow backend responses; unavailable lines remain visible and removable; mutations are protected against duplicate clicks; `/` never loads cart data; checkout/order/payment/delivery submission remain deferred.
- **Commands:** `npm test`; targeted `npx eslint` for changed files; `npx tsc --noEmit`; `npm run build`; `git diff --check`.

### Phase 5 — Authentication, customer account, and saved addresses

- **Status:** implemented in `/preview` using query-selected views rather than additional content routes.
- **Files:** `src/components/storefront/preview-site.tsx`, `src/lib/api/auth.ts`, `src/lib/api/orders.ts`, `src/lib/auth/authorization.ts`, `src/test/auth.test.ts`, `src/test/orders.test.ts`, and routing tests.
- **Behavior:** registration and backend-reported email delivery status; verification request/confirmation; login and required 2FA challenge/enrollment; forgot/reset password; account/profile and saved-address management; read-only customer order history. Session transitions use existing CSRF refresh behavior and admin tools share this login/session experience.
- **Dependencies:** Phase 2; handoff's exact auth/session, customer role, account/address schemas, and error behavior.
- **Acceptance criteria:** no passwords/cookies/CSRF/sensitive account values in localStorage/sessionStorage; fresh CSRF token is used after session regeneration; guest/customer/admin views follow documented role behavior; only backend-returned addresses and orders are displayed; pending-payment orders are not called paid.
- **Commands:** `npx vitest run src/test/auth.test.ts src/test/orders.test.ts src/test/app-routing.test.tsx --maxWorkers=1 --no-file-parallelism`; `npx tsc --noEmit`; targeted `npx eslint`; `npm run build`.

### Phase 6 — Admin product/category and inventory functionality

- **Status:** supported admin category/product/inventory tools are implemented; the general `/preview` login flow is shared with the admin view.
- **Files:** `src/components/storefront/admin.tsx`, `src/components/storefront/preview-site.tsx`, `src/routes/preview.tsx`, `src/lib/api/admin.ts`, `src/lib/api/auth.ts`, `src/lib/image-url.ts`, and focused admin/auth tests.
- **Behavior:** authorized users can create/activate categories and products and view/update supported inventory. Admin navigation requires the backend-confirmed admin role, verified email, expected domain, and authenticated session after 2FA. No self-promotion or admin registration path is added.
- **Dependencies:** Phase 2; admin role definition and exact supported backend operations/fields from the handoff; do not infer CRUD or inventory endpoints.
- **Acceptance criteria:** customer/anonymous sessions cannot access admin tools; admin UI handles documented `401`/`403` and invalid response states; only supported fields/actions are exposed. No public admin registration, invitation, or bootstrap capability was found; a backend operator must confirm the approved secure provisioning procedure. The backend does not provide admin product detail/list or delete, so full product editing and deletion are unavailable.
- **Commands:** `npm test -- src/test/admin.test.tsx src/test/auth.test.ts`; `npx tsc --noEmit`; targeted `npx eslint`; `npm run build`; `git diff --check`.
- **Current verification:** `npm test -- --maxWorkers=1 --no-file-parallelism` passes all 64 tests; `npx tsc --noEmit`, targeted ESLint (0 errors; two existing cart refresh warnings), changed-source Prettier checks, `npm run build`, and `git diff --check` pass. The plan document itself fails Prettier formatting, and the checked-in baseline version fails the same check. No backend files or live API endpoints were changed or tested.

### Phase 7 — Checkout review and pending-payment order creation

- **Likely files:** `src/components/storefront/checkout-review*`, `src/lib/api/orders.ts` (extend the existing validated history client only for documented creation behavior), `src/test/order-creation.test.tsx`.
- **Behavior:** review backend cart and totals, require selection of a saved `addressId`, then create an order only on an explicit submit. Include an `Idempotency-Key` and represent the returned `pending_payment` state as awaiting payment, not paid.
- **Dependencies:** Phases 2, 4, and 5; documented order input/output/error contracts; confirmation of which server-side validations may reject checkout.
- **Acceptance criteria:** no order request on page load/render; cannot submit without valid cart and saved address; retries for one user submission reuse its idempotency key; pending orders are never labeled paid; no shipping fee or delivery promise is invented.
- **Commands:** `npm test -- src/test/order-creation.test.tsx`; `npm run lint`; `npm run build`; `npm run typecheck` if available.

### Phase 8 — Integration tests, responsive design, accessibility, and deployment checks

- **Likely files:** relevant `src/test/*`, `src/routes/*`, `src/components/**/*`, `src/styles.css`, `README.md`, and deployment configuration only if the actual host requires changes.
- **Behavior:** validate the agreed end-to-end customer/admin journeys against a documented test environment; complete responsive, keyboard, screen-reader, error-state, and deploy-origin checks.
- **Dependencies:** Phases 2–7; stable API test environment and test accounts/fixtures; confirmed production host and cookie/CORS settings. Use non-production data and credentials.
- **Acceptance criteria:** the full available test suite, lint, typecheck, and production build pass; session cookies and CSRF work on the real deployment origin; accessible keyboard/focus/status behavior is verified; no secrets are shipped to client; no regression to the two-route scope or required launch/preview behavior.
- **Commands:** `npm test`; `npm run lint`; `npm run build`; `npm run typecheck` if available; run agreed browser/API smoke tests only after their tooling and safe test environment are configured.

### Phase 9 — Delivery and payment integration (deferred)

- **Likely files:** none until a separate approved scope; later changes would likely touch `src/lib/api/*`, checkout/payment UI, deployment secrets/configuration, and integration tests.
- **Behavior:** delivery quotes/fulfillment and PayFast flow only after backend/business rules and provider setup exist. Payment must be confirmed from the authoritative backend payment state/webhook, not from order creation or a browser redirect.
- **Dependencies:** delivery provider and merchant account setup; approved business rules for delivery areas, rates, serviceability, failed quotes, reservation/expiry and refunds; documented backend quote/payment endpoints, callback/webhook security, state transitions, test credentials, and production secrets handling.
- **Acceptance criteria:** no courier or payment request is sent before those prerequisites are confirmed; order/payment states remain server-authoritative; idempotency and failure/retry behavior are tested; provider secrets remain server-side; delivery fees and promises come from approved live backend responses.
- **Commands:** deferred. Define targeted provider sandbox/contract tests and repeat `npm test`, `npm run lint`, and `npm run build` when a separate integration task is approved.

## 6. Blockers and decisions requiring confirmation

1. Confirm the production frontend origin is configured as the backend's exact `FRONTEND_ORIGIN`, credentialed CORS is enabled for it, and session/CSRF cookie attributes are compatible with the frontend/API site relationship. These deployed values remain unverified.
2. Confirm whether `https://heathywayssa-backend.onrender.com` is the intended production API host; the spelling may be intentional. The path prefix is documented as `/api/v1`.
3. Resolve the stated Next.js/Vercel expectation against the actual TanStack Start/Vite application and the repository rule to keep TanStack Start. This plan assumes TanStack Start remains; Vercel compatibility/deployment configuration must be validated, not inferred from the hosting reference.
4. Confirm the two existing contact email values before changing any customer-facing address.
5. **Resolved:** `/` remains the launch/countdown page; all storefront and admin work is kept under `/preview`.
6. Use only the operations documented in `FRONTEND_HANDOFF.md`. The contract includes no public stock/shipping fields, no admin product browse/delete endpoint, no delivery quote or PayFast endpoint, and no automatic reservation expiry.
7. Confirm dependency restoration and CI environment behavior. Dependencies were restored in this workspace; targeted lint/tests/typecheck/build passed, while full lint still encounters repository-wide line-ending/Prettier failures.

## 7. Ready to build now vs. explicitly deferred

**Ready to build now:** the `/preview` storefront uses backend categories/products; the Phase 4A cart uses authenticated backend cart data; customer registration, verification, login/2FA, password reset, account/profile, saved addresses, order history, and documented admin category/product/inventory actions are implemented. Checkout/order creation remains a future phase and is not connected to the cart. Confirm production CORS/cookies and allowed image-host configuration before live browser-session/image acceptance; do not infer current data population or deployed availability.

**Deferred:** courier/delivery quotes, shipping prices or ETAs, Courier Guy/ShipLogic, PayFast, payment capture/status automation, reservation-expiry automation, and any claim that an order has been paid. These depend on missing business rules, backend capabilities, and/or provider/merchant setup and are not part of this task.
