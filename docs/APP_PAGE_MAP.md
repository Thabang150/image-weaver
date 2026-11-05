# Healthy Ways SA application page map

## 1. Application overview

This is a TanStack Start application. `src/routes/__root.tsx` provides the document shell, global stylesheet, React Query client and router outlet. The production `/` route is a standalone launch/countdown experience. The development storefront is `/preview`; its top-level route stays fixed while `view`, `product`, `orderId` and related search parameters select the content shown inside the storefront.

The storefront UI is primarily composed in `src/components/storefront/preview-site.tsx`. Its `SiteFrame` provides the preview navigation and footer; `PreviewSite` resolves the selected view and mounts the common cart sheet. `src/components/storefront/cart.tsx`, `catalogue.tsx`, `customer-checkout.tsx`, `customer-pages.tsx`, `payment-state.tsx`, and `admin-management.tsx` implement the main functional areas.

Frontend API wrappers in `src/lib/api/` use the shared client in `src/lib/api/client.ts`. It supplies the `/api/v1` prefix, credentials, CSRF handling for unsafe requests, response parsing, and preview mutation protection. In development the application also has a same-origin API pass-through at `src/routes/api/v1/$.ts`.

The route tree is generated from files under `src/routes/`. Some customer and storefront pages are not independent routes: they are search-state views under `/preview`. Direct customer/admin sign-in routes reuse `PreviewSite` to render their corresponding form while disabling the cart provider.

## 2. Route and page inventory

