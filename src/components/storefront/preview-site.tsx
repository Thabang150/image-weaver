import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, Menu, Search, ShoppingBag, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AdminPanel } from "@/components/storefront/admin";
import { CartAddButton, CartPage, CartSheet, CartTrigger, useOptionalCart } from "@/components/storefront/cart";
import { Catalogue } from "@/components/storefront/catalogue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiHttpError,
  ApiResponseError,
  CsrfTokenError,
  PreviewMutationBlockedError,
  buildApiUrl,
  getBackendBaseUrl,
} from "@/lib/api/client";
import { authApi, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/auth/authorization";
import { ordersApi } from "@/lib/api/orders";
import { catalogueApi, type PublicProduct } from "@/lib/api/catalogue";
import { getAllowedProductImageUrls } from "@/lib/image-url";
import { formatZarCents } from "@/lib/money";
import { Brand, ContactActions } from "@/components/wellness";
import { CheckoutPage } from "@/components/storefront/customer-checkout";
import { AddressesPage, OrderDetailPage, OrdersPage, TrackingPage } from "@/components/storefront/customer-pages";
import { PaymentStatePage } from "@/components/storefront/payment-state";

export type PreviewView =
  | "home"
  | "shop"
  | "about"
  | "contact"
  | "consultation"
  | "journal"
  | "faq"
  | "privacy"
  | "terms"
  | "delivery"
  | "returns"
  | "login"
  | "customer-login"
  | "admin-login"
  | "register"
  | "admin-register"
  | "admin-forgot-password"
  | "verify-email"
  | "account"
  | "addresses"
  | "orders"
  | "order-detail"
  | "tracking-detail"
  | "checkout"
  | "payment-return"
  | "payment-cancel"
  | "cart"
  | "admin"
  | "forgot-password"
  | "reset-password";

type CustomerAuthModalView =
  | "customer-login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "verify-email";

interface PreviewSiteProps {
  view: PreviewView;
  product: string | undefined;
  returnTo: "cart" | "account" | "admin" | undefined;
  verificationToken: string | undefined;
  orderId: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin", orderId?: string) => void;
  onSelectProduct: (slug: string) => void;
  onBackToCatalogue: () => void;
}

interface Feedback {
  message: string;
  kind: "success" | "error" | "info";
}

const inputClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function authenticatedUserId(queryClient: ReturnType<typeof useQueryClient>) {
  const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
  return session?.status === "authenticated" ? session.user?.id : undefined;
}

function updateSessionForUser(queryClient: ReturnType<typeof useQueryClient>, initiatingUserId: string, user: PublicUser) {
  if (authenticatedUserId(queryClient) === initiatingUserId) {
    queryClient.setQueryData(["session"], { status: "authenticated", user });
  }
}

function describeAuthError(error: unknown, action: string): string {
  if (error instanceof ApiHttpError) {
    if (error.isCsrfFailure) {
      return error.csrfRefreshError
        ? "The backend rejected the security token and a fresh token could not be obtained. Refresh the page and try again."
        : "The backend rejected the security token after one refresh attempt. Refresh the page and try again.";
    }
    if (error.status === 401) {
      return "Sign-in failed. Check your email and password, and confirm your email address is verified.";
    }
    if (error.status === 403) {
      return "The backend denied this request. Verify the account or refresh the page and try again.";
    }
    if (error.status === 409)
      return "This account or request already exists. Check the details and try again.";
    if (error.status === 400 || error.status === 422) {
      const backendMessage = error.message?.trim();
      return backendMessage
        ? `${action} was not accepted: ${backendMessage}`
        : `${action} was not accepted. Check the required fields, password length, or token format and try again.`;
    }
    if (error.status === 429) return "Too many attempts. Wait a few minutes before trying again.";
    if (error.message?.trim()) return `${action} failed: ${error.message.trim()}`;
    if (error.status >= 500)
      return "The service is temporarily unavailable. Please try again later.";
  }
  if (error instanceof ApiResponseError) {
    return `${action} could not be completed because the backend response was invalid.`;
  }
  if (error instanceof CsrfTokenError) {
    return "This request could not be secured because a CSRF token was unavailable. Refresh the page and try again.";
  }
  if (error instanceof PreviewMutationBlockedError) {
    return error.message;
  }
  if (error instanceof TypeError) {
    return `${action} could not be completed because the browser could not complete the network request. Check the API URL, browser network or CORS configuration, your connection, and blockers, then try again.`;
  }
  return `${action} could not be completed. Check your connection and try again.`;
}

function FeedbackMessage({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  const role = feedback.kind === "error" ? "alert" : "status";
  return (
    <p
      className={
        feedback.kind === "error"
          ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          : "rounded-md border border-border bg-muted/40 p-3 text-sm"
      }
      role={role}
    >
      {feedback.message}
    </p>
  );
}

function SiteFrame({
  children,
  user,
  onLogout,
  logoutBusy,
  onNavigate,
}: {
  children: ReactNode;
  user: PublicUser | undefined;
  onLogout: () => void;
  logoutBusy: boolean;
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
}) {
  const isAdmin = user ? isAdminUser(user) : false;
  const cart = useOptionalCart();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const navigateFromHeader = (view: PreviewView) => {
    setMobileMenuOpen(false);
    onNavigate(view);
  };
  return (
    <>
      <header className="preview-header">
        <div className="preview-header-inner">
          <button className="preview-brand" type="button" onClick={() => onNavigate("home")} aria-label="Healthy Ways SA home">
            <Brand className="preview-brand-image" />
          </button>
          <nav
            id="preview-primary-navigation"
            className={`preview-nav${mobileMenuOpen ? " is-open" : ""}`}
            aria-label="Main navigation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMobileMenuOpen(false);
                menuToggleRef.current?.focus();
              }
            }}
          >
            <button type="button" onClick={() => navigateFromHeader("home")}>Home</button>
            <button type="button" onClick={() => navigateFromHeader("shop")}>Shop</button>
            <button type="button" onClick={() => navigateFromHeader("journal")}>Discover</button>
            <button type="button" onClick={() => navigateFromHeader("about")}>Our Story</button>
            <button type="button" onClick={() => navigateFromHeader("contact")}>Contact</button>
          </nav>
          <div className="preview-account-actions">
            <button
              type="button"
              className="preview-icon-button preview-search-link"
              aria-label="Search products"
              onClick={() => navigateFromHeader("shop")}
            >
              <Search aria-hidden="true" />
            </button>
            <button
              type="button"
              className="preview-icon-button preview-account-link"
              aria-label={user ? "Your account" : "Sign in"}
              onClick={() => {
                setMobileMenuOpen(false);
                onNavigate(user ? "account" : "login", "account");
              }}
            >
              <UserRound aria-hidden="true" />
            </button>
            <button
              type="button"
              className="preview-icon-button preview-cart-link"
              aria-label={cart?.totalQuantity ? `Shopping bag, ${cart.totalQuantity} items` : "Shopping bag"}
              onClick={() => navigateFromHeader("cart")}
            >
              <ShoppingBag aria-hidden="true" />
              {cart && cart.totalQuantity > 0 ? (
                <span className="preview-header-cart-count" aria-hidden="true">{cart.totalQuantity}</span>
              ) : null}
            </button>
            {isAdmin ? (
              <button type="button" className="preview-account-link" onClick={() => navigateFromHeader("admin")}>
                Admin
              </button>
            ) : null}
            {user ? (
              <button type="button" className="preview-signout" disabled={logoutBusy} onClick={onLogout}>
                {logoutBusy ? "Signing out…" : "Sign out"}
              </button>
            ) : null}
          </div>
          <button
            ref={menuToggleRef}
            type="button"
            className="preview-menu-toggle"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="preview-primary-navigation"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
          >
            {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>
      {children}
      <footer className="preview-footer">
        <div className="preview-footer-inner">
          <div className="preview-footer-main">
            <div className="preview-footer-brand-column">
              <Brand className="preview-footer-brand" />
              <p>Rooted in nature. Made for your wellbeing.</p>
            </div>
            <div className="preview-footer-columns">
              <section className="preview-footer-column">
                <h2 className="preview-footer-heading">Explore</h2>
                <nav className="preview-footer-links" aria-label="Explore">
                  <button type="button" onClick={() => onNavigate("home")}>Home</button>
                  <button type="button" onClick={() => onNavigate("shop")}>Shop</button>
                  <button type="button" onClick={() => onNavigate("journal")}>Discover</button>
                  <button type="button" onClick={() => onNavigate("about")}>Our Story</button>
                </nav>
              </section>
              <section className="preview-footer-column">
                <h2 className="preview-footer-heading">Customer Support</h2>
                <nav className="preview-footer-links" aria-label="Customer support">
                  <button type="button" onClick={() => onNavigate("faq")}>FAQ</button>
                  <button type="button" onClick={() => onNavigate("delivery")}>Delivery</button>
                  <button type="button" onClick={() => onNavigate("returns")}>Returns</button>
                  <button type="button" onClick={() => onNavigate("contact")}>Contact</button>
                </nav>
                <button
                  type="button"
                  className="preview-footer-consultation"
                  onClick={() => onNavigate("consultation")}
                >
                  Explore consultation
                </button>
              </section>
              <section className="preview-footer-column preview-footer-contact" aria-labelledby="preview-footer-contact-title">
                <h2 className="preview-footer-heading" id="preview-footer-contact-title">Get in Touch</h2>
                <ContactActions />
              </section>
            </div>
          </div>
          <div className="preview-footer-bottom">
            <span>© 2026 Healthy Ways SA.</span>
            <nav className="preview-footer-legal" aria-label="Legal">
              <button type="button" onClick={() => onNavigate("privacy")}>Privacy</button>
              <button type="button" onClick={() => onNavigate("terms")}>Terms</button>
            </nav>
            <span className="preview-footer-telegram">Looking for flowers? Find us on Telegram.</span>
          </div>
        </div>
      </footer>
    </>
  );
}

