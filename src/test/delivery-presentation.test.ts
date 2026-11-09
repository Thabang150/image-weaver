import { describe, expect, it } from "vitest";
import { customerDeliveryName, estimatedDeliveryText } from "@/lib/delivery-presentation";
import type { CartShippingRate } from "@/lib/api/orders";

function rate(
  serviceName: string,
  deliveryDateFrom?: string,
  deliveryDateTo?: string,
): CartShippingRate {
  return {
    quoteId: "quote-1",
    serviceLevel: {
      name: serviceName,
      ...(deliveryDateFrom ? { deliveryDateFrom } : {}),
      ...(deliveryDateTo ? { deliveryDateTo } : {}),
    },
    rateCents: 12345,
    currency: "ZAR",
  };
}

describe("customer delivery presentation", () => {
  it("maps courier service names to simple customer labels", () => {
    expect(customerDeliveryName("Express Overnight Service")).toBe("Express delivery");
    expect(customerDeliveryName("Economy Road")).toBe("Standard delivery");
    expect(customerDeliveryName("TCG-EPX-042")).toBe("Delivery option 1");
    expect(customerDeliveryName("TCG-EPX-042", 1)).toBe("Delivery option 2");
  });

  it("formats provider-supplied delivery dates without inventing a timeframe", () => {
    expect(estimatedDeliveryText(rate("Express", "2026-11-12", "2026-11-14"))).toBe(
      "Estimated delivery: 12 November 2026–14 November 2026",
    );
    expect(estimatedDeliveryText(rate("Standard", "2026-11-12"))).toBe(
      "Estimated delivery: 12 November 2026",
    );
    expect(estimatedDeliveryText(rate("Unmapped service"))).toBe(
      "Estimated timing not provided by the courier",
    );
  });
});
