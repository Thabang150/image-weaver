import { ApiResponseError, createConfiguredApiClient, type createApiClient } from "./client";

export interface PaymentAttempt {
  id: string;
  status: "pending" | "complete" | "failed" | "cancelled" | "reconciliation";
  amountCents: number;
  currency: "ZAR";
  transactionId?: string;
  paymentStatus?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  customerEmail: string;
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    description?: string;
    quantity: number;
    unitPriceCents: number;
    lineSubtotalCents: number;
  }>;
  subtotalCents: number;
  totalCents: number;
  currency: "ZAR";
  status: "pending_payment" | "paid" | "cancelled" | "payment_reconciliation";
  fulfillmentStatus: "awaiting_payment" | "processing" | "shipped" | "delivered" | "cancelled";
  stockReservationStatus: "reserved" | "committed" | "released";
  shippingQuote?: {
    quoteId?: string;
    chargeCents: number;
    serviceName: string;
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    confirmedAt: string;
    status: "confirmed";
    expiresAt?: string;
    optInRateIds?: number[];
    optInTimeBasedRateIds?: number[];
  };
  shippingQuoteOptions?: CartShippingRate[];
  shipmentBooking?: {
    status:
      | "pending"
      | "booking"
      | "booked"
      | "failed"
      | "unknown"
      | "needs_rate_review"
      | "cancelling"
      | "cancelled"
      | "cancellation_unknown";
  };
  paymentAttempts: PaymentAttempt[];
  deliveryAddress: {
    recipientName: string;
    phoneNumber: string;
    addressLine1: string;
    addressLine2?: string;
    localArea?: string;
    addressType?: "residential" | "business";
    city: string;
    province: string;
    postalCode: string;
    country: string;
    lat?: number;
    lng?: number;
    deliveryInstructions?: string;
  };
  shipmentTracking?: {
    provider: "shiplogic" | "manual";
    reference?: string;
    trackingUrl?: string;
    status?: string;
    statusUpdatedAt?: string;
  };
  cancellation?: { reason: string; cancelledAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderList {
  orders: CustomerOrder[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface PayFastCheckout {
  paymentAttemptId: string;
  merchantReference: string;
  amountCents: number;
  currency: "ZAR";
  amountBreakdown: {
    productSubtotalCents: number;
    discountCents: number;
    shippingCents: number;
    additionalChargesCents: number;
    totalCents: number;
  };
  checkoutUrl: string;
  method: "POST";
  fields: Record<string, string>;
}

export interface CartShippingRate {
  quoteId: string;
  serviceLevel: {
    id?: string;
    code?: string;
    name: string;
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
  };
  serviceName?: string;
  rateCents: number;
  currency: "ZAR";
  retrievedAt?: string;
  optInRateIds?: number[];
  optInTimeBasedRateIds?: number[];
}

export interface ShippingOptInRate {
  id: number;
  name: string;
  chargeType: string;
  chargeCents: number;
  optedInByDefault: boolean;
  description?: string;
  type?: string;
}

export interface ShippingOptInRates {
  optInRates: ShippingOptInRate[];
  optInTimeBasedRates: ShippingOptInRate[];
}

export interface CartShippingQuoteSelections {
  optInRateIds?: number[];
  optInTimeBasedRateIds?: number[];
}

export interface CartShippingQuote {
  quoteId: string;
  expiresAt: string;
  currency: "ZAR";
  rates: CartShippingRate[];
}

export interface OrderTracking {
  orderId: string;
  orderNumber: string;
  status: CustomerOrder["status"];
  fulfillmentStatus: CustomerOrder["fulfillmentStatus"];
  tracking: null | {
    provider: "shiplogic" | "manual";
    reference?: string;
    trackingUrl?: string;
    status?: string;
    statusUpdatedAt?: string;
    bookedAt?: string;
    dispatchedAt?: string;
    deliveredAt?: string;
  };
}

export type CustomerPaymentState =
  | "awaiting-payment"
  | "processing"
  | "confirmation-pending"
  | "failed"
  | "cancelled"
  | "successful";

export const CUSTOMER_ORDER_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SHIPPING_RATE_LIFETIME_MS = 5 * 60 * 1000;

export function classifyCustomerPayment(order: CustomerOrder): CustomerPaymentState {
  if (order.status === "paid") return "successful";
  if (order.status === "payment_reconciliation") return "confirmation-pending";
  if (order.status === "cancelled" && order.paymentAttempts.length === 0) return "cancelled";
  const latest = order.paymentAttempts.at(-1);
  if (latest?.status === "reconciliation") return "confirmation-pending";
  if (latest?.status === "pending") {
    return Date.parse(latest.createdAt) + CUSTOMER_ORDER_LIFETIME_MS <= Date.now()
      ? "confirmation-pending"
      : "processing";
  }
  if (latest?.status === "failed") return "failed";
  if (latest?.status === "cancelled") return "cancelled";
  if (latest?.status === "complete") return "successful";
  return "awaiting-payment";
}

export function canRetryCustomerPayment(order: CustomerOrder): boolean {
  const attempts = order.paymentAttempts ?? [];
  const latest = attempts.at(-1);
  const hasUnresolvedAttempt = attempts.some(
    (attempt) => attempt.status === "pending" || attempt.status === "reconciliation",
  );
  const hasCompletedAttempt = attempts.some((attempt) => attempt.status === "complete");
  const quote = order.shippingQuote;
  const confirmedAt = quote ? Date.parse(quote.confirmedAt) : Number.NaN;
  const orderCreatedAt = Date.parse(order.createdAt);
  const quoteIsCurrent =
    quote?.status === "confirmed" &&
    Number.isFinite(orderCreatedAt) &&
    orderCreatedAt + CUSTOMER_ORDER_LIFETIME_MS > Date.now() &&
    Number.isFinite(confirmedAt) &&
    confirmedAt + SHIPPING_RATE_LIFETIME_MS > Date.now() &&
    (!quote.expiresAt || Date.parse(quote.expiresAt) > Date.now());
  return (
    order.status === "pending_payment" &&
    order.stockReservationStatus === "reserved" &&
    quoteIsCurrent &&
    !hasUnresolvedAttempt &&
    !hasCompletedAttempt &&
    (attempts.length === 0 || latest?.status === "failed" || latest?.status === "cancelled")
  );
}

export function canCancelCustomerOrder(order: CustomerOrder): boolean {
  const attempts = order.paymentAttempts ?? [];
  const hasCompletedAttempt = attempts.some((attempt) => attempt.status === "complete");
  const hasReconciliation = attempts.some((attempt) => attempt.status === "reconciliation");
  const freshPendingAttempt = attempts.some(
    (attempt) =>
      attempt.status === "pending" &&
      Date.parse(attempt.createdAt) + CUSTOMER_ORDER_LIFETIME_MS > Date.now(),
  );
  return (
    order.status === "pending_payment" &&
    order.stockReservationStatus === "reserved" &&
    !hasCompletedAttempt &&
    !hasReconciliation &&
    !freshPendingAttempt
  );
}

export function canArchiveCustomerOrder(order: CustomerOrder): boolean {
  if (order.status !== "cancelled") return false;
  return order.paymentAttempts.every(
    (attempt) =>
      attempt.status === "failed" ||
      (attempt.status === "cancelled" && Boolean(attempt.paymentStatus)),
  );
}

type OrdersApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function invalid(): never {
  throw new ApiResponseError(200, "Backend returned an invalid order response.");
}
function parseShippingOptInRates(value: unknown): ShippingOptInRates {
  if (
    !record(value) ||
    !Array.isArray(value["optInRates"]) ||
    !Array.isArray(value["optInTimeBasedRates"])
  )
    invalid();
  const optInRates = value["optInRates"];
  const optInTimeBasedRates = value["optInTimeBasedRates"];
  const parseRates = (rates: unknown[]): ShippingOptInRate[] =>
    rates.map((rate) => {
      if (!record(rate)) invalid();
      const id = rate["id"];
      const name = rate["name"];
      const chargeType = rate["chargeType"];
      const chargeCents = rate["chargeCents"];
      const optedInByDefault = rate["optedInByDefault"];
      const description = rate["description"];
      const type = rate["type"];
      if (
        !integer(id) ||
        id < 1 ||
        typeof name !== "string" ||
        typeof chargeType !== "string" ||
        !integer(chargeCents) ||
        chargeCents < 0 ||
        typeof optedInByDefault !== "boolean" ||
        (description !== undefined && typeof description !== "string") ||
        (type !== undefined && typeof type !== "string")
      )
        invalid();
      return {
        id,
        name,
        chargeType,
        chargeCents,
        optedInByDefault,
        ...(description === undefined ? {} : { description }),
        ...(type === undefined ? {} : { type }),
      };
    });
  return {
    optInRates: parseRates(optInRates),
    optInTimeBasedRates: parseRates(optInTimeBasedRates),
  };
}

function parsePayFastCheckout(value: unknown): PayFastCheckout {
  if (!record(value) || !record(value["amountBreakdown"]) || !record(value["fields"])) invalid();
  const breakdown = value["amountBreakdown"];
  const rawFields = value["fields"];
  const fields: Record<string, string> = {};
  for (const [name, field] of Object.entries(rawFields)) {
    if (typeof field !== "string") invalid();
    fields[name] = field;
  }
  const checkoutUrl = value["checkoutUrl"];
  const amountCents = value["amountCents"];
  const productSubtotalCents = breakdown["productSubtotalCents"];
  const discountCents = breakdown["discountCents"];
  const shippingCents = breakdown["shippingCents"];
  const additionalChargesCents = breakdown["additionalChargesCents"];
  const totalCents = breakdown["totalCents"];
  let url: URL;
  try {
    url = new URL(String(checkoutUrl));
  } catch {
    invalid();
  }
  if (
    typeof value["paymentAttemptId"] !== "string" ||
    !value["paymentAttemptId"] ||
    typeof value["merchantReference"] !== "string" ||
    !value["merchantReference"] ||
    !integer(amountCents) ||
    amountCents < 1 ||
    value["currency"] !== "ZAR" ||
    value["method"] !== "POST" ||
    typeof checkoutUrl !== "string" ||
    url.protocol !== "https:" ||
    !integer(productSubtotalCents) ||
    !integer(discountCents) ||
    !integer(shippingCents) ||
    !integer(additionalChargesCents) ||
    !integer(totalCents) ||
    productSubtotalCents < 0 ||
    discountCents < 0 ||
    discountCents > productSubtotalCents ||
    shippingCents < 0 ||
    additionalChargesCents < 0 ||
    totalCents < 1 ||
    totalCents !== productSubtotalCents - discountCents + shippingCents + additionalChargesCents ||
    amountCents !== totalCents ||
    fields["amount"] !== (amountCents / 100).toFixed(2) ||
    typeof fields["signature"] !== "string" ||
    !fields["signature"]
  )
    invalid();
  return {
    paymentAttemptId: value["paymentAttemptId"],
    merchantReference: value["merchantReference"],
    amountCents,
    currency: "ZAR",
    amountBreakdown: {
      productSubtotalCents,
      discountCents,
      shippingCents,
      additionalChargesCents,
      totalCents,
    },
    checkoutUrl,
    method: "POST",
    fields,
  };
}

function parseOrder(value: unknown): CustomerOrder {
  if (!record(value)) invalid();
  const id = value["id"];
  const orderNumber = value["orderNumber"];
  const items = value["items"];
  const address = value["deliveryAddress"];
  const subtotalCents = value["subtotalCents"];
  const totalCents = value["totalCents"];
  const currency = value["currency"];
  const status = value["status"];
  const fulfillmentStatus = value["fulfillmentStatus"];
  const stockReservationStatus = value["stockReservationStatus"];
  const paymentAttempts = value["paymentAttempts"];
  const createdAt = value["createdAt"];
  const updatedAt = value["updatedAt"];
  if (
    typeof id !== "string" ||
    typeof orderNumber !== "string" ||
    !Array.isArray(items) ||
    !record(address)
  )
    invalid();
  const statuses = ["pending_payment", "paid", "cancelled", "payment_reconciliation"] as string[];
  const fulfillment = [
    "awaiting_payment",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
  ] as string[];
  const stock = ["reserved", "committed", "released"] as string[];
  if (
    !integer(subtotalCents) ||
    !integer(totalCents) ||
    typeof currency !== "string" ||
    !statuses.includes(String(status)) ||
    !fulfillment.includes(String(fulfillmentStatus)) ||
    !stock.includes(String(stockReservationStatus)) ||
    !Array.isArray(paymentAttempts) ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  )
    invalid();
  if (
    typeof address["recipientName"] !== "string" ||
    typeof address["phoneNumber"] !== "string" ||
    typeof address["addressLine1"] !== "string" ||
    (address["addressType"] !== undefined &&
      address["addressType"] !== "residential" &&
      address["addressType"] !== "business") ||
    typeof address["city"] !== "string" ||
    typeof address["province"] !== "string" ||
    typeof address["postalCode"] !== "string" ||
    typeof address["country"] !== "string" ||
    (address["lat"] !== undefined &&
      (typeof address["lat"] !== "number" ||
        !Number.isFinite(address["lat"]) ||
        address["lat"] < -90 ||
        address["lat"] > 90)) ||
    (address["lng"] !== undefined &&
      (typeof address["lng"] !== "number" ||
        !Number.isFinite(address["lng"]) ||
        address["lng"] < -180 ||
        address["lng"] > 180)) ||
    (address["lat"] === undefined) !== (address["lng"] === undefined) ||
    (address["lat"] === 0 && address["lng"] === 0)
  )
    invalid();
  let itemSubtotalCents = 0;
  for (const item of items) {
    if (!record(item)) invalid();
    const productId = item["productId"];
    const name = item["name"];
    const sku = item["sku"];
    const quantity = item["quantity"];
    const unitPriceCents = item["unitPriceCents"];
    const lineSubtotalCents = item["lineSubtotalCents"];
    if (
      typeof productId !== "string" ||
      typeof name !== "string" ||
      typeof sku !== "string" ||
      !integer(quantity) ||
      quantity < 1 ||
      !integer(unitPriceCents) ||
      unitPriceCents < 1 ||
      !integer(lineSubtotalCents) ||
      quantity * unitPriceCents !== lineSubtotalCents
    )
      invalid();
    itemSubtotalCents += lineSubtotalCents;
    if (!Number.isSafeInteger(itemSubtotalCents)) invalid();
  }
  if (itemSubtotalCents !== subtotalCents) invalid();
  let shippingCents = 0;
  const shippingQuote = value["shippingQuote"];
  if (shippingQuote !== undefined) {
    if (!record(shippingQuote)) invalid();
    const quoteStatus = shippingQuote["status"];
    const serviceName = shippingQuote["serviceName"];
    const confirmedAt = shippingQuote["confirmedAt"];
    const chargeCents = shippingQuote["chargeCents"];
    const optInRateIds = shippingQuote["optInRateIds"];
    const optInTimeBasedRateIds = shippingQuote["optInTimeBasedRateIds"];
    if (
      quoteStatus !== "confirmed" ||
      typeof serviceName !== "string" ||
      typeof confirmedAt !== "string" ||
      !integer(chargeCents) ||
      chargeCents < 0 ||
      (optInRateIds !== undefined &&
        (!Array.isArray(optInRateIds) ||
          !optInRateIds.every((rateId) => integer(rateId) && rateId > 0))) ||
      (optInTimeBasedRateIds !== undefined &&
        (!Array.isArray(optInTimeBasedRateIds) ||
          !optInTimeBasedRateIds.every((rateId) => integer(rateId) && rateId > 0)))
    )
      invalid();
    shippingCents = chargeCents;
  }
  if (totalCents !== subtotalCents + shippingCents) invalid();
  return value as unknown as CustomerOrder;
}

function parseCartShippingRate(value: unknown): CartShippingRate {
  if (!record(value) || typeof value["quoteId"] !== "string" || !record(value["serviceLevel"])) {
    invalid();
  }
  const serviceLevel = value["serviceLevel"];
  const serviceLevelId = serviceLevel["id"];
  const serviceLevelCode = serviceLevel["code"];
  const serviceLevelName = serviceLevel["name"];
  const deliveryDateFrom = serviceLevel["deliveryDateFrom"];
  const deliveryDateTo = serviceLevel["deliveryDateTo"];
  const rateCents = value["rateCents"];
  const retrievedAt = value["retrievedAt"];
  if (
    typeof serviceLevelId !== "string" ||
    typeof serviceLevelCode !== "string" ||
    typeof serviceLevelName !== "string" ||
    !integer(rateCents) ||
    rateCents < 0 ||
    value["currency"] !== "ZAR" ||
    (deliveryDateFrom !== undefined && typeof deliveryDateFrom !== "string") ||
    (deliveryDateTo !== undefined && typeof deliveryDateTo !== "string") ||
    (retrievedAt !== undefined && typeof retrievedAt !== "string")
  ) {
    invalid();
  }
  return {
    quoteId: value["quoteId"],
    serviceLevel: {
      id: serviceLevelId,
      code: serviceLevelCode,
      name: serviceLevelName,
      ...(deliveryDateFrom === undefined ? {} : { deliveryDateFrom }),
      ...(deliveryDateTo === undefined ? {} : { deliveryDateTo }),
    },
    rateCents,
    currency: "ZAR",
    ...(retrievedAt === undefined ? {} : { retrievedAt }),
  };
}

export function createOrdersApi(client: OrdersApiClient) {
  return {
    async listCustomerOrders(page = 1, limit = 20): Promise<CustomerOrderList> {
      const response = await client.request<unknown>(`/orders?page=${page}&limit=${limit}`);
      if (
        !record(response) ||
        !Array.isArray(response["orders"]) ||
        !record(response["pagination"])
      )
        invalid();
      const orders = response["orders"];
      const pagination = response["pagination"];
      const currentPage = pagination["page"];
      const currentLimit = pagination["limit"];
      const total = pagination["total"];
      const totalPages = pagination["totalPages"];
      if (
        !integer(currentPage) ||
        !integer(currentLimit) ||
        !integer(total) ||
        !integer(totalPages)
      )
        invalid();
      return {
        orders: orders.map(parseOrder),
        pagination: { page: currentPage, limit: currentLimit, total, totalPages },
      };
    },
    async getCustomerOrder(orderId: string): Promise<CustomerOrder> {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}`);
      if (!record(response) || !record(response["order"])) invalid();
      return parseOrder(response["order"]);
    },
    async getCartShippingOptInRates(addressId: string): Promise<ShippingOptInRates> {
      const response = await client.request<unknown>("/shipping/opt-in-rates", {
        method: "POST",
        json: { addressId },
      });
      return parseShippingOptInRates(response);
    },
    async createCartShippingQuote(
      addressId: string,
      selections: CartShippingQuoteSelections = {},
    ): Promise<CartShippingQuote> {
      const response = await client.request<unknown>("/shipping/quote", {
        method: "POST",
        json: { addressId, ...selections },
      });
      if (
        !record(response) ||
        typeof response["quoteId"] !== "string" ||
        typeof response["expiresAt"] !== "string" ||
        response["currency"] !== "ZAR" ||
        !Array.isArray(response["rates"])
      )
        invalid();
      const rates = response["rates"].map(parseCartShippingRate);
      return {
        quoteId: response["quoteId"],
        expiresAt: response["expiresAt"],
        currency: "ZAR",
        rates,
      };
    },
    async selectCartShippingRate(quoteId: string, rateId: string): Promise<void> {
      await client.request<unknown>(`/shipping/quote/${encodeURIComponent(quoteId)}/select`, {
        method: "POST",
        json: { rateId },
      });
    },
    async createOrder(
      addressId: string,
      shippingQuoteId: string,
      idempotencyKey: string,
    ): Promise<CustomerOrder> {
      const response = await client.request<{ order?: unknown }>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        json: { addressId, shippingQuoteId },
      });
      if (!record(response) || !record(response.order)) invalid();
      return parseOrder(response.order);
    },
    async getTracking(orderId: string): Promise<OrderTracking> {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/tracking`,
      );
      if (
        !record(response) ||
        typeof response["orderId"] !== "string" ||
        typeof response["orderNumber"] !== "string"
      )
        invalid();
      return response as unknown as OrderTracking;
    },
    async createPayFastCheckout(orderId: string): Promise<PayFastCheckout> {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/payfast/checkout`,
        { method: "POST", json: {} },
      );
      return parsePayFastCheckout(response);
    },
    async cancelCustomerOrder(orderId: string): Promise<void> {
      await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        json: {},
      });
    },
    async cancelCustomerShipment(orderId: string): Promise<void> {
      await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/shipment/cancel`, {
        method: "POST",
        json: {},
      });
    },
    async archiveCustomerOrder(orderId: string): Promise<void> {
      await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/archive`, {
        method: "POST",
        json: {},
      });
    },
    async getOrderShippingOptInRates(orderId: string): Promise<ShippingOptInRates> {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/shipping/opt-in-rates`,
        { method: "POST", json: {} },
      );
      return parseShippingOptInRates(response);
    },
    async getShippingQuotes(orderId: string, selections: CartShippingQuoteSelections = {}) {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/shipping/quote`,
        { method: "POST", json: selections },
      );
      if (!record(response) || !Array.isArray(response["rates"])) invalid();
      const responseOrderId = response["orderId"];
      const currency = response["currency"];
      if (
        typeof responseOrderId !== "string" ||
        currency !== "ZAR" ||
        responseOrderId !== orderId
      ) {
        invalid();
      }
      return {
        orderId: responseOrderId,
        currency: "ZAR" as const,
        rates: response["rates"].map(parseCartShippingRate),
      };
    },
    async selectShippingQuote(orderId: string, quoteId: string) {
      const response = await client.request<unknown>(
        `/orders/${encodeURIComponent(orderId)}/shipping/quote/${encodeURIComponent(quoteId)}/select`,
        { method: "POST", json: {} },
      );
      if (!record(response)) invalid();
      return response as {
        orderId: string;
        shippingQuote: CustomerOrder["shippingQuote"];
        totalCents: number;
        currency: "ZAR";
      };
    },
  };
}

let configuredOrdersApi: ReturnType<typeof createOrdersApi> | undefined;
export const ordersApi = {
  listCustomerOrders: (page?: number, limit?: number) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).listCustomerOrders(
      page,
      limit,
    ),
  getCustomerOrder: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getCustomerOrder(
      orderId,
    ),
  getCartShippingOptInRates: (addressId: string) =>
    (configuredOrdersApi ??= createOrdersApi(
      createConfiguredApiClient(),
    )).getCartShippingOptInRates(addressId),
  createCartShippingQuote: (addressId: string, selections?: CartShippingQuoteSelections) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).createCartShippingQuote(
      addressId,
      selections,
    ),
  selectCartShippingRate: (quoteId: string, rateId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).selectCartShippingRate(
      quoteId,
      rateId,
    ),
  createOrder: (addressId: string, shippingQuoteId: string, idempotencyKey: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).createOrder(
      addressId,
      shippingQuoteId,
      idempotencyKey,
    ),
  getTracking: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getTracking(orderId),
  createPayFastCheckout: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).createPayFastCheckout(
      orderId,
    ),
  cancelCustomerOrder: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).cancelCustomerOrder(
      orderId,
    ),
  cancelCustomerShipment: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).cancelCustomerShipment(
      orderId,
    ),
  archiveCustomerOrder: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).archiveCustomerOrder(
      orderId,
    ),
  getShippingQuotes: (orderId: string, selections?: CartShippingQuoteSelections) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getShippingQuotes(
      orderId,
      selections,
    ),
  getOrderShippingOptInRates: (orderId: string) =>
    (configuredOrdersApi ??= createOrdersApi(
      createConfiguredApiClient(),
    )).getOrderShippingOptInRates(orderId),
  selectShippingQuote: (orderId: string, quoteId: string) =>
    (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).selectShippingQuote(
      orderId,
      quoteId,
    ),
};
