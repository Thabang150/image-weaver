import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authApi, type NewAddressInput, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import {
  CUSTOMER_ORDER_LIFETIME_MS,
  SHIPPING_RATE_LIFETIME_MS,
  ordersApi,
  type CartShippingRate,
  type CustomerOrder,
  type PayFastCheckout,
} from "@/lib/api/orders";
import { cartApi } from "@/lib/api/cart";
import { formatZarCents } from "@/lib/money";
import { useCart } from "@/components/storefront/cart";
import { ApiHttpError } from "@/lib/api/client";
import {
  customerDeliveryName,
  estimateForConfirmedDelivery,
  estimatedDeliveryText,
} from "@/lib/delivery-presentation";
import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
  SOUTH_AFRICAN_PROVINCES,
} from "@/lib/south-african-address";
import { MapboxAddressAutocomplete } from "@/components/storefront/address-autocomplete";

const inputClass = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const ORDER_KEY = "healthyways.checkout.orderId";
const IDEMPOTENCY_KEYS = "healthyways.checkout.idempotencyKeys";
type CartFingerprintSource = {
  items: Array<{ productId: string; quantity: number }>;
};

function cartFingerprint(cart: CartFingerprintSource | undefined) {
  return (cart?.items ?? [])
    .map((item) => `${item.productId}:${item.quantity}`)
    .sort()
    .join("|");
}

function checkoutFingerprint(
  userId: string,
  addressId: string,
  cart: CartFingerprintSource | undefined,
) {
  return `${userId}:${addressId}:${cartFingerprint(cart)}`;
}

