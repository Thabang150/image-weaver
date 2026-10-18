import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: {
    id: string;
    name: string;
    slug: string;
  };
  priceCents: number;
  imageReferences: string[];
  packaging?: {
    amount: number;
    unit: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProductPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ProductList {
  products: PublicProduct[];
  pagination: ProductPagination;
}

export type CatalogueApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isProductPagination(value: unknown): value is ProductPagination {
  return (
    isRecord(value) &&
    isSafeInteger(value["page"]) &&
    value["page"] >= 1 &&
    isSafeInteger(value["limit"]) &&
    value["limit"] >= 1 &&
    isSafeInteger(value["total"]) &&
    value["total"] >= 0 &&
    isSafeInteger(value["totalPages"]) &&
    value["totalPages"] >= 0
  );
}

function isPublicCategory(value: unknown): value is PublicCategory {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["slug"] === "string" &&
    (value["description"] === undefined || typeof value["description"] === "string") &&
    value["isActive"] === true &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string"
  );
}

function isPublicProduct(value: unknown): value is PublicProduct {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["slug"] !== "string" ||
    typeof value["description"] !== "string" ||
    !isSafeInteger(value["priceCents"]) ||
    value["priceCents"] <= 0 ||
    !isStringArray(value["imageReferences"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    return false;
  }

  const category = value["category"];
  const packaging = value["packaging"];
  return (
    isRecord(category) &&
    typeof category["id"] === "string" &&
    typeof category["name"] === "string" &&
    typeof category["slug"] === "string" &&
    (packaging === undefined ||
      (isRecord(packaging) &&
        typeof packaging["amount"] === "number" &&
        Number.isFinite(packaging["amount"]) &&
        packaging["amount"] > 0 &&
        typeof packaging["unit"] === "string"))
  );
}

function invalidResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid catalogue response.");
}

function parseCategories(value: unknown): { categories: PublicCategory[] } {
  if (!isRecord(value) || !Array.isArray(value["categories"])) return invalidResponse();
  const categories: PublicCategory[] = [];
  for (const category of value["categories"]) {
    if (!isPublicCategory(category)) return invalidResponse();
    categories.push(category);
  }
  return { categories };
}

function parseProductList(value: unknown): ProductList {
  if (!isRecord(value) || !Array.isArray(value["products"])) {
    return invalidResponse();
  }

  const products: PublicProduct[] = [];
  for (const product of value["products"]) {
    if (!isPublicProduct(product)) return invalidResponse();
    products.push(product);
  }

  const pagination = value["pagination"];
  if (!isProductPagination(pagination)) return invalidResponse();
  return { products, pagination };
}

function parseProduct(value: unknown): { product: PublicProduct } {
  if (!isRecord(value) || !isPublicProduct(value["product"])) return invalidResponse();
  return { product: value["product"] };
}

export function createCatalogueApi(client: CatalogueApiClient) {
  return {
    async getCategories() {
      return parseCategories(await client.request<unknown>("/categories"));
    },

    async getProducts(options: { page: number; categoryId?: string }) {
      const query = new URLSearchParams({
        page: String(options.page),
        limit: "20",
        sortBy: "name",
        sortOrder: "asc",
      });
      if (options.categoryId) query.set("categoryId", options.categoryId);

      return parseProductList(await client.request<unknown>(`/products?${query.toString()}`));
    },

    async getProductBySlug(slug: string) {
      return parseProduct(await client.request<unknown>(`/products/${encodeURIComponent(slug)}`));
    },
  };
}

function getCatalogueApi() {
  return createCatalogueApi(createConfiguredApiClient());
}

export const catalogueApi = {
  getCategories: () => getCatalogueApi().getCategories(),
  getProducts: (options: { page: number; categoryId?: string }) =>
    getCatalogueApi().getProducts(options),
  getProductBySlug: (slug: string) => getCatalogueApi().getProductBySlug(slug),
};
