import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/csrf-token")) {
      return jsonResponse({ csrfToken: "test-csrf-token" });
    }
    if (url.pathname.endsWith("/auth/me")) return jsonResponse({ user });
    if (url.pathname.endsWith("/admin/uploads/images")) {
      const body = init?.body as FormData;
      const files = body.getAll("images") as File[];
      const successfulFiles = files.length > 1 ? files.slice(0, 1) : files;
      return jsonResponse({
        images: successfulFiles.map((file) => ({
          url: `https://images.example.test/${file.name}`,
          publicId: `products/${file.name}`,
          originalFilename: file.name,
          format: file.type.split("/")[1],
          width: 640,
          height: 480,
          bytes: file.size,
        })),
      }, files.length > 1 ? 207 : 201);
    }
    if (url.pathname.endsWith("/admin/categories")) return jsonResponse({ categories: [] });
    if (url.pathname.endsWith("/admin/inventory")) {
      return jsonResponse({
        inventory: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (url.pathname.endsWith("/admin/products")) {
      return jsonResponse({
        products: [],
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
    expect(screen.queryByRole("button", { name: "Create product" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("/admin/"))).toBe(false);
  });

  it("requires the documented admin role, verified email, and configured admin domain", async () => {
    renderAdmin({ ...userBase, emailVerified: false });

    expect(
      await screen.findByRole("heading", { name: "Administrator access denied" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("does not treat the configured email domain as a substitute for the admin role", async () => {
    renderAdmin({ ...userBase, email: "owner@example.test" });

    expect(
      await screen.findByRole("heading", { name: "Administrator access denied" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create product" })).not.toBeInTheDocument();
  });

  it("loads only the documented admin categories and inventory for eligible users", async () => {
    const fetcher = renderAdmin(userBase);

    expect(await screen.findByRole("button", { name: "Create product" })).toBeVisible();
    const requestedPaths = fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(requestedPaths).toContain("/api/v1/admin/categories");
    expect(requestedPaths.some((path) => path === "/api/v1/admin/inventory")).toBe(true);
  });

  it("shows a connected file picker in the product form without manual image URL entry", async () => {
    vi.stubEnv("VITE_PRODUCT_IMAGE_ALLOWED_HOSTS", "images.example.test");
    renderAdmin(userBase);
    const createProductButton = await screen.findByRole("button", { name: "Create product" });

    fireEvent.click(createProductButton);

    expect(await screen.findByRole("group", { name: "Product Images" })).toBeVisible();
    const chooseImagesButton = screen.getByRole("button", { name: "Choose Images" });
    const fileInput = screen.getByLabelText("Choose product image files") as HTMLInputElement;
    expect(fileInput.type).toBe("file");
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.accept).toBe("image/jpeg,image/png,image/webp,image/gif");
    const inputClick = vi.spyOn(fileInput, "click");

    fireEvent.click(chooseImagesButton);

    expect(inputClick).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/image references/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/image URL/i)).not.toBeInTheDocument();

    const file = new File(["image data"], "product.webp", { type: "image/webp" });
    const failedFile = new File(["other image"], "other.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file, failedFile] } });
    expect(await screen.findByAltText("Preview of product.webp")).toBeVisible();
    expect(await screen.findByAltText("Preview of other.png")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Upload 2 selected images" }));
    expect(await screen.findByText(/Retry failed file: other\.png/i)).toBeVisible();
    expect(screen.getByRole("img", { name: "Product image 1" })).toBeVisible();
    expect(screen.getByAltText("Preview of other.png")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 selected image" }));
    expect(await screen.findByText(/uploaded and added to the product/i)).toBeVisible();
    expect(screen.getByRole("img", { name: "Product image 2" })).toBeVisible();

    const uploadCalls = fetcher.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.endsWith("/admin/uploads/images"),
    );
    expect(uploadCalls).toHaveLength(2);
    for (const [, init] of uploadCalls) {
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("test-csrf-token");
      expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    }
    expect(((uploadCalls[0]?.[1]?.body as FormData).getAll("images") as File[]).map((item) => item.name))
      .toEqual(["product.webp", "other.png"]);
    expect(((uploadCalls[1]?.[1]?.body as FormData).getAll("images") as File[]).map((item) => item.name))
      .toEqual(["other.png"]);
  });
});
