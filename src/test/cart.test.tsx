import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartAddButton, CartProvider, CartSheet, CartTrigger, useCart } from "@/components/storefront/cart";
import { formatZarCents } from "@/lib/money";

const productId = "507f1f77bcf86cd799439011";
const unitPriceCents = 14550;
const product = {
  id: productId,
  name: "Aloe product",
  slug: "aloe-product",
  priceCents: unitPriceCents,
};
const secondProductId = "507f1f77bcf86cd799439013";
const secondProduct = {
  id: secondProductId,
  name: "Chamomile product",
  slug: "chamomile-product",
  priceCents: 8900,
};
const authenticatedSession = {
  status: "authenticated",
  user: {
    id: "507f1f77bcf86cd799439012",
    email: "customer@example.com",
    emailVerified: true,
    roles: ["customer"],
    addresses: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
} as const;

function makeCart(quantity = 0) {
  const items =
    quantity > 0
      ? [
          {
            productId,
            quantity,
            available: true,
            product: { name: "Aloe product", slug: "aloe-product" },
            unitPriceCents,
            lineSubtotalCents: unitPriceCents * quantity,
          },
        ]
      : [];

  return {
    items,
    itemCount: items.length,
    currency: "ZAR",
    totalCents: unitPriceCents * quantity,
    hasUnavailableItems: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installCartApi({
  initialQuantity = 0,
  failFirstCartRead = false,
  delayAdd = false,
}: {
  initialQuantity?: number;
  failFirstCartRead?: boolean;
  delayAdd?: boolean;
} = {}) {
  let quantity = initialQuantity;
  let cartReadCount = 0;
  let releaseAdd: (() => void) | undefined;
  const requests: Array<{ method: string; path: string }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });

    if (url.pathname.endsWith("/auth/csrf-token")) {
      return jsonResponse({ csrfToken: "test-csrf-token" });
    }

    if (url.pathname.endsWith("/auth/me")) {
      return jsonResponse({
        status: "authenticated",
        user: {
          id: "507f1f77bcf86cd799439012",
          email: "customer@example.com",
          emailVerified: true,
          roles: ["customer"],
          addresses: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      });
    }

    if (url.pathname.endsWith("/cart") && method === "GET") {
      cartReadCount += 1;
      if (failFirstCartRead && cartReadCount === 1) {
        return jsonResponse({ error: "Cart temporarily unavailable." }, 503);
      }
      return jsonResponse({ cart: makeCart(quantity) });
    }

    if (url.pathname.endsWith("/cart/items") && method === "POST") {
      if (delayAdd) {
        await new Promise<void>((resolve) => {
          releaseAdd = resolve;
        });
      }
      const body = JSON.parse(String(init?.body)) as { quantity: number };
      quantity += body.quantity;
      return jsonResponse({ cart: makeCart(quantity) });
    }

    if (url.pathname.endsWith(`/cart/items/${productId}`) && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { quantity: number };
      quantity = body.quantity;
      return jsonResponse({ cart: makeCart(quantity) });
    }

    if (url.pathname.endsWith(`/cart/items/${productId}`) && method === "DELETE") {
      quantity = 0;
      return jsonResponse({ cart: makeCart() });
    }

    if (url.pathname.endsWith("/cart") && method === "DELETE") {
      quantity = 0;
      return jsonResponse({ cart: makeCart() });
    }

    return jsonResponse({ error: "Not found" }, 404);
  });

  vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
  vi.stubGlobal("fetch", fetcher);
  return { requests, fetcher, releaseAdd: () => releaseAdd?.() };
}

