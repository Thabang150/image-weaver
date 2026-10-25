import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";

export interface AdminInventoryItem {
  productId: string;
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  status: "draft" | "active" | "inactive" | "archived";
  stockQuantity: number;
  updatedAt: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  displayOrder?: number;
  isActive: boolean;
  imageReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  categoryId: string;
  shortDescription?: string;
  priceCents: number | null;
  salePriceCents?: number;
  costCents?: number;
  priceConfirmed?: boolean;
  primaryImageReference?: string;
  packaging?: { amount: number; unit: string };
  lowStockThreshold?: number;
  status: "draft" | "active" | "inactive" | "archived";
  imageReferences: string[];
  isMockData?: boolean;
  requiresConfirmation?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductList {
  products: AdminProduct[];
  pagination: InventoryList["pagination"];
}

export interface InventoryList {
  inventory: AdminInventoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InventoryAdjustmentResult {
  adjustment: {
    id: string;
    productId: string;
    quantityDelta: number;
    resultingQuantity: number;
    reason: string;
    adjustedBy: string;
    movementType: "manual" | "order-reservation" | "order-release";
    referenceOrderId?: string;
    createdAt: string;
  };
  replayed: boolean;
}

export type AdminApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isAdminStatus(value: unknown): value is AdminInventoryItem["status"] {
  return (
    value === "draft" ||
    value === "active" ||
    value === "inactive" ||
    value === "archived"
  );
}

function isInventoryMovementType(
  value: unknown,
): value is InventoryAdjustmentResult["adjustment"]["movementType"] {
  return value === "manual" || value === "order-reservation" || value === "order-release";
}

function invalidAdminResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid administrator response.");
}

function parseCategories(value: unknown): AdminCategory[] {
  if (!isRecord(value) || !Array.isArray(value["categories"])) return invalidAdminResponse();
  return value["categories"].map((category): AdminCategory => {
    if (
      !isRecord(category) ||
      typeof category["id"] !== "string" ||
      typeof category["name"] !== "string" ||
      typeof category["slug"] !== "string" ||
      typeof category["isActive"] !== "boolean" ||
      typeof category["createdAt"] !== "string" ||
      typeof category["updatedAt"] !== "string" ||
      (category["description"] !== undefined && typeof category["description"] !== "string") ||
      (category["displayOrder"] !== undefined && !isSafeInteger(category["displayOrder"])) ||
      (category["imageReference"] !== undefined &&
        typeof category["imageReference"] !== "string")
    ) {
      invalidAdminResponse();
    }
    return {
      id: category["id"],
      name: category["name"],
      slug: category["slug"],
      isActive: category["isActive"],
      createdAt: category["createdAt"],
      updatedAt: category["updatedAt"],
      ...(typeof category["description"] === "string"
        ? { description: category["description"] }
        : {}),
      ...(isSafeInteger(category["displayOrder"])
        ? { displayOrder: category["displayOrder"] }
        : {}),
      ...(typeof category["imageReference"] === "string"
        ? { imageReference: category["imageReference"] }
        : {}),
    };
  });
}

function parseInventory(value: unknown): InventoryList {
  if (!isRecord(value) || !Array.isArray(value["inventory"]) || !isRecord(value["pagination"])) {
    return invalidAdminResponse();
  }
  const pagination = value["pagination"];
  if (
    !isSafeInteger(pagination["page"]) ||
    !isSafeInteger(pagination["limit"]) ||
    !isSafeInteger(pagination["total"]) ||
    !isSafeInteger(pagination["totalPages"])
  ) {
    return invalidAdminResponse();
  }
  const inventory = value["inventory"].map((entry): AdminInventoryItem => {
    if (
      !isRecord(entry) ||
      typeof entry["productId"] !== "string" ||
      typeof entry["name"] !== "string" ||
      typeof entry["slug"] !== "string" ||
      typeof entry["sku"] !== "string" ||
      typeof entry["categoryId"] !== "string" ||
      !isAdminStatus(entry["status"]) ||
      !isSafeInteger(entry["stockQuantity"]) ||
      entry["stockQuantity"] < 0 ||
      typeof entry["updatedAt"] !== "string"
    ) {
      invalidAdminResponse();
    }
    return {
      productId: entry["productId"],
      name: entry["name"],
      slug: entry["slug"],
      sku: entry["sku"],
      categoryId: entry["categoryId"],
      status: entry["status"],
      stockQuantity: entry["stockQuantity"],
      updatedAt: entry["updatedAt"],
    };
  });
  return {
    inventory,
    pagination: {
      page: pagination["page"],
      limit: pagination["limit"],
      total: pagination["total"],
      totalPages: pagination["totalPages"],
    },
  };
}

function parseAdminProduct(value: unknown): AdminProduct {
  if (!isRecord(value) || !isRecord(value["product"])) return invalidAdminResponse();
  const product = value["product"];
  if (
    typeof product["id"] !== "string" ||
    typeof product["name"] !== "string" ||
    typeof product["slug"] !== "string" ||
    typeof product["sku"] !== "string" ||
    typeof product["description"] !== "string" ||
    typeof product["categoryId"] !== "string" ||
    (product["priceCents"] !== null &&
      (!isSafeInteger(product["priceCents"]) || product["priceCents"] <= 0)) ||
    !isAdminStatus(product["status"]) ||
    !Array.isArray(product["imageReferences"]) ||
    !product["imageReferences"].every((entry) => typeof entry === "string") ||
    (product["shortDescription"] !== undefined &&
      typeof product["shortDescription"] !== "string") ||
    (product["salePriceCents"] !== undefined &&
      (!isSafeInteger(product["salePriceCents"]) || product["salePriceCents"] <= 0)) ||
    (product["costCents"] !== undefined &&
      (!isSafeInteger(product["costCents"]) || product["costCents"] < 0)) ||
    (product["priceConfirmed"] !== undefined &&
      typeof product["priceConfirmed"] !== "boolean") ||
    (product["primaryImageReference"] !== undefined &&
      typeof product["primaryImageReference"] !== "string") ||
    (product["lowStockThreshold"] !== undefined &&
      (!isSafeInteger(product["lowStockThreshold"]) || product["lowStockThreshold"] < 0)) ||
    (product["packaging"] !== undefined &&
      (!isRecord(product["packaging"]) ||
        typeof product["packaging"]["amount"] !== "number" ||
        !Number.isFinite(product["packaging"]["amount"]) ||
        product["packaging"]["amount"] <= 0 ||
        typeof product["packaging"]["unit"] !== "string")) ||
    (product["isMockData"] !== undefined && typeof product["isMockData"] !== "boolean") ||
    (product["requiresConfirmation"] !== undefined &&
      (!Array.isArray(product["requiresConfirmation"]) ||
        !product["requiresConfirmation"].every((entry) => typeof entry === "string"))) ||
    typeof product["createdAt"] !== "string" ||
    typeof product["updatedAt"] !== "string"
  ) {
    return invalidAdminResponse();
  }
  return {
    id: product["id"],
    name: product["name"],
    slug: product["slug"],
    sku: product["sku"],
    description: product["description"],
    categoryId: product["categoryId"],
    priceCents: typeof product["priceCents"] === "number" ? product["priceCents"] : null,
    status: product["status"],
    imageReferences: product["imageReferences"],
    ...(typeof product["shortDescription"] === "string"
      ? { shortDescription: product["shortDescription"] }
      : {}),
    ...(isSafeInteger(product["salePriceCents"])
      ? { salePriceCents: product["salePriceCents"] }
      : {}),
    ...(isSafeInteger(product["costCents"]) ? { costCents: product["costCents"] } : {}),
    ...(typeof product["priceConfirmed"] === "boolean"
      ? { priceConfirmed: product["priceConfirmed"] }
      : {}),
    ...(typeof product["primaryImageReference"] === "string"
      ? { primaryImageReference: product["primaryImageReference"] }
      : {}),
    ...(isRecord(product["packaging"])
      ? {
          packaging: {
            amount: Number(product["packaging"]["amount"]),
            unit: String(product["packaging"]["unit"]),
          },
        }
      : {}),
    ...(isSafeInteger(product["lowStockThreshold"])
      ? { lowStockThreshold: product["lowStockThreshold"] }
      : {}),
    ...(typeof product["isMockData"] === "boolean"
      ? { isMockData: product["isMockData"] }
      : {}),
    ...(Array.isArray(product["requiresConfirmation"])
      ? {
          requiresConfirmation: product["requiresConfirmation"].filter(
            (entry): entry is string => typeof entry === "string",
          ),
        }
      : {}),
    createdAt: product["createdAt"],
    updatedAt: product["updatedAt"],
  };
}

function parsePagination(value: unknown): InventoryList["pagination"] {
  if (
    !isRecord(value) ||
    !isSafeInteger(value["page"]) ||
    !isSafeInteger(value["limit"]) ||
    !isSafeInteger(value["total"]) ||
    !isSafeInteger(value["totalPages"])
  ) {
    return invalidAdminResponse();
  }
  return {
    page: value["page"],
    limit: value["limit"],
    total: value["total"],
    totalPages: value["totalPages"],
  };
}

function parseProducts(value: unknown): AdminProductList {
  if (!isRecord(value) || !Array.isArray(value["products"])) return invalidAdminResponse();
  return {
    products: value["products"].map((product) => parseAdminProduct({ product })),
    pagination: parsePagination(value["pagination"]),
  };
}

function buildQuery(options: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

function parseInventoryAdjustment(value: unknown): InventoryAdjustmentResult {
  if (!isRecord(value) || !isRecord(value["adjustment"])) return invalidAdminResponse();
  const adjustment = value["adjustment"];
  if (
    typeof adjustment["id"] !== "string" ||
    typeof adjustment["productId"] !== "string" ||
    !isSafeInteger(adjustment["quantityDelta"]) ||
    adjustment["quantityDelta"] === 0 ||
    !isSafeInteger(adjustment["resultingQuantity"]) ||
    adjustment["resultingQuantity"] < 0 ||
    typeof adjustment["reason"] !== "string" ||
    typeof adjustment["adjustedBy"] !== "string" ||
    !isInventoryMovementType(adjustment["movementType"]) ||
    (adjustment["referenceOrderId"] !== undefined &&
      typeof adjustment["referenceOrderId"] !== "string") ||
    typeof adjustment["createdAt"] !== "string" ||
    typeof value["replayed"] !== "boolean"
  ) {
    return invalidAdminResponse();
  }
  return {
    adjustment: {
      id: adjustment["id"],
      productId: adjustment["productId"],
      quantityDelta: adjustment["quantityDelta"],
      resultingQuantity: adjustment["resultingQuantity"],
      reason: adjustment["reason"],
      adjustedBy: adjustment["adjustedBy"],
      movementType: adjustment["movementType"],
      ...(typeof adjustment["referenceOrderId"] === "string"
        ? { referenceOrderId: adjustment["referenceOrderId"] }
        : {}),
      createdAt: adjustment["createdAt"],
    },
    replayed: value["replayed"],
  };
}

export function createAdminApi(client: AdminApiClient) {
  return {
    async getCategories() {
      return parseCategories(await client.request<unknown>("/admin/categories"));
    },
    async getProducts(options: {
      page: number;
      limit?: number;
      q?: string;
      categoryId?: string;
      status?: AdminProduct["status"];
    }) {
      return parseProducts(
        await client.request<unknown>(
          `/admin/products${buildQuery({
            page: options.page,
            limit: options.limit ?? 20,
            q: options.q,
            categoryId: options.categoryId,
            status: options.status,
          })}`,
        ),
      );
    },
    async getProduct(productId: string) {
      return parseAdminProduct(
        await client.request<unknown>(`/admin/products/${encodeURIComponent(productId)}`),
      );
    },
    async getInventory(options: {
      page: number;
      limit?: number;
      q?: string;
      categoryId?: string;
      status?: AdminInventoryItem["status"];
      lowStockBelow?: number;
      sortBy?: "updatedAt" | "name" | "stockQuantity";
      sortOrder?: "asc" | "desc";
    }) {
      return parseInventory(
        await client.request<unknown>(
          `/admin/inventory${buildQuery({
            page: options.page,
            limit: options.limit ?? 20,
            q: options.q,
            categoryId: options.categoryId,
            status: options.status,
            lowStockBelow: options.lowStockBelow,
            sortBy: options.sortBy ?? "updatedAt",
            sortOrder: options.sortOrder ?? "desc",
          })}`,
        ),
      );
    },
    async getInventoryAdjustments(options: { page?: number; limit?: number } = {}) {
      return client.request<unknown>(
        `/admin/inventory/adjustments${buildQuery({
          page: options.page ?? 1,
          limit: options.limit ?? 20,
        })}`,
      );
    },
    async getProductInventoryAdjustments(
      productId: string,
      options: { page?: number; limit?: number } = {},
    ) {
      return client.request<unknown>(
        `/admin/products/${encodeURIComponent(productId)}/inventory-adjustments${buildQuery({
          page: options.page ?? 1,
          limit: options.limit ?? 20,
        })}`,
      );
    },
    async getAnalytics(
      report: "overview" | "sales" | "products" | "inventory" | "categories",
      options: {
        start?: string;
        end?: string;
        groupBy?: "day" | "week" | "month";
        page?: number;
        limit?: number;
        q?: string;
        categoryId?: string;
        status?: AdminProduct["status"];
      } = {},
    ) {
      return client.request<unknown>(
        `/admin/analytics/${report}${buildQuery({
          start: options.start,
          end: options.end,
          groupBy: options.groupBy,
          page: options.page,
          limit: options.limit,
          q: options.q,
          categoryId: options.categoryId,
          status: options.status,
        })}`,
      );
    },
    async createProduct(payload: Record<string, unknown>) {
      return parseAdminProduct(
        await client.request<unknown>("/admin/products", { method: "POST", json: payload }),
      );
    },
    async updateProduct(productId: string, payload: Record<string, unknown>) {
      return parseAdminProduct(
        await client.request<unknown>(`/admin/products/${encodeURIComponent(productId)}`, {
          method: "PATCH",
          json: payload,
        }),
      );
    },
    async createCategory(payload: Record<string, unknown>) {
      const response = await client.request<unknown>("/admin/categories", {
        method: "POST",
        json: payload,
      });
      if (!isRecord(response) || !isRecord(response["category"])) return invalidAdminResponse();
      const category = parseCategories({ categories: [response["category"]] })[0];
      if (!category) return invalidAdminResponse();
      return category;
    },
    async updateCategory(categoryId: string, payload: Record<string, unknown>) {
      const response = await client.request<unknown>(
        `/admin/categories/${encodeURIComponent(categoryId)}`,
        { method: "PATCH", json: payload },
      );
      if (!isRecord(response) || !isRecord(response["category"])) return invalidAdminResponse();
      const category = parseCategories({ categories: [response["category"]] })[0];
      if (!category) return invalidAdminResponse();
      return category;
    },
    async adjustInventory(
      productId: string,
      payload: { quantityDelta: number; reason: string },
      idempotencyKey = crypto.randomUUID(),
    ) {
      return parseInventoryAdjustment(
        await client.request<unknown>(
          `/admin/products/${encodeURIComponent(productId)}/inventory-adjustments`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            json: payload,
          },
        ),
      );
    },
  };
}

let configuredAdminApi: ReturnType<typeof createAdminApi> | undefined;

function getConfiguredAdminApi() {
  configuredAdminApi ??= createAdminApi(createConfiguredApiClient());
  return configuredAdminApi;
}

export const adminApi = {
  getCategories: () => getConfiguredAdminApi().getCategories(),
  getProducts: (options: Parameters<ReturnType<typeof createAdminApi>["getProducts"]>[0]) =>
    getConfiguredAdminApi().getProducts(options),
  getProduct: (productId: string) => getConfiguredAdminApi().getProduct(productId),
  getInventory: (options: Parameters<ReturnType<typeof createAdminApi>["getInventory"]>[0]) =>
    getConfiguredAdminApi().getInventory(options),
  getInventoryAdjustments: (
    options?: Parameters<ReturnType<typeof createAdminApi>["getInventoryAdjustments"]>[0],
  ) => getConfiguredAdminApi().getInventoryAdjustments(options),
  getProductInventoryAdjustments: (
    productId: string,
    options?: Parameters<ReturnType<typeof createAdminApi>["getProductInventoryAdjustments"]>[1],
  ) => getConfiguredAdminApi().getProductInventoryAdjustments(productId, options),
  getAnalytics: (
    report: Parameters<ReturnType<typeof createAdminApi>["getAnalytics"]>[0],
    options?: Parameters<ReturnType<typeof createAdminApi>["getAnalytics"]>[1],
  ) => getConfiguredAdminApi().getAnalytics(report, options),
  createProduct: (payload: Record<string, unknown>) =>
    getConfiguredAdminApi().createProduct(payload),
  updateProduct: (productId: string, payload: Record<string, unknown>) =>
    getConfiguredAdminApi().updateProduct(productId, payload),
  createCategory: (payload: Record<string, unknown>) =>
    getConfiguredAdminApi().createCategory(payload),
  updateCategory: (categoryId: string, payload: Record<string, unknown>) =>
    getConfiguredAdminApi().updateCategory(categoryId, payload),
  adjustInventory: (
    productId: string,
    payload: { quantityDelta: number; reason: string },
    idempotencyKey?: string,
  ) => getConfiguredAdminApi().adjustInventory(productId, payload, idempotencyKey),
};
