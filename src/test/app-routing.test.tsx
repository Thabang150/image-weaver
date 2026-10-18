import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  rootRouteId,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Match routes without loaders where possible; the history test uses mocked API responses.
describe("App routing", () => {
  it("keeps the launch and preview pages as the two content routes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const homeMatches = router.matchRoutes("/");
    const previewMatches = router.matchRoutes("/preview");

    expect(homeMatches.at(-1)?.routeId).toBe("/");
    expect(previewMatches.at(-1)?.routeId).toBe("/preview");
    expect(homeMatches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("keeps product detail selection in history for browser Back and Forward", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [] });
        if (url.pathname.endsWith("/products/aloe-product")) {
          return jsonResponse({
            product: {
              id: "product-1",
              name: "Aloe product",
              slug: "aloe-product",
              description: "Catalogue description",
              category: { id: "category-1", name: "Botanical care", slug: "botanical-care" },
              priceCents: 14550,
              imageReferences: [],
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
            },
          });
        }
        return jsonResponse({
          products: [
            {
              id: "product-1",
              name: "Aloe product",
              slug: "aloe-product",
              description: "Catalogue description",
              category: { id: "category-1", name: "Botanical care", slug: "botanical-care" },
              priceCents: 14550,
              imageReferences: [],
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "View details for Aloe product" }));
    expect(await screen.findByRole("button", { name: "Back to catalogue" })).toBeVisible();
    expect(router.state.location.search).toEqual({ product: "aloe-product" });

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(
      await screen.findByRole("button", { name: "View details for Aloe product" }),
    ).toBeVisible();

    router.history.forward();
    await waitFor(() => expect(router.state.location.search).toEqual({ product: "aloe-product" }));
    expect(await screen.findByRole("button", { name: "Back to catalogue" })).toBeVisible();
  }, 15000);
});
