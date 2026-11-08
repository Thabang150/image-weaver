import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { authApi, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import { cartApi } from "@/lib/api/cart";
import {
  canArchiveCustomerOrder,
  canCancelCustomerOrder,
  canRetryCustomerPayment,
  classifyCustomerPayment,
  CUSTOMER_ORDER_LIFETIME_MS,
  ordersApi,
  type CustomerOrder,
} from "@/lib/api/orders";
import { ApiHttpError } from "@/lib/api/client";
import { formatZarCents } from "@/lib/money";

const inputClass = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
type Navigate = (view: string, returnTo?: "account", orderId?: string) => void;
const label = (value: string) =>
  value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const status = (value: string) => value.replaceAll("_", " ");
function fulfillmentLabel(value: CustomerOrder["fulfillmentStatus"]): string {
  const labels = {
    awaiting_payment: "Awaiting payment",
    processing: "Preparing order",
    shipped: "Dispatched",
    delivered: "Delivered",
    cancelled: "Cancelled",
  } as const;
  return labels[value];
}

function currentQuote(order: CustomerOrder) {
  const quote = order.shippingQuote;
  if (!quote || quote.status !== "confirmed") return false;
  const orderCreatedAt = Date.parse(order.createdAt);
  const confirmedAt = Date.parse(quote.confirmedAt);
  return (
    Number.isFinite(orderCreatedAt) &&
    orderCreatedAt + CUSTOMER_ORDER_LIFETIME_MS > Date.now() &&
    Number.isFinite(confirmedAt) &&
    confirmedAt + CUSTOMER_ORDER_LIFETIME_MS > Date.now() &&
    (!quote.expiresAt || Date.parse(quote.expiresAt) > Date.now())
  );
}

function trackingAvailable(order: CustomerOrder) {
  return Boolean(order.shipmentTracking?.reference?.trim());
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-border px-2.5 py-1 text-xs capitalize">
      {children}
    </span>
  );
}

