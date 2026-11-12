const ORDER_KEY = "healthyways.checkout.orderId";
const IDEMPOTENCY_KEYS = "healthyways.checkout.idempotencyKeys";
const inMemoryIdempotencyKeys = new Map<string, string>();

export function getCheckoutIdempotencyKey(fingerprint: string): string {
  const inMemory = inMemoryIdempotencyKeys.get(fingerprint);
  if (inMemory) return inMemory;

  let keys: Record<string, string> = {};
  try {
    const saved = sessionStorage.getItem(IDEMPOTENCY_KEYS);
    const parsed: unknown = saved ? JSON.parse(saved) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      keys = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    // Keep retries idempotent for this page session when browser storage is unavailable.
  }

  const existing = keys[fingerprint];
  if (existing) {
    inMemoryIdempotencyKeys.set(fingerprint, existing);
    return existing;
  }

  const created = `checkout-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  keys[fingerprint] = created;
  inMemoryIdempotencyKeys.set(fingerprint, created);
  try {
    sessionStorage.setItem(IDEMPOTENCY_KEYS, JSON.stringify(keys));
  } catch {
    // The in-memory key still protects same-page retries.
  }
  return created;
}

export function getSavedCheckoutOrderId(): string | undefined {
  try {
    return sessionStorage.getItem(ORDER_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function saveCheckoutOrderId(orderId: string): boolean {
  try {
    sessionStorage.setItem(ORDER_KEY, orderId);
    return true;
  } catch {
    return false;
  }
}

export function clearSavedCheckoutOrder(): void {
  try {
    sessionStorage.removeItem(ORDER_KEY);
  } catch {
    // Clearing recovery state is best-effort when browser storage is unavailable.
  }
}
