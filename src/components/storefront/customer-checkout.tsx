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
  type FulfillmentOptions,
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
import { AddressLocationFields } from "@/components/storefront/address-autocomplete";
import {
  checkoutTraceHeaders,
  getCheckoutTraceId,
  logCheckoutDiagnostic,
} from "@/lib/checkout-diagnostics";
import {
  clearSavedCheckoutOrder,
  getCheckoutIdempotencyKey,
  getSavedCheckoutOrderId,
  saveCheckoutOrderId,
} from "@/lib/checkout-storage";
import {
  findActiveCheckoutOrder,
  matchesOrderCart,
  matchesSelectedAddress,
} from "@/lib/checkout-recovery";

const inputClass = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
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
  fulfillmentMethod: CustomerOrder["fulfillmentMethod"],
  addressId: string,
  cart: CartFingerprintSource | undefined,
) {
  return fulfillmentMethod === "collection"
    ? `${userId}:collection:${cartFingerprint(cart)}`
    : `${userId}:${addressId}:${cartFingerprint(cart)}`;
}

function idempotencyKey(
  userId: string,
  fulfillmentMethod: CustomerOrder["fulfillmentMethod"],
  addressId: string,
  cart: CartFingerprintSource | undefined,
) {
  return getCheckoutIdempotencyKey(checkoutFingerprint(userId, fulfillmentMethod, addressId, cart));
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
  if (order.stockReservationStatus !== "reserved" && order.stockReservationStatus !== "unreserved")
    return {
      eligible: false,
      reason: "This order is no longer eligible for checkout.",
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

async function getCheckoutCart() {
  try {
    const cart = await cartApi.getCart({ headers: checkoutTraceHeaders() });
    logCheckoutDiagnostic("checkout.cart.validated", {
      status:
        cart.items.length === 0 ? "empty" : cart.hasUnavailableItems ? "unavailable" : "valid",
    });
    return cart;
  } catch (error) {
    logCheckoutDiagnostic("checkout.cart.validation.failed", {
      status: "failed",
      errorCode: "cart_validation_failed",
    });
    throw error;
  }
}

export function CheckoutPage({
  user,
  onNavigate,
}: {
  user: PublicUser;
  onNavigate: (view: string, returnTo?: string, orderId?: string) => void;
}) {
  const queryClient = useQueryClient();
  useEffect(() => {
    getCheckoutTraceId();
    logCheckoutDiagnostic("checkout.started");
  }, []);
  const { cart, retryCart, removeItem, isBusy } = useCart();
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<CustomerOrder["fulfillmentMethod"]>("delivery");
  const [fulfillmentOptions, setFulfillmentOptions] = useState<FulfillmentOptions>();
  const [fulfillmentOptionsError, setFulfillmentOptionsError] = useState(false);
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
  const [recoveryState, setRecoveryState] = useState<
    "loading" | "eligible" | "stale" | "none" | "ambiguous" | "unavailable"
  >("none");

  useEffect(() => {
    let active = true;
    void ordersApi
      .getFulfillmentOptions()
      .then((options) => {
        if (active) setFulfillmentOptions(options);
      })
      .catch(() => {
        if (active) setFulfillmentOptionsError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const saved = getSavedCheckoutOrderId();
    setRecoveryState("loading");

    const acceptOrder = (recovered: CustomerOrder) => {
      if (!active) return;
      setRecoveryState("eligible");
      setOrder(recovered);
      setFulfillmentMethod(recovered.fulfillmentMethod);
      saveCheckoutOrderId(recovered.id);
      const quoteExpiresAt = recovered.shippingQuote?.expiresAt
        ? Date.parse(recovered.shippingQuote.expiresAt)
        : Date.parse(recovered.shippingQuote?.confirmedAt ?? "") + SHIPPING_RATE_LIFETIME_MS;
      if (Number.isFinite(quoteExpiresAt)) setRatesExpireAt(quoteExpiresAt);
      if (recovered.shippingQuote) setSelectedQuote(recovered.shippingQuote.quoteId ?? "");
    };

    const discoverActiveOrder = async () => {
      const currentCart = await getCheckoutCart();
      if (!active) return;
      queryClient.setQueryData(["cart", user.id], currentCart);
      if (currentCart.items.length === 0) {
        setRecoveryState("none");
        return;
      }

      const matchingOrders: CustomerOrder[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await ordersApi.listCustomerOrders(page, 100, checkoutTraceHeaders());
        matchingOrders.push(...result.orders);
        totalPages = result.pagination.totalPages;
        page += 1;
      } while (active && page <= totalPages);

      if (!active) return;
      const selected = user.addresses.find((entry) => entry.id === addressId);
      const activeCheckout = findActiveCheckoutOrder(
        matchingOrders,
        currentCart,
        selected,
        fulfillmentMethod,
      );
      if (activeCheckout.status === "found") {
        acceptOrder(activeCheckout.order);
      } else if (activeCheckout.status === "ambiguous") {
        setRecoveryState("ambiguous");
        setMessage(
          "More than one active order matches this cart. No new order was created; review My Orders and continue the correct checkout.",
        );
      } else {
        setRecoveryState("none");
      }
    };

    const recover = async () => {
      if (saved) {
        try {
          acceptOrder(await ordersApi.getCustomerOrder(saved, checkoutTraceHeaders()));
          return;
        } catch {
          clearSavedCheckoutOrder();
        }
      }
      try {
        await discoverActiveOrder();
      } catch {
        if (!active) return;
        setRecoveryState("unavailable");
        setMessage(
          "We could not check for an existing order. No new order can be created until checkout status is verified; refresh the page or review My Orders.",
        );
      }
    };

    void recover();
    return () => {
      active = false;
    };
  }, [addressId, fulfillmentMethod, queryClient, user.addresses, user.id]);

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
  const recoveredMethodMatches = Boolean(order && order.fulfillmentMethod === fulfillmentMethod);
  const recoveredAddressMatches = Boolean(
    order &&
    (order.fulfillmentMethod === "collection" ||
      (selectedAddress && matchesSelectedAddress(order, selectedAddress))),
  );
  const recoveredCartMatches = Boolean(order && matchesOrderCart(order, cart));
  const recoveryBlocked = Boolean(
    recoveryState === "loading" ||
    recoveryState === "ambiguous" ||
    recoveryState === "unavailable" ||
    (order &&
      (!recovery.eligible ||
        !recoveredMethodMatches ||
        !recoveredAddressMatches ||
        (cart?.items.length !== 0 && !recoveredCartMatches))),
  );

  const deliveryCharge = order?.shippingQuote?.chargeCents ?? 0;
  const selectedCartRate = rates.find((rate) => rate.quoteId === selectedQuote);
  const selectedOrderRate = rates.find((rate) => rate.quoteId === selectedQuote);
  const cartTotalWithDelivery =
    fulfillmentMethod === "collection"
      ? cart?.totalCents
      : selectedCartRate && cart
        ? cart.totalCents + selectedCartRate.rateCents
        : undefined;
  const currentOrderQuote = Boolean(order && currentShippingQuote(order));
  const currentCollectionOrder = Boolean(
    order &&
    order.fulfillmentMethod === "collection" &&
    !order.shippingQuote &&
    order.totalCents === order.subtotalCents,
  );
  const orderReadyForPayment = Boolean(
    order &&
    recovery.eligible &&
    (order.fulfillmentMethod === "collection"
      ? currentCollectionOrder
      : currentShippingQuote(order)),
  );
  const orderTotalWithDelivery =
    order && currentCollectionOrder
      ? order.totalCents
      : order && currentOrderQuote
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
  const collectionContactReady = Boolean(user.displayName?.trim() && user.phoneNumber?.trim());
  const collectionAvailable = fulfillmentOptions?.collection.available === true;
  const configuredCollectionLocation = fulfillmentOptions?.collection.location;
  const collectionLocation = order?.collectionLocation
    ? { ...configuredCollectionLocation, ...order.collectionLocation }
    : configuredCollectionLocation;
  const collectionInstructions =
    order?.collectionLocation?.instructions ??
    configuredCollectionLocation?.instructions ??
    fulfillmentOptions?.collection.instructions;
  const canCreate = Boolean(
    cart?.items.length &&
    !hasUnavailable &&
    (fulfillmentMethod === "delivery" ? addressId : collectionAvailable && collectionContactReady),
  );

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
      const quoteResponse = await ordersApi.getShippingQuotes(
        existingOrder.id,
        undefined,
        checkoutTraceHeaders(),
      );
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
    const startedAt = performance.now();
    logCheckoutDiagnostic("checkout.quote.requested");
    try {
      const latestCart = await getCheckoutCart();
      queryClient.setQueryData(["cart", user.id], latestCart);
      if (latestCart.hasUnavailableItems || cartFingerprint(latestCart) !== cartFingerprint(cart)) {
        setMessage(
          "Your cart availability changed. Review the refreshed cart before requesting delivery rates.",
        );
        return;
      }
      const response = await ordersApi.createCartShippingQuote(
        addressId,
        undefined,
        checkoutTraceHeaders(),
      );
      setCartQuoteId(response.quoteId);
      setRatesExpireAt(Date.parse(response.expiresAt));
      setRates(response.rates);
      logCheckoutDiagnostic("checkout.quote.succeeded", {
        durationMs: performance.now() - startedAt,
        status: response.rates.length === 0 ? "no_rates" : "rates_returned",
      });
      if (response.rates.length === 0)
        setMessage("No delivery options are available for this address.");
    } catch (error) {
      logCheckoutDiagnostic("checkout.quote.failed", {
        durationMs: performance.now() - startedAt,
        httpStatus: error instanceof ApiHttpError ? error.status : undefined,
        errorCode: error instanceof ApiHttpError ? `http_${error.status}` : "request_failed",
      });
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
    if (
      !canCreate ||
      recoveryBlocked ||
      (fulfillmentMethod === "delivery" && (!cartQuoteId || !selectedQuote))
    )
      return;
    setBusy(true);
    setMessage(null);
    const startedAt = performance.now();
    logCheckoutDiagnostic("checkout.order.create.started");
    try {
      const latestCart = await getCheckoutCart();
      queryClient.setQueryData(["cart", user.id], latestCart);
      if (latestCart.hasUnavailableItems || cartFingerprint(latestCart) !== cartFingerprint(cart)) {
        setMessage(
          fulfillmentMethod === "delivery"
            ? "Stock or cart contents changed after delivery rates were requested. Review the refreshed cart and request new rates."
            : "Stock or cart contents changed. Review the refreshed cart before creating the collection order.",
        );
        return;
      }
      const next = await ordersApi.createOrder(
        {
          fulfillmentMethod,
          ...(fulfillmentMethod === "delivery" ? { addressId, shippingQuoteId: cartQuoteId } : {}),
        },
        idempotencyKey(user.id, fulfillmentMethod, addressId, latestCart),
        checkoutTraceHeaders(),
      );
      setOrder(next);
      setFulfillmentMethod(next.fulfillmentMethod);
      if (!saveCheckoutOrderId(next.id)) {
        setMessage(
          "Your order was created, but this browser cannot save checkout recovery. Keep this page open while completing payment.",
        );
      }
      logCheckoutDiagnostic("checkout.order.create.succeeded", {
        orderId: next.id,
        status: next.status,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      logCheckoutDiagnostic("checkout.order.create.failed", {
        durationMs: performance.now() - startedAt,
        httpStatus: error instanceof ApiHttpError ? error.status : undefined,
        errorCode: error instanceof ApiHttpError ? `http_${error.status}` : "request_failed",
      });
      if (error instanceof ApiHttpError && error.status === 409) {
        setMessage(
          fulfillmentMethod === "delivery"
            ? "The delivery rate expired or your order/cart changed. Request fresh rates and retry; no order was created."
            : "Collection or your cart changed before the order was saved. Refresh checkout and retry; no order was created.",
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
        await ordersApi.selectCartShippingRate(cartQuoteId, quoteId, checkoutTraceHeaders());
        setSelectedQuote(quoteId);
        return;
      }
      await ordersApi.selectShippingQuote(order.id, quoteId, checkoutTraceHeaders());
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
    if (!order || !orderReadyForPayment || recoveryBlocked) {
      setMessage(
        "Payment is blocked until the saved checkout matches the current cart and fulfilment choice and the order is eligible for payment.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    logCheckoutDiagnostic("checkout.payment.initiation.started", { orderId: order.id });
    try {
      const checkout = await ordersApi.createPayFastCheckout(order.id, checkoutTraceHeaders());
      logCheckoutDiagnostic("checkout.payment.initiation.succeeded", { orderId: order.id });
      submitPayFast(checkout);
    } catch (error) {
      logCheckoutDiagnostic("checkout.payment.initiation.failed", {
        orderId: order.id,
        httpStatus: error instanceof ApiHttpError ? error.status : undefined,
        errorCode: error instanceof ApiHttpError ? `http_${error.status}` : "request_failed",
      });
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
      <h1 className="section-title mt-3">Fulfilment and payment</h1>
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
          Checking for an existing order…
        </p>
      ) : null}
      {recoveryState === "ambiguous" || recoveryState === "unavailable" ? (
        <div role="alert" className="mt-5 rounded-md border border-destructive/40 p-4 text-sm">
          <p>{message}</p>
          <Button variant="outline" className="mt-3" onClick={() => onNavigate("orders")}>
            Review my orders
          </Button>
        </div>
      ) : null}
      {order && recoveryBlocked ? (
        <div role="alert" className="mt-5 rounded-md border border-destructive/40 p-4 text-sm">
          <p>
            {!recovery.eligible
              ? recovery.reason
              : !recoveredMethodMatches
                ? "The saved order uses a different fulfilment method. It cannot be reused for this checkout."
                : !recoveredAddressMatches
                  ? "The saved order used a different delivery address. It cannot be reused for the address currently selected."
                  : "Your cart has changed since this order was created. The saved order cannot be continued with the current cart."}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              clearSavedCheckoutOrder();
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
          <h2 className="text-xl font-medium">Fulfilment method</h2>
          <div className="mt-4 space-y-3">
            <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="fulfillment-method"
                checked={fulfillmentMethod === "delivery"}
                disabled={Boolean(order) || busy}
                onChange={() => {
                  setFulfillmentMethod("delivery");
                  setRates([]);
                  setSelectedQuote("");
                  setCartQuoteId("");
                  setRatesExpireAt(undefined);
                  setMessage(null);
                }}
              />
              <span>
                <strong>Delivery</strong>
                <br />
                Ship to one of your saved addresses.
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="fulfillment-method"
                checked={fulfillmentMethod === "collection"}
                disabled={!collectionAvailable || Boolean(order) || busy}
                onChange={() => {
                  setFulfillmentMethod("collection");
                  setRates([]);
                  setSelectedQuote("");
                  setCartQuoteId("");
                  setRatesExpireAt(undefined);
                  setShowAddressForm(false);
                  setMessage(null);
                }}
              />
              <span>
                <strong>Customer collection</strong>
                <br />
                {collectionAvailable
                  ? `Collect from ${collectionLocation?.name ?? "the configured location"}.`
                  : fulfillmentOptions === undefined && !fulfillmentOptionsError
                    ? "Checking collection availability…"
                    : "Not currently available."}
              </span>
            </label>
          </div>
          {!collectionAvailable && fulfillmentOptions?.collection.reason ? (
            <p role="status" className="mt-3 text-sm text-destructive">
              {fulfillmentOptions.collection.reason}
            </p>
          ) : null}
          {fulfillmentOptionsError ? (
            <p role="status" className="mt-3 text-sm text-destructive">
              Collection availability could not be loaded. Delivery remains available; refresh
              checkout before selecting collection.
            </p>
          ) : null}
          {fulfillmentMethod === "delivery" ? (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-lg font-medium">Delivery address</h3>
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
                          logCheckoutDiagnostic("checkout.address.selected", {
                            status: "selected",
                          });
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
                        {entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city},{" "}
                        {entry.province}
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
                  <AddressLocationFields
                    value={address}
                    onChange={setAddress}
                    disabled={busy}
                    provinceOptions={SOUTH_AFRICAN_PROVINCES}
                    onAddressSelected={() => setMessage(null)}
                  />
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
            </div>
          ) : (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-lg font-medium">Collection details</h3>
              {collectionLocation ? (
                <div className="mt-3 space-y-1 text-sm">
                  <p>
                    <strong>{collectionLocation.name}</strong>
                  </p>
                  <p>{collectionLocation.address}</p>
                  {collectionInstructions ? (
                    <p className="text-muted-foreground">{collectionInstructions}</p>
                  ) : null}
                  {collectionLocation.contactName ? (
                    <p>Pickup contact: {collectionLocation.contactName}</p>
                  ) : null}
                  {collectionLocation.contactEmail ? (
                    <p>
                      Email:{" "}
                      <a className="underline" href={`mailto:${collectionLocation.contactEmail}`}>
                        {collectionLocation.contactEmail}
                      </a>
                    </p>
                  ) : null}
                  {collectionLocation.contactMobile ? (
                    <p>
                      Phone:{" "}
                      <a className="underline" href={`tel:${collectionLocation.contactMobile}`}>
                        {collectionLocation.contactMobile}
                      </a>
                    </p>
                  ) : null}
                  {order ? (
                    <p className="text-muted-foreground">
                      We will notify you when your paid order is ready for collection.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  A verified collection location has not been configured.
                </p>
              )}
              {collectionAvailable && !collectionContactReady ? (
                <div className="mt-3 text-sm">
                  <p>
                    Add your name and phone number to your account before creating a collection
                    order.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    onClick={() => onNavigate("account")}
                  >
                    Update account details
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
        <aside className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-xl font-medium">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatZarCents(order?.subtotalCents ?? cart?.totalCents ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{fulfillmentMethod === "collection" ? "Collection" : "Delivery"}</dt>
              <dd>
                {fulfillmentMethod === "collection"
                  ? "No delivery charge"
                  : currentOrderQuote
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
                      ? fulfillmentMethod === "collection"
                        ? "Unavailable"
                        : "Select delivery"
                      : formatZarCents(orderTotalWithDelivery)
                    : cartTotalWithDelivery === undefined
                      ? fulfillmentMethod === "collection"
                        ? "Unavailable"
                        : "Select delivery"
                      : formatZarCents(cartTotalWithDelivery)}
                </strong>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
      {!order && fulfillmentMethod === "delivery" && !cartQuoteId ? (
        <Button
          className="mt-6"
          disabled={!canCreate || !selectedAddress?.localArea?.trim() || busy || recoveryBlocked}
          onClick={() => void requestCartQuotes()}
        >
          {busy ? "Requesting delivery rates…" : "Request delivery rates"}
        </Button>
      ) : null}
      {!order && fulfillmentMethod === "delivery" && cartQuoteId ? (
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
      {!order && fulfillmentMethod === "delivery" && cartQuoteId && rates.length > 0 ? (
        <Button
          className="mt-6"
          disabled={!canCreate || busy || recoveryBlocked || !selectedQuote}
          onClick={() => void create()}
        >
          {busy ? "Creating order…" : "Confirm delivery and create order"}
        </Button>
      ) : null}
      {!order && fulfillmentMethod === "collection" ? (
        <Button
          className="mt-6"
          disabled={!canCreate || busy || recoveryBlocked}
          onClick={() => void create()}
        >
          {busy ? "Creating order…" : "Confirm collection and create order"}
        </Button>
      ) : null}
      {!order && fulfillmentMethod === "delivery" && rates.length ? (
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
      {order && order.fulfillmentMethod === "delivery" && !currentShippingQuote(order) ? (
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
      {order && orderReadyForPayment ? (
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          {order.fulfillmentMethod === "delivery" && order.shippingQuote ? (
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
          ) : (
            <p className="text-sm">
              <strong>Customer collection · No delivery charge</strong>
              <br />
              We will notify you when your paid order is ready for collection.
            </p>
          )}
          {order.fulfillmentMethod === "collection" && collectionLocation ? (
            <p className="mt-3 text-sm">
              <strong>Collection location:</strong>
              <br />
              {collectionLocation.name}
              <br />
              {collectionLocation.address}
              {collectionLocation.contactName ? (
                <>
                  <br />
                  Pickup contact: {collectionLocation.contactName}
                </>
              ) : null}
              {collectionLocation.contactEmail ? (
                <>
                  <br />
                  Email: {collectionLocation.contactEmail}
                </>
              ) : null}
              {collectionLocation.contactMobile ? (
                <>
                  <br />
                  Phone: {collectionLocation.contactMobile}
                </>
              ) : null}
            </p>
          ) : null}
          {order.fulfillmentMethod === "delivery" && order.deliveryAddress ? (
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
          ) : null}
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