function renderCart({
  includeSecondProduct = false,
  includeTestControls = false,
}: {
  includeSecondProduct?: boolean;
  includeTestControls?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <CartTrigger />
        <CartAddButton product={product} />
        {includeSecondProduct ? (
          <CartAddButton product={secondProduct}>Add Product B</CartAddButton>
        ) : null}
        {includeTestControls ? <CartTestControls /> : null}
        <CartSheet />
      </CartProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function CartTestControls() {
  const queryClient = useQueryClient();
  const cart = useCart();
  return (
    <>
      <button
        type="button"
        onClick={() => queryClient.setQueryData(["session"], authenticatedSession)}
      >
        Simulate customer sign-in
      </button>
      <button type="button" onClick={() => void cart.syncGuestCart().catch(() => undefined)}>
        Sync guest cart
      </button>
    </>
  );
}

function installGuestLifecycleApi({
  initiallyAuthenticated = false,
  initialQuantities = {},
  failFirstAdd = false,
}: {
  initiallyAuthenticated?: boolean;
  initialQuantities?: Record<string, number>;
  failFirstAdd?: boolean;
} = {}) {
  const quantities = new Map(Object.entries(initialQuantities));
  let shouldFailFirstAdd = failFirstAdd;
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const cartResponse = () => {
    const items = [...quantities.entries()].map(([id, quantity]) => {
      const currentProduct = id === productId ? product : secondProduct;
      return {
        productId: id,
        quantity,
        available: true,
        product: { name: currentProduct.name, slug: currentProduct.slug },
        unitPriceCents: currentProduct.priceCents,
        lineSubtotalCents: currentProduct.priceCents * quantity,
      };
    });
    const totalCents = items.reduce((total, item) => total + item.lineSubtotalCents, 0);
    return {
      items,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      currency: "ZAR",
      totalCents,
      hasUnavailableItems: false,
    };
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown;
    requests.push({ method, path: url.pathname, body });

    if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "lifecycle-csrf" });
    if (url.pathname.endsWith("/auth/me")) {
      return initiallyAuthenticated
        ? jsonResponse({ user: authenticatedSession.user })
        : jsonResponse({ error: "Authentication required." }, 401);
    }
    if (url.pathname.endsWith("/cart") && method === "GET") {
      return jsonResponse({ cart: cartResponse() });
    }
    if (url.pathname.endsWith("/cart/items") && method === "POST") {
      const item = body as { productId: string; quantity: number };
      if (shouldFailFirstAdd) {
        shouldFailFirstAdd = false;
        return jsonResponse({ error: "Cart temporarily unavailable." }, 503);
      }
      quantities.set(item.productId, Math.min(99, (quantities.get(item.productId) ?? 0) + item.quantity));
      return jsonResponse({ cart: cartResponse() });
    }
    const itemMatch = url.pathname.match(/\/cart\/items\/([a-f\d]{24})$/i);
    if (itemMatch && method === "PATCH") {
      quantities.set(itemMatch[1]!, (body as { quantity: number }).quantity);
      return jsonResponse({ cart: cartResponse() });
    }
    if (itemMatch && method === "DELETE") {
      quantities.delete(itemMatch[1]!);
      return jsonResponse({ cart: cartResponse() });
    }
    return jsonResponse({ error: "Not found" }, 404);
  });
  vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
  vi.stubGlobal("fetch", fetcher);
  return { requests, quantities, fetcher };
}

function getZarPriceMatcher(cents: number) {
  const expected = formatZarCents(cents).replace(/\u00a0/g, " ");
  return (_content: string, element: Element | null) =>
    element?.textContent?.replace(/\u00a0/g, " ") === expected;
}

