import { createFileRoute } from "@tanstack/react-router";

// Dev-side pass-through: in dev the SSR middleware intercepts same-origin /api/v1
// before the Vite proxy can forward it, so the router would answer with the app's
// 404 page instead of the backend. At publish, Nitro's /api/v1/** routeRules proxy
// (nitro.config.ts) handles these requests before the router, so this handler is
// shadowed there and the deployment-side rule stays in charge.
function backendApiOrigin(): string {
  const configured = (import.meta.env.VITE_BACKEND_BASE_URL ?? "").trim();
  return configured ? new URL(configured).origin : "http://localhost:3000";
}

async function proxyApiV1({ request }: { request: Request }): Promise<Response> {
  const incoming = new URL(request.url);
  const suffix = incoming.pathname.replace(/^\/api\/v1/, "");
  const target = `${backendApiOrigin()}/api/v1${suffix}${incoming.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { error: "The store backend could not be reached." },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  // fetch() transparently decompresses the body, so a stale
  // content-encoding header would corrupt the passthrough response.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("set-cookie");
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: proxyApiV1,
      POST: proxyApiV1,
      PUT: proxyApiV1,
      PATCH: proxyApiV1,
      DELETE: proxyApiV1,
      OPTIONS: proxyApiV1,
    },
  },
});
