import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiHttpError, ApiResponseError, CsrfTokenError } from "@/lib/api/client";
import { adminApi, type AdminInventoryItem } from "@/lib/api/admin";
import type { PublicUser } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/auth/authorization";
import { isAllowedProductImageUrl } from "@/lib/image-url";

type ProductStatus = AdminInventoryItem["status"];

function isProductStatus(value: string): value is ProductStatus {
  return value === "draft" || value === "active" || value === "inactive";
}

function safeAdminError(error: unknown, action: string): string {
  if (error instanceof ApiHttpError && error.status === 401) {
    return "Your session has expired or authentication is required. Please sign in again.";
  }
  if (error instanceof ApiHttpError && error.status === 403) {
    if (error.isCsrfFailure)
      return "The request could not be verified after one token refresh. Refresh the page and try again.";
    return "The backend denied this administrator action.";
  }
  if (error instanceof ApiResponseError) {
    return `${action} failed because the backend response was invalid.`;
  }
  if (error instanceof CsrfTokenError) {
    return `${action} could not be secured because a CSRF token was unavailable. Refresh the page and try again.`;
  }
  return `${action} could not be completed. Check your connection and try again.`;
}

function parsePriceCents(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export function AdminPanel({ user }: { user: PublicUser | null }) {
  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-panel-header">
        <div>
          <span className="eyebrow">Healthy Ways SA</span>
          <h2 id="admin-title" className="section-title mt-3">
            Administrator workspace
          </h2>
        </div>
      </header>
      {!user ? (
        <div className="admin-card" role="alert">
          <h3>Administrator access denied</h3>
          <p>
            Sign in with an authorized administrator account. The backend role, verified email,
            administrator domain and completed two-factor session are all required.
          </p>
        </div>
      ) : isAdminUser(user) ? (
        <AdminTools />
      ) : (
        <div className="admin-card" role="alert">
          <h3>Administrator access denied</h3>
          <p>
            Access requires a verified account with the backend administrator role and an
            {` @healtywayssa.co.za `}email address. A matching email alone does not grant access.
          </p>
        </div>
      )}
    </section>
  );
}