afterEach(() => {
  window.localStorage.removeItem("healthyways.guest-cart.v1");
  window.localStorage.removeItem("healthyways.guest-cart-merge.v1");
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("storefront cart", () => {
  it("adds, updates, removes, and clears items using backend cart responses", async () => {
    const { requests } = installCartApi();
    renderCart();

    const addButton = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(await screen.findByText("Added 1 item to your cart.")).toBeVisible();
    expect(screen.getByText("Aloe product")).toBeVisible();
    expect(
      screen.getByText(getZarPriceMatcher(unitPriceCents), { selector: ".cart-item-price" }),
    ).toBeVisible();
    expect(
      screen.getByText(getZarPriceMatcher(unitPriceCents), { selector: ".cart-subtotal" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Aloe product" }));
    expect(
      await screen.findByText(getZarPriceMatcher(unitPriceCents * 2), {
        selector: ".cart-subtotal",
      }),
    ).toBeVisible();
    expect(screen.getByText("2", { selector: ".cart-quantity-row span" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Remove Aloe product from cart" }));
    expect(await screen.findByText("Your cart is empty.")).toBeVisible();

    fireEvent.click(addButton);
    expect(await screen.findByText("Aloe product")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear cart" }));
    expect(await screen.findByText("Your cart is empty.")).toBeVisible();

    expect(requests).toContainEqual({ method: "GET", path: "/api/v1/cart" });
    expect(requests).toContainEqual({ method: "POST", path: "/api/v1/cart/items" });
    expect(requests).toContainEqual({
      method: "PATCH",
      path: `/api/v1/cart/items/${productId}`,
    });
    expect(requests).toContainEqual({
      method: "DELETE",
      path: `/api/v1/cart/items/${productId}`,
    });
    expect(requests).toContainEqual({ method: "DELETE", path: "/api/v1/cart" });
    expect(requests.filter(({ path }) => path.endsWith("/auth/csrf-token"))).toHaveLength(1);
  }, 15000);

  it("shows a recoverable cart API error and retries the cart load", async () => {
    const { requests } = installCartApi({ failFirstCartRead: true });
    renderCart();

    fireEvent.click(await screen.findByRole("button", { name: "Open cart" }));
    expect(await screen.findByText("Cart temporarily unavailable.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry cart" }));

    expect(await screen.findByText("Your cart is empty.")).toBeVisible();
    expect(
      requests.filter(({ method, path }) => method === "GET" && path.endsWith("/cart")),
    ).toHaveLength(2);
  }, 15000);

  it("prevents duplicate adds while a cart mutation is pending", async () => {
    const { releaseAdd } = installCartApi({ delayAdd: true });
    renderCart();

    const addButton = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(await screen.findByRole("button", { name: "Adding…" })).toBeDisabled();
    await act(async () => releaseAdd());
    expect(await screen.findByText("Added 1 item to your cart.")).toBeVisible();
  }, 15000);

  it("persists an unauthenticated preview cart locally without backend mutations", async () => {
    const requests: string[] = [];
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        requests.push(`${url.pathname}${url.search}`);
        return jsonResponse({ error: "Authentication required." }, 401);
      }),
    );
    window.history.replaceState({}, "", "/preview");

    const firstRender = renderCart();
    const addButton = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);
    expect(await screen.findByText("Added 1 item to your cart.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Aloe product" }));
    expect(await screen.findByText("2", { selector: ".cart-quantity-row span" })).toBeVisible();
    firstRender.unmount();

    renderCart();
    fireEvent.click(await screen.findByRole("button", { name: "Open cart with 2 items" }));
    expect(await screen.findByText("Aloe product")).toBeVisible();
    expect(screen.getByText("2", { selector: ".cart-quantity-row span" })).toBeVisible();
    expect(localStorage.getItem("healthyways.guest-cart.v1")).toContain(productId);
    expect(requests.some((path) => path.includes("/cart"))).toBe(false);
  }, 15000);

  it("merges guest products into the signed-in cart without duplicating matching lines", async () => {
    installGuestLifecycleApi({ initiallyAuthenticated: false, initialQuantities: { [productId]: 2 } });
    window.history.replaceState({}, "", "/preview");
    const firstRender = renderCart({ includeSecondProduct: true, includeTestControls: true });
    const addA = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addA).toBeEnabled());
    fireEvent.click(addA);
    fireEvent.keyDown(document, { key: "Escape" });
    const addB = await screen.findByRole("button", { name: "Add Product B" });
    await waitFor(() => expect(addB).toBeEnabled());
    fireEvent.click(addB);
    await waitFor(() => expect(document.querySelector(".cart-badge")?.textContent).toBe("2"));
    expect(localStorage.getItem("healthyways.guest-cart.v1")).toContain(secondProductId);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Simulate customer sign-in" }));
    await waitFor(() => {
      expect(firstRender.queryClient.getQueryData(["session"])).toMatchObject({
        status: "authenticated",
      });
    });
    await waitFor(() =>
      expect(firstRender.queryClient.getQueryData(["cart", authenticatedSession.user.id])).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync guest cart" }));

    await waitFor(() => expect(document.querySelector(".cart-badge")?.textContent).toBe("4"));
    fireEvent.click(screen.getByRole("button", { name: "Open cart with 4 items" }));
    expect(await screen.findByText("Chamomile product")).toBeVisible();
    expect(screen.getByText("Aloe product")).toBeVisible();
    expect(screen.getByText("3", { selector: ".cart-quantity-row span" })).toBeVisible();
    expect(localStorage.getItem("healthyways.guest-cart.v1")).toContain('"items":[]');
    expect(localStorage.getItem("healthyways.guest-cart-merge.v1")).toBeNull();
  }, 15000);

  it("preserves the guest cart when reconciliation fails", async () => {
    installGuestLifecycleApi({ initiallyAuthenticated: false, failFirstAdd: true });
    window.history.replaceState({}, "", "/preview");
    const view = renderCart({ includeTestControls: true });
    const addA = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addA).toBeEnabled());
    fireEvent.click(addA);
    expect(await screen.findByText("Aloe product")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Simulate customer sign-in" }));
    await waitFor(() => {
      expect(view.queryClient.getQueryData(["session"])).toMatchObject({
        status: "authenticated",
      });
    });
    await waitFor(() =>
      expect(view.queryClient.getQueryData(["cart", authenticatedSession.user.id])).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync guest cart" }));

    await waitFor(() =>
      expect(localStorage.getItem("healthyways.guest-cart-merge.v1")).toContain(productId),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
    expect(await screen.findByText(/Cart temporarily unavailable/)).toBeVisible();
    expect(localStorage.getItem("healthyways.guest-cart.v1")).toContain(productId);
    expect(localStorage.getItem("healthyways.guest-cart-merge.v1")).toContain(productId);
  }, 15000);

  it("restores authenticated cart data after refresh and persists quantity changes and removal", async () => {
    const backendCart = installGuestLifecycleApi({ initiallyAuthenticated: true });
    window.history.replaceState({}, "", "/preview");
    const firstRender = renderCart();
    const addA = await screen.findByRole("button", { name: "Add to cart" });
    await waitFor(() => expect(addA).toBeEnabled());
    fireEvent.click(addA);
    expect(await screen.findByText("Added 1 item to your cart.")).toBeVisible();
    expect(await screen.findByText("Aloe product")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByRole("button", { name: "Open cart with 1 items" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    firstRender.unmount();

    const secondRender = renderCart();
    fireEvent.click(await screen.findByRole("button", { name: "Open cart with 1 items" }));
    expect(await screen.findByText("Aloe product")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Aloe product" }));
    expect(await screen.findByText("2", { selector: ".cart-quantity-row span" })).toBeVisible();
    expect(secondRender.queryClient.getQueryData<{ items: Array<{ quantity: number }> }>([
      "cart",
      authenticatedSession.user.id,
    ])?.items[0]?.quantity).toBe(2);
    expect(backendCart.quantities.get(productId)).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove Aloe product from cart" }));
    expect(await screen.findByText("Your cart is empty.")).toBeVisible();
    expect(secondRender.queryClient.getQueryData<{ items: unknown[] }>([
      "cart",
      authenticatedSession.user.id,
    ])?.items).toHaveLength(0);
    expect(backendCart.quantities.has(productId)).toBe(false);
  }, 15000);
});
