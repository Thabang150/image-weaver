import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CartProvider } from "@/components/storefront/cart";
import { PreviewSite, type PreviewView } from "@/components/storefront/preview-site";

export const Route = createFileRoute("/admin/register")({
  head: () => ({ meta: [{ title: "Administrator Registration — Healthy Ways SA" }] }),
  component: AdminRegisterRoute,
});

function AdminRegisterRoute() {
  const navigate = useNavigate();

  function navigateTo(view: PreviewView) {
    if (view === "admin-login") {
      void navigate({ to: "/admin/login" });
      return;
    }
    if (view === "verify-email") {
      void navigate({ to: "/preview", search: { view: "verify-email" } });
      return;
    }
    void navigate({ to: "/preview", search: { view } });
  }

  return (
    <CartProvider>
      <PreviewSite
        view="admin-register"
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
