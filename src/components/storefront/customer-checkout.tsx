import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authApi, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import { ordersApi, type CustomerOrder, type PayFastCheckout } from "@/lib/api/orders";
import { formatZarCents } from "@/lib/money";
import { useCart } from "@/components/storefront/cart";
import { ApiHttpError } from "@/lib/api/client";

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

function checkoutFingerprint(userId: string, addressId: string, cart: CartFingerprintSource | undefined) {
  return `${userId}:${addressId}:${cartFingerprint(cart)}`;
}

function idempotencyKey(userId: string, addressId: string, cart: CartFingerprintSource | undefined) {
  const fingerprint = checkoutFingerprint(userId, addressId, cart);
  let keys: Record<string, string> = {};
  try { keys = JSON.parse(sessionStorage.getItem(IDEMPOTENCY_KEYS) ?? "{}"); } catch { keys = {}; }
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
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    country: address.country,
  };
  const delivery = order.deliveryAddress;
  return [selected.recipientName, selected.phoneNumber, selected.addressLine1, selected.addressLine2, selected.localArea, selected.city, selected.province, selected.postalCode, selected.country]
    .map((value) => value.trim().toLowerCase()).join("|") === [delivery.recipientName, delivery.phoneNumber, delivery.addressLine1, delivery.addressLine2 ?? "", delivery.localArea ?? "", delivery.city, delivery.province, delivery.postalCode, delivery.country]
    .map((value) => value.trim().toLowerCase()).join("|");
}

function matchesCart(order: CustomerOrder, cart: CartFingerprintSource | undefined) {
  const ordered = order.items.map((item) => `${item.productId}:${item.quantity}`).sort().join("|");
  return ordered === cartFingerprint(cart);
}

