import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CartProvider } from "@/components/storefront/cart";
import { PreviewSite, type PreviewView } from "@/components/storefront/preview-site";

export const Route = createFileRoute("/account/login")({
  head: () => ({ meta: [{ title: "Customer Sign In — Healthy Ways SA" }] }),
  component: CustomerLoginRoute,
});

function CustomerLoginRoute() {
  const navigate = useNavigate();

  function navigateTo(view: PreviewView) {
    if (view === "shop") {
      void navigate({ to: "/preview" });
      return;
    }
    void navigate({ to: "/preview", search: { view } });
  }

  return (
    <CartProvider>
      <PreviewSite
        view="customer-login"
        product={undefined}
        returnTo="account"
        verificationToken={undefined}
        orderId={undefined}
        isEmailLink={false}
        onClearEmailLink={() => undefined}
        onNavigate={(view) => navigateTo(view)}
        onSelectProduct={() => undefined}
        onBackToCatalogue={() => navigateTo("shop")}
      />
    </CartProvider>
  );
}
