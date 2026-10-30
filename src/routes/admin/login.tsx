import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CartProvider } from "@/components/storefront/cart";
import { PreviewSite, type PreviewView } from "@/components/storefront/preview-site";

export const Route = createFileRoute("/admin/login")({
  head: () => ({ meta: [{ title: "Administrator Sign In — Healthy Ways SA" }] }),
  component: AdminLoginRoute,
});

function AdminLoginRoute() {
  const navigate = useNavigate();

  function navigateTo(view: PreviewView) {
    if (view === "shop") {
      void navigate({ to: "/preview" });
      return;
    }
    void navigate({ to: "/preview", search: { view: view === "admin-login" ? "admin" : view } });
  }

  return (
    <CartProvider>
      <PreviewSite
        view="admin-login"
        product={undefined}
        returnTo="admin"
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
