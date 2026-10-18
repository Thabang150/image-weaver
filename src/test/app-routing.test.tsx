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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const testProduct = {
  id: "product-1",
  name: "Aloe product",
  slug: "aloe-product",
  description: "Catalogue description",
  category: { id: "category-1", name: "Botanical care", slug: "botanical-care" },
  priceCents: 14550,
  imageReferences: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

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

  it("keeps the official homepage independent of storefront and cart API requests", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    const fetcher = vi.fn<typeof fetch>(() => {
      throw new Error("The launch route must not make backend requests.");
    });
    vi.stubGlobal("fetch", fetcher);
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: /Natural wellness, beautifully renewed/i }),
    ).toBeVisible();
    expect(screen.getByRole("timer")).toBeVisible();
    expect(screen.getByRole("link", { name: "Email Us" })).toHaveAttribute(
      "href",
      "mailto:info@healtywayssa.co.za",
    );
    expect(screen.getByText(/© 2026 Healthy Ways SA/)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Explore the catalogue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open cart/i })).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("renders the storefront and cart on /preview and keeps product selection there", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/cart")) {
          return jsonResponse({
            cart: {
              items: [],
              itemCount: 0,
              currency: "ZAR",
              totalCents: 0,
              hasUnavailableItems: false,
            },
          });
        }
        if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [] });
        if (url.pathname.endsWith("/products")) {
          return jsonResponse({
            products: [testProduct],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
        }
        if (url.pathname.endsWith("/products/aloe-product")) {
          return jsonResponse({ product: testProduct });
        }
        return jsonResponse({ error: "Not found" }, 404);
      }),
    );
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      history: createMemoryHistory({ initialEntries: ["/preview"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "Explore the catalogue" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open cart" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Add to cart" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View details for Aloe product" }));
    expect(await screen.findByRole("button", { name: "Back to catalogue" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/preview");
    expect(router.state.location.search).toEqual({ product: "aloe-product" });
  }, 15000);

  it("keeps product detail selection in history for browser Back and Forward on /preview", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/cart")) {
          return jsonResponse(
            {
              cart: {
                items: [],
                itemCount: 0,
                currency: "ZAR",
                totalCents: 0,
                hasUnavailableItems: false,
              },
            },
            15000,
          );
        }
        if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [] });
        if (url.pathname.endsWith("/products/aloe-product")) {
          return jsonResponse({ product: testProduct });
        }
        return jsonResponse({
          products: [testProduct],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      history: createMemoryHistory({ initialEntries: ["/preview"] }),
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
