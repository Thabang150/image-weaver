import { describe, expect, it, vi } from "vitest";

import { createAdminApi } from "@/lib/api/admin";
import { ApiResponseError, createApiClient } from "@/lib/api/client";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("administrator API contract", () => {
  it("validates inventory response fields and constructs only documented filters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        inventory: [],
        pagination: { page: 2, limit: 20, total: 22, totalPages: 2 },
      }),
    );
    const api = createAdminApi(
      createApiClient({
        baseUrl: "https://api.example.test",
        csrfTokenProvider: vi.fn(),
        fetcher,
      }),
    );

    await expect(
      api.getInventory({
        page: 2,
        q: "aloe",
        status: "active",
        sortBy: "stockQuantity",
        sortOrder: "asc",
      }),
    ).resolves.toMatchObject({
      pagination: { page: 2, limit: 20, total: 22, totalPages: 2 },
    });
    const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/api/v1/admin/inventory");
    expect([...requestUrl.searchParams.entries()].sort()).toEqual(
      [
        ["limit", "20"],
        ["page", "2"],
        ["q", "aloe"],
        ["sortBy", "stockQuantity"],
        ["sortOrder", "asc"],
        ["status", "active"],
      ].sort(),
    );
  });

  it("rejects malformed inventory adjustments instead of returning success-shaped data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ replayed: false }));
    const api = createAdminApi(
      createApiClient({
        baseUrl: "https://api.example.test",
        csrfTokenProvider: async () => "a-valid-csrf-token",
        fetcher,
      }),
    );

    await expect(
      api.adjustInventory("product-1", { quantityDelta: 1, reason: "Stock received" }),
    ).rejects.toBeInstanceOf(ApiResponseError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Idempotency-Key")).toMatch(
      /^[A-Za-z0-9-]{16,128}$/,
    );
  });
});
