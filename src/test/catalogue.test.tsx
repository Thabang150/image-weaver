import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Catalogue } from "@/components/storefront/catalogue";
import { LaunchExperience } from "@/routes/index";
import { formatZarCents } from "@/lib/money";

const category = {
  id: "category-1",
  name: "Botanical care",
  slug: "botanical-care",
  isActive: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const product = {
  id: "product-1",
  name: "Aloe product",
  slug: "aloe-product",
  description: "A product description from the catalogue.",
  category: { id: category.id, name: category.name, slug: category.slug },
  priceCents: 14550,
  imageReferences: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const productList = {
  products: [product],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installApi(handler: (url: URL) => Promise<Response> | Response) {
  vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
  const fetcher = vi.fn<typeof fetch>(async (input) => handler(new URL(String(input))));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function renderCatalogue(selectedSlug?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onSelectProduct = vi.fn();
  const onBackToCatalogue = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Catalogue
        selectedSlug={selectedSlug}
        onSelectProduct={onSelectProduct}
        onBackToCatalogue={onBackToCatalogue}
      />
    </QueryClientProvider>,
  );
  return { ...view, onSelectProduct, onBackToCatalogue, queryClient };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public catalogue", () => {
  it("renders backend categories, products, and integer-cent ZAR prices", async () => {
    installApi((url) => {
      if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [category] });
      if (url.pathname.endsWith("/products")) return jsonResponse(productList);
      return jsonResponse({ error: "Not found" }, 404);
    });
    const { onSelectProduct } = renderCatalogue();

    expect(await screen.findByRole("heading", { name: "Explore the catalogue" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Botanical care" })).toBeVisible();
    expect(await screen.findByText(product.name)).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\u00a0/g, " ") ===
          formatZarCents(product.priceCents).replace(/\u00a0/g, " "),
      ),
    ).toBeVisible();
    expect(screen.getByText(product.description)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "View details for Aloe product" }));
    expect(onSelectProduct).toHaveBeenCalledWith("aloe-product");
  }, 15000);

  it("shows an empty state when category and product results are empty", async () => {
    installApi((url) =>
      url.pathname.endsWith("/categories")
        ? jsonResponse({ categories: [] })
        : jsonResponse({
            products: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          }),
    );
    renderCatalogue();

    expect(
      await screen.findByText("There are no products in the catalogue right now."),
    ).toBeVisible();
    expect(screen.getByText("No categories are available right now.")).toBeVisible();
  });

  it("treats inactive entries in the public category response as a contract error", async () => {
    installApi((url) =>
      url.pathname.endsWith("/categories")
        ? jsonResponse({ categories: [{ ...category, isActive: false }] })
        : jsonResponse(productList),
    );
    renderCatalogue();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend returned an invalid catalogue response.",
    );
  });

  it("shows loading feedback while the product list request is pending", async () => {
    let resolveProducts: ((response: Response) => void) | undefined;
    installApi((url) => {
      if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [category] });
      return new Promise<Response>((resolve) => {
        resolveProducts = resolve;
      });
    });
    renderCatalogue();

    expect(await screen.findByText("Loading catalogue…")).toBeVisible();
    await act(async () => {
      resolveProducts?.(jsonResponse(productList));
    });
    expect(await screen.findByText(product.name)).toBeVisible();
  });

  it("shows a recoverable API error and retries the failed product request", async () => {
    let productAttempts = 0;
    const fetcher = installApi((url) => {
      if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [category] });
      productAttempts += 1;
      return productAttempts === 1
        ? jsonResponse({ error: "Catalogue temporarily unavailable." }, 503)
        : jsonResponse(productList);
    });
    renderCatalogue();

    expect(
      await screen.findByText("The catalogue is unavailable: Catalogue temporarily unavailable."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry catalogue" }));

    expect(await screen.findByText(product.name)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not display an arbitrary non-JSON proxy error body", async () => {
    installApi((url) =>
      url.pathname.endsWith("/categories")
        ? jsonResponse({ categories: [category] })
        : new Response("<h1>internal proxy detail</h1>", {
            status: 503,
            headers: { "content-type": "text/html" },
          }),
    );
    renderCatalogue();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The catalogue is unavailable (HTTP 503).",
    );
    expect(screen.queryByText(/internal proxy detail/i)).not.toBeInTheDocument();
  });

  it("rejects malformed required product fields instead of attempting to render them", async () => {
    installApi((url) =>
      url.pathname.endsWith("/categories")
        ? jsonResponse({ categories: [category] })
        : jsonResponse({
            products: [{ ...product, category: null }],
            pagination: productList.pagination,
          }),
    );
    renderCatalogue();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend returned an invalid catalogue response.",
    );
    expect(screen.queryByText(product.name)).not.toBeInTheDocument();
  });

  it("requests only the documented category filter and page/sort parameters", async () => {
    const fetcher = installApi((url) =>
      url.pathname.endsWith("/categories")
        ? jsonResponse({ categories: [category] })
        : jsonResponse(productList),
    );
    renderCatalogue();
    await screen.findByText(product.name);

    fireEvent.click(screen.getByRole("button", { name: "Botanical care" }));
    await waitFor(() => {
      const productRequest = fetcher.mock.calls
        .map(([input]) => new URL(String(input)))
        .find((url) => url.pathname.endsWith("/products") && url.searchParams.has("categoryId"));
      expect(productRequest?.searchParams.get("categoryId")).toBe(category.id);
      expect(productRequest?.searchParams.get("page")).toBe("1");
      expect(productRequest?.searchParams.get("limit")).toBe("20");
      expect(productRequest?.searchParams.get("sortBy")).toBe("name");
      expect(productRequest?.searchParams.get("sortOrder")).toBe("asc");
    });
  });

  it("loads product detail by slug and omits absent optional packaging", async () => {
    const fetcher = installApi(() => jsonResponse({ product }));
    const { onBackToCatalogue } = renderCatalogue(product.slug);

    expect(await screen.findByRole("heading", { name: product.name })).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\u00a0/g, " ") ===
          formatZarCents(product.priceCents).replace(/\u00a0/g, " "),
      ),
    ).toBeVisible();
    expect(screen.getByText(product.description)).toBeVisible();
    expect(screen.queryByText(/packaging/i)).not.toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/v1/products/aloe-product",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to catalogue" }));
    expect(onBackToCatalogue).toHaveBeenCalledOnce();
  });

  it("renders documented optional packaging without requiring it", async () => {
    const packagedProduct = { ...product, packaging: { amount: 120, unit: "ml" } };
    installApi(() => jsonResponse({ product: packagedProduct }));
    renderCatalogue(product.slug);

    expect(await screen.findByText("120 ml")).toBeVisible();
  });

  it("rejects malformed packaging values instead of displaying them", async () => {
    const malformedProduct = { ...product, packaging: { amount: -1, unit: "ml" } };
    installApi(() => jsonResponse({ product: malformedProduct }));
    renderCatalogue(product.slug);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend returned an invalid catalogue response.",
    );
    expect(screen.queryByText("-1 ml")).not.toBeInTheDocument();
  });

  it("shows the documented unavailable state for a missing product", async () => {
    installApi(() => jsonResponse({ error: "Not found" }, 404));
    renderCatalogue(product.slug);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This product is not currently available.",
    );
    expect(screen.getByRole("button", { name: "Back to catalogue" })).toBeVisible();
  });

  it("rejects a malformed product detail response", async () => {
    installApi(() => jsonResponse({ product: { ...product, priceCents: -14550 } }));
    renderCatalogue(product.slug);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend returned an invalid catalogue response.",
    );
    expect(screen.queryByText(product.name)).not.toBeInTheDocument();
  });

  it("preserves the launch hero, countdown, contact actions, and catalogue entry point", () => {
    render(<LaunchExperience />);

    expect(
      screen.getByRole("heading", { name: /Natural wellness, beautifully renewed/i }),
    ).toBeVisible();
    expect(screen.getByText("1 NOVEMBER 2026")).toBeVisible();
    expect(screen.getByRole("timer")).toBeVisible();
    expect(screen.getByRole("img", { name: /Sunlit green botanical leaves/i })).toBeVisible();
    expect(screen.getByRole("link", { name: "Chat on WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/27796871118",
    );
    expect(screen.getByRole("link", { name: "Email Us" })).toHaveAttribute(
      "href",
      "mailto:info@healtywayssa.co.za",
    );
    expect(screen.getByRole("link", { name: /079 687 1118/ })).toHaveAttribute(
      "href",
      "tel:+27796871118",
    );
    expect(screen.getByRole("link", { name: "Explore the development preview" })).toHaveAttribute(
      "href",
      "/preview",
    );
    expect(screen.queryByRole("button", { name: /open cart/i })).not.toBeInTheDocument();
  });
});
