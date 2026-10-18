# Image Weaver

please just also make sure to render these images as img tags and not json coz i'm hosting on nextjs on vercel, and it can't access the json files, so use iimgs as img tags

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d9405a7b-8d12-4d92-9d10-31463face41e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Backend API configuration

The frontend uses the existing TanStack Start/Vite runtime. For local API development, copy `.env.example` to `.env.local` and set `VITE_BACKEND_BASE_URL` to the public backend origin. The client normalizes the `/api/v1` prefix, so the value may be either the origin or an origin already ending in `/api/v1`.

Only the public backend URL belongs in a `VITE_*` variable; Vite exposes these values in the browser bundle. Do not place passwords, session secrets, CSRF tokens, payment credentials, or other secrets in frontend environment variables. Session cookies are browser-managed, and unsafe API requests must obtain their CSRF token through the backend's documented contract before use.

`src/lib/api/client.ts` follows the supplied `FRONTEND_HANDOFF.md` for `GET /api/v1/auth/csrf-token` and its `{ csrfToken }` response. Unsafe requests are blocked if token acquisition fails. On the documented CSRF 403, the client refreshes the token but does not replay the failed request. Authentication helpers refresh CSRF after login, logout, 2FA verification, and 2FA confirmation. Confirm the backend's CORS and cookie settings for the actual frontend origin before relying on browser sessions.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