export function PreviewSite({
  view,
  product,
  returnTo,
  verificationToken,
  orderId,
  isEmailLink,
  onClearEmailLink,
  onNavigate,
  onSelectProduct,
  onBackToCatalogue,
}: PreviewSiteProps) {
  const queryClient = useQueryClient();
  const cart = useOptionalCart();
  const activeOrderId = orderId;
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.getSession(),
    retry: false,
    enabled: !["admin-login", "admin-register", "admin-forgot-password"].includes(view),
  });
  const user = sessionQuery.data?.status === "authenticated" ? sessionQuery.data.user : undefined;
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<CustomerAuthModalView>("customer-login");
  const [authModalReturnTo, setAuthModalReturnTo] = useState<"checkout" | "storefront">("storefront");
  const [authModalError, setAuthModalError] = useState<string | null>(null);
  const [googleSignInBusy, setGoogleSignInBusy] = useState(false);

  function openCustomerAuth(returnTarget: "checkout" | "storefront") {
    setAuthModalReturnTo(returnTarget);
    setAuthModalView("customer-login");
    setAuthModalError(null);
    setAuthModalOpen(true);
  }

  const completeCustomerAuth = useCallback(async (returnTarget = authModalReturnTo) => {
    setAuthModalError(null);
    try {
      if (returnTarget === "checkout") {
        await cart?.syncGuestCart();
      }
      setAuthModalOpen(false);
      if (returnTarget === "checkout") onNavigate("checkout");
    } catch (error) {
      setAuthModalError(
        `You are signed in, but your saved cart could not be synced. ${describeAuthError(error, "Cart sync")}`,
      );
    }
  }, [authModalReturnTo, cart, onNavigate]);

  function handleCustomerAuthNavigate(nextView: PreviewView) {
    if (
      nextView === "customer-login" ||
      nextView === "register" ||
      nextView === "forgot-password" ||
      nextView === "reset-password" ||
      nextView === "verify-email"
    ) {
      setAuthModalView(nextView);
      setAuthModalError(null);
      return;
    }
    if (nextView === "account" || nextView === "cart" || nextView === "checkout") {
      void completeCustomerAuth();
      return;
    }
    setAuthModalOpen(false);
    onNavigate(nextView);
  }

  async function startGoogleSignIn() {
    setGoogleSignInBusy(true);
    setAuthModalError(null);
    try {
      window.sessionStorage.setItem(
        "healthyways.google-sign-in-return",
        authModalReturnTo,
      );
      window.location.assign(buildApiUrl(getBackendBaseUrl(), "/auth/google/start"));
    } catch (error) {
      window.sessionStorage.removeItem("healthyways.google-sign-in-return");
      setGoogleSignInBusy(false);
      setAuthModalOpen(true);
      setAuthModalError(describeAuthError(error, "Google sign-in"));
    }
  }

  useEffect(() => {
    async function resumeGoogleSignIn() {
      const returnTarget = window.sessionStorage.getItem("healthyways.google-sign-in-return");
      if (!returnTarget) return;
      window.sessionStorage.removeItem("healthyways.google-sign-in-return");
      setAuthModalReturnTo(returnTarget === "checkout" ? "checkout" : "storefront");
      setAuthModalView("customer-login");
      setAuthModalOpen(true);
      setGoogleSignInBusy(false);
      try {
        const session = await authApi.getSession();
        if (session.status !== "authenticated" || isAdminUser(session.user)) {
          setAuthModalError("Google sign-in did not establish a customer session. Try again or use email and password.");
          return;
        }
        queryClient.setQueryData(["session"], session);
        await completeCustomerAuth(returnTarget === "checkout" ? "checkout" : "storefront");
      } catch (error) {
        setAuthModalError(describeAuthError(error, "Google sign-in"));
      }
    }

    window.addEventListener("focus", resumeGoogleSignIn);
    window.addEventListener("pageshow", resumeGoogleSignIn);
    return () => {
      window.removeEventListener("focus", resumeGoogleSignIn);
      window.removeEventListener("pageshow", resumeGoogleSignIn);
    };
  }, [queryClient, completeCustomerAuth]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = user?.id;
    previousUserIdRef.current = currentUserId;
    if (previousUserId !== undefined && previousUserId !== currentUserId) {
      queryClient.removeQueries({ queryKey: ["orders"] });
      queryClient.removeQueries({ queryKey: ["order"] });
      queryClient.removeQueries({ queryKey: ["tracking"] });
      queryClient.removeQueries({ queryKey: ["cart"] });
      sessionStorage.removeItem("healthyways.checkout.orderId");
      sessionStorage.removeItem("healthyways.checkout.idempotencyKeys");
    }
  }, [queryClient, user?.id]);

  async function logout() {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      await authApi.logout();
      queryClient.setQueryData(["session"], { status: "unauthenticated" });
      queryClient.removeQueries({ queryKey: ["cart"] });
      queryClient.removeQueries({ queryKey: ["orders"] });
      queryClient.removeQueries({ queryKey: ["order"] });
      queryClient.removeQueries({ queryKey: ["tracking"] });
      sessionStorage.removeItem("healthyways.checkout.orderId");
      sessionStorage.removeItem("healthyways.checkout.idempotencyKeys");
      onNavigate("shop");
    } catch (error) {
      setLogoutError(describeAuthError(error, "Sign out"));
    } finally {
      setLogoutBusy(false);
    }
  }

  function navigatePreview(
    nextView: PreviewView,
    nextReturnTo?: "cart" | "account" | "admin",
    nextOrderId?: string,
  ) {
    if (nextView === "login" && nextReturnTo !== "admin") {
      openCustomerAuth(nextReturnTo === "cart" ? "checkout" : "storefront");
      return;
    }
    onNavigate(nextView, nextReturnTo, nextOrderId);
  }

  let content: ReactNode;
  if (view === "home") {
    content = <PreviewHome onNavigate={onNavigate} onSelectProduct={onSelectProduct} />;
  } else if (view === "shop") {
    content = (
      <Catalogue
        selectedSlug={product}
        onSelectProduct={onSelectProduct}
        onBackToCatalogue={onBackToCatalogue}
      />
    );
  } else if (view === "about" || view === "contact" || view === "consultation" || view === "journal" || view === "faq" || view === "privacy" || view === "terms" || view === "delivery" || view === "returns") {
    content = <PublicPage view={view} onNavigate={onNavigate} />;
  } else if (view === "login") {
    content = returnTo === "admin"
      ? <AdminLoginPage onNavigate={onNavigate} />
      : <CustomerLoginPage onNavigate={onNavigate} returnTo={returnTo} />;
  } else if (view === "customer-login") {
    content = (
      <CustomerLoginPage
        onNavigate={onNavigate}
        onGoogleSignIn={() => void startGoogleSignIn()}
        googleSignInBusy={googleSignInBusy}
      />
    );
  } else if (view === "admin-login") {
    content = <AdminLoginPage onNavigate={onNavigate} />;
  } else if (view === "register") {
    content = <RegisterPage experience="customer" onNavigate={onNavigate} />;
  } else if (view === "admin-register") {
    content = <RegisterPage experience="admin" onNavigate={onNavigate} />;
  } else if (view === "admin-forgot-password") {
    content = <ForgotPasswordPage experience="admin" onNavigate={onNavigate} />;
  } else if (view === "verify-email") {
    content = (
      <VerifyEmailPage
        onNavigate={onNavigate}
        verificationToken={verificationToken}
        isEmailLink={isEmailLink}
        onClearEmailLink={onClearEmailLink}
      />
    );
  } else if (view === "forgot-password") {
    content = <ForgotPasswordPage onNavigate={onNavigate} />;
  } else if (view === "reset-password") {
    content = <ResetPasswordPage onNavigate={onNavigate} />;
  } else if (view === "account") {
    content = user ? (
      <AccountPage user={user} />
    ) : (
      <AccessMessage
        title="Sign in to view your account"
        onAction={() => openCustomerAuth("storefront")}
        action="Go to login"
      />
    );
  } else if (view === "addresses") {
    content = user ? <AddressesPage user={user} applyUser={(updated, initiatingUserId) => updateSessionForUser(queryClient, initiatingUserId, updated)} /> : <AccessMessage title="Sign in to manage addresses" onAction={() => openCustomerAuth("storefront")} action="Go to login" />;
  } else if (view === "orders") {
    content = user ? <OrdersPage userId={user.id} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId)} /> : <AccessMessage title="Sign in to view your orders" onAction={() => openCustomerAuth("storefront")} action="Go to login" />;
  } else if (view === "order-detail") {
    content = user && activeOrderId ? <OrderDetailPage userId={user.id} orderId={activeOrderId} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? activeOrderId)} /> : <AccessMessage title="Sign in to view this order" onAction={() => openCustomerAuth("storefront")} action="Go to login" />;
  } else if (view === "tracking-detail") {
    content = user && activeOrderId ? <TrackingPage userId={user.id} orderId={activeOrderId} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? activeOrderId)} /> : <AccessMessage title="Sign in to view tracking" onAction={() => openCustomerAuth("storefront")} action="Go to login" />;
  } else if (view === "checkout") {
    content = user ? <CheckoutPage user={user} onNavigate={(next) => onNavigate(next as PreviewView)} /> : <AccessMessage title="Sign in to checkout" onAction={() => openCustomerAuth("checkout")} action="Go to login" />;
  } else if (view === "payment-return" || view === "payment-cancel") {
    content = user ? <PaymentStatePage userId={user.id} orderId={orderId} cancelled={view === "payment-cancel"} onNavigate={(next, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? orderId)} /> : <AccessMessage title="Sign in to view payment status" onAction={() => openCustomerAuth("storefront")} action="Go to login" />;
  } else if (view === "cart") {
    content = (
      <CartPage
        onContinueShopping={() => onNavigate("shop")}
        onSignIn={() => openCustomerAuth("storefront")}
        onCheckout={() => user ? onNavigate("checkout") : openCustomerAuth("checkout")}
      />
    );
  } else {
    content = (
      <section className="catalogue-section">
        {user && !isAdminUser(user) ? (
          <AccessMessage
            title="Administrator access denied"
            description="A matching email domain is not enough. The backend must confirm the administrator role and completed two-factor authentication."
          />
        ) : !user ? (
          <AccessMessage
            title="Administrator sign-in required"
            description="Sign in with an authorized administrator account. The backend role and required two-factor authentication are checked after sign-in."
            onAction={() => onNavigate("login", "admin")}
            action="Go to login"
          />
        ) : (
          <AdminPanel user={user} />
        )}
      </section>
    );
  }

  return (
    <div className="healthyways-preview-scope">
      <CartProviderView
      content={
        <SiteFrame
          user={user}
          onLogout={() => void logout()}
          logoutBusy={logoutBusy}
          onNavigate={navigatePreview}
        >
          {sessionQuery.isError ? (
            <div className="mx-auto max-w-7xl px-5 pt-4">
              <p role="alert" className="text-sm text-destructive">
                Account status could not be checked. Store browsing remains available.{" "}
                {describeAuthError(sessionQuery.error, "Session check")}
              </p>
            </div>
          ) : null}
          {logoutError ? (
            <div className="mx-auto max-w-7xl px-5 pt-4">
              <p role="alert" className="text-sm text-destructive">
                {logoutError}
              </p>
            </div>
          ) : null}
          {content}
        </SiteFrame>
      }
      view={view}
      onSignIn={() => openCustomerAuth("storefront")}
      onCheckout={() => user ? onNavigate("checkout") : openCustomerAuth("checkout")}
      />
      <Dialog
        open={authModalOpen}
        onOpenChange={(open) => {
          setAuthModalOpen(open);
          if (!open) setAuthModalError(null);
        }}
      >
        <DialogContent className="healthyways-auth-dialog">
          <DialogHeader className="healthyways-auth-dialog-header">
            <DialogTitle>Healthy Ways SA</DialogTitle>
            <DialogDescription>Sign in or create your customer account.</DialogDescription>
          </DialogHeader>
          {authModalError ? (
            <p className="healthyways-auth-modal-error" role="alert">{authModalError}</p>
          ) : null}
          {authModalView === "customer-login" ? (
            <LoginPage
              experience="customer"
              onNavigate={handleCustomerAuthNavigate}
              returnTo={authModalReturnTo === "checkout" ? "cart" : "account"}
              onGoogleSignIn={() => void startGoogleSignIn()}
              googleSignInBusy={googleSignInBusy}
            />
          ) : authModalView === "register" ? (
            <RegisterPage experience="customer" onNavigate={handleCustomerAuthNavigate} />
          ) : authModalView === "forgot-password" ? (
            <ForgotPasswordPage onNavigate={handleCustomerAuthNavigate} />
          ) : authModalView === "reset-password" ? (
            <ResetPasswordPage onNavigate={handleCustomerAuthNavigate} />
          ) : (
            <VerifyEmailPage
              onNavigate={handleCustomerAuthNavigate}
              verificationToken={undefined}
              isEmailLink={false}
              onClearEmailLink={() => undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CartProviderView({
  content,
  view,
  onSignIn,
  onCheckout,
}: {
  content: ReactNode;
  view: PreviewView;
  onSignIn: () => void;
  onCheckout: () => void;
}) {
  return (
    <>
      {content}
      {view !== "cart" ? (
        <div className="fixed bottom-5 right-5 z-40">
          <CartTrigger />
        </div>
      ) : null}
      <CartSheet onSignIn={onSignIn} onCheckout={onCheckout} />
    </>
  );
}

function AccessMessage({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="catalogue-section">
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6">
        <h1 className="section-title">{title}</h1>
        {description ? <p className="mt-4 text-sm text-muted-foreground">{description}</p> : null}
        {action && onAction ? (
          <Button className="mt-5" onClick={onAction}>
            {action}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function PreviewHomeProductImage({ product }: { product: PublicProduct }) {
  const [failed, setFailed] = useState(false);
  const image = getAllowedProductImageUrls(product.imageReferences)[0];

  if (!image || failed) {
    return (
      <span className="preview-home-image-fallback" role="img" aria-label={`${product.name} image unavailable`}>
        Image unavailable
      </span>
    );
  }

  return (
    <img
      src={image}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function PreviewHome({
  onNavigate,
  onSelectProduct,
}: {
  onNavigate: (view: PreviewView) => void;
  onSelectProduct: (slug: string) => void;
}) {
  const [selectedIngredient, setSelectedIngredient] = useState("Lion’s Mane");
  const [breathingActive, setBreathingActive] = useState(false);
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sections = document.querySelectorAll<HTMLElement>(".preview-home .preview-reveal");
    if (reducedMotion || !("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const featured = useQuery({
    queryKey: ["preview-home-featured"],
    queryFn: () => catalogueApi.getProducts({
      page: 1,
      limit: 4,
      sortBy: "name",
      sortOrder: "asc",
    }),
  });
  const [selectedGoal, setSelectedGoal] = useState("Everyday wellness");
  const goals = [
    "Calm",
    "Focus",
    "Everyday wellness",
    "Vitality",
    "Rest & recovery",
  ];
  const goalDescriptions: Record<string, string> = {
    Calm: "A quiet moment can begin with a slower breath, a simple ritual or a little more room in the day.",
    Focus: "Explore practical ways to shape a more intentional space for the task in front of you.",
    "Everyday wellness": "Build from the basics that fit your life: nourishment, movement, rest and connection.",
    Vitality: "Consider the everyday routines that help you feel engaged with the things that matter.",
    "Rest & recovery": "Make space for rest as part of a balanced routine, and seek qualified advice when needed.",
  };
  const ingredients = [
    {
      name: "Lion’s Mane",
      type: "Mushroom",
      description: "A distinctive edible mushroom. Product labels can clarify the part used, preparation and other ingredients.",
    },
    {
      name: "Ashwagandha",
      type: "Botanical",
      description: "A plant in the nightshade family. Check each product label for the form used and relevant cautions.",
    },
    {
      name: "Magnesium Glycinate",
      type: "Mineral form",
      description: "A form of magnesium paired with glycine. Compare the label for the amount of elemental magnesium per serving.",
    },
    {
      name: "Moringa",
      type: "Botanical",
      description: "A plant used in foods and ingredient preparations. The product label explains its form and composition.",
    },
    {
      name: "Collagen",
      type: "Protein",
      description: "A structural protein used as an ingredient. Check the source and allergen information on the product label.",
    },
  ];
  const activeIngredient = ingredients.find(({ name }) => name === selectedIngredient) ?? ingredients[0];

  return (
    <main className="preview-home">
      <section className={`preview-home-hero${breathingActive ? " is-breathing" : ""}`} aria-labelledby="preview-home-title">
        <img
          src="/images/botanical-hero.webp"
          alt=""
          className="preview-home-hero-image"
          fetchPriority="high"
        />
        <div className="preview-home-hero-shade" aria-hidden="true" />
        <div className="preview-home-hero-content">
          <p className="preview-home-eyebrow">Healthy Ways SA · A more intentional everyday</p>
          <h1 id="preview-home-title">Find your natural rhythm.</h1>
          <p className="preview-home-hero-copy">
            Thoughtfully selected wellness essentials to support a more intentional everyday.
          </p>
          <div className="preview-home-actions">
            <Button onClick={() => onNavigate("shop")}>
              Explore the collection <ArrowRight aria-hidden="true" />
            </Button>
            <a className="preview-home-text-link" href="#preview-ingredients">
              Discover our ingredients <ArrowDown aria-hidden="true" />
            </a>
          </div>
          <button
            type="button"
            className="preview-home-breathing-toggle"
            aria-pressed={breathingActive}
            onClick={() => setBreathingActive((active) => !active)}
          >
            <span className="preview-home-breathing-orbit" aria-hidden="true" />
            {breathingActive ? "Pause the breathing rhythm" : "Find a breathing rhythm"}
          </button>
        </div>
        <p className="preview-home-hero-caption">A little closer to nature, a little closer to yourself.</p>
      </section>

      <section className="preview-home-goals preview-reveal" aria-labelledby="preview-goals-title">
        <div className="preview-home-section-heading">
          <p className="preview-section-kicker">A place to begin</p>
          <h2 id="preview-goals-title">How would you like to feel?</h2>
          <p>
            Explore the routines and questions that matter to you. These themes are for discovery,
            not product recommendations or promises of an outcome.
          </p>
        </div>
        <div className="preview-home-goal-list" role="group" aria-label="Choose a wellbeing theme">
          {goals.map((goal, index) => (
            <button
              className={`preview-home-goal${selectedGoal === goal ? " is-selected" : ""}`}
              type="button"
              key={goal}
              aria-pressed={selectedGoal === goal}
              onClick={() => setSelectedGoal(goal)}
            >
              <span className="preview-home-goal-number">0{index + 1}</span>
              <span className="preview-home-goal-label">{goal}</span>
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="preview-home-goal-note" aria-live="polite" key={selectedGoal}>
          <span className="preview-home-note-index">A note on {selectedGoal.toLowerCase()}</span>
          <p>{goalDescriptions[selectedGoal]}</p>
        </div>
      </section>

      <section className="preview-featured preview-home-products preview-reveal" aria-labelledby="preview-featured-title">
        <div className="preview-featured-heading preview-home-section-heading">
          <div>
            <p className="preview-section-kicker">The collection</p>
            <h2 id="preview-featured-title">Thoughtful picks from our range</h2>
          </div>
          <button type="button" onClick={() => onNavigate("shop")}>Shop all products <ArrowRight aria-hidden="true" /></button>
        </div>
        {featured.isPending ? (
          <div className="preview-featured-grid preview-home-product-grid" role="status" aria-label="Loading featured products">
            {[0, 1, 2, 3].map((item) => <div className="preview-featured-skeleton" key={item} />)}
          </div>
        ) : featured.isError ? (
          <div className="preview-featured-state" role="alert">
            <p>The collection could not be loaded just now.</p>
            <button type="button" onClick={() => void featured.refetch()}>Try again</button>
          </div>
        ) : featured.data.products.length === 0 ? (
          <div className="preview-featured-state" role="status">Our range is being updated. Please check back soon.</div>
        ) : (
          <div className="preview-featured-grid preview-home-product-grid">
            {featured.data.products.map((product) => {
              return (
                <article className="preview-featured-card" key={product.id}>
                  <button
                    type="button"
                    onClick={() => onSelectProduct(product.slug)}
                    className="preview-featured-image-button"
                    aria-label={`View ${product.name} details`}
                  >
                    <PreviewHomeProductImage product={product} />
                  </button>
                  <p>{product.category.name}</p>
                  <button
                    type="button"
                    className="preview-home-product-name"
                    onClick={() => onSelectProduct(product.slug)}
                  >
                    {product.name}
                  </button>
                  <strong>{formatZarCents(product.priceCents)}</strong>
                  <CartAddButton product={product} quantity={1}>
                    Add to bag
                  </CartAddButton>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="preview-home-ingredients preview-reveal" id="preview-ingredients" aria-labelledby="preview-ingredients-title">
        <div className="preview-home-ingredient-intro">
          <p className="preview-section-kicker">The language of ingredients</p>
          <h2 id="preview-ingredients-title">Curiosity is a good place to start.</h2>
          <p>
            Take a closer look at some of the ingredients in our range. Clear labels and reliable
            information help you make choices that are right for you.
          </p>
          <p className="preview-home-ingredient-disclaimer">
            General ingredient information only. It is not medical advice and does not describe
            every product formulation.
          </p>
        </div>
        <div className="preview-home-ingredient-explorer">
          <div className="preview-home-ingredient-tabs" role="group" aria-label="Explore ingredients">
            {ingredients.map(({ name }, index) => (
              <button
                type="button"
                aria-pressed={selectedIngredient === name}
                key={name}
                onClick={() => setSelectedIngredient(name)}
              >
                <span>0{index + 1}</span>{name}
              </button>
            ))}
          </div>
          <div
            className="preview-home-ingredient-detail"
            id="preview-ingredient-detail"
            aria-live="polite"
            key={activeIngredient.name}
          >
            <span className="preview-home-ingredient-type">{activeIngredient.type}</span>
            <h3>{activeIngredient.name}</h3>
            <p>{activeIngredient.description}</p>
            <button type="button" className="preview-home-text-link" onClick={() => onNavigate("shop")}>
              Browse the range <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section className="preview-home-story preview-reveal" aria-labelledby="preview-story-title">
        <figure className="preview-home-story-image">
          <img src="/images/botanical-hero.webp" alt="Olive-toned botanical branches against warm light" loading="lazy" />
          <figcaption>Rooted in nature. Made for your wellbeing.</figcaption>
        </figure>
        <div className="preview-home-story-copy">
          <p className="preview-section-kicker">Our story</p>
          <h2 id="preview-story-title">A considered approach to everyday wellness.</h2>
          <p>
            The Healthy Ways SA journey is grounded in thoughtful product selection, clear
            information and personal care. We believe everyday wellness should feel considered,
            understandable and personal.
          </p>
          <button type="button" className="preview-home-text-link" onClick={() => onNavigate("about")}>
            Get to know us <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="preview-home-community preview-reveal" aria-labelledby="preview-community-title">
        <p className="preview-section-kicker">Keep discovering</p>
        <h2 id="preview-community-title">Wellness is personal. Learning can be shared.</h2>
        <p>
          Find practical notes on mindful routines, reading product labels and knowing when to ask
          for qualified advice.
        </p>
        <div className="preview-home-community-actions">
          <Button onClick={() => onNavigate("journal")}>Explore Discover <ArrowRight aria-hidden="true" /></Button>
          <button type="button" className="preview-home-text-link" onClick={() => onNavigate("contact")}>
            Talk to our team
          </button>
        </div>
      </section>
    </main>
  );
}

const publicPageCopy: Record<Exclude<PreviewView, "shop" | "home" | "login" | "customer-login" | "admin-login" | "register" | "admin-register" | "admin-forgot-password" | "verify-email" | "account" | "addresses" | "orders" | "order-detail" | "tracking-detail" | "checkout" | "payment-return" | "payment-cancel" | "cart" | "admin" | "forgot-password" | "reset-password">, {
  eyebrow: string;
  title: string;
  intro: string;
  sections: Array<{ title: string; copy: string }>;
}> = {
  about: {
    eyebrow: "Our story",
    title: "Natural care, thoughtfully chosen.",
    intro: "Healthy Ways SA combines trusted natural wellness products with practical, personal support for everyday wellbeing.",
    sections: [
      { title: "Rooted in care", copy: "Our approach is simple: make natural wellness feel understandable, accessible and reassuring." },
      { title: "Selected with intention", copy: "We focus on useful, clearly presented products and help customers find information before making a choice." },
      { title: "Here for the journey", copy: "Every wellbeing journey is personal. Our team is available to answer product and order questions with care." },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "How can we help?",
    intro: "Reach our team for product guidance, order support or general questions.",
    sections: [
      { title: "WhatsApp", copy: "Send us a WhatsApp message for a convenient conversation with our team." },
      { title: "Email", copy: "Email hello@healthywayssa.co.za for product, account or delivery questions." },
      { title: "Call", copy: "Call +27 79 687 1118 during standard business hours for personal support." },
    ],
  },
  consultation: {
    eyebrow: "Personal guidance",
    title: "Start a thoughtful wellness conversation.",
    intro: "Tell our team what you would like help with so we can point you toward the right next step.",
    sections: [
      { title: "Product guidance", copy: "Ask for help understanding product choices, intended use and suitability questions." },
      { title: "Before your enquiry", copy: "Do not send sensitive medical details. A consultation does not replace care from a qualified healthcare professional." },
      { title: "Continue with confidence", copy: "Our team can help clarify product information and connect you with appropriate support." },
    ],
  },
  journal: {
    eyebrow: "The Healthy Ways journal",
    title: "Simple ideas for everyday wellbeing.",
    intro: "Practical reading on natural routines, informed choices and feeling your best.",
    sections: [
      { title: "Building a mindful routine", copy: "Small, consistent choices are often more sustainable than dramatic changes. Start with sleep, hydration, movement and balanced nourishment." },
      { title: "Reading a product label", copy: "Ingredients, serving directions, cautions and quality information help you compare wellness products more clearly." },
      { title: "Knowing when to ask", copy: "Speak to a qualified healthcare professional if you have a medical condition, take medication or are pregnant or nursing." },
    ],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Answers before you begin.",
    intro: "A quick guide to shopping, accounts, delivery and product support.",
    sections: [
      { title: "Can I shop without an account?", copy: "Yes. You can browse and add products to your cart as a guest. Sign in is requested when you proceed to checkout." },
      { title: "How do I track an order?", copy: "Sign in to your account and select My orders. Available tracking information will be shown alongside the order." },
      { title: "Where can I ask about a product?", copy: "Use WhatsApp, email or the consultation page to ask for product guidance." },
      { title: "How are delivery charges calculated?", copy: "Delivery charges are returned by the checkout shipping service after a delivery address is selected." },
    ],
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Your privacy matters.",
    intro: "This summary explains the website information and account practices that apply to the Healthy Ways SA storefront.",
    sections: [
      { title: "Information we use", copy: "Account, delivery and order information is used to provide registration, checkout, fulfilment and customer support." },
      { title: "Payments and security", copy: "Payment details are handled through the approved payment provider. Checkout data is not stored in this preview interface." },
      { title: "Your choices", copy: "Contact the support team if you need help reviewing account information or raising a privacy question." },
    ],
  },
  terms: {
    eyebrow: "Terms",
    title: "Website and purchase terms.",
    intro: "These terms describe responsible use of this preview storefront and its purchasing experience.",
    sections: [
      { title: "Product information", copy: "Descriptions are provided for general information and are not intended to replace qualified healthcare advice." },
      { title: "Orders and availability", copy: "An order is subject to stock, address validation and successful payment confirmation." },
      { title: "Contact and support", copy: "Questions about an order or these terms should be sent to the Healthy Ways SA support team." },
    ],
  },
  delivery: {
    eyebrow: "Delivery",
    title: "Clear delivery expectations.",
    intro: "Delivery options and charges are calculated during checkout using the delivery address and live shipping service.",
    sections: [
      { title: "Checkout quote", copy: "Choose an address and request available shipping options before creating the payment order." },
      { title: "Tracking", copy: "Where tracking is available, it can be viewed from the relevant customer order." },
      { title: "Delivery support", copy: "Contact the team if an order status or delivery update needs clarification." },
    ],
  },
  returns: {
    eyebrow: "Returns",
    title: "Support for order concerns.",
    intro: "Our team can help review incorrect, damaged or unsuitable orders and explain the available next steps.",
    sections: [
      { title: "Contact promptly", copy: "Include the order number, product and concern when contacting support so the issue can be reviewed efficiently." },
      { title: "Keep original packaging", copy: "Do not dispose of packaging, delivery labels or the product until the support team confirms the required process." },
      { title: "Health and safety", copy: "Seek appropriate medical advice for adverse reactions and contact the company directly for product quality concerns." },
    ],
  },
};

function PublicPage({ view, onNavigate }: { view: keyof typeof publicPageCopy; onNavigate: (view: PreviewView) => void }) {
  const copy = publicPageCopy[view];
  return (
    <main className="wellness-public-page">
      <header className="wellness-public-hero">
        <p className="preview-section-kicker">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
        {view === "contact" || view === "consultation" ? <ContactActions /> : null}
      </header>
      <section className="wellness-public-grid" aria-label={`${copy.title} information`}>
        {copy.sections.map((section) => (
          <article key={section.title}>
            <span aria-hidden="true">0{copy.sections.indexOf(section) + 1}</span>
            <h2>{section.title}</h2>
            <p>{section.copy}</p>
          </article>
        ))}
      </section>
      {view === "contact" || view === "consultation" ? (
        <section className="wellness-public-callout">
          <div>
            <p className="preview-section-kicker">Need product guidance?</p>
            <h2>Browse first, then ask us anything.</h2>
          </div>
          <Button onClick={() => onNavigate("shop")}>Explore products</Button>
        </section>
      ) : null}
    </main>
  );
}

function FormPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      <h1 className="section-title">{title}</h1>
      {description ? <p className="mt-3 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-7">{children}</div>
    </main>
  );
}

function RegisterPage({
  experience,
  onNavigate,
}: {
  experience: "customer" | "admin";
  onNavigate: (view: PreviewView) => void;
}) {
  const [fields, setFields] = useState({
    displayName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    console.info("[admin-registration] Registration submit handler entered.");
    setFeedback(null);
    setFieldError(null);
    if (fields.password.length < 12 || fields.password.length > 128) {
      console.info("[admin-registration] Client-side validation failed: password length.");
      setFieldError("Password must be 12 to 128 characters.");
      return;
    }
    if (fields.password !== fields.confirmPassword) {
      console.info("[admin-registration] Client-side validation failed: passwords do not match.");
      setFieldError("Passwords do not match.");
      return;
    }
    const email = fields.email.trim().toLowerCase();
    if (experience === "admin" && !email.endsWith("@healtywayssa.co.za")) {
      console.info("[admin-registration] Client-side validation failed: administrator email domain.");
      setFieldError("Administrator accounts must use an @healtywayssa.co.za email address.");
      return;
    }
    console.info("[admin-registration] Client-side validation passed.");
    setBusy(true);
    try {
      const registration = {
        email,
        password: fields.password,
        ...(fields.displayName.trim() ? { displayName: fields.displayName.trim() } : {}),
      };
      let result: Awaited<ReturnType<typeof authApi.registerAdmin>>;
      if (experience === "admin") {
        console.info("[admin-registration] Calling registerAdmin.");
        result = await authApi.registerAdmin(registration);
        console.info("[admin-registration] registerAdmin resolved.", result.status);
      } else {
        result = await authApi.register(registration);
      }
      setFields({ displayName: "", email: "", password: "", confirmPassword: "" });
      setFeedback({
        kind: result.emailVerificationEmailSent ? "success" : "info",
        message: result.emailVerificationEmailSent
          ? `${result.status === 202 ? "Registration accepted" : "Account created"} for ${result.user.email}. The backend reports that the email provider accepted the verification message; this does not confirm delivery. Verify the email before signing in.`
          : `${result.status === 202 ? "Registration accepted" : "Account created"} for ${result.user.email}, but the backend reports that no verification message was accepted by the email provider. Contact the site operator or request verification again when email delivery is available.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Registration") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPage
      title={experience === "admin" ? "Create an administrator account" : "Create an account"}
      description={experience === "admin"
        ? "Administrator registration requires an @healtywayssa.co.za email. Email verification and two-factor setup are required before login."
        : "Customer registration. Email verification is required before login."}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm">
          <span>Name (optional)</span>
          <input
            className={inputClass}
            autoComplete="name"
            maxLength={100}
            value={fields.displayName}
            onChange={(event) => setFields({ ...fields, displayName: event.currentTarget.value })}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className={inputClass}
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={fields.email}
            onChange={(event) => setFields({ ...fields, email: event.currentTarget.value })}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Password (12–128 characters)</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={fields.password}
            onChange={(event) => setFields({ ...fields, password: event.currentTarget.value })}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Confirm password</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            required
            value={fields.confirmPassword}
            onChange={(event) =>
              setFields({ ...fields, confirmPassword: event.currentTarget.value })
            }
          />
        </label>
        {fieldError ? (
          <p role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        ) : null}
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Register"}
        </Button>
      </form>
      <p className="mt-5 text-sm">
        Already registered?{" "}
        <button
          className="underline"
          type="button"
          onClick={() => onNavigate(experience === "admin" ? "admin-login" : "customer-login")}
        >
          Log in
        </button>
      </p>
      <p className="mt-2 text-sm">
        Need to verify?{" "}
        <button className="underline" type="button" onClick={() => onNavigate("verify-email")}>
          Email verification
        </button>
      </p>
    </FormPage>
  );
}

type LoginStep = "credentials" | "email-otp" | "two-factor" | "enrollment" | "recovery-codes";
type LoginExperience = "customer" | "admin";

function CustomerLoginPage({
  onNavigate,
  returnTo,
  onGoogleSignIn,
  googleSignInBusy,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
  returnTo?: "cart" | "account" | "admin";
  onGoogleSignIn?: () => void;
  googleSignInBusy?: boolean;
}) {
  return (
    <LoginPage
      experience="customer"
      onNavigate={onNavigate}
      returnTo={returnTo}
      onGoogleSignIn={onGoogleSignIn}
      googleSignInBusy={googleSignInBusy}
    />
  );
}

function AdminLoginPage({
  onNavigate,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
}) {
  return <LoginPage experience="admin" onNavigate={onNavigate} returnTo="admin" />;
}

function LoginPage({
  experience,
  onNavigate,
  returnTo,
  onGoogleSignIn,
  googleSignInBusy = false,
}: {
  experience: LoginExperience;
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
  returnTo: "cart" | "account" | "admin" | undefined;
  onGoogleSignIn?: () => void;
  googleSignInBusy?: boolean;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep>("credentials");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await authApi.login({ email: email.trim(), password });
      setPassword("");
      if (experience === "customer") {
        if ("emailOtpRequired" in response) {
          setStep("email-otp");
        } else {
          throw new ApiResponseError(200, "Customer login returned an unexpected authentication challenge.");
        }
      } else if ("twoFactorRequired" in response) {
        setStep("two-factor");
      } else if ("twoFactorEnrollmentRequired" in response) {
        const setup = await authApi.enrollTwoFactor();
        setProvisioningUri(setup.provisioningUri);
        setStep("enrollment");
      } else {
        throw new ApiResponseError(200, "Administrator login returned an unexpected authentication response.");
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Sign in") });
    } finally {
      setBusy(false);
    }
  }

  async function submitFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (step === "email-otp") {
        if (experience !== "customer") {
          throw new ApiResponseError(200, "Unexpected customer verification challenge in administrator login.");
        }
        const result = await authApi.verifyLoginEmailOtp(code.trim());
        if (!("user" in result)) {
          throw new ApiResponseError(200, "Customer verification returned an unexpected authentication challenge.");
        }
        await refreshSession(queryClient, "customer");
        onNavigate(returnTo ?? "account");
      } else if (step === "two-factor") {
        if (experience !== "admin") {
          throw new ApiResponseError(200, "Unexpected administrator verification challenge in customer login.");
        }
        await authApi.verifyTwoFactor(code.trim());
        await refreshSession(queryClient, "admin");
        onNavigate("admin");
      } else if (step === "enrollment") {
        if (experience !== "admin") {
          throw new ApiResponseError(200, "Unexpected administrator enrollment in customer login.");
        }
        const result = await authApi.confirmTwoFactor(code.trim());
        setRecoveryCodes(result.recoveryCodes);
        setCode("");
        setStep("recovery-codes");
        await refreshSession(queryClient, "admin");
      } else {
        throw new ApiResponseError(200, "Unexpected login verification step.");
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Two-factor verification") });
    } finally {
      setBusy(false);
    }
  }

  if (step === "recovery-codes" && recoveryCodes) {
    return (
      <FormPage title="Save your recovery codes">
        <p className="text-sm">
          These codes are shown once. Store them securely; they are not saved in this browser.
        </p>
        <ul className="my-4 list-disc pl-6">
          {recoveryCodes.map((entry) => (
            <li key={entry}>
              <code>{entry}</code>
            </li>
          ))}
        </ul>
        <Button onClick={() => onNavigate(experience === "admin" ? "admin" : "account")}>
          {experience === "admin" ? "Continue to administrator workspace" : "Continue to account"}
        </Button>
      </FormPage>
    );
  }

  return (
    <FormPage
      title={
        step === "credentials"
          ? "Log in"
          : step === "email-otp"
            ? "Check your email"
            : step === "enrollment"
              ? experience === "admin"
                ? "Set up administrator authentication"
                : "Set up two-factor authentication"
              : experience === "admin"
                ? "Verify administrator sign-in"
                : "Verify sign-in"
      }
    >
      {step === "credentials" ? (
        <form className="space-y-4" onSubmit={(event) => void submitCredentials(event)}>
          {experience === "customer" && onGoogleSignIn ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy || googleSignInBusy}
              onClick={onGoogleSignIn}
            >
              {googleSignInBusy ? "Connecting to Google…" : "Continue with Google"}
            </Button>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span>Email</span>
            <input
              className={inputClass}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Password</span>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
          <FeedbackMessage feedback={feedback} />
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Log in"}
          </Button>
          {experience === "customer" ? (
            <p>
              <button
                className="text-sm underline"
                type="button"
                onClick={() => onNavigate("forgot-password")}
              >
                Forgot password?
              </button>
            </p>
          ) : (
            <p>
              <button
                className="text-sm underline"
                type="button"
                onClick={() => onNavigate("admin-forgot-password")}
              >
                Forgot password?
              </button>
            </p>
          )}
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void submitFactor(event)}>
          {step === "enrollment" ? (
            <div className="space-y-2 text-sm">
              <p>Add this setup URI to your authenticator app. It is shown only during setup.</p>
              <code className="block break-all rounded bg-muted p-3">{provisioningUri}</code>
            </div>
          ) : step === "email-otp" ? (
            <p className="text-sm">Enter the six-digit code sent to your email to finish signing in.</p>
          ) : (
            <p className="text-sm">
              {experience === "admin"
                ? "Enter the six-digit code from your authenticator app, or an administrator recovery code, to finish signing in."
                : "Enter the six-digit email sign-in code to finish signing in."}
            </p>
          )}
          <label className="block space-y-1 text-sm">
            <span>
              {step === "enrollment" || step === "email-otp"
                ? "Six-digit code"
                : "Authenticator or recovery code"}
            </span>
            <input
              className={inputClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={32}
              required
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          </label>
          <FeedbackMessage feedback={feedback} />
          <Button type="submit" disabled={busy}>
            {busy ? "Verifying…" : step === "enrollment" ? "Confirm setup" : "Verify and continue"}
          </Button>
          {step === "email-otp" ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void (async () => {
                try {
                  await authApi.resendLoginEmailOtp();
                  setFeedback({ kind: "success", message: "A new sign-in code has been sent." });
                } catch (error) {
                  setFeedback({ kind: "error", message: describeAuthError(error, "Resending the sign-in code") });
                }
              })()}
            >
              Resend code
            </Button>
          ) : null}
        </form>
      )}
      {step === "credentials" && experience === "customer" ? (
        <p className="mt-5 text-sm">
          No account yet?{" "}
          <button className="underline" type="button" onClick={() => onNavigate("register")}>Register</button>
        </p>
      ) : null}
      {step === "credentials" && experience === "admin" ? (
        <p className="mt-5 text-sm">
          Need an administrator account?{" "}
          <button className="underline" type="button" onClick={() => onNavigate("admin-register")}>
            Register as administrator
          </button>
        </p>
      ) : null}
    </FormPage>
  );
}

async function refreshSession(
  queryClient: ReturnType<typeof useQueryClient>,
  experience?: LoginExperience,
) {
  const session = await authApi.getSession();
  if (session.status !== "authenticated") {
    throw new Error("Sign in could not be completed because the authenticated session was not established.");
  }
  if (experience === "customer" && isAdminUser(session.user)) {
    throw new ApiResponseError(200, "Customer login resolved to an administrator account.");
  }
  if (experience === "admin" && !isAdminUser(session.user)) {
    throw new ApiResponseError(200, "Administrator login resolved to a non-administrator account.");
  }
  queryClient.setQueryData(["session"], session);
  await queryClient.invalidateQueries({ queryKey: ["cart"] });
}

type EmailLinkStatus = "loading" | "success" | "invalid" | "error" | "missing";

function VerifyEmailPage({
  onNavigate,
  verificationToken,
  isEmailLink,
  onClearEmailLink,
}: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
}) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(Boolean(isEmailLink && verificationToken));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [linkStatus, setLinkStatus] = useState<EmailLinkStatus | null>(
    isEmailLink ? (verificationToken ? "loading" : "missing") : null,
  );
  const handledEmailLinkRef = useRef<string | null>(null);
  const capturedTokenRef = useRef<string | null>(null);

  const verifyLinkToken = useCallback(async (linkToken: string) => {
    setBusy(true);
    setLinkStatus("loading");
    setFeedback(null);
    try {
      const result = await authApi.verifyEmail(linkToken);
      setLinkStatus("success");
      setFeedback({ kind: "success", message: result.message });
    } catch (error) {
      if (error instanceof ApiHttpError && (error.status === 400 || error.status === 410)) {
        setLinkStatus("invalid");
        setFeedback({
          kind: "error",
          message:
            "This verification link is invalid or expired. Request a new verification email and try again.",
        });
      } else {
        setLinkStatus("error");
        setFeedback({ kind: "error", message: describeAuthError(error, "Email verification") });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isEmailLink) return;
    if (!verificationToken && capturedTokenRef.current) return;

    const linkKey = verificationToken ?? "";
    if (handledEmailLinkRef.current === linkKey) return;
    handledEmailLinkRef.current = linkKey;

    if (!verificationToken) {
      onClearEmailLink();
      setLinkStatus("missing");
      setFeedback({
        kind: "error",
        message:
          "This verification link does not include a token. Request another verification email or enter a token below.",
      });
      return;
    }

    capturedTokenRef.current = verificationToken;
    onClearEmailLink();

    if (verificationToken.length < 40 || verificationToken.length > 200) {
      setLinkStatus("invalid");
      setFeedback({
        kind: "error",
        message:
          "This verification link is invalid or expired. Request a new verification email and try again.",
      });
      setBusy(false);
      return;
    }

    void verifyLinkToken(verificationToken);
  }, [isEmailLink, onClearEmailLink, verificationToken, verifyLinkToken]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const result = await authApi.requestVerification(email.trim());
      setFeedback({
        kind: "info",
        message: `The backend accepted the verification request: ${result.message} This response does not confirm that an email was delivered.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Verification request") });
    } finally {
      setBusy(false);
    }
  }

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const result = await authApi.verifyEmail(token.trim());
      setToken("");
      setFeedback({ kind: "success", message: result.message });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiHttpError && (error.status === 400 || error.status === 410)
            ? "This verification token is invalid or expired. Request a new verification email and try again."
            : describeAuthError(error, "Email verification"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function retryLinkVerification() {
    const capturedToken = capturedTokenRef.current;
    if (!capturedToken || busy) return;
    await verifyLinkToken(capturedToken);
  }

  return (
    <FormPage
      title="Verify your email"
      description="Use the verification link or token from your email. Tokens are submitted only to the backend and are not saved."
    >
      <div className="space-y-6">
        {linkStatus === "loading" ? (
          <p className="text-sm" role="status">
            Verifying your email…
          </p>
        ) : null}
        {linkStatus ? (
          linkStatus !== "loading" ? (
            <FeedbackMessage feedback={feedback} />
          ) : null
        ) : (
          <FeedbackMessage feedback={feedback} />
        )}
        {linkStatus === "error" && capturedTokenRef.current ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void retryLinkVerification()}
          >
            {busy ? "Retrying…" : "Try verification again"}
          </Button>
        ) : null}
        {linkStatus !== "loading" && linkStatus !== "success" ? (
          <form className="space-y-3" onSubmit={(event) => void submitToken(event)}>
            <label className="block space-y-1 text-sm">
              <span>Verification token</span>
              <input
                className={inputClass}
                minLength={40}
                maxLength={200}
                required
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" disabled={busy || token.trim().length < 40}>
              {busy ? "Verifying…" : "Verify email"}
            </Button>
          </form>
        ) : null}
        <div className="border-t border-border pt-5">
          <h2 className="font-medium">Request another verification email</h2>
          <form className="mt-3 space-y-3" onSubmit={(event) => void submitRequest(event)}>
            <label className="block space-y-1 text-sm">
              <span>Email</span>
              <input
                className={inputClass}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? "Sending request…" : "Request verification"}
            </Button>
          </form>
        </div>
        {linkStatus === "success" ? (
          <Button type="button" onClick={() => onNavigate("login")}>
            Continue to sign in
          </Button>
        ) : (
          <div className="flex flex-wrap gap-4">
            <button className="text-sm underline" type="button" onClick={() => onNavigate("login")}>
              Back to login
            </button>
            <button className="text-sm underline" type="button" onClick={() => onNavigate("shop")}>
              Back to the storefront
            </button>
          </div>
        )}
      </div>
    </FormPage>
  );
}

function ForgotPasswordPage({ experience = "customer", onNavigate }: { experience?: "customer" | "admin"; onNavigate: (view: PreviewView) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const result = await authApi.forgotPassword(email.trim());
      setFeedback({ kind: "info", message: result.message });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Password reset request") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormPage
      title={experience === "admin" ? "Administrator password reset" : "Forgot password"}
      description="The backend does not reveal whether an account exists."
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className={inputClass}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={busy}>
          {busy ? "Requesting…" : "Request reset instructions"}
        </Button>
        <p>
          <button
            className="text-sm underline"
            type="button"
            onClick={() => onNavigate("reset-password")}
          >
            I have a reset token
          </button>
        </p>
      </form>
    </FormPage>
  );
}

function ResetPasswordPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (password.length < 12 || password.length > 128 || password !== confirmPassword) {
      setFeedback({
        kind: "error",
        message:
          password !== confirmPassword
            ? "Passwords do not match."
            : "Password must be 12 to 128 characters.",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.resetPassword(token.trim(), password);
      setToken("");
      setPassword("");
      setConfirmPassword("");
      setFeedback({ kind: "success", message: result.message });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiHttpError && (error.status === 400 || error.status === 410)
            ? "This password reset token is invalid or expired. Request another reset."
            : describeAuthError(error, "Password reset"),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormPage title="Reset password">
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm">
          <span>Reset token</span>
          <input
            className={inputClass}
            minLength={40}
            maxLength={200}
            required
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>New password (12–128 characters)</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Confirm new password</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
          />
        </label>
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={busy}>
          {busy ? "Resetting…" : "Reset password"}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <button className="underline" type="button" onClick={() => onNavigate("login")}>
          Back to login
        </button>
      </p>
    </FormPage>
  );
}

const emptyAddress: Omit<PublicAddress, "id"> = {
  label: "",
  recipientName: "",
  phoneNumber: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  country: "South Africa",
  deliveryInstructions: "",
  localArea: "",
};

function AccountPage({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState({
    displayName: user.displayName ?? "",
    phoneNumber: user.phoneNumber ?? "",
  });
  const [address, setAddress] = useState(emptyAddress);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const ordersQuery = useQuery({
    queryKey: ["orders", user.id],
    queryFn: () => ordersApi.listCustomerOrders(),
    retry: false,
  });

  function applyUser(updated: PublicUser, initiatingUserId = user.id) {
    updateSessionForUser(queryClient, initiatingUserId, updated);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const initiatingUserId = user.id;
    try {
      const updated = await authApi.updateProfile({
        ...(profile.displayName.trim() ? { displayName: profile.displayName.trim() } : {}),
        ...(profile.phoneNumber.trim() ? { phoneNumber: profile.phoneNumber.trim() } : {}),
      });
      applyUser(updated, initiatingUserId);
      if (authenticatedUserId(queryClient) === initiatingUserId) setFeedback({ kind: "success", message: "Profile updated." });
    } catch (error) {
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setFeedback({ kind: "error", message: describeAuthError(error, "Profile update") });
      }
    } finally {
      if (authenticatedUserId(queryClient) === initiatingUserId) setBusy(false);
    }
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const initiatingUserId = user.id;
    try {
      const payload: Omit<PublicAddress, "id"> = {
        label: address.label.trim(),
        recipientName: address.recipientName.trim(),
        phoneNumber: address.phoneNumber.trim(),
        addressLine1: address.addressLine1.trim(),
        city: address.city.trim(),
        province: address.province.trim(),
        postalCode: address.postalCode.trim(),
        country: address.country.trim(),
        addressLine2: address.addressLine2?.trim() ?? "",
        ...(address.localArea?.trim() ? { localArea: address.localArea.trim() } : {}),
        deliveryInstructions: address.deliveryInstructions?.trim() ?? "",
      };
      const updated = editingId
        ? await authApi.updateAddress(editingId, payload)
        : await authApi.addAddress(payload);
      applyUser(updated, initiatingUserId);
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setAddress(emptyAddress);
        setEditingId(null);
        setFeedback({ kind: "success", message: editingId ? "Address updated." : "Address saved." });
      }
    } catch (error) {
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setFeedback({ kind: "error", message: describeAuthError(error, "Address save") });
      }
    } finally {
      if (authenticatedUserId(queryClient) === initiatingUserId) setBusy(false);
    }
  }

  async function deleteAddress(addressId: string) {
    const initiatingUserId = user.id;
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await authApi.deleteAddress(addressId);
      applyUser(updated, initiatingUserId);
      if (authenticatedUserId(queryClient) !== initiatingUserId) return;
      setFeedback({ kind: "success", message: "Address removed." });
      if (editingId === addressId) {
        setEditingId(null);
        setAddress(emptyAddress);
      }
    } catch (error) {
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setFeedback({ kind: "error", message: describeAuthError(error, "Address removal") });
      }
    } finally {
      if (authenticatedUserId(queryClient) === initiatingUserId) setBusy(false);
    }
  }

  async function setDefaultAddress(addressId: string) {
    const initiatingUserId = user.id;
    try {
      const updated = await authApi.setDefaultAddress(addressId);
      applyUser(updated, initiatingUserId);
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setFeedback({ kind: "success", message: "Default address updated." });
      }
    } catch (error) {
      if (authenticatedUserId(queryClient) === initiatingUserId) {
        setFeedback({ kind: "error", message: describeAuthError(error, "Default address") });
      }
    }
  }

  function editAddress(entry: PublicAddress) {
    setEditingId(entry.id);
    setAddress({
      label: entry.label,
      recipientName: entry.recipientName,
      phoneNumber: entry.phoneNumber,
      addressLine1: entry.addressLine1,
      addressLine2: entry.addressLine2 ?? "",
      localArea: entry.localArea ?? "",
      city: entry.city,
      province: entry.province,
      postalCode: entry.postalCode,
      country: entry.country,
      deliveryInstructions: entry.deliveryInstructions ?? "",
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-5 py-10">
      <header>
        <span className="eyebrow">Customer account</span>
        <h1 className="section-title mt-3">My account</h1>
      </header>
      <FeedbackMessage feedback={feedback} />
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-medium">Account details</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email verification</dt>
            <dd>{user.emailVerified ? "Verified" : "Not verified"}</dd>
          </div>
        </dl>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void saveProfile(event)}
        >
          <label className="space-y-1 text-sm">
            <span>Name</span>
            <input
              className={inputClass}
              maxLength={100}
              value={profile.displayName}
              onChange={(event) =>
                setProfile({ ...profile, displayName: event.currentTarget.value })
              }
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Phone number</span>
            <input
              className={inputClass}
              maxLength={30}
              value={profile.phoneNumber}
              onChange={(event) =>
                setProfile({ ...profile, phoneNumber: event.currentTarget.value })
              }
            />
          </label>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              variant="outline"
              disabled={busy || (!profile.displayName.trim() && !profile.phoneNumber.trim())}
            >
              Save profile
            </Button>
          </div>
        </form>
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-medium">Saved addresses</h2>
        {user.addresses.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No saved addresses yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {user.addresses.map((entry) => (
              <li
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                key={entry.id}
              >
                <div className="text-sm">
                  <strong>{entry.label}</strong>
                  <p>
                    {entry.recipientName} · {entry.phoneNumber}
                  </p>
                  <p>
                    {entry.addressLine1}
                    {entry.addressLine2 ? `, ${entry.addressLine2}` : ""}
                    {entry.localArea ? `, ${entry.localArea}` : ""}, {entry.city},{" "}
                    {entry.province}, {entry.postalCode}, {entry.country}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => editAddress(entry)}
                  >
                    Edit
                  </Button>
                  {!entry.isDefault ? <Button type="button" variant="outline" disabled={busy} onClick={() => void setDefaultAddress(entry.id)}>Set default</Button> : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void deleteAddress(entry.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => void saveAddress(event)}
        >
          <h3 className="font-medium sm:col-span-2">
            {editingId ? "Edit address" : "Add an address"}
          </h3>
          {(
            [
              ["label", "Address label", true],
              ["recipientName", "Recipient name", true],
              ["phoneNumber", "Phone number", true],
              ["addressLine1", "Address line 1", true],
              ["addressLine2", "Address line 2", false],
              ["localArea", "Local area (optional)", false],
              ["city", "City", true],
              ["province", "Province", true],
              ["postalCode", "Postal code", true],
              ["country", "Country", true],
            ] as const
          ).map(([key, label, required]) => (
            <label className="space-y-1 text-sm" key={key}>
              <span>{label}</span>
              <input
                className={inputClass}
                required={required}
                maxLength={
                  key === "addressLine1" || key === "addressLine2" || key === "localArea"
                    ? 120
                    : key === "postalCode"
                      ? 12
                      : key === "label"
                        ? 40
                        : 100
                }
                value={address[key] ?? ""}
                onChange={(event) => setAddress({ ...address, [key]: event.currentTarget.value })}
              />
            </label>
          ))}
          <label className="space-y-1 text-sm sm:col-span-2">
            <span>Delivery instructions (optional)</span>
            <textarea
              className={inputClass}
              rows={2}
              maxLength={300}
              value={address.deliveryInstructions ?? ""}
              onChange={(event) =>
                setAddress({ ...address, deliveryInstructions: event.currentTarget.value })
              }
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Update address" : "Save address"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setAddress(emptyAddress);
                }}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-medium">Order history</h2>
        {ordersQuery.isPending ? (
          <p className="mt-3 text-sm" role="status">
            Loading orders…
          </p>
        ) : null}
        {ordersQuery.isError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {describeAuthError(ordersQuery.error, "Order history")}
          </p>
        ) : null}
        {ordersQuery.data?.orders.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No orders found.</p>
        ) : null}
        <ul className="mt-3 space-y-3">
          {ordersQuery.data?.orders.map((order) => (
            <li className="rounded-md border border-border p-3 text-sm" key={order.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{order.orderNumber}</strong>
                <span>
                  {order.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1">
                {new Date(order.createdAt).toLocaleDateString()} ·{" "}
                {formatZarCents(order.totalCents)}
              </p>
              <ul className="mt-2 list-disc pl-5">
                {order.items.map((item) => (
                  <li key={item.productId}>
                    {item.name} × {item.quantity}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
