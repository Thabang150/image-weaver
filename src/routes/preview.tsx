import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { CartProvider } from "@/components/storefront/cart";
import { PreviewSite, type PreviewView } from "@/components/storefront/preview-site";

const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const previewViews: PreviewView[] = [
  "shop",
  "login",
  "register",
  "verify-email",
  "account",
  "addresses",
  "orders",
  "order-detail",
  "tracking-detail",
  "checkout",
  "payment-return",
  "payment-cancel",
  "cart",
  "admin",
  "forgot-password",
  "reset-password",
];

type PreviewReturnTarget = "cart" | "account" | "admin";

function isPreviewView(value: unknown): value is PreviewView {
  return typeof value === "string" && previewViews.includes(value as PreviewView);
}

function isPreviewReturnTarget(value: unknown): value is PreviewReturnTarget {
  return value === "cart" || value === "account" || value === "admin";
}

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>) => {
    const product = search["product"];
    const view = search["view"];
    const returnTo = search["returnTo"];
    const token = search["token"];
    const emailLink = search["emailLink"];
    const orderId = search["orderId"];
    return {
      ...(typeof product === "string" && productSlugPattern.test(product) ? { product } : {}),
      ...(isPreviewView(view) ? { view } : {}),
      ...(isPreviewReturnTarget(returnTo) ? { returnTo } : {}),
      ...(typeof token === "string" ? { token } : {}),
      ...(typeof orderId === "string" && /^[a-f\d]{24}$/i.test(orderId) ? { orderId } : {}),
      ...(emailLink === 1 || emailLink === "1" ? { emailLink: 1 as const } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "HealthywaysSA — Storefront Preview" },
      {
        name: "description",
        content: "Shop and test the HealthywaysSA customer storefront.",
      },
      { property: "og:title", content: "HealthywaysSA — Storefront Preview" },
      {
        property: "og:description",
        content: "Shop and test the HealthywaysSA customer storefront.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Preview,
});

function Preview() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "shop";
  const emailLinkFallbackStartedRef = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (
      url.pathname !== "/verify-email" ||
      search.emailLink === 1 ||
      emailLinkFallbackStartedRef.current
    ) {
      return;
    }

    emailLinkFallbackStartedRef.current = true;
    const token = url.searchParams.get("token");
    void navigate({
      to: "/preview",
      search: {
        view: "verify-email",
        emailLink: 1,
        ...(token === null ? {} : { token }),
      },
      replace: true,
    });
  }, [navigate, search.emailLink]);

  function navigateTo(nextView: PreviewView, returnTo?: "cart" | "account" | "admin", orderId?: string) {
    const resolvedOrderId = orderId ?? search.orderId;
    void navigate({
      search:
        nextView === "shop" && search.product
          ? { view: nextView, product: search.product }
          : nextView === "shop"
            ? {}
            : returnTo
              ? { view: nextView, returnTo }
            : nextView === "order-detail" || nextView === "tracking-detail" || nextView === "payment-return" || nextView === "payment-cancel"
              ? { view: nextView, ...(resolvedOrderId ? { orderId: resolvedOrderId } : {}) }
              : { view: nextView },
    });
  }

  return (
    <CartProvider>
      <PreviewSite
        view={view}
        product={search.product}
        returnTo={search.returnTo}
        verificationToken={search.token}
        orderId={search.orderId}
        isEmailLink={search.emailLink === 1}
        onClearEmailLink={() => {
          void navigate({
            to: "/preview",
            search: { view: "verify-email", emailLink: 1 },
            replace: true,
          });
        }}
        onNavigate={navigateTo}
        onSelectProduct={(slug) => {
          void navigate({ search: { product: slug } });
        }}
        onBackToCatalogue={() => {
          void navigate({ search: {} });
        }}
      />
    </CartProvider>
  );
}
