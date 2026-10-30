import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { authApi, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import { canRetryCustomerPayment, classifyCustomerPayment, ordersApi, type CustomerOrder } from "@/lib/api/orders";
import { ApiHttpError } from "@/lib/api/client";
import { formatZarCents } from "@/lib/money";

const inputClass = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
type Navigate = (view: string, returnTo?: "account", orderId?: string) => void;
const label = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
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

export function OrdersPage({ userId, onNavigate }: { userId: string; onNavigate: Navigate }) {
  const query = useQuery({ queryKey: ["orders", userId], queryFn: () => ordersApi.listCustomerOrders(), retry: false });
  if (query.isPending) return <Page title="My orders"><p role="status">Loading orders…</p></Page>;
  if (query.isError) return <Page title="My orders"><p role="alert">{query.error instanceof ApiHttpError && query.error.status === 401 ? "Your session has expired. Sign in again to view your orders." : "Orders are temporarily unavailable. Please check your connection and try again."}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></Page>;
  if (!query.data?.orders.length) return <Page title="My orders"><p>You have not placed any orders yet.</p><Button variant="outline" onClick={() => onNavigate("shop")}>Start shopping</Button></Page>;
  return <Page title="My orders"><div className="mt-5 space-y-4">{query.data.orders.map(order => <article key={order.id} className="rounded-lg border border-border bg-card p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-medium">{order.orderNumber}</h2><p className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p></div><strong>{formatZarCents(order.totalCents)}</strong></div><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Order status</dt><dd className="capitalize">{status(order.status)}</dd></div><div><dt className="text-muted-foreground">Fulfilment</dt><dd className="capitalize">{status(order.fulfillmentStatus)}</dd></div><div><dt className="text-muted-foreground">Payment</dt><dd className="capitalize">{latestPayment(order)}</dd></div></dl><Button className="mt-4" variant="outline" onClick={() => { onNavigate("order-detail", undefined, order.id); }}>View order</Button></article>)}</div></Page>;
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

export function OrderDetailPage({ userId, orderId, onNavigate }: { userId: string; orderId: string; onNavigate: Navigate }) {
  const query = useQuery({ queryKey: ["order", userId, orderId], queryFn: () => ordersApi.getCustomerOrder(orderId), retry: false });
  const [actionError, setActionError] = useState<string | null>(null);
  async function retry() { setActionError(null); try { const checkout = await ordersApi.createPayFastCheckout(orderId); submitPayFast(checkout); } catch { await query.refetch(); setActionError("A new payment cannot be started yet. The current backend payment status has been refreshed."); } }
  if (query.isPending) return <Page title="Order details"><p role="status">Loading order…</p></Page>;
  if (query.isError) return <Page title="Order details"><p role="alert">We could not retrieve this order.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></Page>;
  const order = query.data;
  const unresolved = order.status === "payment_reconciliation" || order.paymentAttempts?.some(a => a.status === "pending" || a.status === "reconciliation");
  const retryAllowed = canRetryCustomerPayment(order);
  const paymentState = classifyCustomerPayment(order);
  return <Page title={`Order ${order.orderNumber}`}><p className="text-sm text-muted-foreground">Placed {new Date(order.createdAt).toLocaleString()}</p>{actionError ? <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">{actionError}</p> : null}<dl className="mt-5 grid gap-2 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Order status</dt><dd className="capitalize">{status(order.status)}</dd></div><div><dt className="text-muted-foreground">Payment</dt><dd>{latestPayment(order)}</dd></div><div><dt className="text-muted-foreground">Fulfilment</dt><dd className="capitalize">{status(order.fulfillmentStatus)}</dd></div></dl>
    <section className="mt-5 rounded-lg border border-border p-5"><h2 className="text-xl font-medium">Items</h2><div className="mt-4 divide-y divide-border">{order.items.map(item => <div key={item.productId} className="flex justify-between gap-4 py-3 text-sm"><div><strong>{item.name}</strong><p className="text-muted-foreground">Quantity {item.quantity}</p></div><strong>{formatZarCents(item.lineSubtotalCents)}</strong></div>)}</div><dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{formatZarCents(order.subtotalCents)}</dd></div><div className="flex justify-between"><dt>Delivery</dt><dd>{formatZarCents(Math.max(0, order.totalCents - order.subtotalCents))}</dd></div><div className="flex justify-between text-base"><dt><strong>Total</strong></dt><dd><strong>{formatZarCents(order.totalCents)}</strong></dd></div></dl></section>
    <section className="mt-5 rounded-lg border border-border p-5"><h2 className="text-xl font-medium">Delivery address</h2><address className="mt-3 text-sm not-italic">{order.deliveryAddress.recipientName}<br />{order.deliveryAddress.phoneNumber}<br />{order.deliveryAddress.addressLine1}{order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ""}<br />{order.deliveryAddress.city}, {order.deliveryAddress.province}, {order.deliveryAddress.postalCode}<br />{order.deliveryAddress.country}</address></section>
    <div className="mt-6 flex flex-wrap gap-3">{retryAllowed ? <Button onClick={() => void retry()}>Resume payment</Button> : null}<Button variant="outline" onClick={() => onNavigate("tracking-detail", undefined, order.id)}>View parcel tracking</Button><Button variant="outline" onClick={() => onNavigate("shop")}>Return to shopping</Button><a className="inline-flex items-center rounded-md border px-4 py-2 text-sm" href="mailto:support@healthywayssa.co.za">Contact support</a></div>{unresolved ? <p className="mt-4 text-sm">Payment confirmation or reconciliation is still being resolved. Do not make another payment yet.</p> : null}{!retryAllowed && (paymentState === "failed" || paymentState === "cancelled") ? <p className="mt-4 text-sm">Payment retry is unavailable because this order is no longer eligible, or its stock reservation has changed.</p> : null}</Page>;
}

export function TrackingPage({ userId, orderId, onNavigate }: { userId: string; orderId: string; onNavigate: Navigate }) {
  const query = useQuery({ queryKey: ["tracking", userId, orderId], queryFn: () => ordersApi.getTracking(orderId), retry: false });
  if (query.isPending) return <Page title="Parcel tracking"><p role="status">Loading tracking…</p></Page>;
  if (query.isError) return <Page title="Parcel tracking"><p role="alert">Tracking is temporarily unavailable.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></Page>;
  const tracking = query.data;
  return <Page title="Parcel tracking"><p className="text-sm text-muted-foreground">Order {tracking.orderNumber}</p><dl className="mt-5 grid gap-3 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Fulfilment status</dt><dd>{fulfillmentLabel(tracking.fulfillmentStatus)}</dd></div><div><dt className="text-muted-foreground">Provider</dt><dd>{tracking.tracking?.provider ?? "Not available yet"}</dd></div><div><dt className="text-muted-foreground">Tracking reference</dt><dd>{tracking.tracking?.reference ?? "Not available"}</dd></div><div><dt className="text-muted-foreground">Latest status</dt><dd>{tracking.tracking?.status ?? "No tracking update yet"}</dd></div>{tracking.tracking?.statusUpdatedAt ? <div><dt className="text-muted-foreground">Last updated</dt><dd>{new Date(tracking.tracking.statusUpdatedAt).toLocaleString()}</dd></div> : null}</dl>{tracking.tracking?.trackingUrl ? <a className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-primary-foreground" href={tracking.tracking.trackingUrl} target="_blank" rel="noreferrer">Track parcel</a> : !tracking.tracking ? <p className="mt-5 text-sm">The parcel has not yet been dispatched or tracking has not yet been made available.</p> : null}<Button className="mt-6 block" variant="outline" onClick={() => onNavigate("order-detail", undefined, orderId)}>Back to order</Button></Page>;
}

export function AddressesPage({ user, applyUser }: { user: PublicUser; applyUser: (user: PublicUser, initiatingUserId: string) => void }) {
  const queryClient = useQueryClient();
  const currentUserId = () => {
    const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
    return session?.status === "authenticated" ? session.user?.id : undefined;
  };
  const empty = { label: "Home", recipientName: user.displayName ?? "", phoneNumber: user.phoneNumber ?? "", addressLine1: "", addressLine2: "", localArea: "", city: "", province: "", postalCode: "", country: "South Africa", deliveryInstructions: "" };
  const [address, setAddress] = useState<Omit<PublicAddress, "id" | "isDefault">>(empty);
  const [editing, setEditing] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) { event.preventDefault(); const initiatingUserId = user.id; setBusy(true); setError(null); try { const payload = { ...address, ...(address.localArea.trim() ? { localArea: address.localArea.trim() } : {}) }; if (!address.localArea.trim()) delete (payload as { localArea?: string }).localArea; const updated = editing ? await authApi.updateAddress(editing, payload) : await authApi.addAddress(payload); applyUser(updated, initiatingUserId); if (currentUserId() === initiatingUserId) { setAddress(empty); setEditing(null); } } catch { if (currentUserId() === initiatingUserId) setError("The address could not be saved. Check the required fields and try again."); } finally { if (currentUserId() === initiatingUserId) setBusy(false); } }
  async function remove(id: string) { const initiatingUserId = user.id; setBusy(true); try { applyUser(await authApi.deleteAddress(id), initiatingUserId); } catch { if (currentUserId() === initiatingUserId) setError("The address could not be removed right now."); } finally { if (currentUserId() === initiatingUserId) setBusy(false); } }
    async function defaultAddress(id: string) { const initiatingUserId = user.id; setBusy(true); try { applyUser(await authApi.setDefaultAddress(id), initiatingUserId); } catch { if (currentUserId() === initiatingUserId) setError("The default address could not be changed."); } finally { if (currentUserId() === initiatingUserId) setBusy(false); } }
  function edit(entry: PublicAddress) { setEditing(entry.id); setAddress({ label: entry.label, recipientName: entry.recipientName, phoneNumber: entry.phoneNumber, addressLine1: entry.addressLine1, addressLine2: entry.addressLine2 ?? "", localArea: entry.localArea ?? "", city: entry.city, province: entry.province, postalCode: entry.postalCode, country: entry.country, deliveryInstructions: entry.deliveryInstructions ?? "" }); }
  return <Page title="My addresses">{error ? <p role="alert" className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">{error}</p> : null}<div className="mt-5 space-y-3">{user.addresses.map(entry => <article key={entry.id} className="rounded-lg border border-border bg-card p-4"><div className="text-sm"><strong>{entry.label}</strong>{entry.isDefault ? " · Default" : null}<br />{entry.recipientName} · {entry.phoneNumber}<br />{entry.addressLine1}{entry.addressLine2 ? `, ${entry.addressLine2}` : ""}{entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city}, {entry.province}, {entry.postalCode}</div><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => edit(entry)}>Edit</Button>{!entry.isDefault ? <Button variant="outline" disabled={busy} onClick={() => void defaultAddress(entry.id)}>Set default</Button> : null}<Button variant="outline" disabled={busy} onClick={() => void remove(entry.id)}>Delete</Button></div></article>)}</div><form className="mt-6 grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2" onSubmit={save}><h2 className="text-xl font-medium sm:col-span-2">{editing ? "Edit address" : "Add address"}</h2>{Object.entries(address).map(([key, value]) => key === "deliveryInstructions" ? null : <label key={key} className="space-y-1 text-sm"><span>{label(key)}</span><input required={!(["addressLine2", "localArea"] as string[]).includes(key)} className={inputClass} maxLength={key === "phoneNumber" ? 30 : 120} value={value} onChange={e => setAddress({ ...address, [key]: e.currentTarget.value })} /></label>)}<div className="sm:col-span-2"><Button disabled={busy}>{busy ? "Saving…" : editing ? "Update address" : "Add address"}</Button></div></form></Page>;
}

function Page({ title, children }: { title: string; children: ReactNode }) { return <main className="mx-auto w-full max-w-5xl px-5 py-10"><span className="eyebrow">Customer account</span><h1 className="section-title mt-3">{title}</h1>{children}</main>; }

function submitPayFast(checkout: { checkoutUrl: string; method: "POST"; fields: Record<string, string> }) { const form = document.createElement("form"); form.method = checkout.method; form.action = checkout.checkoutUrl; for (const [name, value] of Object.entries(checkout.fields)) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); } document.body.appendChild(form); form.submit(); }
