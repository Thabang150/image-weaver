import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ApiHttpError,
  ApiResponseError,
  CsrfTokenError,
} from "@/lib/api/client";
import {
  adminApi,
  type AdminCategory,
  type AdminInventoryItem,
  type AdminProduct,
  type InventoryList,
} from "@/lib/api/admin";
import { isAllowedProductImageUrl } from "@/lib/image-url";

type AdminSection = "overview" | "products" | "categories" | "inventory" | "analytics";
type ProductStatus = AdminProduct["status"];

function isProductStatus(value: string): value is ProductStatus {
  return value === "draft" || value === "active" || value === "inactive" || value === "archived";
}

const sections: Array<{ id: AdminSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "categories", label: "Categories" },
  { id: "inventory", label: "Inventory" },
  { id: "analytics", label: "Analytics" },
];

function safeAdminError(error: unknown, action: string): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 401) return "Your administrator session expired. Sign in again.";
    if (error.status === 403) {
      return error.isCsrfFailure
        ? "The request could not be verified after one token refresh. Refresh the page and try again."
        : "The backend denied this administrator action.";
    }
    if (error.status === 409 || error.status === 400 || error.status === 422) {
      return error.message;
    }
    if (error.status === 413) return "The upload exceeded the backend's image size limit.";
    if (error.status === 415) return "The backend does not support one or more selected image formats.";
    if (error.status === 429) return "Too many requests. Wait before trying again.";
  }
  if (error instanceof ApiResponseError) {
    return `${action} failed because the backend response was invalid.`;
  }
  if (error instanceof CsrfTokenError) {
    return `${action} could not be secured because a CSRF token was unavailable. Refresh and try again.`;
  }
  return `${action} could not be completed. Check your connection and try again.`;
}

function parseZarCents(value: string, allowZero = false): number | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && (allowZero ? cents >= 0 : cents > 0)
    ? cents
    : undefined;
}