function recoverableOrder(order: CustomerOrder) {
  const unresolved = order.paymentAttempts.some((attempt) => attempt.status === "pending" || attempt.status === "reconciliation");
  if (order.status === "paid") return { eligible: false, reason: "This order has already been paid." };
  if (order.status === "cancelled") return { eligible: false, reason: "This order has been cancelled." };
  if (order.status === "payment_reconciliation" || unresolved) return { eligible: false, reason: "Payment confirmation or reconciliation is unresolved. Do not create another order; continue from My Orders." };
  if (order.stockReservationStatus !== "reserved") return { eligible: false, reason: "This order's stock reservation has expired or is no longer active." };
  return { eligible: order.status === "pending_payment", reason: "This order can continue checkout." };
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

export function CheckoutPage({ user, onNavigate }: { user: PublicUser; onNavigate: (view: any, returnTo?: any, orderId?: string) => void }) {
  const queryClient = useQueryClient();
  const { cart, retryCart } = useCart();
  const [addressId, setAddressId] = useState(() => user.addresses.find((a: PublicAddress) => a.isDefault)?.id ?? user.addresses[0]?.id ?? "");
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [rates, setRates] = useState<any[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [address, setAddress] = useState({ label: "Delivery", recipientName: "", phoneNumber: "", addressLine1: "", addressLine2: "", localArea: "", city: "", province: "", postalCode: "", country: "South Africa", deliveryInstructions: "" });
  const [recoveryState, setRecoveryState] = useState<"loading" | "eligible" | "stale" | "none">("none");

  useEffect(() => {
    const saved = sessionStorage.getItem(ORDER_KEY);
    if (!saved) return;
    setRecoveryState("loading");
    void ordersApi.getCustomerOrder(saved)
      .then((recovered) => {
        setRecoveryState("eligible");
        setOrder(recovered);
        if (recovered.shippingQuote) setSelectedQuote(recovered.shippingQuote.serviceName);
      })
      .catch(() => {
        sessionStorage.removeItem(ORDER_KEY);
        setRecoveryState("stale");
        setOrder(null);
        setMessage("We could not verify your saved order. It was not cancelled or changed; start checkout again when the order can be confirmed.");
      });
  }, []);

  const selectedAddress = user.addresses.find((entry) => entry.id === addressId);
  const recovery = order ? recoverableOrder(order) : { eligible: false, reason: "" };
  const recoveredAddressMatches = Boolean(order && selectedAddress && matchesSelectedAddress(order, selectedAddress));
  const recoveredCartMatches = Boolean(order && matchesCart(order, cart));
  const recoveryBlocked = Boolean(order && (!recovery.eligible || !recoveredAddressMatches || !recoveredCartMatches));

  const deliveryCharge = order?.shippingQuote?.chargeCents ?? 0;
  const hasUnavailable = Boolean(cart?.hasUnavailableItems);
  const canCreate = Boolean(addressId && cart?.items.length && !hasUnavailable);

  async function saveAddress(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const addressInput = address.localArea.trim()
        ? { ...address, localArea: address.localArea.trim() }
        : Object.fromEntries(Object.entries(address).filter(([key]) => key !== "localArea"));
      const initiatingUserId = user.id;
      const updated = await authApi.addAddress(addressInput as Omit<PublicAddress, "id" | "isDefault">);
      const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
      if (session?.status === "authenticated" && session.user?.id === initiatingUserId) {
        queryClient.setQueryData(["session"], { status: "authenticated", user: updated });
      }
      const created = updated.addresses.find((entry) => entry.isDefault && !user.addresses.some((existing) => existing.id === entry.id))
        ?? updated.addresses.find((entry) => !user.addresses.some((existing) => existing.id === entry.id));
      if (created) setAddressId(created.id);
      setShowAddressForm(false);
    } catch (error) { setMessage(error instanceof ApiHttpError ? "The address could not be saved. Check the required fields and try again." : "Address saving is unavailable. Your progress has been kept."); }
    finally { setBusy(false); }
  }

  async function loadQuotes(existingOrder: CustomerOrder) {
    try {
      const quoteResponse = await ordersApi.getShippingQuotes(existingOrder.id);
      setRates(quoteResponse.rates ?? []);
      setSelectedQuote(existingOrder.shippingQuote ? existingOrder.shippingQuote.serviceName : "");
      setOrder(await ordersApi.getCustomerOrder(existingOrder.id));
    } catch (error) {
      setSelectedQuote("");
      setRates([]);
      setOrder((current) => current ? { ...current, shippingQuote: undefined } : current);
      setMessage(error instanceof ApiHttpError && error.status === 422
        ? "No delivery quote is available for this address. Review the address or choose another saved address."
        : "Delivery quotes are temporarily unavailable or the order is no longer eligible. Your order has not been cancelled.");
    }
  }

  async function create() {
    if (!canCreate || recoveryBlocked) return;
    setBusy(true); setMessage(null);
    try {
      let next = order;
      if (!next) {
        next = await ordersApi.createOrder(addressId, idempotencyKey(user.id, addressId, cart));
        sessionStorage.setItem(ORDER_KEY, next.id);
      }
      setOrder(next);
      await loadQuotes(next);
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 409) {
        setMessage("Checkout conflicted with an existing order or unavailable stock. Refresh the order status before continuing; do not submit another checkout.");
      } else {
        setMessage(error instanceof ApiHttpError && error.status === 410
          ? "The stock reservation expired. Review your cart and checkout again with a new checkout request."
          : "We could not create the order. Your cart and checkout details are still here; please try again.");
      }
    } finally { setBusy(false); }
  }

  async function selectRate(quoteId: string) {
    if (!order) return;
    setBusy(true); setMessage(null);
    try {
      const result = await ordersApi.selectShippingQuote(order.id, quoteId);
      setSelectedQuote(quoteId);
      const authoritative = await ordersApi.getCustomerOrder(order.id);
      setOrder(authoritative);
      setMessage(authoritative.shippingQuote
        ? `Delivery selected: ${authoritative.shippingQuote.serviceName}.`
        : `${result.shippingQuote?.serviceName ?? "Selected service"} delivery was accepted, but the order must be refreshed before payment.`);
    }
    catch {
      setSelectedQuote("");
      if (order.shippingQuote) {
        try { setOrder(await ordersApi.getCustomerOrder(order.id)); } catch { /* Keep the checkout visible while status refresh fails. */ }
      }
      setMessage("That delivery quote is no longer available. Request the delivery quotes again; no old quote is being used for payment.");
    }
    finally { setBusy(false); }
  }

  async function pay() {
    if (!order || !order.shippingQuote || recoveryBlocked) {
      setMessage("Payment is blocked until the saved checkout matches the current cart and address and the order is eligible for payment.");
      return;
    }
    setBusy(true); setMessage(null);
    try { submitPayFast(await ordersApi.createPayFastCheckout(order.id)); }
    catch (error) { setMessage(error instanceof ApiHttpError && error.status === 409 ? "Payment cannot be started yet. Wait for any reconciliation to finish or continue from My Orders." : "PayFast could not be opened. Your order has not been cancelled; please retry."); setBusy(false); }
  }

  return <main className="mx-auto max-w-5xl px-5 py-10">
    <span className="eyebrow">Secure checkout</span><h1 className="section-title mt-3">Delivery and payment</h1>
    {message ? <p role="status" className="mt-5 rounded-md border border-border bg-muted/40 p-3 text-sm">{message}</p> : null}
    {hasUnavailable ? <div className="mt-5 rounded-md border border-destructive/40 p-4"><p>One or more products in your cart is unavailable or the price may have changed.</p><Button variant="outline" onClick={() => void retryCart()}>Refresh cart</Button></div> : null}
    {recoveryState === "loading" ? <p role="status" className="mt-5 text-sm">Checking your saved order…</p> : null}
    {order && recoveryBlocked ? <div role="alert" className="mt-5 rounded-md border border-destructive/40 p-4 text-sm"><p>{!recovery.eligible ? recovery.reason : !recoveredAddressMatches ? "The saved order used a different delivery address. It cannot be reused for the address currently selected." : "Your cart has changed since this order was created. The saved order cannot be continued with the current cart."}</p><Button variant="outline" className="mt-3" onClick={() => { sessionStorage.removeItem(ORDER_KEY); setOrder(null); setRates([]); setSelectedQuote(""); setRecoveryState("none"); setMessage("The saved checkout has been cleared. Review your current cart and address, then start a new checkout."); }}>Start a fresh checkout</Button></div> : null}
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-medium">Delivery address</h2>
        {user.addresses.length ? <div className="mt-4 space-y-3">{user.addresses.map((entry: PublicAddress) => <label key={entry.id} className="flex gap-3 rounded-md border border-border p-3 text-sm"><input type="radio" checked={addressId === entry.id} onChange={() => setAddressId(entry.id)} disabled={Boolean(order)} /><span><strong>{entry.label}</strong>{entry.isDefault ? " · Default" : null}<br />{entry.recipientName}<br />{entry.addressLine1}{entry.addressLine2 ? `, ${entry.addressLine2}` : ""}{entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city}, {entry.province}<br />{entry.postalCode}</span></label>)}</div> : <p className="mt-3 text-sm">Add a delivery address to continue.</p>}
        {!order ? <Button className="mt-4" variant="outline" onClick={() => setShowAddressForm(!showAddressForm)}>{showAddressForm ? "Cancel new address" : "Add a new address"}</Button> : null}
        {showAddressForm ? <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveAddress}>{Object.entries(address).filter(([key]) => key !== "country" && key !== "addressLine2" && key !== "deliveryInstructions").map(([key, value]) => <label className="space-y-1 text-sm" key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><input required={key !== "addressLine2" && key !== "localArea"} className={inputClass} value={value} onChange={e => setAddress({ ...address, [key]: e.currentTarget.value })} /></label>)}<div className="sm:col-span-2"><Button disabled={busy}>{busy ? "Saving…" : "Save address"}</Button></div></form> : null}
      </section>
      <aside className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-medium">Order summary</h2>
        <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{formatZarCents(order?.subtotalCents ?? cart?.totalCents ?? 0)}</dd></div><div className="flex justify-between"><dt>Delivery</dt><dd>{order?.shippingQuote ? formatZarCents(deliveryCharge) : "Select quote"}</dd></div><div className="flex justify-between border-t border-border pt-2 text-base"><dt><strong>Total</strong></dt><dd><strong>{formatZarCents(order?.totalCents ?? cart?.totalCents ?? 0)}</strong></dd></div></dl>
      </aside>
    </div>
    {!order ? <Button className="mt-6" disabled={!canCreate || busy || recoveryBlocked} onClick={() => void create()}>{busy ? "Preparing…" : "Confirm address and delivery"}</Button> : null}
    {order && !order.shippingQuote ? <section className="mt-6 rounded-lg border border-border p-5"><h2 className="text-xl font-medium">Choose delivery</h2>{rates.length ? <div className="mt-4 space-y-3">{rates.map((rate) => <label key={rate.quoteId} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"><span><input type="radio" name="quote" checked={selectedQuote === rate.quoteId} onChange={() => void selectRate(rate.quoteId)} /> <strong>{rate.serviceLevel?.name ?? rate.serviceName}</strong></span><strong>{formatZarCents(rate.rateCents)}</strong></label>)}</div> : <p className="mt-3 text-sm">Delivery quotes are not available yet. Retry the quotes after reviewing your address.</p>}<Button variant="outline" className="mt-4" disabled={busy || recoveryBlocked} onClick={() => void loadQuotes(order)}>Retry delivery quotes</Button></section> : null}
    {order?.shippingQuote ? <section className="mt-6 rounded-lg border border-border bg-card p-5"><p className="text-sm"><strong>Selected delivery address:</strong><br />{order.deliveryAddress.recipientName}<br />{order.deliveryAddress.addressLine1}{order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ""}{order.deliveryAddress.localArea ? `, ${order.deliveryAddress.localArea}` : ""}<br />{order.deliveryAddress.city}, {order.deliveryAddress.province}, {order.deliveryAddress.postalCode}</p>{recoveryBlocked ? <p role="status" className="mt-4 text-sm text-destructive">Payment is blocked until the checkout issue shown above is resolved.</p> : null}<Button className="mt-4" disabled={busy || recoveryBlocked} onClick={() => void pay()}>{busy ? "Opening PayFast…" : "Continue to PayFast"}</Button></section> : null}
  </main>;
}
