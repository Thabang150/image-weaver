import type { CartShippingRate } from "@/lib/api/orders";

export function customerDeliveryName(serviceName: string | undefined, index = 0): string {
  const normalized = serviceName?.toLowerCase() ?? "";
  if (/\b(express|overnight|next[\s-]?day|same[\s-]?day)\b/.test(normalized)) {
    return "Express delivery";
  }
  if (/\b(standard|economy|regular)\b/.test(normalized)) {
    return "Standard delivery";
  }
  return `Delivery option ${index + 1}`;
}

function formatDeliveryDate(value: string): string | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12))
    : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(parsed);
}

export function estimatedDeliveryText(rate: CartShippingRate): string {
  const from = rate.serviceLevel.deliveryDateFrom
    ? formatDeliveryDate(rate.serviceLevel.deliveryDateFrom)
    : undefined;
  const to = rate.serviceLevel.deliveryDateTo
    ? formatDeliveryDate(rate.serviceLevel.deliveryDateTo)
    : undefined;
  if (from && to && from !== to) return `Estimated delivery: ${from}–${to}`;
  if (from ?? to) return `Estimated delivery: ${from ?? to}`;
  return "Estimated timing not provided by the courier";
}

export function estimateForConfirmedDelivery(
  serviceName: string | undefined,
  deliveryDateFrom: string | undefined,
  deliveryDateTo: string | undefined,
): string {
  return estimatedDeliveryText({
    quoteId: "",
    serviceLevel: {
      name: serviceName ?? "",
      ...(deliveryDateFrom ? { deliveryDateFrom } : {}),
      ...(deliveryDateTo ? { deliveryDateTo } : {}),
    },
    rateCents: 0,
    currency: "ZAR",
  });
}
