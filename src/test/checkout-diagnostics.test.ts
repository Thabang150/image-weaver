import { afterEach, describe, expect, it, vi } from "vitest";

import { checkoutTraceHeaders, logCheckoutDiagnostic } from "@/lib/checkout-diagnostics";

const traceId = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("checkout browser diagnostics", () => {
  it("emits the trace and safe fields only when explicitly enabled", () => {
    window.history.replaceState({}, "", "/?checkoutDebug=1");
    sessionStorage.setItem("healthyways.checkout.traceId", traceId);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logCheckoutDiagnostic("checkout.order.create.failed", {
      orderId: "customer@example.test",
      status: "authorization=private",
      errorCode: "signature=private-signature",
      httpStatus: 503,
    });

    expect(checkoutTraceHeaders()).toEqual({ "X-Checkout-Trace-ID": traceId });
    expect(info).toHaveBeenCalledOnce();
    const logged = JSON.stringify(info.mock.calls[0]);
    expect(logged).toContain(traceId);
    expect(logged).toContain('"httpStatus":503');
    expect(logged).not.toContain("customer@example.test");
    expect(logged).not.toContain("private-signature");
    expect(logged).not.toContain("authorization=private");
  });

  it("does not write browser diagnostics by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logCheckoutDiagnostic("checkout.started");

    expect(info).not.toHaveBeenCalled();
  });

  it("records cart validation with the active trace ID", () => {
    window.history.replaceState({}, "", "/?checkoutDebug=1");
    sessionStorage.setItem("healthyways.checkout.traceId", traceId);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logCheckoutDiagnostic("checkout.cart.validated", { status: "valid" });

    expect(JSON.stringify(info.mock.calls[0])).toContain('"event":"checkout.cart.validated"');
    expect(JSON.stringify(info.mock.calls[0])).toContain(traceId);
  });

  it("keeps explicitly enabled diagnostics active after payment redirects", () => {
    window.history.replaceState({}, "", "/?checkoutDebug=1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logCheckoutDiagnostic("checkout.payment.initiation.succeeded");
    window.history.replaceState({}, "", "/?view=payment-return");

    logCheckoutDiagnostic("checkout.payment.returned");

    expect(info).toHaveBeenCalledTimes(2);
  });
});
