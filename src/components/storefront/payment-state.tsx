import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { canRetryCustomerPayment, classifyCustomerPayment, ordersApi, type PayFastCheckout } from "@/lib/api/orders";

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

const paymentCopy = {
  "awaiting-payment": { title: "Awaiting payment", description: "Payment has not been initiated yet." },
  processing: { title: "Payment processing", description: "Your payment attempt is unresolved. Confirmation is being awaited." },
  "confirmation-pending": { title: "Payment confirmation pending", description: "The backend requires reconciliation. Do not attempt another payment yet." },
  failed: { title: "Payment failed", description: "The latest payment attempt definitively failed." },
  cancelled: { title: "Payment cancelled", description: "The latest payment attempt was cancelled by PayFast." },
  successful: { title: "Payment confirmed", description: "The backend has confirmed and reconciled your payment." },
} as const;

export function PaymentStatePage({ userId, orderId, cancelled, onNavigate }: { userId: string; orderId?: string; cancelled: boolean; onNavigate: (view: string, orderId?: string) => void }) {
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["order", userId, "payment-state", orderId], queryFn: () => ordersApi.getCustomerOrder(orderId as string), enabled: Boolean(orderId), retry: false });

  async function retryPayment() {
    if (!query.data || !canRetryCustomerPayment(query.data)) {
      setRetryError("Payment cannot be retried yet. The current payment status must be checked first.");
      return;
    }
    setRetryBusy(true);
    setRetryError(null);
    try {
      submitPayFast(await ordersApi.createPayFastCheckout(query.data.id));
    } catch {
      await query.refetch();
      setRetryError("A new payment could not be opened. Your existing order was not changed; check its payment status before trying again.");
    } finally {
      setRetryBusy(false);
    }
  }

  if (!orderId) return <main className="mx-auto max-w-xl px-5 py-10"><h1 className="section-title">Payment status</h1><p className="mt-4">We could not identify the order. Return to My Orders and open the correct order.</p><Button variant="outline" onClick={() => onNavigate("orders")}>My orders</Button></main>;
  if (query.isPending) return <main className="mx-auto max-w-xl px-5 py-10"><p role="status">Checking the payment status with the backend…</p></main>;
  if (query.isError) return <main className="mx-auto max-w-xl px-5 py-10"><h1 className="section-title">Payment status</h1><p className="mt-4" role="alert">We could not confirm this payment yet. Do not retry payment. Check the order again shortly.</p><Button variant="outline" onClick={() => void query.refetch()}>Check again</Button></main>;

  const order = query.data;
  const paymentState = classifyCustomerPayment(order);
  const copy = paymentCopy[paymentState];
  const retryAllowed = canRetryCustomerPayment(order);

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <span className="eyebrow">{cancelled ? "Payment cancellation return" : "Payment return"}</span>
      <h1 className="section-title mt-3">{copy.title}</h1>
      <div className="mt-5 rounded-lg border border-border bg-card p-5">
        <p className="text-sm">Order <strong>{order.orderNumber}</strong></p>
        <p className="mt-3">{copy.description}</p>
      </div>
      {retryError ? <p role="alert" className="mt-4 text-sm text-destructive">{retryError}</p> : null}
      {!retryAllowed && (paymentState === "failed" || paymentState === "cancelled") ? <p className="mt-4 text-sm">Payment retry is unavailable for this order. Check its stock reservation or current backend payment status.</p> : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {retryAllowed ? <Button disabled={retryBusy} onClick={() => void retryPayment()}>{retryBusy ? "Opening PayFast…" : "Retry payment"}</Button> : null}
        <Button variant="outline" onClick={() => onNavigate("order-detail", order.id)}>View order</Button>
        <Button variant="outline" onClick={() => onNavigate("orders")}>My orders</Button>
      </div>
    </main>
  );
}