| Route/path | Page name | Purpose | Current implementation status | Main components used | Important functionality | Dependencies or API integrations |
|---|---|---|---|---|---|---|
| `/` | Launch / countdown | Public pre-launch landing page | Implemented; separate from the storefront | `LaunchExperience`, `Brand`, `BotanicalImage`, `Countdown`, `Footer` from `src/components/wellness.tsx` | Countdown, launch information and contact actions | Shared countdown utility; no storefront API |
| `/preview` | Storefront home | Development storefront homepage (default `view=home`) | Implemented | `PreviewSite`, `SiteFrame`, `PreviewHome`, `CartProvider`, `CartSheet` | Campaign hero, wellness themes, featured products, ingredient guide, story, Discover entry | Catalogue API for featured products; cart/session context |
| `/preview?view=shop` | Shop / catalogue | Browse, filter, sort and paginate products | Implemented | `Catalogue`, `ProductListing`, `ShopProductCard`, `CartAddButton` | Category selection, text/price filters, product details and add to cart | Public categories/products API; cart API |
| `/preview?view=shop&product={slug}` | Product detail | View a selected product | Implemented | `Catalogue`, `ProductDetail`, product image/gallery helpers | Product details, image gallery and add to cart | Public product-by-slug API; cart API |
| `/preview?view=cart` | Cart | Review and change cart contents | Implemented | `CartPage`, `CartSheet`, cart context | Quantity changes, removals, clear cart, continue shopping and checkout entry | Auth session and server-backed cart API |
| `/preview?view=checkout` | Checkout | Address, order, delivery quote and payment flow | Implemented; requires authenticated customer | `CheckoutPage`, manual address form, cart context | Save/select address, create/recover order, request/select delivery quote and begin PayFast checkout | Auth/address API; cart; orders, shipping quotes and PayFast checkout API |
| `/preview?view=payment-return` | Payment return/status | Show backend-confirmed order payment state after a provider return | Implemented | `PaymentStatePage` | Refresh status and offer payment retry only when eligible | Customer order API and PayFast checkout API |
| `/preview?view=payment-cancel` | Payment cancellation/status | Show backend-confirmed order state after cancellation return | Implemented | `PaymentStatePage` | Refresh status and offer payment retry only when eligible | Customer order API and PayFast checkout API |
| `/preview?view=login` | Customer login state | Customer sign-in in the preview shell | Implemented | `CustomerLoginPage`, `SiteFrame` | Sign-in, email OTP/two-factor continuations and navigation to registration/reset | Auth API |
| `/account/login` | Customer sign-in route | Dedicated customer login URL | Implemented | `PreviewSite` with `customer-login`, disabled `CartProvider` | Same customer sign-in experience without cart loading | Auth API |
| `/preview?view=register` | Customer registration state | Register a customer from the preview flow | Implemented as a view state, not a standalone route | `RegisterPage` with customer experience | Customer registration and verification prompt | Auth registration and verification API |
| `/preview?view=verify-email` | Email verification state | Verify an account from a token/link | Implemented as a view state | `VerifyEmailPage` | Verify email token and continue to sign-in | Auth verification API |
| `/preview?view=forgot-password` | Customer password recovery state | Request customer password reset | Implemented as a view state | `ForgotPasswordPage` | Request reset email | Auth password-reset API |
| `/preview?view=reset-password` | Customer password reset state | Set a new password from a reset token | Implemented as a view state | `ResetPasswordPage` | Submit reset token and new password | Auth password-reset API |
| `/preview?view=account` | Customer account | View/update profile and navigate account features | Implemented; authenticated customer required | `AccountPage`, `AddressesPage` | Profile updates, address navigation, orders navigation | Auth/session API |
| `/preview?view=addresses` | Saved addresses | Manage customer delivery addresses | Implemented; authenticated customer required | `AddressesPage` | Add/update/delete address and set default | Auth address APIs |
| `/preview?view=orders` | Order history | List authenticated customer's orders | Implemented; authenticated customer required | `OrdersPage` | View status/totals and open order details | Customer orders API |
| `/preview?view=order-detail&orderId={id}` | Order detail | Review one customer's order | Implemented; authenticated customer required | `OrderDetailPage` | Order items/totals/address, retry eligibility, tracking navigation | Customer order and PayFast APIs |
| `/preview?view=tracking-detail&orderId={id}` | Parcel tracking | Show tracking details for an order | Implemented; authenticated customer required | `TrackingPage` | Display available tracking state | Customer tracking API |
| `/preview?view=about` | About / story | Informational brand story | Implemented as static page content in `publicPageCopy` | `PublicPage` | Editorial information and section list | None |
| `/preview?view=contact` | Contact | Show contact information/actions | Implemented as static page content | `PublicPage`, `ContactActions` | Email/phone/WhatsApp actions and shop navigation | No form API |
| `/preview?view=consultation` | Consultation information | Explain how to ask for product guidance | Implemented as static page content | `PublicPage`, `ContactActions` | Contact guidance and safety note | No booking/submission endpoint |
| `/preview?view=journal` | Discover / journal landing | Present wellness education copy | Partially implemented; static introduction and educational snippets, not a CMS/article index | `PublicPage` | Informational content only | None |
| `/preview?view=faq` | FAQ | Static answers about shopping and delivery | Implemented as static page content | `PublicPage` | FAQ information | None |
| `/preview?view=privacy` | Privacy information | Static privacy summary | Implemented as static content; not a legal policy system | `PublicPage` | Informational copy | None |
| `/preview?view=terms` | Terms information | Static terms summary | Implemented as static content; not a legal policy system | `PublicPage` | Informational copy | None |
| `/preview?view=delivery` | Delivery information | Explain checkout delivery quote flow | Implemented as static page content | `PublicPage` | Delivery and tracking information | No API on this page |
| `/preview?view=returns` | Returns information | Explain how to ask about order concerns | Implemented as static page content | `PublicPage` | Support guidance | No returns-submission flow |
| `/preview?view=admin` | Admin workspace | Administrator access state and management dashboard | Implemented; access relies on backend-confirmed admin session/role | `AdminPanel`, `AdminManagement` | Overview, products, categories, inventory and analytics | Admin API |
| `/admin/login` | Admin login | Dedicated administrator sign-in URL | Implemented | `PreviewSite` with `admin-login`, disabled `CartProvider` | Admin login, authenticator/OTP flow and navigation | Auth API |
| `/admin/register` | Admin registration | Dedicated administrator registration URL | Implemented | `PreviewSite` with `admin-register`, disabled `CartProvider` | Restricted admin registration and verification flow | Auth API |
| `/admin/forgot-password` | Admin password recovery | Dedicated administrator recovery URL | Implemented | `PreviewSite` with `admin-forgot-password`, disabled `CartProvider` | Request administrator password reset | Auth API |
| `/api/v1/*` (development route handler) | API pass-through | Forward same-origin development API traffic to configured backend | Implemented server handler, not a user-facing page | `src/routes/api/v1/$.ts` | Forwards supported HTTP methods and passes responses/cookies | Configured backend origin |
| Unmatched route | Not found | Render router's 404 view | Implemented in root route | `NotFoundComponent` | Link to `/` | None |

