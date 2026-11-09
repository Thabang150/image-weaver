# Image Weaver

please just also make sure to render these images as img tags and not json coz i'm hosting on nextjs on vercel, and it can't access the json files, so use iimgs as img tags

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d9405a7b-8d12-4d92-9d10-31463face41e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Backend API configuration

The frontend uses the existing TanStack Start/Vite runtime. Configure the public backend origin with `VITE_BACKEND_BASE_URL` (for example, `http://localhost:3000` for local backend development). Local browser API calls use the same-origin `/api/v1` path and Vite proxies requests to that origin. If unset locally, the Vite proxy defaults to `http://localhost:3000`.

Production API calls use the same-origin `/api/v1` path. Nitro proxies `/api/v1/**` to the backend origin configured by `VITE_BACKEND_BASE_URL`; configure it in the production build environment. The request method, body, headers and backend response (including `Set-Cookie`) pass through the proxy.

Only the public backend URL belongs in a `VITE_*` variable; Vite exposes these values in the browser bundle. Do not place passwords, session secrets, CSRF tokens, payment credentials, or other secrets in frontend environment variables. The backend must allow the deployed frontend origin with credentialed CORS.

### Preview environment safety

Preview mutations are blocked solely by the `/preview` browser pathname. Frontend environment variables cannot enable preview mutations.

Preview staging will require:

- a separately deployed frontend staging origin;
- a separately deployed backend staging origin;
- a separate MongoDB database;
- staging frontend/backend cookie and `FRONTEND_ORIGIN` CORS configuration;
- PayFast sandbox credentials and staging callback origins;
- isolated email behaviour for verification and password-reset messages.

These infrastructure settings are not provisioned by this repository and staging is not operational merely because `VITE_APP_ENV=staging` is configured. The frontend also cannot prove that a deployed backend/database is isolated: backend deployment and ownership verification remain required.

`src/lib/api/client.ts` follows the authentication contract for `GET /api/v1/auth/csrf-token` and its `{ csrfToken }` response. Unsafe requests are blocked if token acquisition fails. On the exact documented CSRF 403, the client refreshes the token but does not replay the rejected mutation. Authentication helpers refresh CSRF after session-regenerating login/logout/2FA transitions. Configure the backend's exact `FRONTEND_ORIGIN` for the deployed site.

The administrator catalogue UI accepts image references only. Set the frontend `VITE_PRODUCT_IMAGE_ALLOWED_HOSTS` to a comma-separated list of approved HTTPS image hostnames, and configure the matching backend `PRODUCT_IMAGE_ALLOWED_HOSTS`; file uploads are not supported.

## Checkout delivery address

Checkout offers optional Mapbox address suggestions and always retains editable manual address fields. Configure the browser's public token as `VITE_MAPBOX_ACCESS_TOKEN`; it is intentionally exposed in frontend code and must not be a secret/server token. Restrict the token to the deployed storefront origins and the minimum Geocoding API scope supported by the Mapbox account. Search uses the Geocoding API v6 forward endpoint with `country=za`, `types=address`, autocomplete, and `permanent=true`, because selected address results and their optional coordinates are saved to customer addresses. Mapbox requires an eligible account (valid billing card or enterprise contract) for permanent geocoding. If the variable is missing or search fails, customers can continue with manual entry.

Mapbox results populate only the available street, neighborhood/locality, place, recognized province, valid four-digit postal code, country, and valid coordinate pair. A missing component remains for the customer to enter. Unit/complex information remains a separate editable field. Editing a location component clears selected coordinates so stale coordinates are not sent to Ship Logic; saved-address updates also remove coordinates when location fields are included without a replacement pair. Results and manual entries are not proof that a courier serves that location; Ship Logic remains the final quote/coverage authority.

Mapbox receives the typed address query from the browser. Avoid placing private tokens in any `VITE_*` setting. If a valid public token is unavailable or Mapbox cannot find an address, manual address entry remains available and does not require selecting a suggestion.

The existing order flow requests and selects backend Ship Logic quotes, then uses `POST /api/v1/orders/:orderId/payfast/checkout` to obtain signed hosted-checkout fields and a backend-calculated shipping-inclusive amount. Payment status is confirmed by the backend order endpoint after PayFast ITN processing; return and cancellation pages query the order and do not trust redirect state as payment proof.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
