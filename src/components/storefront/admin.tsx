import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiHttpError, ApiResponseError } from "@/lib/api/client";
import { adminApi, type AdminInventoryItem } from "@/lib/api/admin";
import { authApi, type PublicUser } from "@/lib/api/auth";
import { isAllowedProductImageUrl } from "@/lib/image-url";

type LoginStep = "credentials" | "two-factor" | "enrollment" | "recovery-codes";
type ProductStatus = AdminInventoryItem["status"];

function isProductStatus(value: string): value is ProductStatus {
  return value === "draft" || value === "active" || value === "inactive";
}

function safeAdminError(error: unknown, action: string): string {
  if (error instanceof ApiHttpError && error.status === 401) {
    return "Your session has expired or authentication is required. Please sign in again.";
  }
  if (error instanceof ApiHttpError && error.status === 403) {
    if (
      typeof error.body === "object" &&
      error.body !== null &&
      !Array.isArray(error.body) &&
      "error" in error.body &&
      error.body.error === "Invalid or missing CSRF token."
    ) {
      return "The request could not be verified. Refresh the page and try again; the rejected request was not replayed.";
    }
    return "The backend denied this administrator action.";
  }
  if (error instanceof ApiResponseError) {
    return `${action} failed because the backend response was invalid.`;
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

function isAdminUser(user: PublicUser): boolean {
  return (
    user.emailVerified &&
    user.roles.includes("admin") &&
    user.email.trim().toLowerCase().endsWith("@healtywayssa.co.za")
  );
}

export function AdminPanel() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["admin", "session"],
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const [step, setStep] = useState<LoginStep>("credentials");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [factorCode, setFactorCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await authApi.login(credentials);
      setCredentials({ email: "", password: "" });
      if (response && "twoFactorRequired" in response && response.twoFactorRequired) {
        setStep("two-factor");
      } else if (
        response &&
        "twoFactorEnrollmentRequired" in response &&
        response.twoFactorEnrollmentRequired
      ) {
        const setup = await authApi.enrollTwoFactor();
        if (!setup || typeof setup.secret !== "string" || !setup.secret) {
          throw new ApiResponseError(200, "Backend returned invalid two-factor enrollment data.");
        }
        setEnrollment({ secret: setup.secret });
        setStep("enrollment");
      } else if (response && "user" in response) {
        await queryClient.invalidateQueries({ queryKey: ["admin", "session"] });
      } else {
        throw new ApiResponseError(200, "Backend returned an invalid sign-in response.");
      }
    } catch (loginError) {
      setError(safeAdminError(loginError, "Sign-in"));
    } finally {
      setBusy(false);
    }
  }

  async function handleFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "two-factor") {
        await authApi.verifyTwoFactor(factorCode);
        await queryClient.invalidateQueries({ queryKey: ["admin", "session"] });
      } else {
        const result = await authApi.confirmTwoFactor(factorCode);
        if (!result || !Array.isArray(result.recoveryCodes)) {
          throw new ApiResponseError(200, "Backend returned invalid recovery codes.");
        }
        setRecoveryCodes(result.recoveryCodes);
        setFactorCode("");
        setStep("recovery-codes");
        await queryClient.invalidateQueries({ queryKey: ["admin", "session"] });
      }
    } catch (factorError) {
      setError(safeAdminError(factorError, "Two-factor verification"));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError(null);
    try {
      await authApi.logout();
      setStep("credentials");
      setEnrollment(null);
      setRecoveryCodes(null);
      setFactorCode("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "session"] });
    } catch (logoutError) {
      setError(safeAdminError(logoutError, "Sign-out"));
    } finally {
      setBusy(false);
    }
  }

  if (sessionQuery.isPending) {
    return (
      <p className="catalogue-status" role="status">
        Checking administrator session…
      </p>
    );
  }
  if (sessionQuery.isError) {
    return (
      <section className="admin-panel" aria-labelledby="admin-title">
        <h2 id="admin-title">Administrator access</h2>
        <p className="catalogue-error" role="alert">
          {safeAdminError(sessionQuery.error, "Session check")}
        </p>
        <Button variant="outline" onClick={() => void sessionQuery.refetch()}>
          Retry
        </Button>
      </section>
    );
  }

  const session = sessionQuery.data;
  const user = session?.status === "authenticated" ? session.user : undefined;
  const authorized = Boolean(user && isAdminUser(user));

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-panel-header">
        <div>
          <span className="eyebrow">Healthy Ways SA</span>
          <h2 id="admin-title" className="section-title mt-3">
            Administrator workspace
          </h2>
        </div>
        {user ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            Sign out
          </Button>
        ) : null}
      </header>

      {error ? (
        <p className="admin-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {step === "recovery-codes" && recoveryCodes ? (
        <div className="admin-card" role="status">
          <h3>Save your recovery codes</h3>
          <p>
            These codes are shown once. Store them securely; they are not saved in this browser.
          </p>
          <ul className="admin-recovery-codes">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={() => {
              setRecoveryCodes(null);
              setEnrollment(null);
              setStep("credentials");
            }}
          >
            I have saved the codes
          </Button>
        </div>
      ) : !user ? (
        step === "credentials" ? (
          <form className="admin-form admin-card" onSubmit={(event) => void handleLogin(event)}>
            <h3>Sign in to continue</h3>
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                required
                value={credentials.email}
                onChange={(event) =>
                  setCredentials({ ...credentials, email: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={credentials.password}
                onChange={(event) =>
                  setCredentials({ ...credentials, password: event.currentTarget.value })
                }
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form
            className="admin-form admin-card"
            onSubmit={(event) => void handleFactorSubmit(event)}
          >
            <h3>{step === "enrollment" ? "Set up two-factor authentication" : "Verify sign-in"}</h3>
            {step === "enrollment" ? (
              <>
                <p>
                  Add the following key to an authenticator app. It is only held in this page while
                  setup is in progress.
                </p>
                <code className="admin-enrollment-secret">{enrollment?.secret}</code>
              </>
            ) : null}
            <label>
              {step === "enrollment"
                ? "Six-digit authenticator code"
                : "Authenticator or recovery code"}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                minLength={6}
                maxLength={step === "enrollment" ? 6 : 32}
                required
                value={factorCode}
                onChange={(event) => setFactorCode(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Verifying…" : step === "enrollment" ? "Confirm setup" : "Verify"}
            </Button>
          </form>
        )
      ) : !authorized ? (
        <div className="admin-card" role="alert">
          <h3>Administrator access denied</h3>
          <p>
            Access requires a verified account with the backend administrator role and an
            {` @healtywayssa.co.za `}email address. A matching email alone does not grant access.
          </p>
        </div>
      ) : (
        <AdminTools />
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
