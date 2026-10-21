import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";
import type { PublicCategory } from "./catalogue";

export interface AdminInventoryItem {
  productId: string;
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  status: "draft" | "active" | "inactive";
  stockQuantity: number;
  updatedAt: string;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  categoryId: string;
  priceCents: number;
  status: "draft" | "active" | "inactive";
  imageReferences: string[];
  isMockData: boolean;
  requiresConfirmation: string[];
  createdAt: string;
  updatedAt: string;
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
  return value === "draft" || value === "active" || value === "inactive";
}

function isInventoryMovementType(
  value: unknown,
): value is InventoryAdjustmentResult["adjustment"]["movementType"] {
  return value === "manual" || value === "order-reservation" || value === "order-release";
}

function invalidAdminResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid administrator response.");
}

function parseCategories(value: unknown): PublicCategory[] {
  if (!isRecord(value) || !Array.isArray(value["categories"])) return invalidAdminResponse();
  return value["categories"].map((category): PublicCategory => {
    if (
      !isRecord(category) ||
      typeof category["id"] !== "string" ||
      typeof category["name"] !== "string" ||
      typeof category["slug"] !== "string" ||
      typeof category["isActive"] !== "boolean" ||
      typeof category["createdAt"] !== "string" ||
      typeof category["updatedAt"] !== "string" ||
      (category["description"] !== undefined && typeof category["description"] !== "string")
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
    !isSafeInteger(product["priceCents"]) ||
    product["priceCents"] <= 0 ||
    !isAdminStatus(product["status"]) ||
    !Array.isArray(product["imageReferences"]) ||
    !product["imageReferences"].every((entry) => typeof entry === "string") ||
    typeof product["isMockData"] !== "boolean" ||
    !Array.isArray(product["requiresConfirmation"]) ||
    !product["requiresConfirmation"].every((entry) => typeof entry === "string") ||
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
    priceCents: product["priceCents"],
    status: product["status"],
    imageReferences: product["imageReferences"],
    isMockData: product["isMockData"],
    requiresConfirmation: product["requiresConfirmation"],
    createdAt: product["createdAt"],
    updatedAt: product["updatedAt"],
  };
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
    async getInventory(options: {
      page: number;
      q?: string;
      categoryId?: string;
      status?: AdminInventoryItem["status"];
      sortBy?: "updatedAt" | "name" | "stockQuantity";
      sortOrder?: "asc" | "desc";
    }) {
      const query = new URLSearchParams({
        page: String(options.page),
        limit: "20",
        sortBy: options.sortBy ?? "updatedAt",
        sortOrder: options.sortOrder ?? "desc",
      });
      if (options.q) query.set("q", options.q);
      if (options.categoryId) query.set("categoryId", options.categoryId);
      if (options.status) query.set("status", options.status);
      return parseInventory(await client.request<unknown>(`/admin/inventory?${query.toString()}`));
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
    async adjustInventory(productId: string, payload: { quantityDelta: number; reason: string }) {
      return parseInventoryAdjustment(
        await client.request<unknown>(
          `/admin/products/${encodeURIComponent(productId)}/inventory-adjustments`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
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
  getInventory: (options: Parameters<ReturnType<typeof createAdminApi>["getInventory"]>[0]) =>
    getConfiguredAdminApi().getInventory(options),
  createProduct: (payload: Record<string, unknown>) =>
    getConfiguredAdminApi().createProduct(payload),
  updateProduct: (productId: string, payload: Record<string, unknown>) =>
    getConfiguredAdminApi().updateProduct(productId, payload),
  createCategory: (payload: Record<string, unknown>) =>
    getConfiguredAdminApi().createCategory(payload),
  updateCategory: (categoryId: string, payload: Record<string, unknown>) =>
    getConfiguredAdminApi().updateCategory(categoryId, payload),
  adjustInventory: (productId: string, payload: { quantityDelta: number; reason: string }) =>
    getConfiguredAdminApi().adjustInventory(productId, payload),
};
