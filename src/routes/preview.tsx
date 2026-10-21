import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AdminPanel } from "@/components/storefront/admin";
import { CartProvider, CartSheet, CartTrigger } from "@/components/storefront/cart";
import { Catalogue } from "@/components/storefront/catalogue";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/wellness";

const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>) => {
    const product = search["product"];
    return typeof product === "string" && productSlugPattern.test(product) ? { product } : {};
  },
  head: () => ({
    meta: [
      { title: "Healthy Ways SA — Storefront Development Preview" },
      {
        name: "description",
        content: "Development preview of the Healthy Ways SA storefront.",
      },
      { property: "og:title", content: "Healthy Ways SA — Storefront Development Preview" },
      {
        property: "og:description",
        content: "Explore the Healthy Ways SA storefront currently in development.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Preview,
});

function Preview() {
  const { product } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <CartProvider>
      <main className="storefront-preview">
        <header className="storefront-preview-header">
          <div>
            <span className="eyebrow">Healthy Ways SA</span>
            <h1 className="section-title mt-3">Storefront development preview</h1>
            <p className="launch-copy mt-3">
              This private preview is for development while the official launch page remains at the
              homepage.
            </p>
          </div>
          <nav className="preview-actions" aria-label="Preview sections">
            <Button
              type="button"
              variant={showAdmin ? "secondary" : "outline"}
              aria-pressed={showAdmin}
              onClick={() => setShowAdmin((visible) => !visible)}
            >
              {showAdmin ? "Return to storefront" : "Administrator access"}
            </Button>
            {!showAdmin ? <CartTrigger /> : null}
          </nav>
        </header>
        {showAdmin ? (
          <AdminPanel />
        ) : (
          <Catalogue
            selectedSlug={product}
            onSelectProduct={(slug) => {
              void navigate({ search: { product: slug } });
            }}
            onBackToCatalogue={() => {
              void navigate({ search: {} });
            }}
          />
        )}
      </main>
      <Footer />
      <CartSheet />
    </CartProvider>
  );
}