function AdminTools() {
  const [categoryName, setCategoryName] = useState("");
  const [product, setProduct] = useState<{
    name: string;
    sku: string;
    description: string;
    categoryId: string;
    price: string;
    status: ProductStatus;
    imageReferencesText: string;
  }>({
    name: "",
    sku: "",
    description: "",
    categoryId: "",
    price: "",
    status: "draft" as "draft" | "active" | "inactive",
    imageReferencesText: "",
  });
  const [priceError, setPriceError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminApi.getCategories(),
    retry: false,
  });
  const inventoryQuery = useQuery({
    queryKey: ["admin", "inventory", inventoryPage],
    queryFn: () => adminApi.getInventory({ page: inventoryPage }),
    retry: false,
  });

  const categoryMutation = useMutation({
    mutationFn: (name: string) => adminApi.createCategory({ name }),
    onSuccess: async (category) => {
      if (!category) {
        setFeedback("Category created, but the backend response was incomplete.");
        return;
      }
      setCategoryName("");
      setFeedback(`Category “${category.name}” created.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });
  const categoryStatusMutation = useMutation({
    mutationFn: (category: { id: string; isActive: boolean }) =>
      adminApi.updateCategory(category.id, { isActive: !category.isActive }),
    onSuccess: async () => {
      setFeedback("Category status updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });
  const productMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminApi.createProduct(payload),
    onSuccess: async (created) => {
      setFeedback(`Product “${created.name}” created with status ${created.status}.`);
      setProduct({
        ...product,
        name: "",
        sku: "",
        description: "",
        price: "",
        imageReferencesText: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: (item: AdminInventoryItem) =>
      adminApi.updateProduct(item.productId, {
        status: item.status === "active" ? "inactive" : "active",
      }),
    onSuccess: async (updated) => {
      setFeedback(`Product “${updated.name}” status changed to ${updated.status}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
    },
  });
  const inventoryMutation = useMutation({
    mutationFn: (input: { productId: string; quantityDelta: number; reason: string }) =>
      adminApi.adjustInventory(input.productId, {
        quantityDelta: input.quantityDelta,
        reason: input.reason,
      }),
    onSuccess: async () => {
      setFeedback("Inventory adjustment recorded.");
      setQuantityDelta("");
      setAdjustmentReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
    },
  });

  const operationError =
    categoryMutation.error ??
    categoryStatusMutation.error ??
    productMutation.error ??
    statusMutation.error ??
    inventoryMutation.error;
  const categories = categoriesQuery.data ?? [];
  const inventory = inventoryQuery.data?.inventory ?? [];

  return (
    <div className="admin-tools">
      {feedback ? (
        <p className="admin-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {operationError ? (
        <p className="admin-feedback" role="alert">
          {safeAdminError(operationError, "Admin operation")}
        </p>
      ) : null}
      {categoriesQuery.isError || inventoryQuery.isError ? (
        <p className="admin-feedback" role="alert">
          {safeAdminError(categoriesQuery.error ?? inventoryQuery.error, "Admin data load")}
        </p>
      ) : null}

      <section className="admin-card" aria-labelledby="admin-categories-title">
        <h3 id="admin-categories-title">Categories</h3>
        {categoriesQuery.isPending ? <p role="status">Loading categories…</p> : null}
        <ul className="admin-list">
          {categories.map((category) => (
            <li key={category.id}>
              <span>
                {category.name} · {category.isActive ? "Active" : "Inactive"}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={categoryStatusMutation.isPending}
                onClick={() => categoryStatusMutation.mutate(category)}
              >
                {category.isActive ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="admin-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            categoryMutation.mutate(categoryName.trim());
          }}
        >
          <label>
            New category name
            <input
              required
              maxLength={100}
              value={categoryName}
              onChange={(event) => setCategoryName(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={!categoryName.trim() || categoryMutation.isPending}>
            {categoryMutation.isPending ? "Creating…" : "Create category"}
          </Button>
        </form>
      </section>

      <section className="admin-card" aria-labelledby="admin-products-title">
        <h3 id="admin-products-title">Create product</h3>
        <p>Only enter verified product information supplied by the business.</p>
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const priceCents = parsePriceCents(product.price);
            if (priceCents === undefined) {
              setPriceError("Enter a positive ZAR price with no more than two decimal places.");
              return;
            }
            setPriceError(null);
            const imageReferences = product.imageReferencesText
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean);
            if (imageReferences.length > 10 || !imageReferences.every(isAllowedProductImageUrl)) {
              setImageError("Use up to 10 HTTPS URLs from the configured approved image hosts.");
              return;
            }
            setImageError(null);
            productMutation.mutate({
              name: product.name.trim(),
              sku: product.sku.trim(),
              description: product.description.trim(),
              categoryId: product.categoryId,
              priceCents,
              status: product.status,
              imageReferences,
            });
          }}
        >
          <label>
            Product name
            <input
              required
              maxLength={160}
              value={product.name}
              onChange={(event) => setProduct({ ...product, name: event.currentTarget.value })}
            />
          </label>
          <label>
            SKU
            <input
              required
              maxLength={64}
              value={product.sku}
              onChange={(event) => setProduct({ ...product, sku: event.currentTarget.value })}
            />
          </label>
          <label>
            Description
            <textarea
              required
              maxLength={5000}
              rows={4}
              value={product.description}
              onChange={(event) =>
                setProduct({ ...product, description: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Category
            <select
              required
              value={product.categoryId}
              onChange={(event) =>
                setProduct({ ...product, categoryId: event.currentTarget.value })
              }
            >
              <option value="">Choose a category</option>
              {categories
                .filter((category) => category.isActive)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Price (ZAR)
            <input
              inputMode="decimal"
              required
              value={product.price}
              onChange={(event) => setProduct({ ...product, price: event.currentTarget.value })}
            />
          </label>
          {priceError ? (
            <p className="admin-field-error" role="alert">
              {priceError}
            </p>
          ) : null}
          <label>
            Status
            <select
              value={product.status}
              onChange={(event) => {
                const status = event.currentTarget.value;
                if (isProductStatus(status)) setProduct({ ...product, status });
              }}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Image URLs (one per line, optional)
            <textarea
              rows={3}
              value={product.imageReferencesText}
              onChange={(event) =>
                setProduct({ ...product, imageReferencesText: event.currentTarget.value })
              }
            />
          </label>
          {imageError ? (
            <p className="admin-field-error" role="alert">
              {imageError}
            </p>
          ) : null}
          <Button type="submit" disabled={productMutation.isPending || categories.length === 0}>
            {productMutation.isPending ? "Creating…" : "Create product"}
          </Button>
        </form>
      </section>

      <section className="admin-card" aria-labelledby="admin-inventory-title">
        <h3 id="admin-inventory-title">Inventory</h3>
        {inventoryQuery.isPending ? <p role="status">Loading inventory…</p> : null}
        {inventory.length === 0 && !inventoryQuery.isPending ? (
          <p>No inventory items are available on this page.</p>
        ) : (
          <ul className="admin-list">
            {inventory.map((item) => (
              <li key={item.productId}>
                <span>
                  {item.name} · {item.sku} · {item.stockQuantity} units · {item.status}
                </span>
                {item.status !== "draft" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate(item)}
                  >
                    {item.status === "active" ? "Deactivate" : "Activate"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {inventoryQuery.data && inventoryQuery.data.pagination.totalPages > 1 ? (
          <nav className="admin-pagination" aria-label="Inventory pages">
            <Button
              type="button"
              variant="outline"
              disabled={inventoryPage <= 1}
              onClick={() => setInventoryPage((page) => page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {inventoryPage} of {inventoryQuery.data.pagination.totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={inventoryPage >= inventoryQuery.data.pagination.totalPages}
              onClick={() => setInventoryPage((page) => page + 1)}
            >
              Next
            </Button>
          </nav>
        ) : null}
        <form
          className="admin-form admin-inventory-adjustment"
          onSubmit={(event) => {
            event.preventDefault();
            const delta = Number(quantityDelta);
            if (!Number.isSafeInteger(delta) || delta === 0 || !selectedProductId) return;
            inventoryMutation.mutate({
              productId: selectedProductId,
              quantityDelta: delta,
              reason: adjustmentReason.trim(),
            });
          }}
        >
          <h4>Adjust stock</h4>
          <label>
            Product
            <select
              required
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.currentTarget.value)}
            >
              <option value="">Choose a product</option>
              {inventory.map((item) => (
                <option key={item.productId} value={item.productId}>
                  {item.name} ({item.stockQuantity} units)
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity change (positive or negative integer)
            <input
              type="number"
              step="1"
              required
              value={quantityDelta}
              onChange={(event) => setQuantityDelta(event.currentTarget.value)}
            />
          </label>
          <label>
            Reason
            <input
              required
              minLength={3}
              maxLength={200}
              value={adjustmentReason}
              onChange={(event) => setAdjustmentReason(event.currentTarget.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={
              inventoryMutation.isPending ||
              !selectedProductId ||
              !Number.isSafeInteger(Number(quantityDelta)) ||
              Number(quantityDelta) === 0 ||
              adjustmentReason.trim().length < 3
            }
          >
            {inventoryMutation.isPending ? "Saving…" : "Record adjustment"}
          </Button>
        </form>
      </section>

      <p className="admin-contract-note">
        The backend does not provide an administrator product-list/detail endpoint or product
        deletion. Product status updates use the documented inventory response; no delete or
        unsupported product fields are simulated.
      </p>
      <p className="admin-contract-note">
        Prices are entered in ZAR and submitted as integer cents. Images are optional and restricted
        to approved HTTPS hosts.
      </p>
    </div>
  );
}
