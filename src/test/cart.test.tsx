import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartAddButton, CartProvider, CartSheet, CartTrigger } from "@/components/storefront/cart";
import { formatZarCents } from "@/lib/money";

const productId = "507f1f77bcf86cd799439011";
const unitPriceCents = 14550;

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

function renderCart() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <CartTrigger />
        <CartAddButton productId={productId} />
        <CartSheet />
      </CartProvider>
    </QueryClientProvider>,
  );
}

function getZarPriceMatcher(cents: number) {
  const expected = formatZarCents(cents).replace(/\u00a0/g, " ");
  return (_content: string, element: Element | null) =>
    element?.textContent?.replace(/\u00a0/g, " ") === expected;
}

afterEach(() => {
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
});
