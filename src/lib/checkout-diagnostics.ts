const TRACE_STORAGE_KEY = "healthyways.checkout.traceId";
const DEBUG_STORAGE_KEY = "healthyways.checkout.debug";

type CheckoutEvent =
  | "checkout.started"
  | "checkout.cart.validated"
  | "checkout.cart.validation.failed"
  | "checkout.address.selected"
  | "checkout.quote.requested"
  | "checkout.quote.succeeded"
  | "checkout.quote.failed"
  | "checkout.order.create.started"
  | "checkout.order.create.succeeded"
  | "checkout.order.create.failed"
  | "checkout.payment.initiation.started"
  | "checkout.payment.initiation.succeeded"
  | "checkout.payment.initiation.failed"
  | "checkout.payment.returned"
  | "checkout.completed";

interface CheckoutDiagnostic {
  orderId?: string;
  status?: string;
  durationMs?: number;
  httpStatus?: number | undefined;
  errorCode?: string;
}

let memoryTraceId: string | undefined;

export function getCheckoutTraceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.sessionStorage.getItem(TRACE_STORAGE_KEY);
    if (stored && isUuid(stored)) {
      memoryTraceId = stored;
      return stored;
    }
  } catch {
    // Continue with an in-memory trace when browser storage is unavailable.
  }
  memoryTraceId ??= window.crypto.randomUUID();
  try {
    window.sessionStorage.setItem(TRACE_STORAGE_KEY, memoryTraceId);
  } catch {
    // The trace remains usable for this page even when browser storage is unavailable.
  }
  return memoryTraceId;
}

export function checkoutTraceHeaders(): Record<string, string> {
  const traceId = getCheckoutTraceId();
  return traceId ? { "X-Checkout-Trace-ID": traceId } : {};
}

export function logCheckoutDiagnostic(
  event: CheckoutEvent,
  details: CheckoutDiagnostic = {},
): void {
  if (typeof window === "undefined") return;
  if (!isCheckoutDebugEnabled()) return;
  console.info("[checkout-diagnostic]", {
    event,
    traceId: getCheckoutTraceId(),
    ...(isSafeId(details.orderId) ? { orderId: details.orderId } : {}),
    ...(isSafeState(details.status) ? { status: details.status } : {}),
    ...(isFiniteNonNegative(details.durationMs)
      ? { durationMs: Math.round(details.durationMs) }
      : {}),
    ...(isHttpStatus(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(isSafeCode(details.errorCode) ? { errorCode: details.errorCode } : {}),
  });
}

function isCheckoutDebugEnabled(): boolean {
  if (new URLSearchParams(window.location.search).get("checkoutDebug") === "1") {
    try {
      window.sessionStorage.setItem(DEBUG_STORAGE_KEY, "1");
    } catch {
      return true;
    }
    return true;
  }
  try {
    return window.sessionStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function isUuid(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

function isSafeState(value: unknown): value is string {
  return typeof value === "string" && /^[a-z_-]{1,40}$/.test(value);
}

function isSafeCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}
