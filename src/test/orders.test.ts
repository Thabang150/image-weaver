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
});