The `view` values above are validated search-state values in the single `/preview` file route; they are not separately registered TanStack routes. Suggested future work is identified in the roadmap and is not represented as an existing route or feature.

## 3. Shared components

| Component | Location | Reuse / role |
|---|---|---|
| `PreviewSite` | `src/components/storefront/preview-site.tsx` | Shared storefront shell for `/preview` and dedicated customer/admin authentication routes. Resolves preview view states and provides `SiteFrame`. |
| `SiteFrame` navigation and footer | `src/components/storefront/preview-site.tsx` | One preview header/nav and footer across the preview views and auth routes rendered through `PreviewSite`. The navbar is component markup within `SiteFrame`, not a separately exported component. |
| `PreviewHome` | `src/components/storefront/preview-site.tsx` | Homepage-only section group; live featured products query and homepage interactions. |
| `PublicPage` | `src/components/storefront/preview-site.tsx` | Data-driven template reused for about, contact, consultation, journal, FAQ, privacy, terms, delivery and returns. Its content is local static data. |
| `CartProvider` / cart context | `src/components/storefront/cart.tsx` | Shares authenticated server-backed cart state and mutations. Disabled on dedicated login/register/verification/password pages. |
| `CartSheet`, `CartTrigger`, `CartPage`, `CartAddButton` | `src/components/storefront/cart.tsx` | Reused cart drawer, full cart state, and add-to-cart action across product and homepage/storefront components. |
| `Catalogue` | `src/components/storefront/catalogue.tsx` | Shared listing/detail host; product detail is selected by slug. |
| `ShopProductCard`, skeleton and image helpers | `src/components/storefront/catalogue.tsx` | Product listing presentation with loading state, product navigation, image fallback and add-to-cart. Homepage has its own featured-card markup but shares product type, image URL validation, price formatting, navigation and cart-add action. |
| Customer account/order pages | `src/components/storefront/customer-pages.tsx` | Exports shared `AddressesPage`, `OrdersPage`, `OrderDetailPage` and `TrackingPage` used from preview view states. |
| `CheckoutPage` | `src/components/storefront/customer-checkout.tsx` | Authenticated checkout form and order/shipping/payment workflow. |
| `PaymentStatePage` | `src/components/storefront/payment-state.tsx` | Shared payment-return and payment-cancel status experience. |
| `AdminPanel` / `AdminManagement` | `src/components/storefront/admin.tsx`, `admin-management.tsx` | Admin authorization boundary and shared multi-section dashboard. |
| `Button` | `src/components/ui/button.tsx` | Shared Radix-slot/CVA button variants used throughout storefront, forms, cart, checkout and admin. |
| Form primitives | `src/components/ui/input.tsx`, `label.tsx`, `textarea.tsx`, `select.tsx`, `form.tsx` | Reusable form controls; used by account, catalogue filters, checkout and admin workflows where applicable. |
| `Sheet` | `src/components/ui/sheet.tsx` | Drawer primitive used by the cart UI. |
| Dialog/alert/dialog controls | `src/components/ui/dialog.tsx`, `alert-dialog.tsx`, `drawer.tsx` | Reusable UI primitives available to features; use is feature-specific rather than a single shared page component. |
| `Brand`, `ContactActions`, `Footer`, `Countdown`, `BotanicalImage` | `src/components/wellness.tsx` | Shared brand/media/contact/countdown pieces. `Footer` and `Countdown` are used by `/`; brand/contact actions also appear in storefront UI. |
| Product image and URL helpers | `src/lib/image-url.ts` | Validates/normalizes product image references before rendering. |
| Price formatter | `src/lib/money.ts` | Shared ZAR cents formatting for product, cart, order and checkout totals. |

