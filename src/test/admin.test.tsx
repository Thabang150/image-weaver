import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminPanel } from "@/components/storefront/admin";
import type { PublicUser } from "@/lib/api/auth";

const userBase: PublicUser = {
  id: "user-1",
  email: "owner@healtywayssa.co.za",
  emailVerified: true,
  roles: ["admin"],
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

function renderAdmin(user: PublicUser) {
  vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/me")) return jsonResponse({ user });
    if (url.pathname.endsWith("/admin/categories")) return jsonResponse({ categories: [] });
    if (url.pathname.endsWith("/admin/inventory")) {
      return jsonResponse({
        inventory: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return jsonResponse({ error: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminPanel user={user} />
    </QueryClientProvider>,
  );
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("administrator workspace access", () => {
  it("does not expose admin operations to a non-admin role", async () => {
    const fetcher = renderAdmin({ ...userBase, roles: ["customer"] });

    expect(
      await screen.findByRole("heading", { name: "Administrator access denied" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Create product" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("/admin/"))).toBe(false);
  });

  it("requires the documented admin role, verified email, and configured admin domain", async () => {
    renderAdmin({ ...userBase, emailVerified: false });

    expect(
      await screen.findByRole("heading", { name: "Administrator access denied" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("does not treat the configured email domain as a substitute for the admin role", async () => {
    renderAdmin({ ...userBase, email: "owner@example.test" });

    expect(
      await screen.findByRole("heading", { name: "Administrator access denied" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("loads only the documented admin categories and inventory for eligible users", async () => {
    const fetcher = renderAdmin(userBase);

    expect(await screen.findByRole("heading", { name: "Create product" })).toBeVisible();
    const requestedPaths = fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(requestedPaths).toContain("/api/v1/admin/categories");
    expect(requestedPaths.some((path) => path === "/api/v1/admin/inventory")).toBe(true);
  });
});