function idempotencyKey(
  userId: string,
  addressId: string,
  cart: CartFingerprintSource | undefined,
) {
  const fingerprint = checkoutFingerprint(userId, addressId, cart);
  let keys: Record<string, string> = {};
  try {
    keys = JSON.parse(sessionStorage.getItem(IDEMPOTENCY_KEYS) ?? "{}");
  } catch {
    keys = {};
  }
  const existing = keys[fingerprint];
  if (existing) return existing;
  const created = `checkout-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  keys[fingerprint] = created;
  sessionStorage.setItem(IDEMPOTENCY_KEYS, JSON.stringify(keys));
  return created;
}

function matchesSelectedAddress(order: CustomerOrder, address: PublicAddress) {
  const selected = {
    recipientName: address.recipientName,
    phoneNumber: address.phoneNumber,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? "",
    localArea: address.localArea ?? "",
    addressType: address.addressType ?? "residential",
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    country: address.country,
    lat: address.lat,
    lng: address.lng,
  };
  const delivery = order.deliveryAddress;
  return (
    [
      selected.recipientName,
      selected.phoneNumber,
      selected.addressLine1,
      selected.addressLine2,
      selected.localArea,
      selected.addressType,
      selected.city,
      selected.province,
      selected.postalCode,
      selected.country,
      selected.lat === undefined ? "" : String(selected.lat),
      selected.lng === undefined ? "" : String(selected.lng),
    ]
      .map((value) => value.trim().toLowerCase())
      .join("|") ===
    [
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
      .join("|")
  );
}

function matchesCart(order: CustomerOrder, cart: CartFingerprintSource | undefined) {
  const ordered = order.items
    .map((item) => `${item.productId}:${item.quantity}`)
    .sort()
    .join("|");
  return ordered === cartFingerprint(cart);
}

function recoverableOrder(order: CustomerOrder) {
  if (Date.parse(order.createdAt) + CUSTOMER_ORDER_LIFETIME_MS <= Date.now()) {
    return {
      eligible: false,
      reason: "This order has expired. Review or cancel it from My Orders.",
    };
  }
  const unresolved = order.paymentAttempts.some(
    (attempt) => attempt.status === "pending" || attempt.status === "reconciliation",
  );
  if (order.status === "paid")
    return { eligible: false, reason: "This order has already been paid." };
  if (order.status === "cancelled")
    return { eligible: false, reason: "This order has been cancelled." };
  if (order.status === "payment_reconciliation" || unresolved)
    return {
      eligible: false,
      reason:
        "Payment confirmation or reconciliation is unresolved. Do not create another order; continue from My Orders.",
    };
  if (order.stockReservationStatus !== "reserved")
    return {
      eligible: false,
      reason: "This order's stock reservation has expired or is no longer active.",
    };
  return {
    eligible: order.status === "pending_payment",
    reason: "This order can continue checkout.",
  };
}

function currentShippingQuote(order: CustomerOrder): order is CustomerOrder & {
  shippingQuote: NonNullable<CustomerOrder["shippingQuote"]>;
} {
  const quote = order.shippingQuote;
  const confirmedAt = quote ? Date.parse(quote.confirmedAt) : Number.NaN;
  const orderCreatedAt = Date.parse(order.createdAt);
  return (
    quote?.status === "confirmed" &&
    Number.isFinite(confirmedAt) &&
    confirmedAt + SHIPPING_RATE_LIFETIME_MS > Date.now() &&
    Number.isFinite(orderCreatedAt) &&
    orderCreatedAt + CUSTOMER_ORDER_LIFETIME_MS > Date.now() &&
    (!quote.expiresAt || Date.parse(quote.expiresAt) > Date.now())
  );
}

function withoutShippingQuote(order: CustomerOrder | null): CustomerOrder | null {
  if (!order) return null;
  const { shippingQuote: _shippingQuote, ...orderWithoutQuote } = order;
  return { ...orderWithoutQuote, totalCents: order.subtotalCents };
}

function submitPayFast(checkout: PayFastCheckout) {
  const form = document.createElement("form");
  form.method = checkout.method;
  form.action = checkout.checkoutUrl;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function DeliveryOptionList({
  rates,
  name,
  selectedQuote,
  disabled,
  onSelect,
}: {
  rates: CartShippingRate[];
  name: string;
  selectedQuote: string;
  disabled: boolean;
  onSelect: (quoteId: string) => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      {rates.map((rate, index) => {
        const selected = selectedQuote === rate.quoteId;
        const label = customerDeliveryName(rate.serviceLevel.name, index);
        return (
          <label
            key={rate.quoteId}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-sm transition-colors ${
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
            }`}
          >
            <span className="flex min-w-0 items-start gap-3">
              <input
                type="radio"
                name={name}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(rate.quoteId)}
                aria-label={label}
              />
              <span className="min-w-0">
                <strong className="block">{label}</strong>
                <span className="mt-1 block text-muted-foreground">
                  {estimatedDeliveryText(rate)}
                </span>
              </span>
            </span>
            <strong className="whitespace-nowrap">{formatZarCents(rate.rateCents)}</strong>
          </label>
        );
      })}
    </div>
  );
}