## 4. Customer shopping journey

1. **Homepage** — `/preview` shows a branded homepage and fetches up to four featured public products.
2. **Shop** — the nav or homepage CTA sets `view=shop`. `Catalogue` loads public categories and products and supports search/filter/sort/pagination.
3. **Product** — selecting a product keeps the `/preview` route and adds its slug to search state; detail view fetches the actual product and exposes add-to-cart.
4. **Cart** — product buttons use `CartAddButton`; the shared server-backed cart appears in the sheet or `view=cart`. Guest cart is not persisted as a browser-only cart; cart loading depends on authenticated session.
5. **Checkout** — unauthenticated customers are directed to sign-in. Authenticated customers select/add a saved delivery address, create or recover an order, request delivery quotes, select a quote, then request signed PayFast checkout fields.
6. **Payment** — the browser submits backend-provided PayFast fields. Return/cancel states query the backend order rather than trusting redirect state as payment proof.
7. **Confirmation/account** — payment state shows confirmed/reconciliation status; `view=orders`, order detail and tracking are available through the customer account.

**Dependencies and incomplete points:** product discovery depends on the public catalogue API and approved image references. Checkout requires a logged-in customer and valid cart/address. Delivery options are backend quotes, not hardcoded rates. Newsletter subscription is not implemented. Customer return requests are informational contact guidance, not an online return workflow.

## 5. Customer account area

- **Login:** `/account/login` and the preview customer-login state use the customer login UI. Login may continue through backend-defined email OTP or two-factor verification.
- **Registration:** customer registration exists as `/preview?view=register`; successful registration proceeds through email verification.
- **Verification:** `/preview?view=verify-email` consumes the verification token/link state.
- **Password reset:** `/preview?view=forgot-password` requests reset; `/preview?view=reset-password` submits the reset token and new password.
- **Profile:** `/preview?view=account` displays customer profile and account navigation. Profile updates use auth API.
- **Addresses:** `/preview?view=addresses` allows address create/update/delete/default operations, also used in checkout.
- **Orders:** `/preview?view=orders`, `order-detail`, and `tracking-detail` use customer-scoped APIs.
- These account screens are preview query states except the dedicated `/account/login` route. There are no standalone `/account/register`, `/account/orders`, or `/account/addresses` route files.

## 6. Admin area

**Routes and entry:** `/admin/login`, `/admin/register`, and `/admin/forgot-password` are file routes. The dashboard is the `view=admin` state under `/preview`, not a standalone `/admin` route. Admin UI requires a backend-authenticated user whose role/session satisfies the frontend's authorization check; email alone is not sufficient.

**Dashboard sections in `src/components/storefront/admin-management.tsx`:**

- **Overview:** dashboard analytics and inventory/product summaries.
- **Products:** list/search/filter, create/edit product data, status management, and associate permitted image references.
- **Categories:** category list and create/update.
- **Inventory:** inventory listing, filtering, stock adjustment and adjustment history.
- **Analytics:** report views available through the admin analytics API.

**Images:** admin image upload uses the admin uploads API and renders allowed image references. Approved host validation is shared through `src/lib/image-url.ts`.