function formatZar(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function labelForKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DataValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) {
    return <span className="admin-unavailable">Unavailable</span>;
  }
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="admin-muted">No records returned</span>;
    return (
      <ol className="admin-data-array">
        {value.map((entry, index) => (
          <li key={index}>
            <DataValue value={entry} />
          </li>
        ))}
      </ol>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="admin-muted">No fields returned</span>;
    return (
      <dl className="admin-data-list">
        {entries.map(([key, entry]) => (
          <div className="admin-data-entry" key={key}>
            <dt>{labelForKey(key)}</dt>
            <dd>
              <DataValue value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="admin-muted">Unsupported value</span>;
}

function Feedback({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className="admin-feedback" role={error ? "alert" : "status"}>
      {children}
    </p>
  );
}

function QueryError({ error, action }: { error: unknown; action: string }) {
  return <Feedback error>{safeAdminError(error, action)}</Feedback>;
}

function AdminManagement() {
  const [activeSection, setActiveSection] = useState<AdminSection>("products");
  return (
    <div className="admin-management">
      <nav className="admin-section-tabs" aria-label="Administrator sections">
        {sections.map((section) => (
          <Button
            key={section.id}
            type="button"
            variant={activeSection === section.id ? "default" : "outline"}
            aria-current={activeSection === section.id ? "page" : undefined}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </Button>
        ))}
      </nav>
      {activeSection === "overview" ? <AdminOverview /> : null}
      {activeSection === "products" ? <ProductManagement /> : null}
      {activeSection === "categories" ? <CategoryManagement /> : null}
      {activeSection === "inventory" ? <InventoryManagement /> : null}
      {activeSection === "analytics" ? <AnalyticsReports /> : null}
      <section className="admin-contract-note">
        <h3>Orders</h3>
        <p>
          This backend documents order cancellation but does not provide an administrator order-list
          endpoint. Orders cannot be displayed or safely selected for cancellation here. Payment,
          refunds and fulfilment are not available.
        </p>
      </section>
    </div>
  );
}

export { AdminManagement };

function AdminOverview() {
  const overviewQuery = useQuery({
    queryKey: ["admin", "analytics", "overview"],
    queryFn: () => adminApi.getAnalytics("overview"),
    retry: false,
  });
  const inventoryQuery = useQuery({
    queryKey: ["admin", "analytics", "inventory", "overview"],
    queryFn: () => adminApi.getAnalytics("inventory", { limit: 20 }),
    retry: false,
  });
  const productsQuery = useQuery({
    queryKey: ["admin", "analytics", "products", "overview"],
    queryFn: () => adminApi.getAnalytics("products", { limit: 100 }),
    retry: false,
  });
  return (
    <div className="admin-management-grid">
      <section className="admin-card admin-wide" aria-labelledby="admin-overview-heading">
        <h3 id="admin-overview-heading">Store overview</h3>
        <p className="admin-muted">
          Values below are shown as returned by the backend. Null sales values are unavailable, not
          zero.
        </p>
        {overviewQuery.isPending ? <p role="status">Loading store overview…</p> : null}
        {overviewQuery.isError ? (
          <QueryError error={overviewQuery.error} action="Overview loading" />
        ) : null}
        {overviewQuery.data !== undefined ? <DataValue value={overviewQuery.data} /> : null}
      </section>
      <section className="admin-card admin-wide" aria-labelledby="admin-stock-overview-heading">
        <h3 id="admin-stock-overview-heading">Current inventory overview</h3>
        <p className="admin-muted">
          Includes only the low-stock and out-of-stock information supplied by the backend.
        </p>
        {inventoryQuery.isPending ? <p role="status">Loading inventory overview…</p> : null}
        {inventoryQuery.isError ? (
          <QueryError error={inventoryQuery.error} action="Inventory overview loading" />
        ) : null}
        {inventoryQuery.data !== undefined ? <DataValue value={inventoryQuery.data} /> : null}
      </section>
      <section className="admin-card admin-wide" aria-labelledby="admin-products-overview-heading">
        <h3 id="admin-products-overview-heading">Current product counts and status</h3>
        <p className="admin-muted">
          Product totals and draft/active counts are shown only if the analytics response provides
          them.
        </p>
        {productsQuery.isPending ? <p role="status">Loading product overview…</p> : null}
        {productsQuery.isError ? (
          <QueryError error={productsQuery.error} action="Product overview loading" />
        ) : null}
        {productsQuery.data !== undefined ? <DataValue value={productsQuery.data} /> : null}
      </section>
      <section className="admin-card admin-wide">
        <h3>Order counts and sales availability</h3>
        <p>
          Pending-payment and cancelled order counts are presented in the overview response. Paid
          sales, revenue, refunds, gross profit, sales velocity and conversion remain unavailable
          until the backend supplies verified payment/refund records and traffic events.
        </p>
      </section>
    </div>
  );
}

interface ProductFormState {
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  price: string;
  salePrice: string;
  cost: string;
  lowStockThreshold: string;
  packagingAmount: string;
  packagingUnit: string;
  shippingParcelLengthCm: string;
  shippingParcelWidthCm: string;
  shippingParcelHeightCm: string;
  shippingParcelWeightGrams: string;
  shippingParcelVerified: boolean;
  shippingParcelRemoved: boolean;
  status: ProductStatus;
  imageReferences: string[];
  primaryImageReference: string;
}

interface PendingProductImage {
  id: string;
  file: File;
  previewUrl: string;
}

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxImageFileBytes = 5 * 1024 * 1024;

const emptyProductForm: ProductFormState = {
  name: "",
  slug: "",
  sku: "",
  description: "",
  shortDescription: "",
  categoryId: "",
  price: "",
  salePrice: "",
  cost: "",
  lowStockThreshold: "",
  packagingAmount: "",
  packagingUnit: "",
  shippingParcelLengthCm: "",
  shippingParcelWidthCm: "",
  shippingParcelHeightCm: "",
  shippingParcelWeightGrams: "",
  shippingParcelVerified: false,
  shippingParcelRemoved: false,
  status: "draft",
  imageReferences: [],
  primaryImageReference: "",
};

function productToForm(product: AdminProduct): ProductFormState {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription ?? "",
    categoryId: product.categoryId,
    price: formatZar(product.priceCents),
    salePrice: formatZar(product.salePriceCents),
    cost: formatZar(product.costCents),
    lowStockThreshold:
      product.lowStockThreshold === undefined ? "" : String(product.lowStockThreshold),
    packagingAmount:
      product.packaging === undefined ? "" : String(product.packaging.amount),
    packagingUnit: product.packaging?.unit ?? "",
    shippingParcelLengthCm: product.shippingParcel
      ? String(product.shippingParcel.lengthCm)
      : "",
    shippingParcelWidthCm: product.shippingParcel
      ? String(product.shippingParcel.widthCm)
      : "",
    shippingParcelHeightCm: product.shippingParcel
      ? String(product.shippingParcel.heightCm)
      : "",
    shippingParcelWeightGrams: product.shippingParcel
      ? String(product.shippingParcel.weightGrams)
      : "",
    shippingParcelVerified: product.shippingParcel?.verified ?? false,
    shippingParcelRemoved: false,
    status: product.status,
    imageReferences: [...product.imageReferences],
    primaryImageReference: product.primaryImageReference ?? "",
  };
}

function ProductManagement() {
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminApi.getCategories(),
    retry: false,
  });
  const productQuery = useQuery({
    queryKey: ["admin", "products", page, search, categoryId, status],
    queryFn: () =>
      adminApi.getProducts({
        page,
        limit: 20,
        ...(search ? { q: search } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(isProductStatus(status) ? { status } : {}),
      }),
    retry: false,
  });
  const productDetailQuery = useQuery({
    queryKey: ["admin", "product", selectedProductId],
    queryFn: () => adminApi.getProduct(selectedProductId ?? ""),
    enabled: selectedProductId !== null,
    retry: false,
  });
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminApi.createProduct(payload),
    onSuccess: async (product) => {
      setMessage(`Product “${product.name}” saved as ${product.status}.`);
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; payload: Record<string, unknown> }) =>
      adminApi.updateProduct(input.id, input.payload),
    onSuccess: async (product) => {
      setMessage(`Product “${product.name}” updated.`);
      setSelectedProductId(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: (input: { product: AdminProduct; status: ProductStatus }) =>
      adminApi.updateProduct(input.product.id, { status: input.status }),
    onSuccess: async (product) => {
      setMessage(`Product “${product.name}” is now ${product.status}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchText.trim());
  }

  const mutationError = createMutation.error ?? updateMutation.error ?? statusMutation.error;
  const editing = selectedProductId === null ? undefined : productDetailQuery.data;
  const saving = createMutation.isPending || updateMutation.isPending;
  return (
    <div className="admin-management-grid">
      <section className="admin-card admin-wide">
        <div className="admin-section-heading">
          <div>
            <h3>Products</h3>
            <p>Manage product listings and publication status. No stock is changed here.</p>
          </div>
          <Button
            type="button"
            onClick={() => {
              setSelectedProductId(null);
              setCreating((current) => !current);
              setMessage(null);
            }}
          >
            {creating ? "Close new product form" : "Create product"}
          </Button>
        </div>
        {message ? <Feedback>{message}</Feedback> : null}
        {mutationError ? <QueryError error={mutationError} action="Product update" /> : null}
        <form className="admin-filter-form" onSubmit={submitSearch}>
          <label>
            Search products
            <input value={searchText} onChange={(event) => setSearchText(event.currentTarget.value)} />
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(event) => {
              setCategoryId(event.currentTarget.value);
              setPage(1);
            }}>
              <option value="">All categories</option>
              {(categoriesQuery.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => {
              setStatus(event.currentTarget.value);
              setPage(1);
            }}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <Button type="submit">Search</Button>
        </form>
        {productQuery.isPending ? <p role="status">Loading products…</p> : null}
        {productQuery.isError ? (
          <QueryError error={productQuery.error} action="Product list loading" />
        ) : null}
        {productQuery.data?.products.length === 0 ? <p>No products match these filters.</p> : null}
        {productQuery.data?.products.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  <th scope="col">Confirmation</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {productQuery.data.products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <ProductImages product={product} />
                    </td>
                    <td>{product.sku}</td>
                    <td>{product.priceCents === null ? "Unconfirmed" : `R ${formatZar(product.priceCents)}`}</td>
                    <td>{product.status}</td>
                    <td>
                      {product.priceConfirmed === false ? <p>Price needs confirmation</p> : null}
                      {product.priceConfirmed === true ? <p>Price confirmed</p> : null}
                      {product.priceConfirmed === undefined ? <p>Price confirmation status unavailable</p> : null}
                      {product.isMockData === true ? <p>Product details require review</p> : null}
                      {product.isMockData === false ? <p>Product details confirmed</p> : null}
                      {product.isMockData === undefined ? <p>Product detail confirmation unavailable</p> : null}
                      {product.requiresConfirmation?.length ? (
                        <p>{product.requiresConfirmation.map(labelForKey).join(", ")}</p>
                      ) : null}
                      {product.requiresConfirmation?.length === 0
                        ? "No outstanding detail flags returned"
                        : null}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <Button type="button" variant="outline" onClick={() => {
                          setCreating(false);
                          setSelectedProductId(product.id);
                          setMessage(null);
                        }}>
                          Edit
                        </Button>
                        {product.status !== "archived" ? (
                          <>
                            {product.status !== "active" ? (
                              <Button type="button" variant="outline" disabled={statusMutation.isPending}
                                onClick={() => statusMutation.mutate({ product, status: "active" })}>
                                Activate
                              </Button>
                            ) : (
                              <Button type="button" variant="outline" disabled={statusMutation.isPending}
                                onClick={() => statusMutation.mutate({ product, status: "inactive" })}>
                                Deactivate
                              </Button>
                            )}
                            <Button type="button" variant="outline" disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ product, status: "archived" })}>
                              Archive
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {productQuery.data && productQuery.data.pagination.totalPages > 1 ? (
          <nav className="admin-pagination" aria-label="Product pages">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button>
            <span>Page {page} of {productQuery.data.pagination.totalPages} · {productQuery.data.pagination.total} products</span>
            <Button type="button" variant="outline" disabled={page >= productQuery.data.pagination.totalPages} onClick={() => setPage((n) => n + 1)}>Next</Button>
          </nav>
        ) : null}
        {creating ? (
          <ProductEditor
            key="new-product"
            categories={categoriesQuery.data ?? []}
            saving={saving}
            onCancel={() => setCreating(false)}
            onSave={(payload) => createMutation.mutateAsync(payload).then(() => undefined)}
          />
        ) : null}
        {selectedProductId !== null ? (
          <div className="admin-editor">
            <h4>Edit product</h4>
            {productDetailQuery.isPending ? <p role="status">Loading product details…</p> : null}
            {productDetailQuery.isError ? (
              <QueryError error={productDetailQuery.error} action="Product details loading" />
            ) : null}
            {editing ? (
              <ProductEditor
                key={editing.id}
                product={editing}
                categories={categoriesQuery.data ?? []}
                saving={saving}
                onCancel={() => setSelectedProductId(null)}
                onSave={(payload) =>
                  updateMutation.mutateAsync({ id: editing.id, payload }).then(() => undefined)
                }
              />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ProductImages({ product }: { product: AdminProduct }) {
  return (
    <div className="admin-image-strip" aria-label={`Images for ${product.name}`}>
      {product.imageReferences.length ? product.imageReferences.map((image) => (
        <ImagePreview key={image} source={image} alt={`${product.name} product image`} />
      )) : <span className="admin-image-placeholder" aria-label="No image available">No image</span>}
    </div>
  );
}

function ImagePreview({
  source,
  alt,
  className,
}: {
  source: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="admin-image-placeholder">Image unavailable</span>
  ) : (
    <img
      className={className}
      src={source}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ProductEditor({
  product,
  categories,
  saving,
  onCancel,
  onSave,
}: {
  product?: AdminProduct;
  categories: AdminCategory[];
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<ProductFormState>(
    product ? productToForm(product) : emptyProductForm,
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingProductImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{
    kind: "success" | "partial" | "error";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const saveLockRef = useRef(false);
  const uploadLockRef = useRef(false);
  const setField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const hasShippingParcelFormValues = [
    form.shippingParcelLengthCm,
    form.shippingParcelWidthCm,
    form.shippingParcelHeightCm,
    form.shippingParcelWeightGrams,
  ].some((value) => value.trim());

  useEffect(
    () => () => previewUrlsRef.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl)),
    [],
  );

  function chooseImages(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const references = form.imageReferences;
    const issues: string[] = [];
    if (selected.length > 10) issues.push("Select no more than 10 files per upload.");
    if (selected.some((file) => !supportedImageTypes.has(file.type))) {
      issues.push("Use JPEG, PNG, WebP or GIF image files.");
    }
    if (selected.some((file) => file.size > maxImageFileBytes)) {
      issues.push("Each image must be 5 MiB or smaller.");
    }
    if (references.length + pendingImages.length + selected.length > 10) {
      issues.push("A product can have up to 10 image references. Remove an image before adding more.");
    }
    if (issues.length) {
      setUploadFeedback({ kind: "error", message: issues.join(" ") });
    } else {
      setPendingImages((current) => [
        ...current,
        ...selected.map((file) => {
          const previewUrl = URL.createObjectURL(file);
          previewUrlsRef.current.add(previewUrl);
          return { id: crypto.randomUUID(), file, previewUrl };
        }),
      ]);
      setUploadFeedback(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingImage(imageId: string) {
    const removed = pendingImages.find((image) => image.id === imageId);
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrlsRef.current.delete(removed.previewUrl);
    }
    setPendingImages((current) => {
      return current.filter((image) => image.id !== imageId);
    });
  }

  function removeImageReference(reference: string) {
    const nextReferences = form.imageReferences.filter((entry) => entry !== reference);
    setField("imageReferences", nextReferences);
    if (form.primaryImageReference.trim() === reference) {
      setField("primaryImageReference", nextReferences[0] ?? "");
    }
  }

  async function uploadSelectedImages() {
    if (!pendingImages.length || uploadLockRef.current || uploading) return;
    uploadLockRef.current = true;
    setUploading(true);
    setUploadFeedback(null);
    try {
      const uploaded = await adminApi.uploadProductImages(pendingImages.map(({ file }) => file));
      const filenameCounts = new Map<string, number>();
      uploaded.forEach((image) => {
        const filename = image.originalFilename.toLowerCase();
        filenameCounts.set(
          filename,
          (filenameCounts.get(filename) ?? 0) + 1,
        );
      });
      const successfulIds = new Set<string>();
      pendingImages.forEach(({ id, file }) => {
        const filename = file.name.toLowerCase();
        const remaining = filenameCounts.get(filename) ?? 0;
        if (remaining > 0) {
          successfulIds.add(id);
          filenameCounts.set(filename, remaining - 1);
        }
      });
      const successfulImages = pendingImages.filter((image) => successfulIds.has(image.id));
      const failedCount = pendingImages.length - successfulImages.length;
      const failedNames = pendingImages
        .filter((image) => !successfulIds.has(image.id))
        .map((image) => image.file.name);
      const newReferences = uploaded.map((image) => image.url);
      setForm((current) => {
        const references = current.imageReferences;
        const mergedReferences = [...references, ...newReferences.filter((url) => !references.includes(url))];
        return {
          ...current,
          imageReferences: mergedReferences,
          primaryImageReference:
            current.primaryImageReference.trim() || mergedReferences[0] || "",
        };
      });
      setPendingImages((current) => current.filter((image) => !successfulIds.has(image.id)));
      successfulImages.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
        previewUrlsRef.current.delete(image.previewUrl);
      });
      if (failedCount) {
        setUploadFeedback({
          kind: successfulImages.length ? "partial" : "error",
          message: successfulImages.length
            ? `${successfulImages.length} image${successfulImages.length === 1 ? "" : "s"} uploaded. Retry failed file${failedCount === 1 ? "" : "s"}: ${failedNames.join(", ")}.`
            : `No images uploaded. These files remain selected for retry: ${failedNames.join(", ")}.`,
        });
      } else {
        setUploadFeedback({
          kind: "success",
          message: `${successfulImages.length} image${successfulImages.length === 1 ? "" : "s"} uploaded and added to the product. Save the product to persist the references.`,
        });
      }
    } catch (uploadError) {
      setUploadFeedback({
        kind: "error",
        message: safeAdminError(uploadError, "Image upload"),
      });
    } finally {
      uploadLockRef.current = false;
      setUploading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLockRef.current || uploadLockRef.current || saving) return;
    setError(null);
    if (pendingImages.length || uploading) {
      setError("Upload or remove the selected image files before saving the product.");
      return;
    }
    const priceCents = parseZarCents(form.price);
    if (priceCents === undefined) {
      setError("Enter a positive ZAR price with no more than two decimal places.");
      return;
    }
    const salePriceCents = form.salePrice.trim()
      ? parseZarCents(form.salePrice)
      : undefined;
    if (form.salePrice.trim() && (salePriceCents === undefined || salePriceCents >= priceCents)) {
      setError("Sale price must be valid and lower than the regular price.");
      return;
    }
    const costCents = form.cost.trim() ? parseZarCents(form.cost, true) : undefined;
    if (form.cost.trim() && costCents === undefined) {
      setError("Enter a valid non-negative product cost in ZAR.");
      return;
    }
    const imageReferences = form.imageReferences;
    if (imageReferences.length > 10) {
      setError("A product can have up to 10 images.");
      return;
    }
    if (!imageReferences.every(isAllowedProductImageUrl)) {
      setError(
        "One or more image hosts are not approved for display. Configure VITE_PRODUCT_IMAGE_ALLOWED_HOSTS to match the backend image host allowlist.",
      );
      return;
    }
    if (
      form.primaryImageReference &&
      !imageReferences.includes(form.primaryImageReference.trim())
    ) {
      setError("The primary image must be one of the image references.");
      return;
    }
    if (product?.primaryImageReference && imageReferences.length === 0) {
      setError("Choose a replacement primary image before removing all image references.");
      return;
    }
    const lowStockThreshold = form.lowStockThreshold.trim()
      ? Number(form.lowStockThreshold)
      : undefined;
    if (
      form.lowStockThreshold.trim() &&
      (!Number.isSafeInteger(lowStockThreshold) || (lowStockThreshold ?? -1) < 0)
    ) {
      setError("Low-stock threshold must be a non-negative whole number.");
      return;
    }
    const packagingAmount = form.packagingAmount.trim()
      ? Number(form.packagingAmount)
      : undefined;
    if (
      form.packagingAmount.trim() &&
      (!Number.isFinite(packagingAmount) || (packagingAmount ?? 0) <= 0)
    ) {
      setError("Packaging amount must be a positive number.");
      return;
    }
    if (Boolean(form.packagingAmount.trim()) !== Boolean(form.packagingUnit.trim())) {
      setError("Enter both packaging amount and unit, or leave both empty.");
      return;
    }
    const shippingParcelFields = [
      form.shippingParcelLengthCm.trim(),
      form.shippingParcelWidthCm.trim(),
      form.shippingParcelHeightCm.trim(),
      form.shippingParcelWeightGrams.trim(),
    ];
    const hasShippingParcelValues = shippingParcelFields.some(Boolean);
    if (form.shippingParcelVerified && !hasShippingParcelValues) {
      setError("Enter packed parcel measurements before verifying them.");
      return;
    }
    let shippingParcel:
      | {
          lengthCm: number;
          widthCm: number;
          heightCm: number;
          weightGrams: number;
          verified: boolean;
        }
      | undefined;
    if (hasShippingParcelValues) {
      if (shippingParcelFields.some((value) => !value)) {
        setError("Enter length, width, height and packed weight to configure shipping.");
        return;
      }
      const lengthCm = Number(form.shippingParcelLengthCm);
      const widthCm = Number(form.shippingParcelWidthCm);
      const heightCm = Number(form.shippingParcelHeightCm);
      const weightGrams = Number(form.shippingParcelWeightGrams);
      if (
        !Number.isFinite(lengthCm) ||
        lengthCm <= 0 ||
        !Number.isFinite(widthCm) ||
        widthCm <= 0 ||
        !Number.isFinite(heightCm) ||
        heightCm <= 0
      ) {
        setError("Parcel length, width and height must be positive measurements in centimetres.");
        return;
      }
      if (!Number.isSafeInteger(weightGrams) || weightGrams <= 0) {
        setError("Packed weight must be a positive whole number of grams.");
        return;
      }
      shippingParcel = {
        lengthCm,
        widthCm,
        heightCm,
        weightGrams,
        verified: form.shippingParcelVerified,
      };
    }
    const baseline = product ? productToForm(product) : null;
    const payload: Record<string, unknown> = {};
    const putChanged = (key: keyof ProductFormState, apiKey: string, value: unknown) => {
      if (value === undefined || value === "") return;
      const currentValue = form[key];
      const previousValue = baseline?.[key];
      const isEqual =
        Array.isArray(value) && Array.isArray(previousValue)
          ? value.length === previousValue.length &&
            value.every((entry, index) => entry === previousValue[index])
          : currentValue === previousValue;
      if (!baseline || !isEqual) payload[apiKey] = value;
    };

    putChanged("name", "name", form.name.trim());
    putChanged("sku", "sku", form.sku.trim());
    putChanged("slug", "slug", form.slug.trim() || undefined);
    putChanged("description", "description", form.description.trim());
    putChanged("shortDescription", "shortDescription", form.shortDescription.trim() || undefined);
    putChanged("categoryId", "categoryId", form.categoryId);
    putChanged("price", "priceCents", priceCents);
    putChanged("salePrice", "salePriceCents", salePriceCents);
    putChanged("cost", "costCents", costCents);
    putChanged("lowStockThreshold", "lowStockThreshold", lowStockThreshold);
    putChanged("status", "status", form.status);
    putChanged("imageReferences", "imageReferences", imageReferences);
    putChanged(
      "primaryImageReference",
      "primaryImageReference",
      form.primaryImageReference.trim(),
    );
    if (form.packagingAmount !== baseline?.packagingAmount ||
      form.packagingUnit !== baseline?.packagingUnit) {
      if (packagingAmount !== undefined && form.packagingUnit.trim()) {
        payload["packaging"] = { amount: packagingAmount, unit: form.packagingUnit.trim() };
      }
    }
    if (form.shippingParcelRemoved && product?.shippingParcel) {
      payload["shippingParcel"] = null;
    } else if (shippingParcel) {
      const previousParcel = product?.shippingParcel;
      if (
        !previousParcel ||
        previousParcel.lengthCm !== shippingParcel.lengthCm ||
        previousParcel.widthCm !== shippingParcel.widthCm ||
        previousParcel.heightCm !== shippingParcel.heightCm ||
        previousParcel.weightGrams !== shippingParcel.weightGrams ||
        previousParcel.verified !== shippingParcel.verified
      ) {
        payload["shippingParcel"] = shippingParcel;
      }
    }
    if (!product) payload["currency"] = "ZAR";
    if (Object.keys(payload).length === (product ? 0 : 1)) {
      setError("Change at least one product field before saving.");
      return;
    }
    saveLockRef.current = true;
    try {
      await onSave(payload);
    } catch (saveError) {
      setError(safeAdminError(saveError, product ? "Product update" : "Product creation"));
    } finally {
      saveLockRef.current = false;
    }
  }

  return (
    <form className="admin-form admin-editor-form" onSubmit={submit}>
      <div className="admin-editor-heading">
        <h4>{product ? `Edit ${product.name}` : "Create product"}</h4>
        {product ? (
          <p>
            {product.priceConfirmed === false ? "Price confirmation required." : ""}
            {product.requiresConfirmation?.length
              ? ` Details requiring confirmation: ${product.requiresConfirmation.join(", ")}.`
              : ""}
          </p>
        ) : <p>Enter only business-approved product information. New products start as drafts.</p>}
      </div>
      <fieldset className="admin-editor-section">
        <legend>Product details</legend>
        <div className="admin-editor-grid">
        <label>Product name<input required maxLength={160} value={form.name} onChange={(event) => setField("name", event.currentTarget.value)} /></label>
        <label>SKU<input required maxLength={64} value={form.sku} onChange={(event) => setField("sku", event.currentTarget.value)} /></label>
        <label>Slug (optional; backend may derive it from the name)<input maxLength={160} value={form.slug} onChange={(event) => setField("slug", event.currentTarget.value)} /></label>
        <label>Category<select required value={form.categoryId} onChange={(event) => setField("categoryId", event.currentTarget.value)}>
          <option value="">Choose a category</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (inactive)"}</option>)}
        </select></label>
        <label>Status<select value={form.status} onChange={(event) => {
          const value = event.currentTarget.value;
          if (isProductStatus(value)) setField("status", value);
        }}>
          <option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
        </select></label>
        <label>Short description<textarea maxLength={300} rows={2} value={form.shortDescription} onChange={(event) => setField("shortDescription", event.currentTarget.value)} /></label>
        </div>
        <label>Description<textarea required maxLength={5000} rows={5} value={form.description} onChange={(event) => setField("description", event.currentTarget.value)} /></label>
      </fieldset>
      <fieldset className="admin-editor-section">
        <legend>Pricing and packaging</legend>
        <div className="admin-editor-grid">
        <label>Price (ZAR)<input inputMode="decimal" required value={form.price} onChange={(event) => setField("price", event.currentTarget.value)} /></label>
        <label>Sale price (ZAR, optional)<input inputMode="decimal" value={form.salePrice} onChange={(event) => setField("salePrice", event.currentTarget.value)} /></label>
        <label>Cost (ZAR, optional)<input inputMode="decimal" value={form.cost} onChange={(event) => setField("cost", event.currentTarget.value)} /></label>
        <label>Packaging amount<input type="number" min="0.01" step="any" value={form.packagingAmount} onChange={(event) => setField("packagingAmount", event.currentTarget.value)} /></label>
        <label>Packaging unit<input maxLength={40} value={form.packagingUnit} onChange={(event) => setField("packagingUnit", event.currentTarget.value)} /></label>
        </div>
      </fieldset>
      <fieldset className="admin-editor-section">
        <legend>Shipping &amp; Packaging</legend>
        <p className="admin-muted">
          Measure the complete packed unit for this SKU, including its shipping packaging—not just
          the empty bottle. Enter dimensions in centimetres and packed weight in grams. Measurements
          can be saved before they are verified.
        </p>
        <div className="admin-editor-grid">
          <label>
            Length (cm)
            <input
              type="number"
              min="0.01"
              step="any"
              value={form.shippingParcelLengthCm}
              disabled={saving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  shippingParcelLengthCm: value,
                  shippingParcelRemoved: false,
                }));
              }}
            />
          </label>
          <label>
            Width (cm)
            <input
              type="number"
              min="0.01"
              step="any"
              value={form.shippingParcelWidthCm}
              disabled={saving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  shippingParcelWidthCm: value,
                  shippingParcelRemoved: false,
                }));
              }}
            />
          </label>
          <label>
            Height (cm)
            <input
              type="number"
              min="0.01"
              step="any"
              value={form.shippingParcelHeightCm}
              disabled={saving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  shippingParcelHeightCm: value,
                  shippingParcelRemoved: false,
                }));
              }}
            />
          </label>
          <label>
            Packed weight (grams)
            <input
              type="number"
              min="1"
              step="1"
              value={form.shippingParcelWeightGrams}
              disabled={saving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  shippingParcelWeightGrams: value,
                  shippingParcelRemoved: false,
                }));
              }}
            />
          </label>
        </div>
        <label className="admin-checkbox-label">
          <input
            type="checkbox"
            checked={form.shippingParcelVerified}
            disabled={saving}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setForm((current) => ({
                ...current,
                shippingParcelVerified: checked,
                shippingParcelRemoved: false,
              }));
            }}
          />
          Parcel measurements verified
        </label>
        {product?.shippingParcel ? (
          <p className="admin-muted">
            {product.shippingParcel.verified
              ? "Saved parcel measurements are verified."
              : "Saved parcel measurements are not verified."}
          </p>
        ) : null}
        {product?.shippingParcel || hasShippingParcelFormValues ? (
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() =>
              setForm((current) => ({
                ...current,
                shippingParcelLengthCm: "",
                shippingParcelWidthCm: "",
                shippingParcelHeightCm: "",
                shippingParcelWeightGrams: "",
                shippingParcelVerified: false,
                shippingParcelRemoved: true,
              }))
            }
          >
            Remove shipping configuration
          </Button>
        ) : null}
      </fieldset>
      <fieldset className="admin-editor-section">
        <legend>Product Images</legend>
        <p className="admin-muted">
          Select JPEG, PNG, WebP or GIF images up to 5 MiB each. You can choose up to 10 images
          total. Upload selected images, then save the product.
        </p>
        <div className="admin-image-upload">
          <input
            ref={fileInputRef}
            className="admin-image-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            disabled={uploading || saving}
            onChange={(event) => chooseImages(event.currentTarget.files)}
            aria-label="Choose product image files"
            tabIndex={-1}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={uploading || saving || form.imageReferences.length + pendingImages.length >= 10}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose Images
          </Button>
          <p className="admin-muted">
            {form.imageReferences.length} uploaded or saved · {pendingImages.length} selected
          </p>
          {pendingImages.length ? (
            <>
              <div className="admin-upload-preview-grid">
                {pendingImages.map((image) => (
                  <div className="admin-upload-preview" key={image.id}>
                    <img src={image.previewUrl} alt={`Preview of ${image.file.name}`} />
                    <span>{image.file.name}</span>
                    <Button type="button" variant="outline" disabled={uploading} onClick={() => removePendingImage(image.id)}>
                      Remove before upload
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" disabled={uploading || saving} onClick={() => void uploadSelectedImages()}>
                {uploading ? "Uploading images…" : `Upload ${pendingImages.length} selected image${pendingImages.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : null}
          {uploadFeedback ? (
            <p
              className={uploadFeedback.kind === "error" ? "admin-field-error" : "admin-upload-feedback"}
              role={uploadFeedback.kind === "error" ? "alert" : "status"}
            >
              {uploadFeedback.message}
            </p>
          ) : null}
        </div>
        {form.imageReferences.length ? (
          <div className="admin-upload-preview-grid" aria-label="Product image previews">
            {form.imageReferences.map((reference, index) => (
              <div className="admin-upload-preview admin-saved-image" key={reference}>
                {isAllowedProductImageUrl(reference) ? (
                  <img src={reference} alt={`Product image ${index + 1}`} loading="lazy" />
                ) : (
                  <span className="admin-image-placeholder">Image preview unavailable</span>
                )}
                <span>Image {index + 1}{form.primaryImageReference === reference ? " · Primary" : ""}</span>
                <div className="admin-row-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving || uploading || form.primaryImageReference === reference}
                    onClick={() => setField("primaryImageReference", reference)}
                  >
                    Set as primary
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving || uploading}
                    onClick={() => removeImageReference(reference)}
                  >
                    Remove image
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-image-placeholder">No product images selected.</p>
        )}
      </fieldset>
      <fieldset className="admin-editor-section">
        <legend>Inventory settings</legend>
        <p className="admin-muted">Stock quantity is managed separately through auditable inventory adjustments. Product details and price edits never change on-hand stock.</p>
        <label>Low-stock threshold (optional)<input type="number" min="0" step="1" value={form.lowStockThreshold} onChange={(event) => setField("lowStockThreshold", event.currentTarget.value)} /></label>
      </fieldset>
      {error ? <p className="admin-field-error" role="alert">{error}</p> : null}
      <div className="admin-row-actions">
        <Button type="submit" disabled={saving || categories.length === 0}>{saving ? "Saving…" : product ? "Save changes" : "Save product"}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  displayOrder: string;
  imageReference: string;
  isActive: boolean;
}

function categoryToForm(category?: AdminCategory): CategoryFormState {
  return {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    displayOrder: category?.displayOrder === undefined ? "" : String(category.displayOrder),
    imageReference: category?.imageReference ?? "",
    isActive: category?.isActive ?? true,
  };
}

function CategoryManagement() {
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminApi.getCategories(),
    retry: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminApi.createCategory(payload),
    onSuccess: async (category) => {
      setMessage(`Category “${category.name}” created.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; payload: Record<string, unknown> }) =>
      adminApi.updateCategory(input.id, input.payload),
    onSuccess: async (category) => {
      setMessage(`Category “${category.name}” updated.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
  return (
    <div className="admin-management-grid">
      <section className="admin-card">
        <h3>Create category</h3>
        <CategoryEditor
          saving={createMutation.isPending}
          onSave={(payload) => createMutation.mutate(payload)}
        />
        {createMutation.error ? <QueryError error={createMutation.error} action="Category creation" /> : null}
      </section>
      <section className="admin-card">
        <h3>Categories</h3>
        {message ? <Feedback>{message}</Feedback> : null}
        {categoriesQuery.isPending ? <p role="status">Loading categories…</p> : null}
        {categoriesQuery.isError ? <QueryError error={categoriesQuery.error} action="Category list loading" /> : null}
        {!categoriesQuery.isPending && !categoriesQuery.data?.length ? <p>No categories returned.</p> : null}
        <div className="admin-category-list">
          {(categoriesQuery.data ?? []).map((category) => (
            <details className="admin-category-item" key={category.id}>
              <summary>{category.name} · {category.isActive ? "Active" : "Inactive"}</summary>
              {category.imageReference ? (
                <ImagePreview
                  className="admin-category-image"
                  source={category.imageReference}
                  alt={`${category.name} category`}
                />
              ) : <span className="admin-image-placeholder">No category image</span>}
              <CategoryEditor
                key={category.id}
                category={category}
                saving={updateMutation.isPending}
                onSave={(payload) => updateMutation.mutate({ id: category.id, payload })}
              />
            </details>
          ))}
        </div>
        {updateMutation.error ? <QueryError error={updateMutation.error} action="Category update" /> : null}
        <p className="admin-muted">Categories cannot be deleted because the backend has no delete endpoint.</p>
      </section>
    </div>
  );
}

function CategoryEditor({
  category,
  saving,
  onSave,
}: {
  category?: AdminCategory;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState(() => categoryToForm(category));
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let displayOrder: number | undefined;
    if (form.displayOrder.trim()) {
      displayOrder = Number(form.displayOrder);
      if (!Number.isSafeInteger(displayOrder)) {
        setError("Display order must be a whole number.");
        return;
      }
    }
    if (form.imageReference.trim() && !isAllowedProductImageUrl(form.imageReference.trim())) {
      setError("Category image references must be approved HTTPS URLs.");
      return;
    }
    const baseline = categoryToForm(category);
    const payload: Record<string, unknown> = {};
    const setChanged = (key: keyof CategoryFormState, apiKey: string, value: unknown) => {
      if (value === undefined || value === "") return;
      if (!category || form[key] !== baseline[key]) payload[apiKey] = value;
    };
    setChanged("name", "name", form.name.trim());
    setChanged("slug", "slug", form.slug.trim() || undefined);
    setChanged("description", "description", form.description.trim() || undefined);
    setChanged("displayOrder", "displayOrder", displayOrder);
    setChanged("imageReference", "imageReference", form.imageReference.trim() || undefined);
    setChanged("isActive", "isActive", form.isActive);
    if (Object.keys(payload).length === 0) {
      setError("Change at least one category field before saving.");
      return;
    }
    onSave(payload);
  }
  return (
    <form className="admin-form" onSubmit={submit}>
      <label>Name<input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label>
      <label>Slug<input required maxLength={120} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.currentTarget.value })} /></label>
      <label>Description<textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></label>
      <label>Display order<input type="number" step="1" value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: event.currentTarget.value })} /></label>
      <label>Category image reference<input value={form.imageReference} onChange={(event) => setForm({ ...form, imageReference: event.currentTarget.value })} /></label>
      {form.imageReference && isAllowedProductImageUrl(form.imageReference) ? (
        <ImagePreview
          className="admin-category-image"
          source={form.imageReference}
          alt="Category image preview"
        />
      ) : form.imageReference ? <span className="admin-image-placeholder">Image preview unavailable</span> : null}
      <label className="admin-checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.currentTarget.checked })} />Active</label>
      {error ? <p className="admin-field-error" role="alert">{error}</p> : null}
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : category ? "Save category changes" : "Create category"}</Button>
    </form>
  );
}

function InventoryManagement() {
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [lowStockBelow, setLowStockBelow] = useState("");
  const [historyProductId, setHistoryProductId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const inventoryQueryKey = ["admin", "inventory", page, search, categoryId, status, lowStockBelow] as const;
  const adjustmentLockRef = useRef(false);
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminApi.getCategories(),
    retry: false,
  });
  const inventoryQuery = useQuery({
    queryKey: inventoryQueryKey,
    queryFn: () => adminApi.getInventory({
      page,
      limit: 20,
      ...(search ? { q: search } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(isProductStatus(status) ? { status } : {}),
      ...(lowStockBelow.trim() ? { lowStockBelow: Number(lowStockBelow) } : {}),
      sortBy: "stockQuantity",
      sortOrder: "asc",
    }),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["admin", "adjustments", historyProductId],
    queryFn: () => historyProductId
      ? adminApi.getProductInventoryAdjustments(historyProductId, { limit: 20 })
      : adminApi.getInventoryAdjustments({ limit: 20 }),
    retry: false,
  });
  const inventoryOverviewQuery = useQuery({
    queryKey: ["admin", "analytics", "inventory", "inventory-page"],
    queryFn: () => adminApi.getAnalytics("inventory", { limit: 20 }),
    retry: false,
  });
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const adjustmentMutation = useMutation({
    mutationFn: (input: {
      productId: string;
      quantityDelta: number;
      reason: string;
      key: string;
    }) => adminApi.adjustInventory(
      input.productId,
      { quantityDelta: input.quantityDelta, reason: input.reason },
      input.key,
    ),
    onSuccess: async (result) => {
      queryClient.setQueryData<InventoryList>(inventoryQueryKey, (current) =>
        current
          ? {
              ...current,
              inventory: current.inventory.map((item) =>
                item.productId === result.adjustment.productId
                  ? {
                      ...item,
                      stockQuantity: result.adjustment.resultingQuantity,
                      updatedAt: result.adjustment.createdAt,
                    }
                  : item,
              ),
            }
          : current,
      );
      setMessage(
        `Inventory updated. New stock: ${result.adjustment.resultingQuantity} units${result.replayed ? " (the original adjustment was replayed safely)" : ""}.`,
      );
      setQuantityDelta("");
      setReason("");
      idempotencyRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ["admin", "inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "adjustments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "overview"] });
    },
    onError: (error) => setAdjustmentError(error),
    onSettled: () => {
      adjustmentLockRef.current = false;
    },
  });

  function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchText.trim());
  }
  function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adjustmentLockRef.current || adjustmentMutation.isPending) return;
    setAdjustmentError(null);
    const delta = Number(quantityDelta);
    if (!productId || !Number.isSafeInteger(delta) || delta === 0 || reason.trim().length < 3) {
      setAdjustmentError(new Error("Select a product, enter a non-zero whole quantity and give a reason of at least 3 characters."));
      return;
    }
    const selectedItem = inventoryQuery.data?.inventory.find((item) => item.productId === productId);
    if (delta < 0 && selectedItem && selectedItem.stockQuantity + delta < 0) {
      setAdjustmentError(
        new Error(`Only ${selectedItem.stockQuantity} units are currently recorded; the adjustment cannot reduce stock below zero.`),
      );
      return;
    }
    const normalizedReason = reason.trim();
    const fingerprint = JSON.stringify([productId, delta, normalizedReason]);
    if (idempotencyRef.current?.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    adjustmentLockRef.current = true;
    adjustmentMutation.mutate({
      productId,
      quantityDelta: delta,
      reason: normalizedReason,
      key: idempotencyRef.current.key,
    });
  }

  return (
    <div className="admin-management-grid">
      <section className="admin-card admin-wide">
        <h3>Inventory</h3>
        <p>Stock changes are recorded as auditable adjustments. Product forms never change stock.</p>
        <form className="admin-filter-form" onSubmit={submitFilter}>
          <label>Search name or SKU<input value={searchText} onChange={(event) => setSearchText(event.currentTarget.value)} /></label>
          <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.currentTarget.value); setPage(1); }}>
            <option value="">All categories</option>
            {(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <label>Status<select value={status} onChange={(event) => { setStatus(event.currentTarget.value); setPage(1); }}>
            <option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
          </select></label>
          <label>Flag stock below<input type="number" min="0" step="1" value={lowStockBelow} onChange={(event) => { setLowStockBelow(event.currentTarget.value); setPage(1); }} /></label>
          <Button type="submit">Apply filters</Button>
        </form>
        {inventoryQuery.isPending ? <p role="status">Loading stock…</p> : null}
        {inventoryQuery.isError ? <QueryError error={inventoryQuery.error} action="Inventory loading" /> : null}
        {inventoryQuery.data?.inventory.length === 0 ? <p>No inventory items match the selected filters.</p> : null}
        {inventoryQuery.data?.inventory.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col">History</th></tr></thead>
              <tbody>{inventoryQuery.data.inventory.map((item) => (
                <tr key={item.productId} className={item.stockQuantity === 0 ? "admin-out-of-stock" : ""}>
                  <td>{item.name}</td><td>{item.sku}</td>
                  <td>{item.stockQuantity === 0 ? "Out of stock" : item.stockQuantity}</td>
                  <td>{item.status}</td><td>{new Date(item.updatedAt).toLocaleString()}</td>
                  <td><Button type="button" variant="outline" onClick={() => setHistoryProductId(item.productId)}>View movements</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        {inventoryQuery.data && inventoryQuery.data.pagination.totalPages > 1 ? (
          <nav className="admin-pagination" aria-label="Inventory pages">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button>
            <span>Page {page} of {inventoryQuery.data.pagination.totalPages} · {inventoryQuery.data.pagination.total} products</span>
            <Button type="button" variant="outline" disabled={page >= inventoryQuery.data.pagination.totalPages} onClick={() => setPage((n) => n + 1)}>Next</Button>
          </nav>
        ) : null}
        <form className="admin-form admin-inventory-adjustment" onSubmit={submitAdjustment}>
          <h4>Adjust stock</h4>
          <label>Product<select required value={productId} onChange={(event) => setProductId(event.currentTarget.value)}>
            <option value="">Choose from the current filtered stock page</option>
            {(inventoryQuery.data?.inventory ?? []).map((item) => <option key={item.productId} value={item.productId}>{item.name} · {item.stockQuantity} units · {item.sku}</option>)}
          </select></label>
          <label>Quantity change (positive adds, negative removes)<input type="number" step="1" required value={quantityDelta} onChange={(event) => setQuantityDelta(event.currentTarget.value)} /></label>
          <label>Reason (3–200 characters)<textarea required minLength={3} maxLength={200} rows={2} value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></label>
          <Button type="submit" disabled={adjustmentMutation.isPending || !productId || !quantityDelta || reason.trim().length < 3}>
            {adjustmentMutation.isPending ? "Recording…" : "Record stock adjustment"}
          </Button>
        </form>
        {message ? <Feedback>{message}</Feedback> : null}
        {adjustmentError ? <QueryError error={adjustmentError} action="Inventory adjustment" /> : null}
      </section>
      <section className="admin-card admin-wide">
        <div className="admin-section-heading">
          <div><h3>Inventory movement history</h3><p>Recent movement data returned by the backend.</p></div>
          {historyProductId ? <Button type="button" variant="outline" onClick={() => setHistoryProductId("")}>Show all products</Button> : null}
        </div>
        {historyQuery.isPending ? <p role="status">Loading movement history…</p> : null}
        {historyQuery.isError ? <QueryError error={historyQuery.error} action="Movement history loading" /> : null}
        {historyQuery.data !== undefined ? <DataValue value={historyQuery.data} /> : null}
      </section>
      <section className="admin-card admin-wide">
        <h3>Configured low-stock and out-of-stock lists</h3>
        {inventoryOverviewQuery.isPending ? <p role="status">Loading stock warnings…</p> : null}
        {inventoryOverviewQuery.isError ? <QueryError error={inventoryOverviewQuery.error} action="Stock warnings loading" /> : null}
        {inventoryOverviewQuery.data !== undefined ? <DataValue value={inventoryOverviewQuery.data} /> : null}
      </section>
    </div>
  );
}

interface AnalyticsRange {
  start?: string;
  end?: string;
  groupBy: "day" | "week" | "month";
}

function dateToUtcBoundary(value: string, endExclusive: boolean): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function AnalyticsReports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [groupBy, setGroupBy] = useState<AnalyticsRange["groupBy"]>("day");
  const [range, setRange] = useState<AnalyticsRange>({ groupBy: "day" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const options = useMemo(() => ({
    ...(range.start && range.end ? { start: range.start, end: range.end } : {}),
    groupBy: range.groupBy,
    limit: 20,
  }), [range]);
  const reports = [
    { id: "overview", title: "Overview" },
    { id: "sales", title: "Sales availability" },
    { id: "products", title: "Products" },
    { id: "inventory", title: "Inventory" },
    { id: "categories", title: "Categories" },
  ] as const;
  return (
    <div className="admin-management-grid">
      <section className="admin-card admin-wide">
        <h3>Analytics reports</h3>
        <p>
          A date range is optional; without one the backend returns its documented default range.
          Dates are sent as UTC ISO timestamps with an explicit timezone.
        </p>
        <form className="admin-filter-form" onSubmit={(event) => {
          event.preventDefault();
          setRangeError(null);
          if (Boolean(startDate) !== Boolean(endDate)) {
            setRangeError("Choose both a start and end date, or leave both empty.");
            return;
          }
          if (startDate && endDate) {
            if (startDate > endDate) {
              setRangeError("The start date must not be after the end date.");
              return;
            }
            const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
            if (days > 365) {
              setRangeError("The selected range cannot exceed 366 calendar days.");
              return;
            }
          }
          setRange({
            ...(startDate ? { start: dateToUtcBoundary(startDate, false) } : {}),
            ...(endDate ? { end: dateToUtcBoundary(endDate, true) } : {}),
            groupBy,
          });
        }}>
          <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} /></label>
          <label>End date (inclusive)<input type="date" value={endDate} onChange={(event) => setEndDate(event.currentTarget.value)} /></label>
          <label>Group by<select value={groupBy} onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "day" || value === "week" || value === "month") setGroupBy(value);
          }}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
          <Button type="submit">Load reports</Button>
        </form>
        {rangeError ? <p className="admin-field-error" role="alert">{rangeError}</p> : null}
      </section>
      {reports.map((report) => (
        <AnalyticsReportCard key={report.id} report={report.id} title={report.title} options={options} />
      ))}
      <section className="admin-card admin-wide">
        <h3>Metrics not yet tracked</h3>
        <p>
          Revenue, refunds, gross profit, sales velocity and conversion are not estimated or
          displayed as zero. The backend lacks verified payment/refund records and traffic events.
          See each response's sales-unavailable reason and null or empty values.
        </p>
      </section>
    </div>
  );
}

function AnalyticsReportCard({
  report,
  title,
  options,
}: {
  report: "overview" | "sales" | "products" | "inventory" | "categories";
  title: string;
  options: Parameters<typeof adminApi.getAnalytics>[1];
}) {
  const query = useQuery({
    queryKey: ["admin", "analytics", report, options],
    queryFn: () => adminApi.getAnalytics(report, options),
    retry: false,
  });
  return (
    <section className="admin-card admin-wide" aria-labelledby={`analytics-${report}`}>
      <h3 id={`analytics-${report}`}>{title}</h3>
      {query.isPending ? <p role="status">Loading {title.toLowerCase()} report…</p> : null}
      {query.isError ? <QueryError error={query.error} action={`${title} report loading`} /> : null}
      {query.data !== undefined ? <DataValue value={query.data} /> : null}
    </section>
  );
}
