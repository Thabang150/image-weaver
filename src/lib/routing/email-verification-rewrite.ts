import type { LocationRewrite } from "@tanstack/react-router";

export const emailVerificationRewrite: LocationRewrite = {
  input: ({ url }) => {
    const isVerificationLink = url.pathname === "/verify-email";
    const isPasswordResetLink = url.pathname === "/reset-password";
    const isPaymentReturn = url.pathname === "/payment/return";
    const isPaymentCancel = url.pathname === "/payment/cancel";
    if (!isVerificationLink && !isPasswordResetLink && !isPaymentReturn && !isPaymentCancel) {
      return undefined;
    }

    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = "/preview";
    const view = isVerificationLink
      ? "verify-email"
      : isPasswordResetLink
        ? "reset-password"
        : isPaymentReturn
          ? "payment-return"
          : "payment-cancel";
    rewrittenUrl.searchParams.set("view", view);
    if (isVerificationLink) rewrittenUrl.searchParams.set("emailLink", "1");
    if (isPaymentReturn || isPaymentCancel) {
      const orderId = url.searchParams.get("orderId");
      if (orderId) rewrittenUrl.searchParams.set("orderId", orderId);
    }
    return rewrittenUrl;
  },
};
