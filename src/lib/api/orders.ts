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
  items: Array<{ productId: string; name: string; sku: string; description?: string; quantity: number; unitPriceCents: number; lineSubtotalCents: number }>;
  subtotalCents: number;
  totalCents: number;
  currency: "ZAR";
  status: "pending_payment" | "paid" | "cancelled" | "payment_reconciliation";
  fulfillmentStatus: "awaiting_payment" | "processing" | "shipped" | "delivered" | "cancelled";
  stockReservationStatus: "reserved" | "committed" | "released";
  shippingQuote?: { chargeCents: number; serviceName: string; confirmedAt: string; status: "confirmed"; expiresAt?: string };
  shippingQuoteOptions?: Array<{ quoteId: string; serviceLevel: { name: string; code?: string }; rateCents: number; currency: "ZAR" }>;
  paymentAttempts: PaymentAttempt[];
  deliveryAddress: { recipientName: string; phoneNumber: string; addressLine1: string; addressLine2?: string; localArea?: string; city: string; province: string; postalCode: string; country: string; deliveryInstructions?: string };
  shipmentTracking?: { provider: "shiplogic" | "manual"; reference?: string; trackingUrl?: string; status?: string; statusUpdatedAt?: string };
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
  checkoutUrl: string;
  method: "POST";
  fields: Record<string, string>;
}

export interface OrderTracking {
  orderId: string;
  orderNumber: string;
  status: CustomerOrder["status"];
  fulfillmentStatus: CustomerOrder["fulfillmentStatus"];
  tracking: null | { provider: "shiplogic" | "manual"; reference?: string; trackingUrl?: string; status?: string; statusUpdatedAt?: string; bookedAt?: string; dispatchedAt?: string; deliveredAt?: string };
}

export type CustomerPaymentState =
  | "awaiting-payment"
  | "processing"
  | "confirmation-pending"
  | "failed"
  | "cancelled"
  | "successful";

export function classifyCustomerPayment(order: CustomerOrder): CustomerPaymentState {
  if (order.status === "paid") return "successful";
  if (order.status === "payment_reconciliation") return "confirmation-pending";
  const latest = order.paymentAttempts.at(-1);
  if (latest?.status === "reconciliation") return "confirmation-pending";
  if (latest?.status === "pending") return "processing";
  if (latest?.status === "failed") return "failed";
  if (latest?.status === "cancelled") return "cancelled";
  if (latest?.status === "complete") return "successful";
  return "awaiting-payment";
}

export function canRetryCustomerPayment(order: CustomerOrder): boolean {
  const latest = order.paymentAttempts.at(-1);
  const hasUnresolvedAttempt = order.paymentAttempts.some((attempt) =>
    attempt.status === "pending" || attempt.status === "reconciliation",
  );
  const hasCompletedAttempt = order.paymentAttempts.some((attempt) => attempt.status === "complete");
  return (
    order.status === "pending_payment" &&
    order.stockReservationStatus === "reserved" &&
    !hasUnresolvedAttempt &&
    !hasCompletedAttempt &&
    (latest?.status === "failed" || latest?.status === "cancelled")
  );
}

type OrdersApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function invalid(): never { throw new ApiResponseError(200, "Backend returned an invalid order response."); }
function parseOrder(value: unknown): CustomerOrder {
  if (!record(value) || typeof value.id !== "string" || typeof value.orderNumber !== "string" || !Array.isArray(value.items) || !record(value.deliveryAddress)) invalid();
  const address = value.deliveryAddress;
  const statuses = ["pending_payment", "paid", "cancelled", "payment_reconciliation"] as string[];
  const fulfillment = ["awaiting_payment", "processing", "shipped", "delivered", "cancelled"] as string[];
  const stock = ["reserved", "committed", "released"] as string[];
  if (!integer(value.subtotalCents) || !integer(value.totalCents) || typeof value.currency !== "string" || !statuses.includes(String(value.status)) || !fulfillment.includes(String(value.fulfillmentStatus)) || !stock.includes(String(value.stockReservationStatus)) || !Array.isArray(value.paymentAttempts) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") invalid();
  if (typeof address.recipientName !== "string" || typeof address.phoneNumber !== "string" || typeof address.addressLine1 !== "string" || typeof address.city !== "string" || typeof address.province !== "string" || typeof address.postalCode !== "string" || typeof address.country !== "string") invalid();
  return value as unknown as CustomerOrder;
}

export function createOrdersApi(client: OrdersApiClient) {
  return {
    async listCustomerOrders(page = 1, limit = 20): Promise<CustomerOrderList> {
      const response = await client.request<unknown>(`/orders?page=${page}&limit=${limit}`);
      if (!record(response) || !Array.isArray(response.orders) || !record(response.pagination)) invalid();
      const pagination = response.pagination;
      if (!integer(pagination.page) || !integer(pagination.limit) || !integer(pagination.total) || !integer(pagination.totalPages)) invalid();
      return { orders: response.orders.map(parseOrder), pagination: pagination as CustomerOrderList["pagination"] };
    },
    async getCustomerOrder(orderId: string): Promise<CustomerOrder> {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}`);
      if (!record(response) || !record(response.order)) invalid();
      return parseOrder(response.order);
    },
    async createOrder(addressId: string, idempotencyKey: string): Promise<CustomerOrder> {
      const response = await client.request<{ order?: unknown }>('/orders', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, json: { addressId } });
      if (!record(response) || !record(response.order)) invalid();
      return parseOrder(response.order);
    },
    async getTracking(orderId: string): Promise<OrderTracking> {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/tracking`);
      if (!record(response) || typeof response.orderId !== 'string' || typeof response.orderNumber !== 'string') invalid();
      return response as unknown as OrderTracking;
    },
    async createPayFastCheckout(orderId: string): Promise<PayFastCheckout> {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/payfast/checkout`, { method: 'POST', json: {} });
      if (!record(response) || typeof response.checkoutUrl !== 'string' || !record(response.fields) || typeof response.method !== 'string') invalid();
      return response as unknown as PayFastCheckout;
    },
    async getShippingQuotes(orderId: string) {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/shipping/quote`, { method: 'POST', json: {} });
      if (!record(response)) invalid();
      return response as unknown as { orderId: string; currency: "ZAR"; rates: CustomerOrder["shippingQuoteOptions"] };
    },
    async selectShippingQuote(orderId: string, quoteId: string) {
      const response = await client.request<unknown>(`/orders/${encodeURIComponent(orderId)}/shipping/quote/${encodeURIComponent(quoteId)}/select`, { method: 'POST', json: {} });
      if (!record(response)) invalid();
      return response as { orderId: string; shippingQuote: CustomerOrder["shippingQuote"]; totalCents: number; currency: "ZAR" };
    }
  };
}

let configuredOrdersApi: ReturnType<typeof createOrdersApi> | undefined;
export const ordersApi = {
  listCustomerOrders: (page?: number, limit?: number) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).listCustomerOrders(page, limit),
  getCustomerOrder: (orderId: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getCustomerOrder(orderId),
  createOrder: (addressId: string, idempotencyKey: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).createOrder(addressId, idempotencyKey),
  getTracking: (orderId: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getTracking(orderId),
  createPayFastCheckout: (orderId: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).createPayFastCheckout(orderId),
  getShippingQuotes: (orderId: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).getShippingQuotes(orderId),
  selectShippingQuote: (orderId: string, quoteId: string) => (configuredOrdersApi ??= createOrdersApi(createConfiguredApiClient())).selectShippingQuote(orderId, quoteId),
};
