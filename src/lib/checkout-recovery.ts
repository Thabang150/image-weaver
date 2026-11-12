import type { CustomerOrder } from "@/lib/api/orders";

type CheckoutCart = {
  items: Array<{ productId: string; quantity: number }>;
};

type CheckoutAddress = {
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
};

export function matchesSelectedAddress(order: CustomerOrder, address: CheckoutAddress): boolean {
  if (order.fulfillmentMethod !== "delivery" || order.deliveryAddress === undefined) return false;
  const selected = [
    address.recipientName,
    address.phoneNumber,
    address.addressLine1,
    address.addressLine2 ?? "",
    address.localArea ?? "",
    address.addressType ?? "residential",
    address.city,
    address.province,
    address.postalCode,
    address.country,
    address.lat === undefined ? "" : String(address.lat),
    address.lng === undefined ? "" : String(address.lng),
  ]
    .map((value) => value.trim().toLowerCase())
    .join("|");
  const delivery = order.deliveryAddress;
  const ordered = [
    delivery.recipientName,
    delivery.phoneNumber,
    delivery.addressLine1,
    delivery.addressLine2 ?? "",
    delivery.localArea ?? "",
    delivery.addressType ?? "residential",
    delivery.city,
    delivery.province,
    delivery.postalCode,
    delivery.country,
    delivery.lat === undefined ? "" : String(delivery.lat),
    delivery.lng === undefined ? "" : String(delivery.lng),
  ]
    .map((value) => value.trim().toLowerCase())
    .join("|");
  return selected === ordered;
}

function cartFingerprint(cart: CheckoutCart | undefined): string {
  return (cart?.items ?? [])
    .map((item) => `${item.productId}:${item.quantity}`)
    .sort()
    .join("|");
}

export function matchesOrderCart(order: CustomerOrder, cart: CheckoutCart | undefined): boolean {
  return cartFingerprint({ items: order.items }) === cartFingerprint(cart);
}

export function findActiveCheckoutOrder(
  orders: CustomerOrder[],
  cart: CheckoutCart,
  selectedAddress?: CheckoutAddress,
  fulfillmentMethod: CustomerOrder["fulfillmentMethod"] = "delivery",
): { status: "found"; order: CustomerOrder } | { status: "none" | "ambiguous" } {
  if (cart.items.length === 0) return { status: "none" };
  const matchingOrders = orders.filter(
    (order) =>
      (order.status === "pending_payment" || order.status === "payment_reconciliation") &&
      order.fulfillmentMethod === fulfillmentMethod &&
      matchesOrderCart(order, cart),
  );
  const addressMatches = selectedAddress
    ? matchingOrders.filter((order) => matchesSelectedAddress(order, selectedAddress))
    : [];
  const candidates = addressMatches.length === 1 ? addressMatches : matchingOrders;
  if (candidates.length === 1) return { status: "found", order: candidates[0]! };
  return { status: candidates.length === 0 ? "none" : "ambiguous" };
}