export function OrdersPage({ userId, onNavigate }: { userId: string; onNavigate: Navigate }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["orders", userId, page],
    queryFn: () => ordersApi.listCustomerOrders(page),
    retry: false,
  });
  if (query.isPending)
    return (
      <Page title="My orders">
        <p role="status">Loading orders…</p>
      </Page>
    );
  if (query.isError)
    return (
      <Page title="My orders">
        <p role="alert">
          {query.error instanceof ApiHttpError && query.error.status === 401
            ? "Your session has expired. Sign in again to view your orders."
            : "Orders are temporarily unavailable. Please check your connection and try again."}
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </Page>
    );
  if (!query.data?.orders.length)
    return (
      <Page title="My orders">
        <p>You have not placed any orders yet.</p>
        <Button className="mt-4" variant="outline" onClick={() => onNavigate("shop")}>
          Start shopping
        </Button>
      </Page>
    );
  return (
    <Page title="My orders">
      <div className="mt-5 space-y-4">
        {query.data.orders.map((order) => {
          const deliveryCharge = order.shippingQuote?.chargeCents;
          return (
            <article key={order.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium">{order.orderNumber}</h2>
                  <p className="text-sm text-muted-foreground">
                    Placed {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                <strong className="text-lg">{formatZarCents(order.totalCents)}</strong>
              </div>
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Order statuses">
                <StatusPill>Payment: {latestPayment(order)}</StatusPill>
                <StatusPill>Delivery: {fulfillmentLabel(order.fulfillmentStatus)}</StatusPill>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {order.items.map((item) => (
                  <li key={item.productId} className="flex justify-between gap-3">
                    <span>
                      {item.name} <span className="text-muted-foreground">× {item.quantity}</span>
                    </span>
                    <span>{formatZarCents(item.lineSubtotalCents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>{formatZarCents(order.subtotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd>
                    {deliveryCharge === undefined ? "Not selected" : formatZarCents(deliveryCharge)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Delivery method</dt>
                  <dd>{order.shippingQuote?.serviceName ?? "Not selected"}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => onNavigate("order-detail", undefined, order.id)}
                >
                  View details
                </Button>
                {order.fulfillmentStatus === "shipped" && trackingAvailable(order) ? (
                  <Button
                    variant="outline"
                    onClick={() => onNavigate("tracking-detail", undefined, order.id)}
                  >
                    Track parcel
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {query.data.pagination.totalPages > 1 ? (
        <nav
          className="mt-5 flex items-center justify-between gap-3"
          aria-label="Order history pages"
        >
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {query.data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= query.data.pagination.totalPages}
            onClick={() =>
              setPage((current) => Math.min(query.data.pagination.totalPages, current + 1))
            }
          >
            Next
          </Button>
        </nav>
      ) : null}
    </Page>
  );
}

function latestPayment(order: CustomerOrder) {
  const labels = {
    "awaiting-payment": "Awaiting payment",
    processing: "Payment processing",
    "confirmation-pending": "Confirmation pending",
    failed: "Payment failed",
    cancelled: "Payment cancelled",
    successful: "Verified and paid",
  } as const;
  return labels[classifyCustomerPayment(order)];
}

export function OrderDetailPage({
  userId,
  orderId,
  onNavigate,
}: {
  userId: string;
  orderId: string;
  onNavigate: Navigate;
}) {
  const query = useQuery({
    queryKey: ["order", userId, orderId],
    queryFn: () => ordersApi.getCustomerOrder(orderId),
    retry: false,
  });
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "pay" | "cancel" | "shipment-cancel" | "archive" | "reorder" | null
  >(null);
  const [cartNeedsReview, setCartNeedsReview] = useState(false);
  async function retry() {
    setBusyAction("pay");
    setActionError(null);
    setActionMessage(null);
    try {
      submitPayFast(await ordersApi.createPayFastCheckout(orderId));
    } catch (error) {
      await query.refetch();
      setActionError(
        error instanceof ApiHttpError && error.status === 409
          ? "Payment cannot be started because this order, delivery quote or payment attempt is no longer eligible. Refresh the order or cancel it."
          : "PayFast could not be opened. Your order has not been duplicated; please retry or contact support.",
      );
    } finally {
      setBusyAction(null);
    }
  }
  async function cancel() {
    if (!window.confirm("Cancel this unpaid order? Reserved stock will be released.")) return;
    setBusyAction("cancel");
    setActionError(null);
    setActionMessage(null);
    try {
      await ordersApi.cancelCustomerOrder(orderId);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ["orders", userId] });
      setActionMessage("The order was cancelled and its reserved stock has been released.");
    } catch {
      await query.refetch();
      setActionError(
        "This order could not be cancelled. Its payment status may have changed; refresh and try again.",
      );
    } finally {
      setBusyAction(null);
    }
  }
  async function cancelShipment() {
    if (
      !window.confirm(
        "Request cancellation of this booked, not-yet-dispatched shipment? Carrier cancellation does not automatically refund your payment.",
      )
    )
      return;
    setBusyAction("shipment-cancel");
    setActionError(null);
    setActionMessage(null);
    try {
      await ordersApi.cancelCustomerShipment(orderId);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ["orders", userId] });
      setActionMessage(
        "The carrier confirmed shipment cancellation. Any payment refund is not automatic; contact support to discuss your payment.",
      );
    } catch (error) {
      await query.refetch();
      setActionError(
        error instanceof ApiHttpError && error.status === 503
          ? "The carrier cancellation outcome could not be confirmed. Do not retry; contact support while the shipment is reconciled."
          : "The shipment could not be cancelled. It may have been collected or its status changed; refresh the order or contact support.",
      );
    } finally {
      setBusyAction(null);
    }
  }
  async function archive() {
    setBusyAction("archive");
    setActionError(null);
    try {
      await ordersApi.archiveCustomerOrder(orderId);
      await queryClient.invalidateQueries({ queryKey: ["orders", userId] });
      onNavigate("orders");
    } catch {
      setActionError("Only cancelled orders can be removed from your order history.");
      setBusyAction(null);
    }
  }
  async function reorder(order: CustomerOrder) {
    setBusyAction("reorder");
    setActionError(null);
    setActionMessage(null);
    setCartNeedsReview(false);
    try {
      for (const item of order.items) {
        const cart = await cartApi.addItem(item.productId, item.quantity);
        const addedItem = cart.items.find((line) => line.productId === item.productId);
        if (!addedItem?.available) {
          await queryClient.invalidateQueries({ queryKey: ["cart", userId] });
          setActionError(
            `${item.name} is no longer available in the requested quantity. Review your cart before checkout.`,
          );
          setCartNeedsReview(true);
          setBusyAction(null);
          return;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["cart", userId] });
      onNavigate("cart");
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["cart", userId] });
      setActionError(
        "Some products could not be added. Review your cart; no new order was created.",
      );
      setCartNeedsReview(true);
    } finally {
      setBusyAction(null);
    }
  }
  if (query.isPending)
    return (
      <Page title="Order details">
        <p role="status">Loading order…</p>
      </Page>
    );
  if (query.isError)
    return (
      <Page title="Order details">
        <p role="alert">We could not retrieve this order.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </Page>
    );
  const order = query.data;
  const unresolved =
    order.status === "payment_reconciliation" ||
    order.paymentAttempts.some(
      (attempt) =>
        attempt.status === "reconciliation" ||
        (attempt.status === "pending" &&
          Date.parse(attempt.createdAt) + CUSTOMER_ORDER_LIFETIME_MS > Date.now()),
    );
  const expiredPendingAttempt = order.paymentAttempts.some(
    (attempt) =>
      attempt.status === "pending" &&
      Date.parse(attempt.createdAt) + CUSTOMER_ORDER_LIFETIME_MS <= Date.now(),
  );
  const retryAllowed = canRetryCustomerPayment(order);
  const cancelAllowed = canCancelCustomerOrder(order);
  const archiveAllowed = canArchiveCustomerOrder(order);
  const paymentState = classifyCustomerPayment(order);
  const deliveryCharge = order.shippingQuote?.chargeCents;
  const latestAttempt = order.paymentAttempts.at(-1);
  const trackable = order.fulfillmentStatus === "shipped" && trackingAvailable(order);
  const shipmentCancellationAvailable =
    order.status === "paid" &&
    order.fulfillmentStatus === "processing" &&
    order.shipmentBooking?.status === "booked";
  const orderIsCancelled = order.status === "cancelled";
  return (
    <Page title={`Order ${order.orderNumber}`}>
      <p className="text-sm text-muted-foreground">
        Order reference {order.orderNumber} · Placed {new Date(order.createdAt).toLocaleString()}
      </p>
      {actionError ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">
          {actionError}
        </p>
      ) : null}
      {actionMessage ? (
        <p role="status" className="mt-4 rounded-md border border-border p-3 text-sm">
          {actionMessage}
        </p>
      ) : null}
      <dl className="mt-5 grid gap-3 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Payment status</dt>
          <dd className="mt-1">
            <StatusPill>{latestPayment(order)}</StatusPill>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Delivery status</dt>
          <dd className="mt-1">
            <StatusPill>{fulfillmentLabel(order.fulfillmentStatus)}</StatusPill>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Order status</dt>
          <dd className="mt-1 capitalize">{status(order.status)}</dd>
        </div>
      </dl>
      <section className="mt-5 rounded-lg border border-border p-5">
        <h2 className="text-xl font-medium">Items and totals</h2>
        <div className="mt-4 divide-y divide-border">
          {order.items.map((item) => (
            <div key={item.productId} className="flex justify-between gap-4 py-3 text-sm">
              <div>
                <strong>{item.name}</strong>
                <p className="text-muted-foreground">Quantity {item.quantity}</p>
              </div>
              <strong>{formatZarCents(item.lineSubtotalCents)}</strong>
            </div>
          ))}
        </div>
        <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatZarCents(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>
              Shipping
              {order.shippingQuote?.serviceName ? ` · ${order.shippingQuote.serviceName}` : ""}
            </dt>
            <dd>
              {deliveryCharge === undefined ? "Not selected" : formatZarCents(deliveryCharge)}
            </dd>
          </div>
          <div className="flex justify-between text-base">
            <dt>
              <strong>Total</strong>
            </dt>
            <dd>
              <strong>{formatZarCents(order.totalCents)}</strong>
            </dd>
          </div>
        </dl>
      </section>
      <section className="mt-5 rounded-lg border border-border p-5">
        <h2 className="text-xl font-medium">Delivery address</h2>
        <address className="mt-3 text-sm not-italic">
          {order.deliveryAddress.recipientName}
          <br />
          {order.deliveryAddress.phoneNumber}
          <br />
          {order.deliveryAddress.addressLine1}
          {order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ""}
          <br />
          {order.deliveryAddress.localArea ? `${order.deliveryAddress.localArea}, ` : ""}
          {order.deliveryAddress.city}, {order.deliveryAddress.province},{" "}
          {order.deliveryAddress.postalCode}
          <br />
          {order.deliveryAddress.country}
        </address>
      </section>
      {order.cancellation ? (
        <p className="mt-4 rounded-md border border-border p-3 text-sm">
          Cancellation reason: {order.cancellation.reason}
        </p>
      ) : null}
      {latestAttempt?.status === "failed" || latestAttempt?.status === "cancelled" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          The latest PayFast attempt was {latestAttempt.status}.{" "}
          {latestAttempt.paymentStatus ? `Payment status: ${latestAttempt.paymentStatus}.` : ""}
        </p>
      ) : null}
      {order.status === "pending_payment" && !currentQuote(order) && !unresolved ? (
        <p className="mt-4 rounded-md border border-border p-3 text-sm">
          This order has no current delivery quote. PayFast is unavailable until checkout is
          restarted with a current quote. You may cancel this unpaid order and place a new order.
        </p>
      ) : null}
      {expiredPendingAttempt ? (
        <p className="mt-4 rounded-md border border-border p-3 text-sm">
          This PayFast attempt is older than 7 days and cannot be retried. If you completed payment,
          contact support instead of cancelling; otherwise, cancel this order to release its
          reservation.
        </p>
      ) : null}
      {unresolved ? (
        <p className="mt-4 rounded-md border border-border p-3 text-sm">
          Payment confirmation or reconciliation is still being resolved. Do not make another
          payment or cancel yet.
        </p>
      ) : null}
      {order.status === "paid" &&
      order.fulfillmentStatus === "processing" &&
      !shipmentCancellationAvailable ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This paid order is being prepared or its shipment status is being reconciled. Contact
          support if you need help cancelling it. A refund is not automatic.
        </p>
      ) : null}
      {order.shipmentBooking?.status === "cancellation_unknown" ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">
          The carrier cancellation is still being reconciled. Do not retry it; contact support for
          an update.
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        {retryAllowed ? (
          <Button disabled={busyAction !== null} onClick={() => void retry()}>
            {busyAction === "pay" ? "Opening PayFast…" : "Pay now / Complete payment"}
          </Button>
        ) : null}
        {cancelAllowed ? (
          <Button variant="outline" disabled={busyAction !== null} onClick={() => void cancel()}>
            {busyAction === "cancel" ? "Cancelling…" : "Cancel order"}
          </Button>
        ) : null}
        {shipmentCancellationAvailable ? (
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => void cancelShipment()}
          >
            {busyAction === "shipment-cancel"
              ? "Requesting carrier cancellation…"
              : "Cancel shipment"}
          </Button>
        ) : null}
        {trackable ? (
          <Button
            variant="outline"
            onClick={() => onNavigate("tracking-detail", undefined, order.id)}
          >
            Track parcel
          </Button>
        ) : null}
        {order.status === "paid" && order.fulfillmentStatus === "delivered" ? (
          <Button
            variant="outline"
            disabled={busyAction !== null}
            onClick={() => void reorder(order)}
          >
            {busyAction === "reorder" ? "Adding items…" : "Reorder"}
          </Button>
        ) : null}
        {archiveAllowed ? (
          <Button variant="outline" disabled={busyAction !== null} onClick={() => void archive()}>
            {busyAction === "archive" ? "Removing…" : "Remove from order history"}
          </Button>
        ) : null}
        {orderIsCancelled && !archiveAllowed ? (
          <p className="w-full text-sm text-muted-foreground">
            This order stays visible until every payment attempt has a confirmed outcome.
          </p>
        ) : null}
        {cartNeedsReview ? (
          <Button variant="outline" onClick={() => onNavigate("cart")}>
            Review cart
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => onNavigate("orders")}>
          Back to my orders
        </Button>
        <Button variant="outline" onClick={() => onNavigate("shop")}>
          Continue shopping
        </Button>
        <a
          className="inline-flex min-h-10 items-center rounded-md border px-4 py-2 text-sm"
          href="mailto:support@healthywayssa.co.za"
        >
          Contact support
        </a>
      </div>
    </Page>
  );
}

export function TrackingPage({
  userId,
  orderId,
  onNavigate,
}: {
  userId: string;
  orderId: string;
  onNavigate: Navigate;
}) {
  const query = useQuery({
    queryKey: ["tracking", userId, orderId],
    queryFn: () => ordersApi.getTracking(orderId),
    retry: false,
  });
  if (query.isPending)
    return (
      <Page title="Parcel tracking">
        <p role="status">Loading tracking…</p>
      </Page>
    );
  if (query.isError)
    return (
      <Page title="Parcel tracking">
        <p role="alert">Tracking is temporarily unavailable.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </Page>
    );
  const tracking = query.data;
  const canTrack =
    tracking.fulfillmentStatus === "shipped" && Boolean(tracking.tracking?.reference?.trim());
  const trackingUrl = tracking.tracking?.trackingUrl;
  const usableTrackingUrl = (() => {
    if (!trackingUrl) return undefined;
    try {
      const url = new URL(trackingUrl);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.toString()
        : undefined;
    } catch {
      return undefined;
    }
  })();
  return (
    <Page title="Parcel tracking">
      <p className="text-sm text-muted-foreground">Order {tracking.orderNumber}</p>
      <dl className="mt-5 grid gap-3 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Fulfilment status</dt>
          <dd>{fulfillmentLabel(tracking.fulfillmentStatus)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Provider</dt>
          <dd>{tracking.tracking?.provider ?? "Not available yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tracking reference</dt>
          <dd>{tracking.tracking?.reference ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latest status</dt>
          <dd>{tracking.tracking?.status ?? "No tracking update yet"}</dd>
        </div>
        {tracking.tracking?.statusUpdatedAt ? (
          <div>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd>{new Date(tracking.tracking.statusUpdatedAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
      {canTrack && usableTrackingUrl ? (
        <a
          className="mt-5 inline-flex min-h-10 items-center rounded-md bg-primary px-4 py-2 text-primary-foreground"
          href={usableTrackingUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open carrier tracking
        </a>
      ) : (
        <p className="mt-5 text-sm">
          {canTrack
            ? "The carrier has not supplied a verified external tracking link. The current carrier status and tracking reference are shown above."
            : "Tracking becomes available after dispatch once a valid tracking reference has been recorded."}
        </p>
      )}
      <Button
        className="mt-6 block"
        variant="outline"
        onClick={() => onNavigate("order-detail", undefined, orderId)}
      >
        Back to order
      </Button>
    </Page>
  );
}

export function AddressesPage({
  user,
  applyUser,
}: {
  user: PublicUser;
  applyUser: (user: PublicUser, initiatingUserId: string) => void;
}) {
  const queryClient = useQueryClient();
  const currentUserId = () => {
    const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>([
      "session",
    ]);
    return session?.status === "authenticated" ? session.user?.id : undefined;
  };
  const empty = {
    label: "Home",
    recipientName: user.displayName ?? "",
    phoneNumber: user.phoneNumber ?? "",
    addressLine1: "",
    addressLine2: "",
    localArea: "",
    city: "",
    province: "",
    postalCode: "",
    country: "South Africa",
    deliveryInstructions: "",
  };
  const [address, setAddress] = useState<Omit<PublicAddress, "id" | "isDefault">>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    const initiatingUserId = user.id;
    setBusy(true);
    setError(null);
    try {
      const { localArea, ...addressWithoutLocalArea } = address;
      const payload = localArea?.trim()
        ? { ...addressWithoutLocalArea, localArea: localArea.trim() }
        : addressWithoutLocalArea;
      const updated = editing
        ? await authApi.updateAddress(editing, payload)
        : await authApi.addAddress(payload);
      applyUser(updated, initiatingUserId);
      if (currentUserId() === initiatingUserId) {
        setAddress(empty);
        setEditing(null);
      }
    } catch {
      if (currentUserId() === initiatingUserId)
        setError("The address could not be saved. Check the required fields and try again.");
    } finally {
      if (currentUserId() === initiatingUserId) setBusy(false);
    }
  }
  async function remove(id: string) {
    const initiatingUserId = user.id;
    setBusy(true);
    try {
      applyUser(await authApi.deleteAddress(id), initiatingUserId);
    } catch {
      if (currentUserId() === initiatingUserId)
        setError("The address could not be removed right now.");
    } finally {
      if (currentUserId() === initiatingUserId) setBusy(false);
    }
  }
  async function defaultAddress(id: string) {
    const initiatingUserId = user.id;
    setBusy(true);
    try {
      applyUser(await authApi.setDefaultAddress(id), initiatingUserId);
    } catch {
      if (currentUserId() === initiatingUserId)
        setError("The default address could not be changed.");
    } finally {
      if (currentUserId() === initiatingUserId) setBusy(false);
    }
  }
  function edit(entry: PublicAddress) {
    setEditing(entry.id);
    setAddress({
      label: entry.label,
      recipientName: entry.recipientName,
      phoneNumber: entry.phoneNumber,
      addressLine1: entry.addressLine1,
      addressLine2: entry.addressLine2 ?? "",
      localArea: entry.localArea ?? "",
      city: entry.city,
      province: entry.province,
      postalCode: entry.postalCode,
      country: entry.country,
      deliveryInstructions: entry.deliveryInstructions ?? "",
    });
  }
  return (
    <Page title="My addresses">
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">
          {error}
        </p>
      ) : null}
      <div className="mt-5 space-y-3">
        {user.addresses.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm">
              <strong>{entry.label}</strong>
              {entry.isDefault ? " · Default" : null}
              <br />
              {entry.recipientName} · {entry.phoneNumber}
              <br />
              {entry.addressLine1}
              {entry.addressLine2 ? `, ${entry.addressLine2}` : ""}
              {entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city}, {entry.province},{" "}
              {entry.postalCode}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => edit(entry)}>
                Edit
              </Button>
              {!entry.isDefault ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void defaultAddress(entry.id)}
                >
                  Set default
                </Button>
              ) : null}
              <Button variant="outline" disabled={busy} onClick={() => void remove(entry.id)}>
                Delete
              </Button>
            </div>
          </article>
        ))}
      </div>
      <form
        className="mt-6 grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2"
        onSubmit={save}
      >
        <h2 className="text-xl font-medium sm:col-span-2">
          {editing ? "Edit address" : "Add address"}
        </h2>
        {Object.entries(address).map(([key, value]) =>
          key === "deliveryInstructions" ? null : (
            <label key={key} className="space-y-1 text-sm">
              <span>{label(key)}</span>
              <input
                required={!(["addressLine2", "localArea"] as string[]).includes(key)}
                className={inputClass}
                maxLength={key === "phoneNumber" ? 30 : 120}
                value={value}
                onChange={(e) => setAddress({ ...address, [key]: e.currentTarget.value })}
              />
            </label>
          ),
        )}
        <div className="sm:col-span-2">
          <Button disabled={busy}>
            {busy ? "Saving…" : editing ? "Update address" : "Add address"}
          </Button>
        </div>
      </form>
    </Page>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <span className="eyebrow">Customer account</span>
      <h1 className="section-title mt-3">{title}</h1>
      {children}
    </main>
  );
}

function submitPayFast(checkout: {
  checkoutUrl: string;
  method: "POST";
  fields: Record<string, string>;
}) {
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
