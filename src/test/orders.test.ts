import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { canRetryCustomerPayment, createOrdersApi, type CustomerOrder } from "@/lib/api/orders";

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
  fulfillmentStatus: "awaiting_payment",
  stockReservationStatus: "reserved",
  paymentAttempts: [],
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
} satisfies CustomerOrder;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("customer order history API", () => {
  it("does not allow payment retry with an expired five-minute shipping rate", () => {
    const now = Date.now();
    const retryableOrder = {
      ...order,
      createdAt: new Date(now).toISOString(),
      paymentAttempts: [
        {
          id: "attempt-1",
          status: "failed" as const,
          amountCents: 3300,
          currency: "ZAR" as const,
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        },
      ],
      shippingQuote: {
        chargeCents: 800,
        serviceName: "Standard",
        confirmedAt: new Date(now - 6 * 60 * 1000).toISOString(),
        status: "confirmed" as const,
      },
    };

    expect(canRetryCustomerPayment(retryableOrder)).toBe(false);
  });

  it("sends selected opt-in IDs with cart rate requests and keeps the provider rate as the full delivery amount", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf" });
      if (url.pathname.endsWith("/shipping/opt-in-rates")) {
        return jsonResponse({
          optInRates: [
            {
              id: 11,
              name: "Fragile",
              chargeType: "fixed",
              chargeCents: 500,
              optedInByDefault: false,
            },
          ],
          optInTimeBasedRates: [
            {
              id: 22,
              name: "Weekend",
              chargeType: "fixed",
              chargeCents: 800,
              optedInByDefault: false,
            },
          ],
        });
      }
      if (url.pathname.endsWith("/shipping/quote")) {
        return jsonResponse({
          quoteId: "quote-1",
          expiresAt: "2026-10-17T00:05:00.000Z",
          currency: "ZAR",
          rates: [
            {
              quoteId: "rate-1",
              serviceLevel: {
                id: "service-1",
                code: "standard",
                name: "Standard",
                deliveryDateFrom: "2026-10-19",
                deliveryDateTo: "2026-10-21",
              },
              rateCents: 1800,
              currency: "ZAR",
              retrievedAt: "2026-10-17T00:00:00.000Z",
            },
          ],
        });
      }
      return jsonResponse({ error: "Not found" }, 404);
    });
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    await expect(api.getCartShippingOptInRates("address-1")).resolves.toMatchObject({
      optInRates: [{ id: 11, chargeCents: 500 }],
      optInTimeBasedRates: [{ id: 22, chargeCents: 800 }],
    });
    const quote = await api.createCartShippingQuote("address-1", {
      optInRateIds: [11],
      optInTimeBasedRateIds: [22],
    });

    expect(quote.rates[0]?.rateCents).toBe(1800);
    expect(quote.rates[0]?.serviceLevel.deliveryDateFrom).toBe("2026-10-19");
    expect(quote.rates[0]?.serviceLevel.deliveryDateTo).toBe("2026-10-21");
    expect(quote.rates[0]?.retrievedAt).toBe("2026-10-17T00:00:00.000Z");
    const quoteRequest = fetcher.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith("/shipping/quote"),
    );
    expect(JSON.parse(String(quoteRequest?.[1]?.body))).toEqual({
      addressId: "address-1",
      optInRateIds: [11],
      optInTimeBasedRateIds: [22],
    });
  });

  it("preserves validated opt-in selections on a confirmed order shipping quote", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        order: {
          ...order,
          fulfillmentStatus: "awaiting_payment",
          paymentAttempts: [],
          totalCents: 3300,
          shippingQuote: {
            quoteId: "rate-1",
            chargeCents: 800,
            serviceName: "Standard",
            confirmedAt: "2026-10-17T00:00:00.000Z",
            status: "confirmed",
            optInRateIds: [11],
            optInTimeBasedRateIds: [22],
          },
        },
      }),
    );
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    const result = await api.getCustomerOrder("order-1");

    expect(result.shippingQuote?.optInRateIds).toEqual([11]);
    expect(result.shippingQuote?.optInTimeBasedRateIds).toEqual([22]);
  });

  it("parses the quote-first order-creation envelope and rejects malformed order data", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf" });
      if (url.pathname.endsWith("/orders")) {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("order-submit-test-0001");
        expect(JSON.parse(String(init?.body))).toEqual({
          addressId: "address-1",
          shippingQuoteId: "shipping-quote-1",
        });
        return new Response(JSON.stringify({ order, replayed: false }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse({ error: "Not found" }, 404);
    });
    const api = createOrdersApi(createApiClient({ baseUrl: "https://api.example.test", fetcher }));

    await expect(
      api.createOrder("address-1", "shipping-quote-1", "order-submit-test-0001"),
    ).resolves.toEqual(order);

    const invalidFetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/csrf-token")) return jsonResponse({ csrfToken: "csrf" });
      return new Response(JSON.stringify({ order: { id: order.id }, replayed: false }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const invalidApi = createOrdersApi(
      createApiClient({ baseUrl: "https://api.example.test", fetcher: invalidFetcher }),
    );

    await expect(
      invalidApi.createOrder("address-1", "shipping-quote-1", "order-submit-test-0001"),
    ).rejects.toMatchObject({
      name: "ApiResponseError",
      status: 200,
    });
  });

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
      message: "Backend returned an invalid order response.",
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

    const result = await api.createPayFastCheckout("order-1");

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

    await expect(api.createPayFastCheckout("order-1")).rejects.toMatchObject({
      name: "ApiResponseError",
      message: "Backend returned an invalid order response.",
    });
  });
});
