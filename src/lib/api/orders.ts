import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  customerEmail: string;
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    lineSubtotalCents: number;
  }>;
  subtotalCents: number;
  totalCents: number;
  currency: "ZAR";
  status: string;
  stockReservationStatus: string;
  deliveryAddress: {
    recipientName: string;
    phoneNumber: string;
    addressLine1: string;
    addressLine2?: string;
    localArea?: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    deliveryInstructions?: string;
  };
  cancellation?: { reason: string; cancelledAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderList {
  orders: CustomerOrder[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ShippingQuote {
  quoteId: string;
  serviceLevel: {
    id: string;
    code: string;
    name: string;
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
  };
  rateCents: number;
  currency: "ZAR";
}

export interface ShippingQuoteResponse {
  orderId: string;
  currency: "ZAR";
  rates: ShippingQuote[];
}

type OrdersApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function invalidResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid order or shipping response.");
}

function parseCancellation(value: unknown): CustomerOrder["cancellation"] {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value["reason"] !== "string" ||
    typeof value["cancelledAt"] !== "string" ||
    (value["cancelledBy"] !== undefined && typeof value["cancelledBy"] !== "string")
  ) {
    return invalidResponse();
  }
  return { reason: value["reason"], cancelledAt: value["cancelledAt"] };
}

function parseOrder(value: unknown): CustomerOrder {
  const address = isRecord(value) ? value["deliveryAddress"] : undefined;
  const cancellation = isRecord(value) ? value["cancellation"] : undefined;
  const parsedCancellation = parseCancellation(cancellation);
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["orderNumber"] !== "string" ||
    typeof value["customerEmail"] !== "string" ||
    !Array.isArray(value["items"]) ||
    !isSafeInteger(value["subtotalCents"]) ||
    !isSafeInteger(value["totalCents"]) ||
    value["currency"] !== "ZAR" ||
    typeof value["status"] !== "string" ||
    !value["status"].trim() ||
    typeof value["stockReservationStatus"] !== "string" ||
    !value["stockReservationStatus"].trim() ||
    !isRecord(address) ||
    typeof address["recipientName"] !== "string" ||
    typeof address["phoneNumber"] !== "string" ||
    typeof address["addressLine1"] !== "string" ||
    (address["addressLine2"] !== undefined && typeof address["addressLine2"] !== "string") ||
    (address["localArea"] !== undefined && typeof address["localArea"] !== "string") ||
    typeof address["city"] !== "string" ||
    typeof address["province"] !== "string" ||
    typeof address["postalCode"] !== "string" ||
    typeof address["country"] !== "string" ||
    (address["deliveryInstructions"] !== undefined &&
      typeof address["deliveryInstructions"] !== "string") ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    return invalidResponse();
  }

  const items = value["items"].map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry["productId"] !== "string" ||
      typeof entry["name"] !== "string" ||
      typeof entry["sku"] !== "string" ||
      typeof entry["description"] !== "string" ||
      !isSafeInteger(entry["quantity"]) ||
      entry["quantity"] < 1 ||
      !isSafeInteger(entry["unitPriceCents"]) ||
      !isSafeInteger(entry["lineSubtotalCents"])
    ) {
      return invalidResponse();
    }
    return {
      productId: entry["productId"],
      name: entry["name"],
      sku: entry["sku"],
      description: entry["description"],
      quantity: entry["quantity"],
      unitPriceCents: entry["unitPriceCents"],
      lineSubtotalCents: entry["lineSubtotalCents"],
    };
  });

  return {
    id: value["id"],
    orderNumber: value["orderNumber"],
    customerEmail: value["customerEmail"],
    items,
    subtotalCents: value["subtotalCents"],
    totalCents: value["totalCents"],
    currency: "ZAR",
    status: value["status"],
    stockReservationStatus: value["stockReservationStatus"],
    deliveryAddress: {
      recipientName: address["recipientName"],
      phoneNumber: address["phoneNumber"],
      addressLine1: address["addressLine1"],
      ...(typeof address["addressLine2"] === "string"
        ? { addressLine2: address["addressLine2"] }
        : {}),
      ...(typeof address["localArea"] === "string" ? { localArea: address["localArea"] } : {}),
      city: address["city"],
      province: address["province"],
      postalCode: address["postalCode"],
      country: address["country"],
      ...(typeof address["deliveryInstructions"] === "string"
        ? { deliveryInstructions: address["deliveryInstructions"] }
        : {}),
    },
    ...(parsedCancellation ? { cancellation: parsedCancellation } : {}),
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function parseShippingQuote(value: unknown): ShippingQuote {
  if (
    !isRecord(value) ||
    typeof value["quoteId"] !== "string" ||
    !isRecord(value["serviceLevel"]) ||
    typeof value["serviceLevel"]["id"] !== "string" ||
    typeof value["serviceLevel"]["code"] !== "string" ||
    typeof value["serviceLevel"]["name"] !== "string" ||
    !isSafeInteger(value["rateCents"]) ||
    value["currency"] !== "ZAR" ||
    (value["serviceLevel"]["deliveryDateFrom"] !== undefined &&
      typeof value["serviceLevel"]["deliveryDateFrom"] !== "string") ||
    (value["serviceLevel"]["deliveryDateTo"] !== undefined &&
      typeof value["serviceLevel"]["deliveryDateTo"] !== "string")
  ) {
    return invalidResponse();
  }
  return {
    quoteId: value["quoteId"],
    serviceLevel: {
      id: value["serviceLevel"]["id"],
      code: value["serviceLevel"]["code"],
      name: value["serviceLevel"]["name"],
      ...(typeof value["serviceLevel"]["deliveryDateFrom"] === "string"
        ? { deliveryDateFrom: value["serviceLevel"]["deliveryDateFrom"] }
        : {}),
      ...(typeof value["serviceLevel"]["deliveryDateTo"] === "string"
        ? { deliveryDateTo: value["serviceLevel"]["deliveryDateTo"] }
        : {}),
    },
    rateCents: value["rateCents"],
    currency: "ZAR",
  };
}

export function createOrdersApi(client: OrdersApiClient) {
  return {
    async createCustomerOrder(addressId: string, idempotencyKey: string): Promise<CustomerOrder> {
      const response = await client.request<unknown>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        json: { addressId },
      });
      return parseOrder(response);
    },

    async getCustomerOrder(orderId: string): Promise<CustomerOrder> {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}`);
      return parseOrder(response);
    },

    async requestShippingQuotes(orderId: string): Promise<ShippingQuoteResponse> {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/shipping/quote`,
        { method: "POST", json: {} },
      );
      if (
        !isRecord(response) ||
        typeof response["orderId"] !== "string" ||
        response["currency"] !== "ZAR" ||
        (response["rates"] !== null && !Array.isArray(response["rates"]))
      ) {
        return invalidResponse();
      }
      return {
        orderId: response["orderId"],
        currency: "ZAR",
        rates: Array.isArray(response["rates"])
          ? response["rates"].map(parseShippingQuote)
          : [],
      };
    },

    async selectShippingQuote(orderId: string, quoteId: string): Promise<void> {
      await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/shipping/quote/${encodeURIComponent(quoteId)}/select`,
        { method: "POST", json: {} },
      );
    },

    async listCustomerOrders(page = 1): Promise<CustomerOrderList> {
      const response = await client.request<unknown>(`/orders?page=${page}&limit=20`);
      if (
        !isRecord(response) ||
        !Array.isArray(response["orders"]) ||
        !isRecord(response["pagination"])
      ) {
        return invalidResponse();
      }
      const pagination = response["pagination"];
      if (
        !isSafeInteger(pagination["page"]) ||
        !isSafeInteger(pagination["limit"]) ||
        !isSafeInteger(pagination["total"]) ||
        !isSafeInteger(pagination["totalPages"])
      ) {
        return invalidResponse();
      }
      return {
        orders: response["orders"].map(parseOrder),
        pagination: {
          page: pagination["page"],
          limit: pagination["limit"],
          total: pagination["total"],
          totalPages: pagination["totalPages"],
        },
      };
    },
  };
}

let configuredOrdersApi: ReturnType<typeof createOrdersApi> | undefined;

export const ordersApi = {
  createCustomerOrder: (addressId: string, idempotencyKey: string) => {
    configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient());
    return configuredOrdersApi.createCustomerOrder(addressId, idempotencyKey);
  },
  getCustomerOrder: (orderId: string) => {
    configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient());
    return configuredOrdersApi.getCustomerOrder(orderId);
  },
  requestShippingQuotes: (orderId: string) => {
    configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient());
    return configuredOrdersApi.requestShippingQuotes(orderId);
  },
  selectShippingQuote: (orderId: string, quoteId: string) => {
    configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient());
    return configuredOrdersApi.selectShippingQuote(orderId, quoteId);
  },
  listCustomerOrders: (page?: number) => {
    configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient());
    return configuredOrdersApi.listCustomerOrders(page);
  },
};
