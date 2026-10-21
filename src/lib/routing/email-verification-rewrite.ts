import type { LocationRewrite } from "@tanstack/react-router";

export const emailVerificationRewrite: LocationRewrite = {
  input: ({ url }) => {
    if (url.pathname !== "/verify-email") return undefined;

    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = "/preview";
    rewrittenUrl.searchParams.set("view", "verify-email");
    rewrittenUrl.searchParams.set("emailLink", "1");
    return rewrittenUrl;
  },
};
