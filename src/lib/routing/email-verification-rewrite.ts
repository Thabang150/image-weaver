import type { LocationRewrite } from "@tanstack/react-router";

export const emailVerificationRewrite: LocationRewrite = {
  input: ({ url }) => {
    if (url.pathname !== "/verify-email" && url.pathname !== "/reset-password") return undefined;

    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = "/preview";
    const isVerificationLink = url.pathname === "/verify-email";
    rewrittenUrl.searchParams.set("view", isVerificationLink ? "verify-email" : "reset-password");
    if (isVerificationLink) rewrittenUrl.searchParams.set("emailLink", "1");
    return rewrittenUrl;
  },
};