export function CheckoutPage({
  user,
  onNavigate,
}: {
  user: PublicUser;
  onNavigate: (view: string, returnTo?: string, orderId?: string) => void;
}) {
  const queryClient = useQueryClient();
  const { cart, retryCart, removeItem, isBusy } = useCart();
  const [addressId, setAddressId] = useState(
    () => user.addresses.find((a: PublicAddress) => a.isDefault)?.id ?? user.addresses[0]?.id ?? "",
  );
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [rates, setRates] = useState<CartShippingRate[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<string>("");
  const [cartQuoteId, setCartQuoteId] = useState<string>("");
  const [ratesExpireAt, setRatesExpireAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressType, setAddressType] = useState<"residential" | "business">("residential");
  const [address, setAddress] = useState<{
    label: string;
    recipientName: string;
    phoneNumber: string;
    addressLine1: string;
    addressLine2: string;
    localArea: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    lat?: number;
    lng?: number;
  }>({
    label: "Delivery",
    recipientName: "",
    phoneNumber: "",
    addressLine1: "",
    addressLine2: "",
    localArea: "",
    city: "",
    province: "",
    postalCode: "",
    country: "South Africa",
  });
  const [recoveryState, setRecoveryState] = useState<"loading" | "eligible" | "stale" | "none">(
    "none",
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(ORDER_KEY);
    if (!saved) return;
    setRecoveryState("loading");
    void ordersApi
      .getCustomerOrder(saved)
      .then((recovered) => {
        setRecoveryState("eligible");
        setOrder(recovered);
        const quoteExpiresAt = recovered.shippingQuote?.expiresAt
          ? Date.parse(recovered.shippingQuote.expiresAt)
          : Date.parse(recovered.shippingQuote?.confirmedAt ?? "") + SHIPPING_RATE_LIFETIME_MS;
        if (Number.isFinite(quoteExpiresAt)) setRatesExpireAt(quoteExpiresAt);
        if (recovered.shippingQuote) setSelectedQuote(recovered.shippingQuote.quoteId ?? "");
      })
      .catch(() => {
        sessionStorage.removeItem(ORDER_KEY);
        setRecoveryState("stale");
        setOrder(null);
        setMessage(
          "We could not verify your saved order. It was not cancelled or changed; start checkout again when the order can be confirmed.",
        );
      });
  }, []);

  useEffect(() => {
    if (ratesExpireAt === undefined) return;
    const timer = window.setTimeout(
      () => {
        setRates([]);
        setSelectedQuote("");
        setCartQuoteId("");
        setRatesExpireAt(undefined);
        setOrder((current) => (current?.shippingQuote ? withoutShippingQuote(current) : current));
        setMessage("Delivery rates expired. Request current delivery options before continuing.");
      },
      Math.max(0, ratesExpireAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [ratesExpireAt]);

  const selectedAddress = user.addresses.find((entry) => entry.id === addressId);
  const recovery = order ? recoverableOrder(order) : { eligible: false, reason: "" };
  const recoveredAddressMatches = Boolean(
    order && selectedAddress && matchesSelectedAddress(order, selectedAddress),
  );
  const recoveredCartMatches = Boolean(order && matchesCart(order, cart));
  const recoveryBlocked = Boolean(
    order &&
    (!recovery.eligible ||
      !recoveredAddressMatches ||
      (cart?.items.length !== 0 && !recoveredCartMatches)),
  );

  const deliveryCharge = order?.shippingQuote?.chargeCents ?? 0;
  const selectedCartRate = rates.find((rate) => rate.quoteId === selectedQuote);
  const selectedOrderRate = rates.find((rate) => rate.quoteId === selectedQuote);
  const cartTotalWithDelivery =
    selectedCartRate && cart ? cart.totalCents + selectedCartRate.rateCents : undefined;
  const currentOrderQuote = Boolean(order && currentShippingQuote(order));
  const orderTotalWithDelivery =
    order && currentOrderQuote
      ? order.totalCents
      : order && selectedOrderRate
        ? order.subtotalCents + selectedOrderRate.rateCents
        : undefined;
  const hasUnavailable = Boolean(cart?.hasUnavailableItems);
  const unavailableItems =
    cart?.items.filter(
      (item) =>
        !item.available ||
        (item.stockQuantity !== undefined &&
          (item.stockQuantity === 0 || item.quantity > item.stockQuantity)),
    ) ?? [];
  const canCreate = Boolean(addressId && cart?.items.length && !hasUnavailable);

  async function saveAddress(event: FormEvent) {
    event.preventDefault();
    const province = normalizeSouthAfricanProvince(address.province);
    if (!address.localArea.trim()) {
      setMessage("Enter the suburb or local area for this delivery address.");
      return;
    }
    if (!province || !isSouthAfricanPostalCode(address.postalCode)) {
      setMessage("Enter a supported South African province and a four-digit postal code.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const addressInput: NewAddressInput = {
        ...address,
        addressType,
        province,
        postalCode: address.postalCode.trim(),
        localArea: address.localArea.trim(),
      };
      const initiatingUserId = user.id;
      const updated = await authApi.addAddress(addressInput);
      const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>([
        "session",
      ]);
      if (session?.status === "authenticated" && session.user?.id === initiatingUserId) {
        queryClient.setQueryData(["session"], { status: "authenticated", user: updated });
      }
      const created =
        updated.addresses.find(
          (entry) =>
            entry.isDefault && !user.addresses.some((existing) => existing.id === entry.id),
        ) ??
        updated.addresses.find(
          (entry) => !user.addresses.some((existing) => existing.id === entry.id),
        );
      if (created) {
        setAddressId(created.id);
        setRates([]);
        setSelectedQuote("");
        setCartQuoteId("");
      }
      setShowAddressForm(false);
    } catch (error) {
      setMessage(
        error instanceof ApiHttpError
          ? "The address could not be saved. Check the required fields and try again."
          : "Address saving is unavailable. Your progress has been kept.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadQuotes(existingOrder: CustomerOrder) {
    try {
      const quoteResponse = await ordersApi.getShippingQuotes(existingOrder.id);
      setRates(quoteResponse.rates ?? []);
      const expiryTimes = (quoteResponse.rates ?? [])
        .map((rate) => Date.parse(rate.retrievedAt ?? ""))
        .filter(Number.isFinite)
        .map((retrievedAt) => retrievedAt + SHIPPING_RATE_LIFETIME_MS);
      setRatesExpireAt(expiryTimes.length ? Math.min(...expiryTimes) : undefined);
      setSelectedQuote("");
      setOrder(await ordersApi.getCustomerOrder(existingOrder.id));
    } catch (error) {
      setSelectedQuote("");
      setRates([]);
      setOrder(withoutShippingQuote);
      setMessage(
        error instanceof ApiHttpError && error.status === 422
          ? "No delivery quote is available for this address. Review the address or choose another saved address."
          : "Delivery quotes are temporarily unavailable or the order is no longer eligible. Your order has not been cancelled.",
      );
    }
  }

  async function requestCartQuotes() {
    if (!canCreate || order) return;
    if (!selectedAddress?.localArea?.trim()) {
      setMessage(
        "Add the suburb or local area to this saved address before requesting delivery rates. Update it in My account or choose another address.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    setRates([]);
    setSelectedQuote("");
    setCartQuoteId("");
    setRatesExpireAt(undefined);
    try {
      const latestCart = await cartApi.getCart();
      queryClient.setQueryData(["cart", user.id], latestCart);
      if (latestCart.hasUnavailableItems || cartFingerprint(latestCart) !== cartFingerprint(cart)) {
        setMessage(
          "Your cart availability changed. Review the refreshed cart before requesting delivery rates.",
        );
        return;
      }
      const response = await ordersApi.createCartShippingQuote(addressId);
      setCartQuoteId(response.quoteId);
      setRatesExpireAt(Date.parse(response.expiresAt));
      setRates(response.rates);
      if (response.rates.length === 0)
        setMessage("No delivery options are available for this address.");
    } catch (error) {
      setMessage(
        error instanceof ApiHttpError && error.status === 400
          ? "Check that your delivery address has a street, suburb, city, supported province and four-digit postal code."
          : error instanceof ApiHttpError && error.status === 422
            ? "No delivery options were returned for this address. Review it or contact us for help."
            : error instanceof ApiHttpError && error.status === 409
              ? "Delivery or parcel details need review. Refresh checkout or contact us for help; no order has been created."
              : "Delivery quotes are temporarily unavailable. No order has been created and your cart remains unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!canCreate || recoveryBlocked || !cartQuoteId || !selectedQuote) return;
    setBusy(true);
    setMessage(null);
    try {
      const latestCart = await cartApi.getCart();
      queryClient.setQueryData(["cart", user.id], latestCart);
      if (latestCart.hasUnavailableItems || cartFingerprint(latestCart) !== cartFingerprint(cart)) {
        setMessage(
          "Stock or cart contents changed after delivery rates were requested. Review the refreshed cart and request new rates.",
        );
        return;
      }
      const next = await ordersApi.createOrder(
        addressId,
        cartQuoteId,
        idempotencyKey(user.id, addressId, latestCart),
      );
      sessionStorage.setItem(ORDER_KEY, next.id);
      setOrder(next);
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 409) {
        setMessage(
          "The delivery rate expired or your order/cart changed. Request fresh rates and retry; no order was created.",
        );
      } else {
        setMessage(
          "We could not create the order. Your cart and checkout details are still here; please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function selectRate(quoteId: string) {
    setBusy(true);
    setMessage(null);
    try {
      if (!order) {
        if (!cartQuoteId) throw new Error("Missing delivery quote.");
        await ordersApi.selectCartShippingRate(cartQuoteId, quoteId);
        setSelectedQuote(quoteId);
        return;
      }
      await ordersApi.selectShippingQuote(order.id, quoteId);
      setSelectedQuote(quoteId);
      const authoritative = await ordersApi.getCustomerOrder(order.id);
      setOrder(authoritative);
      setMessage(
        authoritative.shippingQuote
          ? "Delivery option saved."
          : "The delivery option was accepted. Refresh the order before continuing to payment.",
      );
    } catch {
      setRates([]);
      setSelectedQuote("");
      setRatesExpireAt(undefined);
      setCartQuoteId("");
      if (order?.shippingQuote) {
        try {
          setOrder(await ordersApi.getCustomerOrder(order.id));
        } catch {
          /* Keep the checkout visible while status refresh fails. */
        }
      }
      setSelectedQuote("");
      setMessage(
        "That delivery quote is no longer available. Request delivery quotes again; no old quote is being used for payment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!order || !currentShippingQuote(order) || recoveryBlocked) {
      setMessage(
        "Payment is blocked until the saved checkout matches the current cart and address and the order is eligible for payment.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      submitPayFast(await ordersApi.createPayFastCheckout(order.id));
    } catch (error) {
      setMessage(
        error instanceof ApiHttpError && error.status === 409
          ? "Payment cannot be started yet. Wait for any reconciliation to finish or continue from My Orders."
          : "PayFast could not be opened. Your order has not been cancelled; please retry.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <span className="eyebrow">Secure checkout</span>
      <h1 className="section-title mt-3">Delivery and payment</h1>
      {message ? (
        <p role="status" className="mt-5 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {message}
        </p>
      ) : null}
      {hasUnavailable ? (
        <div className="mt-5 rounded-md border border-destructive/40 p-4">
          <p>
            Unavailable products cannot be checked out. Remove them or reduce the quantity of items
            that exceed available stock.
          </p>
          {unavailableItems.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {unavailableItems.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>
                    {item.product?.name ?? item.productId} · quantity {item.quantity}
                    {item.stockQuantity !== undefined ? ` · ${item.stockQuantity} available` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      void removeItem(item.productId).catch(() =>
                        setMessage(
                          "This unavailable item could not be removed. Please retry from your cart.",
                        ),
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button variant="outline" className="mt-3" onClick={() => void retryCart()}>
            Refresh cart
          </Button>
        </div>
      ) : null}
      {recoveryState === "loading" ? (
        <p role="status" className="mt-5 text-sm">
          Checking your saved order…
        </p>
      ) : null}
      {order && recoveryBlocked ? (
        <div role="alert" className="mt-5 rounded-md border border-destructive/40 p-4 text-sm">
          <p>
            {!recovery.eligible
              ? recovery.reason
              : !recoveredAddressMatches
                ? "The saved order used a different delivery address. It cannot be reused for the address currently selected."
                : "Your cart has changed since this order was created. The saved order cannot be continued with the current cart."}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              sessionStorage.removeItem(ORDER_KEY);
              setOrder(null);
              setRates([]);
              setSelectedQuote("");
              setRecoveryState("none");
              setMessage(
                "The saved checkout has been cleared. Review your current cart and address, then start a new checkout.",
              );
            }}
          >
            Start a fresh checkout
          </Button>
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-xl font-medium">Delivery address</h2>
          {user.addresses.length ? (
            <div className="mt-4 space-y-3">
              {user.addresses.map((entry: PublicAddress) => (
                <label
                  key={entry.id}
                  className="flex gap-3 rounded-md border border-border p-3 text-sm"
                >
                  <input
                    type="radio"
                    checked={addressId === entry.id}
                    onChange={() => {
                      setAddressId(entry.id);
                      setRates([]);
                      setRatesExpireAt(undefined);
                      setSelectedQuote("");
                      setCartQuoteId("");
                    }}
                    disabled={Boolean(order)}
                  />
                  <span>
                    <strong>{entry.label}</strong>
                    {entry.isDefault ? " · Default" : null}
                    <br />
                    {entry.recipientName}
                    <br />
                    {entry.addressLine1}
                    {entry.addressLine2 ? `, ${entry.addressLine2}` : ""}
                    {entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city}, {entry.province}
                    <br />
                    {entry.postalCode}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm">Add a delivery address to continue.</p>
          )}
          {selectedAddress && !selectedAddress.localArea?.trim() ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              This saved address needs a suburb or local area before delivery rates can be
              requested. Update it in My account or choose another address.
            </p>
          ) : null}
          {!order ? (
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setShowAddressForm(!showAddressForm)}
            >
              {showAddressForm ? "Cancel new address" : "Add a new address"}
            </Button>
          ) : null}
          {showAddressForm ? (
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveAddress}>
              <MapboxAddressAutocomplete
                disabled={busy}
                onSelect={(selected) => {
                  setAddress((current) => {
                    const nextAddress = {
                      ...current,
                      addressLine1: selected.addressLine1 ?? "",
                      localArea: selected.localArea ?? "",
                      city: selected.city ?? "",
                      province: selected.province ?? "",
                      postalCode: selected.postalCode ?? "",
                      country: selected.country ?? "South Africa",
                    };
                    delete nextAddress.lat;
                    delete nextAddress.lng;
                    if (selected.lat !== undefined && selected.lng !== undefined) {
                      nextAddress.lat = selected.lat;
                      nextAddress.lng = selected.lng;
                    }
                    return nextAddress;
                  });
                  setMessage(null);
                }}
              />
              {Object.entries(address)
                .filter(
                  ([key]) =>
                    key !== "country" &&
                    key !== "addressLine2" &&
                    key !== "province" &&
                    key !== "lat" &&
                    key !== "lng",
                )
                .map(([key, value]) => (
                  <label className="space-y-1 text-sm" key={key}>
                    <span>{key.replace(/([A-Z])/g, " $1")}</span>
                    <input
                      required
                      type="text"
                      inputMode={key === "postalCode" ? "numeric" : undefined}
                      pattern={key === "postalCode" ? "[0-9]{4}" : undefined}
                      maxLength={key === "postalCode" ? 4 : undefined}
                      className={inputClass}
                      value={value}
                      onChange={(e) => {
                        const nextAddress = { ...address, [key]: e.currentTarget.value };
                        if (
                          key === "addressLine1" ||
                          key === "localArea" ||
                          key === "city" ||
                          key === "province" ||
                          key === "postalCode"
                        ) {
                          delete nextAddress.lat;
                          delete nextAddress.lng;
                        }
                        setAddress(nextAddress);
                      }}
                    />
                  </label>
                ))}
              <label className="space-y-1 text-sm">
                <span>Apartment, unit or complex (optional)</span>
                <input
                  type="text"
                  maxLength={120}
                  className={inputClass}
                  value={address.addressLine2}
                  onChange={(event) => {
                    const nextAddress = {
                      ...address,
                      addressLine2: event.currentTarget.value,
                    };
                    delete nextAddress.lat;
                    delete nextAddress.lng;
                    setAddress(nextAddress);
                  }}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Province</span>
                <select
                  className={inputClass}
                  required
                  value={address.province}
                  onChange={(event) => {
                    const nextAddress = { ...address, province: event.currentTarget.value };
                    delete nextAddress.lat;
                    delete nextAddress.lng;
                    setAddress(nextAddress);
                  }}
                >
                  <option value="">Select a province</option>
                  {SOUTH_AFRICAN_PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Address type</span>
                <select
                  className={inputClass}
                  value={addressType}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === "residential" || value === "business") {
                      setAddressType(value);
                    }
                  }}
                >
                  <option value="residential">Residential</option>
                  <option value="business">Business</option>
                </select>
              </label>
              <div className="sm:col-span-2">
                <Button disabled={busy}>{busy ? "Saving…" : "Save address"}</Button>
              </div>
            </form>
          ) : null}
        </section>
        <aside className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-xl font-medium">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatZarCents(order?.subtotalCents ?? cart?.totalCents ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Delivery</dt>
              <dd>
                {currentOrderQuote
                  ? formatZarCents(deliveryCharge)
                  : selectedOrderRate
                    ? formatZarCents(selectedOrderRate.rateCents)
                    : selectedCartRate
                      ? formatZarCents(selectedCartRate.rateCents)
                      : "Select quote"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base">
              <dt>
                <strong>Total</strong>
              </dt>
              <dd>
                <strong>
                  {order
                    ? orderTotalWithDelivery === undefined
                      ? "Select delivery"
                      : formatZarCents(orderTotalWithDelivery)
                    : cartTotalWithDelivery === undefined
                      ? "Select delivery"
                      : formatZarCents(cartTotalWithDelivery)}
                </strong>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
      {!order && !cartQuoteId ? (
        <Button
          className="mt-6"
          disabled={!canCreate || !selectedAddress?.localArea?.trim() || busy || recoveryBlocked}
          onClick={() => void requestCartQuotes()}
        >
          {busy ? "Requesting delivery rates…" : "Request delivery rates"}
        </Button>
      ) : null}
      {!order && cartQuoteId ? (
        rates.length === 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3" role="status">
            <p className="text-sm text-muted-foreground">
              No delivery options are available for this address.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void requestCartQuotes()}
            >
              Refresh delivery options
            </Button>
          </div>
        ) : null
      ) : null}
      {!order && cartQuoteId && rates.length > 0 ? (
        <Button
          className="mt-6"
          disabled={!canCreate || busy || recoveryBlocked || !selectedQuote}
          onClick={() => void create()}
        >
          {busy ? "Creating order…" : "Confirm delivery and create order"}
        </Button>
      ) : null}
      {!order && rates.length ? (
        <section className="mt-6 rounded-lg border border-border p-5">
          <h2 className="text-xl font-medium">Choose delivery</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Rates are valid for five minutes. Confirm delivery before they expire.
          </p>
          <DeliveryOptionList
            rates={rates}
            name="cart-quote"
            selectedQuote={selectedQuote}
            disabled={busy}
            onSelect={(quoteId) => void selectRate(quoteId)}
          />
        </section>
      ) : null}
      {order && !currentShippingQuote(order) ? (
        <section className="mt-6 rounded-lg border border-border p-5">
          <h2 className="text-xl font-medium">Choose delivery</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Delivery rates expire after five minutes. Request a current rate before payment.
          </p>
          {rates.length ? (
            <DeliveryOptionList
              rates={rates}
              name="quote"
              selectedQuote={selectedQuote}
              disabled={busy || recoveryBlocked}
              onSelect={(quoteId) => void selectRate(quoteId)}
            />
          ) : (
            <p className="mt-3 text-sm">
              Delivery quotes are not available yet. Request rates after reviewing your address.
            </p>
          )}
          <Button
            variant="outline"
            className="mt-4"
            disabled={busy || recoveryBlocked}
            onClick={() => void loadQuotes(order)}
          >
            Request current delivery rates
          </Button>
        </section>
      ) : null}
      {order && currentShippingQuote(order) ? (
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <p className="text-sm">
            <strong>
              {customerDeliveryName(order.shippingQuote.serviceName)} ·{" "}
              {formatZarCents(order.shippingQuote.chargeCents)}
            </strong>
            <br />
            {estimateForConfirmedDelivery(
              order.shippingQuote.serviceName,
              order.shippingQuote.deliveryDateFrom,
              order.shippingQuote.deliveryDateTo,
            )}
          </p>
          <p className="mt-3 text-sm">
            <strong>Selected delivery address:</strong>
            <br />
            {order.deliveryAddress.recipientName}
            <br />
            {order.deliveryAddress.addressLine1}
            {order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ""}
            {order.deliveryAddress.localArea ? `, ${order.deliveryAddress.localArea}` : ""}
            <br />
            {order.deliveryAddress.city}, {order.deliveryAddress.province},{" "}
            {order.deliveryAddress.postalCode}
          </p>
          {recoveryBlocked ? (
            <p role="status" className="mt-4 text-sm text-destructive">
              Payment is blocked until the checkout issue shown above is resolved.
            </p>
          ) : null}
          <Button className="mt-4" disabled={busy || recoveryBlocked} onClick={() => void pay()}>
            {busy ? "Opening PayFast…" : "Continue to PayFast"}
          </Button>
        </section>
      ) : null}
    </main>
  );
}
