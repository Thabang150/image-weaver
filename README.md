# Image Weaver

please just also make sure to render these images as img tags and not json coz i'm hosting on nextjs on vercel, and it can't access the json files, so use iimgs as img tags

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d9405a7b-8d12-4d92-9d10-31463face41e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Backend API configuration

The frontend uses the existing TanStack Start/Vite runtime. In local development, browser API calls use the same-origin `/api/v1` path and Vite proxies them to the origin in `VITE_BACKEND_BASE_URL` (or the deployed backend by default). This avoids browser CORS and third-party-cookie behavior. The URL is public and contains no credentials.

Production API calls use the same-origin `/api/v1` path. Nitro proxies `/api/v1/**` to `https://heathywayssa-backend.onrender.com/api/v1/**`; the request method, body and headers and the backend response (including `Set-Cookie`) pass through the proxy. Production does not use `VITE_BACKEND_BASE_URL`, and no API credentials or other secrets are placed in the frontend bundle.

Only the public backend URL belongs in a `VITE_*` variable; Vite exposes these values in the browser bundle. Do not place passwords, session secrets, CSRF tokens, payment credentials, or other secrets in frontend environment variables. Local browser requests go through Vite's same-origin proxy, while the backend keeps its exact-origin credentialed CORS policy for any direct cross-origin clients.

`src/lib/api/client.ts` follows the supplied `FRONTEND_HANDOFF.md` for `GET /api/v1/auth/csrf-token` and its `{ csrfToken }` response. Unsafe requests are blocked if token acquisition fails. On the exact documented CSRF 403, the client refreshes the token and retries once; the backend's CSRF middleware rejects the request before its route handler runs. Authentication helpers refresh CSRF after session-regenerating login/logout/2FA transitions. Production session cookies are host-only and work through the same-origin proxy without third-party cookies. Configure the backend's exact `FRONTEND_ORIGIN` for the deployed site.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