**Orders limitation:** the dashboard explicitly notes that the backend contract does not expose an administrator order-list endpoint. The UI therefore does not offer admin order listing, selection/cancellation, refunds or fulfilment management. Customer order pages are separate and user-scoped.

## 7. Development roadmap

Stages below distinguish current state from proposed work. Each stage should preserve the existing route/state architecture and API contracts unless a separate backend contract change is intentionally approved.

| Stage | Status | Focus | Existing files/components | Completion criteria |
|---|---|---|---|---|
| 0. Shared preview shell | **Partially implemented** | Stabilize shared header/footer and responsive behavior without altering the launch page | `preview-site.tsx` (`SiteFrame`), `styles.css`, `wellness.tsx` | Header remains a single shared implementation across preview views/auth routes; desktop nav is horizontal and centered, tablet/mobile menu works, no overflow; footer links retain existing destinations. |
| 1. Homepage | **Implemented, continue content verification as needed** | Refine homepage sections, accessibility, responsive behavior and image quality | `preview-site.tsx` (`PreviewHome`), `styles.css`, `catalogue.ts`, `cart.tsx`, `public/images/` | Real catalogue states/data and add-to-cart remain intact; all theme/ingredient interactions are keyboard accessible; images and responsive layouts are verified. |
| 2. Catalogue and product detail | **Implemented** | Improve shop and product detail independently | `catalogue.tsx`, `styles.css`, `catalogue.ts`, `image-url.ts`, `cart.tsx` | Filters, pagination, product query, image fallback, selection and add-to-cart work with current API and no fabricated data. |
| 3. Cart and checkout | **Implemented; high-impact flow** | Incremental UX/accessibility improvements only | `cart.tsx`, `customer-checkout.tsx`, `orders.ts`, `cart.ts`, `auth.ts` | Auth gate, server-backed cart, idempotent order creation/recovery, backend shipping quotes and payment handoff continue to work; existing focused tests/build pass. |
| 4. Customer account and authentication | **Implemented** | Review/iterate customer-specific forms and account experience | `account/login.tsx`, `preview-site.tsx`, `customer-pages.tsx`, `auth.ts`, `authorization.ts` | Customer/admin boundaries remain separate; verification, OTP/two-factor, profile, addresses and orders retain backend-defined behavior. |
| 5. Payment return and order follow-up | **Implemented** | Improve payment status, order detail and tracking information | `payment-state.tsx`, `customer-pages.tsx`, `orders.ts` | Backend order status remains authoritative; retry only when eligible; no redirect-only proof of payment. |
| 6. Admin auth and dashboard | **Implemented with order-management limitation** | Improve product/category/inventory/analytics workflows; resolve admin orders only after backend support exists | `admin/*.tsx`, `preview-site.tsx`, `admin.tsx`, `admin-management.tsx`, `admin.ts` | Backend role and 2FA are required; uploads obey host restrictions; supported workflows tested; no unsupported order actions represented. |
| 7. Informational and Discover content | **Partially implemented** | Replace static snippets with verified final content; add real education/articles only when content and routes exist | `preview-site.tsx` (`PublicPage`, `publicPageCopy`), `styles.css` | Copy, legal policies and contact details are reviewed; a journal/article index only ships with real content and working destinations. |
| 8. Newsletter/community | **Not implemented** | Add signup only after a real subscription endpoint and privacy/consent behavior are available | Future frontend component plus approved API contract | A real endpoint, validation, consent/privacy copy, success/error states and tests exist before adding submit functionality. |
| 9. Missing admin order capability | **Not implemented** | Backend/API contract and authorization design first, then a frontend order-management page if approved | Backend order routes/services; later admin API/UI | Backend provides documented, authorized list/detail/actions; frontend never infers customer ownership or invents unsupported actions. |

### Suggested next stage

Start with **Stage 0: shared preview shell**, verifying the navbar at desktop, tablet and mobile widths and ensuring all current navigation callbacks remain unchanged. The production launch/countdown route at `/` should remain isolated throughout.
