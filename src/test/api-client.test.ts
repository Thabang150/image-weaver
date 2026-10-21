import { describe, expect, it, vi } from "vitest";

import {
  ApiHttpError,
  ApiResponseError,
  buildApiUrl,
  createApiClient,
  getBackendBaseUrl,
  normalizeApiBaseUrl,
} from "@/lib/api/client";

const baseUrl = "https://api.example.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("API URL configuration", () => {
  it("adds the API prefix once, whether or not it is already in the base URL", () => {
    expect(normalizeApiBaseUrl(baseUrl)).toBe(`${baseUrl}/api/v1/`);
    expect(normalizeApiBaseUrl(`${baseUrl}/api/v1/`)).toBe(`${baseUrl}/api/v1/`);
    expect(buildApiUrl(baseUrl, "/products")).toBe(`${baseUrl}/api/v1/products`);
    expect(buildApiUrl(`${baseUrl}/api/v1`, "/api/v1/products")).toBe(`${baseUrl}/api/v1/products`);
  });

  it("defaults development to the same-origin API proxy and rejects invalid configuration", () => {
    expect(getBackendBaseUrl("", true)).toBe("/api/v1/");
    expect(() => normalizeApiBaseUrl("javascript:alert(1)")).toThrow("HTTP(S) URL");
  });

  it("uses the configured backend locally and the relative API path in production", () => {
    expect(getBackendBaseUrl(baseUrl, true)).toBe(`${baseUrl}/api/v1/`);
    expect(getBackendBaseUrl(baseUrl, false)).toBe("/api/v1/");
    expect(buildApiUrl(getBackendBaseUrl(baseUrl, false), "/auth/login")).toBe(
      "/api/v1/auth/login",
    );
  });

  it("sends production API requests to relative same-origin URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ products: [] }));
    const client = createApiClient({ baseUrl: "/api/v1", fetcher });

    await client.request("/products");

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/products");
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("rejects absolute endpoints outside the configured API origin", () => {
    expect(() => buildApiUrl(baseUrl, "https://elsewhere.test/resource")).toThrow("relative paths");
    expect(() => buildApiUrl(baseUrl, "../outside")).toThrow("configured API prefix");
  });
});

describe("API requests", () => {
  it("includes browser session cookies and serializes JSON requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const csrfTokenProvider = vi.fn().mockResolvedValue("csrf-1");
    const client = createApiClient({ baseUrl, csrfTokenProvider, fetcher });

    await expect(
      client.request<{ ok: boolean }>("/resource", {
        method: "POST",
        json: { name: "test" },
      }),
    ).resolves.toEqual({ ok: true });

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("include");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-1");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ name: "test" }));
  });

  it("sends credentials and the in-memory CSRF token for every protected method", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockResolvedValue("csrf-methods"),
      fetcher,
    });

    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await client.request("/resource", { method });
    }

    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-methods");
    }
  });

  it("uses no CSRF token for safe methods and includes the abort signal", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }));
    const csrfTokenProvider = vi.fn().mockResolvedValue("csrf-1");
    const client = createApiClient({ baseUrl, csrfTokenProvider, fetcher });
    const controller = new AbortController();

    await client.request("/resource", { signal: controller.signal });

    expect(csrfTokenProvider).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("acquires one CSRF token for concurrent unsafe calls", async () => {
    let resolveToken: ((token: string) => void) | undefined;
    const csrfTokenProvider = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createApiClient({ baseUrl, csrfTokenProvider, fetcher });

    const first = client.request("/one", { method: "POST" });
    const second = client.request("/two", { method: "DELETE" });
    await Promise.resolve();
    resolveToken?.("csrf-shared");
    await Promise.all([first, second]);

    expect(csrfTokenProvider).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-shared");
    }
  });

  it("fetches the documented CSRF endpoint with cookies and validates its response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-from-backend" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetcher });

    await client.request("/mutate", { method: "POST" });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${baseUrl}/api/v1/auth/csrf-token`);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("include");
    expect(fetcher.mock.calls[0]?.[1]?.cache).toBe("no-store");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-from-backend",
    );
  });

  it("refreshes and retries once after the backend's exact CSRF rejection", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-stale" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid or missing CSRF token." }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-refreshed" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetcher });

    await expect(
      client.request("/mutate", { method: "POST", json: { value: 1 } }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[1]?.[0]).toBe(`${baseUrl}/api/v1/mutate`);
    expect(fetcher.mock.calls[3]?.[0]).toBe(`${baseUrl}/api/v1/mutate`);
    expect(fetcher.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({ value: 1 }));
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-stale");
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-refreshed",
    );
  });

  it("does not retry indefinitely when the refreshed CSRF token is rejected", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-stale" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid or missing CSRF token." }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-refreshed" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid or missing CSRF token." }, 403));
    const client = createApiClient({ baseUrl, fetcher });

    await expect(client.request("/mutate", { method: "POST" })).rejects.toMatchObject({
      status: 403,
      isCsrfFailure: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not refresh the CSRF token for unrelated forbidden errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "Administrator access required" }, 403));
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockResolvedValue("csrf-1"),
      fetcher,
    });

    await expect(client.request("/admin")).rejects.toMatchObject({
      status: 403,
      message: "Administrator access required",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not send an unsafe request when CSRF acquisition fails", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockRejectedValue(new Error("provider failed")),
      fetcher,
    });

    await expect(client.request("/resource", { method: "POST" })).rejects.toThrow(
      "Unable to acquire a CSRF token",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not proceed when the CSRF response lacks the documented token field", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ token: "wrong-shape" }));
    const client = createApiClient({ baseUrl, fetcher });

    await expect(client.request("/mutate", { method: "POST" })).rejects.toThrow(
      "invalid CSRF token response",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes the in-memory token after a successful session-regenerating request", async () => {
    const csrfTokenProvider = vi
      .fn()
      .mockResolvedValueOnce("csrf-before")
      .mockResolvedValueOnce("csrf-after");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const client = createApiClient({ baseUrl, csrfTokenProvider, fetcher });

    await client.request("/auth-transition", {
      method: "POST",
      regeneratesSession: true,
    });
    await client.request("/next-mutation", { method: "PATCH" });

    expect(csrfTokenProvider).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-before",
    );
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-after");
  });

  it("distinguishes unauthorized and forbidden errors and preserves backend details", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: "Sign in required" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "Admin role required" }, 403));
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockResolvedValue("csrf-1"),
      fetcher,
    });

    const unauthorized = client.request("/private");
    const forbidden = client.request("/admin");
    await expect(unauthorized).rejects.toMatchObject({
      name: "ApiHttpError",
      status: 401,
      kind: "unauthorized",
      message: "Sign in required",
      body: { message: "Sign in required" },
    } satisfies Partial<ApiHttpError>);
    await expect(forbidden).rejects.toMatchObject({
      status: 403,
      kind: "forbidden",
      message: "Admin role required",
    });
  });

  it("reports malformed JSON responses and preserves malformed error bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("{bad", { headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(
        new Response("{bad", {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockResolvedValue("csrf-1"),
      fetcher,
    });

    await expect(client.request("/malformed")).rejects.toBeInstanceOf(ApiResponseError);
    await expect(client.request("/error", { method: "POST" })).rejects.toMatchObject({
      name: "ApiHttpError",
      status: 500,
      body: "{bad",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for an empty success response without fabricating data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({
      baseUrl,
      csrfTokenProvider: vi.fn().mockResolvedValue("csrf-1"),
      fetcher,
    });

    await expect(client.request("/empty")).resolves.toBeUndefined();
  });
});
