import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";

export interface CartProductSummary {
  name: string;
  slug: string;
}

export interface CartLine {
  productId: string;
  quantity: number;
  available: boolean;
  product: CartProductSummary | null;
  unitPriceCents: number | null;
  lineSubtotalCents: number | null;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  currency: "ZAR";
  totalCents: number;
  hasUnavailableItems: boolean;
}

export type CartApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function invalidCartResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid cart response.");
}

function parseProductSummary(value: unknown): CartProductSummary | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value["name"] !== "string" || typeof value["slug"] !== "string") {
    invalidCartResponse();
  }
  return { name: value["name"], slug: value["slug"] };
}

function parseCartLine(value: unknown): CartLine {
  if (!isRecord(value)) invalidCartResponse();

  const productId = value["productId"];
  const quantity = value["quantity"];
  const available = value["available"];
  const unitPriceCents = value["unitPriceCents"];
  const lineSubtotalCents = value["lineSubtotalCents"];

  if (
    typeof productId !== "string" ||
    !isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 99 ||
    typeof available !== "boolean"
  ) {
    invalidCartResponse();
  }

  if (available) {
    if (
      !isRecord(value["product"]) ||
      typeof value["product"]["name"] !== "string" ||
      typeof value["product"]["slug"] !== "string" ||
      !isSafeInteger(unitPriceCents) ||
      unitPriceCents <= 0 ||
      !isSafeInteger(lineSubtotalCents) ||
      lineSubtotalCents <= 0
    ) {
      invalidCartResponse();
    }

    return {
      productId,
      quantity,
      available: true,
      product: parseProductSummary(value["product"]),
      unitPriceCents,
      lineSubtotalCents,
    };
  }

  if (value["product"] !== null || unitPriceCents !== null || lineSubtotalCents !== null) {
    invalidCartResponse();
  }

  return {
    productId,
    quantity,
    available: false,
    product: null,
    unitPriceCents: null,
    lineSubtotalCents: null,
  };
}

function parseCart(value: unknown): Cart {
  if (!isRecord(value) || !Array.isArray(value["items"])) invalidCartResponse();

  const items = value["items"].map((item) => parseCartLine(item));
  const itemCount = value["itemCount"];
  const totalCents = value["totalCents"];
  const hasUnavailableItems = value["hasUnavailableItems"];
  const currency = value["currency"];

  if (
    !isSafeInteger(itemCount) ||
    itemCount < 0 ||
    !isSafeInteger(totalCents) ||
    totalCents < 0 ||
    currency !== "ZAR" ||
    typeof hasUnavailableItems !== "boolean"
  ) {
    invalidCartResponse();
  }

  return {
    items,
    itemCount,
    currency: "ZAR",
    totalCents,
    hasUnavailableItems,
  };
}

export function createCartApi(client: CartApiClient) {
  return {
    async getCart() {
      const response = await client.request<{ cart: unknown }>("/cart");
      if (!response || !isRecord(response) || !isRecord(response["cart"])) {
        invalidCartResponse();
      }
      return parseCart(response["cart"]);
    },

    async addItem(productId: string, quantity = 1) {
      const response = await client.request<{ cart: unknown }>("/cart/items", {
        method: "POST",
        json: { productId, quantity },
      });
      if (!response || !isRecord(response) || !isRecord(response["cart"])) {
        invalidCartResponse();
      }
      return parseCart(response["cart"]);
    },

    async updateItem(productId: string, quantity: number) {
      const response = await client.request<{ cart: unknown }>(
        `/cart/items/${encodeURIComponent(productId)}`,
        {
          method: "PATCH",
          json: { quantity },
        },
      );
      if (!response || !isRecord(response) || !isRecord(response["cart"])) {
        invalidCartResponse();
      }
      return parseCart(response["cart"]);
    },

    async removeItem(productId: string) {
      const response = await client.request<{ cart: unknown }>(
        `/cart/items/${encodeURIComponent(productId)}`,
        {
          method: "DELETE",
        },
      );
      if (!response || !isRecord(response) || !isRecord(response["cart"])) {
        invalidCartResponse();
      }
      return parseCart(response["cart"]);
    },

    async clearCart() {
      const response = await client.request<{ cart: unknown }>("/cart", {
        method: "DELETE",
      });
      if (!response || !isRecord(response) || !isRecord(response["cart"])) {
        invalidCartResponse();
      }
      return parseCart(response["cart"]);
    },
  };
}

export const cartApi = createCartApi(createConfiguredApiClient());
