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

function createPreviewFetcher(registerResponse: unknown, registerStatus = 201) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/me")) {
      return jsonResponse({ error: "Authentication required." }, 401);
    }
    if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf-test" });
    if (url.pathname.endsWith("/auth/register")) {
      return jsonResponse(registerResponse, registerStatus);
    }
    if (url.pathname.endsWith("/cart")) {
      return jsonResponse({ error: "Authentication required." }, 401);
    }
    if (url.pathname.endsWith("/categories")) return jsonResponse({ categories: [] });
    if (url.pathname.endsWith("/products")) {
      return jsonResponse({
        products: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return jsonResponse({ error: "Not found" }, 404);
  });
}

async function renderPreviewAt(initialEntry: string, fetcher: typeof fetch) {
  vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
  vi.stubGlobal("fetch", fetcher);
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
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

  it("registers through the backend and reports its real email-delivery result", async () => {
    const registeredUser = {
      id: "user-1",
      email: "customer@example.test",
      emailVerified: false,
      roles: ["customer"],
      addresses: [],
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    };
    const fetcher = createPreviewFetcher({
      user: registeredUser,
      emailVerificationEmailSent: false,
    });
    const router = await renderPreviewAt("/preview?view=register", fetcher);

    expect(await screen.findByRole("heading", { name: "Create an account" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password (12–128 characters)"), {
      target: { value: "a-strong-test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-strong-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByText(/no verification email was sent/i)).toBeVisible();
    expect(router.state.location.pathname).toBe("/preview");
    const registrationCall = fetcher.mock.calls.find(([input]) =>
      String(input).endsWith("/auth/register"),
    );
    expect(registrationCall?.[1]?.credentials).toBe("include");
    expect(new Headers(registrationCall?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-test");
    expect(JSON.parse(String(registrationCall?.[1]?.body))).toEqual({
      email: "customer@example.test",
      password: "a-strong-test-password",
    });
  }, 15000);

  it("does not show account creation success when the backend rejects registration", async () => {
    const fetcher = createPreviewFetcher({ error: "Account already exists." }, 409);
    await renderPreviewAt("/preview?view=register", fetcher);

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password (12–128 characters)"), {
      target: { value: "a-strong-test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-strong-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.queryByText(/account created/i)).not.toBeInTheDocument();
  }, 15000);

  it("shows backend invalid-credential errors on the login form", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/me") || url.pathname.endsWith("/cart")) {
        return jsonResponse({ error: "Authentication required." }, 401);
      }
      if (url.pathname.endsWith("/auth/csrf-token")) {
        return jsonResponse({ csrfToken: "csrf-login-test" });
      }
      if (url.pathname.endsWith("/auth/login")) {
        return jsonResponse({ error: "Invalid email or password." }, 401);
      }
      return jsonResponse({ error: "Not found" }, 404);
    });
    await renderPreviewAt("/preview?view=login", fetcher);

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "incorrect-password" },
    });
    const loginForm = screen.getByLabelText("Email").closest("form");
    expect(loginForm).not.toBeNull();
    fireEvent.submit(loginForm!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-in failed. Check your email and password",
    );
    const loginCall = fetcher.mock.calls.find(([input]) => String(input).endsWith("/auth/login"));
    expect(loginCall?.[1]?.credentials).toBe("include");
    expect(new Headers(loginCall?.[1]?.headers).get("X-CSRF-Token")).toBeTruthy();
  }, 15000);

  it("renders backend account and order data and saves an address through the customer API", async () => {
    const savedUser = {
      id: "customer-1",
      email: "customer@example.test",
      displayName: "Customer",
      emailVerified: true,
      roles: ["customer"],
      addresses: [],
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/me")) return jsonResponse({ user: savedUser });
      if (url.pathname.endsWith("/auth/csrf-token"))
        return jsonResponse({ csrfToken: "csrf-test" });
      if (url.pathname.endsWith("/cart"))
        return jsonResponse({ error: "Authentication required." }, 401);
      if (url.pathname.endsWith("/orders")) {
        return jsonResponse({
          orders: [
            {
              id: "order-1",
              orderNumber: "HW-2026-000001",
              customerEmail: savedUser.email,
              items: [],
              subtotalCents: 2500,
              totalCents: 2500,
              currency: "ZAR",
              status: "pending_payment",
              stockReservationStatus: "reserved",
              deliveryAddress: {
                recipientName: "Customer",
                phoneNumber: "0790000000",
                addressLine1: "1 Main Road",
                city: "Johannesburg",
                province: "Gauteng",
                postalCode: "2000",
                country: "South Africa",
              },
              createdAt: "2026-10-17T00:00:00.000Z",
              updatedAt: "2026-10-17T00:00:00.000Z",
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      if (url.pathname.endsWith("/users/me/addresses")) {
        const inputData = JSON.parse(String(init?.body)) as Record<string, string>;
        return jsonResponse(
          {
            user: {
              ...savedUser,
              addresses: [{ id: "address-1", ...inputData }],
            },
          },
          201,
        );
      }
      return jsonResponse({ error: "Not found" }, 404);
    });
    await renderPreviewAt("/preview?view=account", fetcher);

    expect(await screen.findByText("customer@example.test")).toBeVisible();
    expect(await screen.findByText("Pending payment — not paid")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Address label"), {
      target: { value: "Home" },
    });
    fireEvent.change(screen.getByLabelText("Recipient name"), {
      target: { value: "Customer" },
    });
    fireEvent.change(screen.getAllByLabelText("Phone number")[1]!, {
      target: { value: "0790000000" },
    });
    fireEvent.change(screen.getByLabelText("Address line 1"), {
      target: { value: "1 Main Road" },
    });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(await screen.findByText("Address saved.")).toBeVisible();
    expect(screen.getByText("Home", { selector: "strong" })).toBeVisible();
    const addressCall = fetcher.mock.calls.find(([input]) =>
      String(input).endsWith("/users/me/addresses"),
    );
    expect(addressCall?.[1]?.credentials).toBe("include");
    expect(new Headers(addressCall?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-test");
  }, 15000);

  it("does not enter the admin view until the login two-factor challenge succeeds", async () => {
    const adminUser = {
      id: "admin-1",
      email: "owner@healtywayssa.co.za",
      emailVerified: true,
      roles: ["admin"],
      addresses: [],
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    };
    let authenticated = false;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/me")) {
        return authenticated
          ? jsonResponse({ user: adminUser })
          : jsonResponse({ error: "Authentication required." }, 401);
      }
      if (url.pathname.endsWith("/auth/csrf-token")) {
        return jsonResponse({ csrfToken: "csrf-test" });
      }
      if (url.pathname.endsWith("/auth/login")) {
        return jsonResponse({ twoFactorRequired: true }, 202);
      }
      if (url.pathname.endsWith("/auth/2fa/verify")) {
        authenticated = true;
        return jsonResponse({ user: adminUser });
      }
      if (url.pathname.endsWith("/cart")) {
        return authenticated
          ? jsonResponse({
              cart: {
                items: [],
                itemCount: 0,
                currency: "ZAR",
                totalCents: 0,
                hasUnavailableItems: false,
              },
            })
          : jsonResponse({ error: "Authentication required." }, 401);
      }
      if (url.pathname.endsWith("/admin/categories")) return jsonResponse({ categories: [] });
      if (url.pathname.endsWith("/admin/inventory")) {
        return jsonResponse({
          inventory: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
      }
      return jsonResponse({ error: "Not found" }, 404);
    });
    const router = await renderPreviewAt("/preview?view=login&returnTo=admin", fetcher);

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: adminUser.email },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-strong-test-password" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Log in" })[1]!);
    expect(await screen.findByRole("heading", { name: "Verify sign-in" })).toBeVisible();
    expect(router.state.location.search).toEqual({ view: "login", returnTo: "admin" });
    expect(
      screen.queryByRole("heading", { name: "Administrator workspace" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Authenticator or recovery code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("heading", { name: "Create product" })).toBeVisible();
    expect(router.state.location.search).toEqual({ view: "admin" });
    expect(screen.getByRole("button", { name: "Admin" })).toBeVisible();
  }, 15000);

  it("keeps customer and administrator views within the existing /preview route", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/auth/me")) {
          return jsonResponse({ error: "Authentication required." }, 401);
        }
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
            products: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          });
        }
        return jsonResponse({ error: "Not found" }, 404);
      }),
    );
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      history: createMemoryHistory({ initialEntries: ["/preview?view=admin"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: "Administrator sign-in required" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Go to login" }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/preview");
    expect(router.state.location.search).toEqual({ view: "login", returnTo: "admin" });
    expect(router.matchRoutes("/").map((match) => match.routeId)).not.toContain("/admin");
  }, 15000);
});
