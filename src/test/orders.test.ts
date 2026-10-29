import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { createOrdersApi } from "@/lib/api/orders";

const order = {
  id: "order-1",
  orderNumber: "HW-2026-000001",
  customerEmail: "customer@example.test",
  items: [
    {
      productId: "product-1",
      name: "Example product",
      sku: "EXAMPLE-1",
      description: "Backend order snapshot",
      quantity: 2,
      unitPriceCents: 1250,
      lineSubtotalCents: 2500,
    },
  ],
  subtotalCents: 2500,
  totalCents: 2500,
  currency: "ZAR",
  status: "pending_payment",
  stockReservationStatus: "reserved",
  deliveryAddress: {
    recipientName: "Customer",
    phoneNumber: "0790000000",
    addressLine1: "1 Main Road",
    city: "Johannesburg",
    province: "Gauteng",
    postalCode: "2000",
    country: "South Africa",
  },
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("customer order history API", () => {
  it("validates the documented list response and keeps pending payment explicit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        orders: [order],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    );
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    const result = await api.listCustomerOrders();
    expect(result.orders[0]?.status).toBe("pending_payment");
    expect(result.orders[0]?.totalCents).toBe(2500);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/orders?page=1&limit=20",
    );
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("rejects malformed order totals rather than displaying an invented amount", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        orders: [{ ...order, totalCents: "25.00" }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    );
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    await expect(api.listCustomerOrders()).rejects.toMatchObject({
      name: "ApiResponseError",
      message: "Backend returned an invalid order history response.",
    });
  });

  it("uses the documented PayFast endpoint and validates its signed shipping-inclusive response", async () => {
    const checkout = {
      paymentAttemptId: "attempt-1",
      merchantReference: "HW-2026-000001-attempt-1",
      amountCents: 3300,
      currency: "ZAR",
      amountBreakdown: {
        productSubtotalCents: 2500,
        discountCents: 0,
        shippingCents: 800,
        additionalChargesCents: 0,
        totalCents: 3300,
      },
      checkoutUrl: "https://sandbox.payfast.co.za/eng/process",
      method: "POST",
      fields: {
        merchant_id: "merchant",
        merchant_key: "key",
        return_url: "https://store.example.test/payment/return?orderId=order-1",
        cancel_url: "https://store.example.test/payment/cancel?orderId=order-1",
        notify_url: "https://api.example.test/api/v1/payments/payfast/itn",
        email_address: "customer@example.test",
        m_payment_id: "HW-2026-000001-attempt-1",
        amount: "33.00",
        item_name: "Healthy Ways SA HW-2026-000001",
        signature: "signed-value",
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf" });
      if (url.pathname.endsWith("/payfast/checkout")) return jsonResponse(checkout);
      return jsonResponse({ error: "Not found" }, 404);
    });
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    const result = await api.initiatePayFastCheckout("order-1");

    expect(result.amountBreakdown.shippingCents).toBe(800);
    expect(result.amountCents).toBe(3300);
    expect(result.method).toBe("POST");
    const request = fetcher.mock.calls.find(([input]) =>
      String(input).endsWith("/orders/order-1/payfast/checkout"),
    );
    expect(request?.[1]?.method).toBe("POST");
    expect(request?.[1]?.credentials).toBe("include");
    expect(new Headers(request?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf");
  });

  it("rejects a PayFast response whose shipping-inclusive breakdown is inconsistent", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf" });
      return jsonResponse({
        paymentAttemptId: "attempt-1",
        merchantReference: "HW-1",
        amountCents: 3300,
        currency: "ZAR",
        amountBreakdown: {
          productSubtotalCents: 2500,
          discountCents: 0,
          shippingCents: 700,
          additionalChargesCents: 0,
          totalCents: 3300,
        },
        checkoutUrl: "https://sandbox.payfast.co.za/eng/process",
        method: "POST",
        fields: { amount: "33.00", signature: "signed" },
      });
    });
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    await expect(api.initiatePayFastCheckout("order-1")).rejects.toMatchObject({
      name: "ApiResponseError",
      message: "Backend returned an invalid order or shipping response.",
    });
  });
});
