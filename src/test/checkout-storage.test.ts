import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSavedCheckoutOrder,
  getCheckoutIdempotencyKey,
  getSavedCheckoutOrderId,
  saveCheckoutOrderId,
} from "@/lib/checkout-storage";

describe("checkout browser storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("reuses and persists an idempotency key for the same checkout", () => {
    const fingerprint = `checkout-${crypto.randomUUID()}`;
    const key = getCheckoutIdempotencyKey(fingerprint);

    expect(getCheckoutIdempotencyKey(fingerprint)).toBe(key);
    expect(sessionStorage.getItem("healthyways.checkout.idempotencyKeys")).toContain(key);
  });

  it("keeps checkout retries idempotent when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    const fingerprint = `blocked-${crypto.randomUUID()}`;
    const key = getCheckoutIdempotencyKey(fingerprint);

    expect(getCheckoutIdempotencyKey(fingerprint)).toBe(key);
  });

  it("reports failed recovery persistence without throwing and clears safely", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    expect(saveCheckoutOrderId("order-1")).toBe(false);
    expect(getSavedCheckoutOrderId()).toBeUndefined();
    expect(() => clearSavedCheckoutOrder()).not.toThrow();
  });
});
