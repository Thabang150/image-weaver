import { describe, expect, it, vi } from "vitest";

import { createAuthApi, type PublicUser } from "@/lib/api/auth";
import { createApiClient } from "@/lib/api/client";

const user: PublicUser = {
  id: "user-1",
  email: "customer@example.test",
  emailVerified: true,
  roles: ["customer"],
  addresses: [],
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("session foundation", () => {
  it("maps only 401 from GET /auth/me to an unauthenticated session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "Authentication required." }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "Forbidden." }, 403));
    const auth = createAuthApi(
      createApiClient({
        baseUrl: "https://api.example.test",
        csrfTokenProvider: vi.fn(),
        fetcher,
      }),
    );

    await expect(auth.getSession()).resolves.toEqual({ status: "unauthenticated" });
    await expect(auth.getSession()).rejects.toMatchObject({
      status: 403,
      kind: "forbidden",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.test/api/v1/auth/me");
  });

  it("returns a typed authenticated session from the documented user response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ user }));
    const auth = createAuthApi(
      createApiClient({
        baseUrl: "https://api.example.test",
        csrfTokenProvider: vi.fn(),
        fetcher,
      }),
    );

    await expect(auth.getSession()).resolves.toEqual({
      status: "authenticated",
      user,
    });
  });

  it("rejects malformed session users rather than trusting their role fields", async () => {
    const auth = createAuthApi(
      createApiClient({
        baseUrl: "https://api.example.test",
        csrfTokenProvider: vi.fn(),
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({
            user: {
              ...user,
              roles: "admin",
            },
          }),
        ),
      }),
    );

    await expect(auth.getSession()).rejects.toMatchObject({
      name: "ApiResponseError",
      message: "Backend returned an invalid authentication response.",
    });
  });

  it("refreshes CSRF after login, logout, and 2FA session transitions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-1" }))
      .mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-2" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-3" }))
      .mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-4" }))
      .mockResolvedValueOnce(jsonResponse({ twoFactorEnabled: true, recoveryCodes: [] }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-5" }));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetcher,
    });
    const auth = createAuthApi(client);

    await auth.login({ email: user.email, password: "not-a-real-password" });
    await auth.logout();
    await auth.verifyTwoFactor("123456");
    await auth.confirmTwoFactor("123456");

    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.endsWith("/auth/csrf-token"))).toHaveLength(5);
    expect(urls.filter((url) => !url.endsWith("/auth/csrf-token"))).toEqual([
      "https://api.example.test/api/v1/auth/login",
      "https://api.example.test/api/v1/auth/logout",
      "https://api.example.test/api/v1/auth/2fa/verify",
      "https://api.example.test/api/v1/auth/2fa/confirm",
    ]);
  });
});
