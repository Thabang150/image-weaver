import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CartProvider } from "@/components/storefront/cart";
import { PreviewSite, type PreviewView } from "@/components/storefront/preview-site";

export const Route = createFileRoute("/admin/forgot-password")({
  head: () => ({ meta: [{ title: "Administrator Password Reset — Healthy Ways SA" }] }),
  component: AdminForgotPasswordRoute,
});

function AdminForgotPasswordRoute() {
  const navigate = useNavigate();

  function navigateTo(view: PreviewView) {
    if (view === "admin-login") {
      void navigate({ to: "/admin/login" });
      return;
    }
    if (view === "reset-password") {
      void navigate({ to: "/preview", search: { view: "reset-password" } });
      return;
    }
    void navigate({ to: "/preview", search: { view } });
  }

  return (
    <CartProvider enabled={false}>
      <PreviewSite
        view="admin-forgot-password"
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
