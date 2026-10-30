import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AdminPanel } from "@/components/storefront/admin";
import { CartPage, CartSheet, CartTrigger } from "@/components/storefront/cart";
import { Catalogue } from "@/components/storefront/catalogue";
import { Button } from "@/components/ui/button";
import { ApiHttpError, ApiResponseError, CsrfTokenError } from "@/lib/api/client";
import { authApi, type PublicAddress, type PublicUser } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/auth/authorization";
import { ordersApi } from "@/lib/api/orders";
import { formatZarCents } from "@/lib/money";
import { Brand, ContactActions } from "@/components/wellness";
import { CheckoutPage } from "@/components/storefront/customer-checkout";
import { AddressesPage, OrderDetailPage, OrdersPage, TrackingPage } from "@/components/storefront/customer-pages";
import { PaymentStatePage } from "@/components/storefront/payment-state";

export type PreviewView =
  | "shop"
  | "login"
  | "customer-login"
  | "admin-login"
  | "register"
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
    if (error.status === 400) {
      return `${action} was not accepted. Check the required fields, password length, or token format and try again.`;
    }
    if (error.status === 429) return "Too many attempts. Wait a few minutes before trying again.";
    if (error.status >= 500)
      return "The service is temporarily unavailable. Please try again later.";
  }
  if (error instanceof ApiResponseError) {
    return `${action} could not be completed because the backend response was invalid.`;
  }
  if (error instanceof CsrfTokenError) {
    return "This request could not be secured because a CSRF token was unavailable. Refresh the page and try again.";
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
  return (
    <>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <a href="/preview" aria-label="HealthywaysSA home and shop">
            <Brand className="w-[120px]" />
          </a>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Main navigation">
            <Button type="button" variant="ghost" onClick={() => onNavigate("shop")}>
              Home / Shop
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onNavigate(user ? "account" : "login", "account")}
            >
              My Account
            </Button>
            {user ? (
              <>
                <Button type="button" variant="ghost" onClick={() => onNavigate("addresses")}>My Addresses</Button>
                <Button type="button" variant="ghost" onClick={() => onNavigate("orders")}>My Orders</Button>
              </>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => onNavigate("cart")}>
              Cart
            </Button>
            {!user ? (
              <Button type="button" variant="ghost" onClick={() => onNavigate("login", "admin")}>Admin sign-in</Button>
            ) : null}
            {isAdmin ? (
              <Button type="button" variant="ghost" onClick={() => onNavigate("admin")}>
                Admin
              </Button>
            ) : null}
            {user ? (
              <Button type="button" variant="outline" disabled={logoutBusy} onClick={onLogout}>
                {logoutBusy ? "Signing out…" : "Log out"}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => onNavigate("login")}>
                Log in
              </Button>
            )}
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-muted-foreground">
          <span>© 2026 Healthy Ways SA. Naturally, with care.</span>
          <ContactActions />
          <span>Rooted in nature. Made for your wellbeing.</span>
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
  const activeOrderId = orderId;
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const user = sessionQuery.data?.status === "authenticated" ? sessionQuery.data.user : undefined;
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

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

  let content: ReactNode;
  if (view === "shop") {
    content = (
      <Catalogue
        selectedSlug={product}
        onSelectProduct={onSelectProduct}
        onBackToCatalogue={onBackToCatalogue}
      />
    );
  } else if (view === "login") {
    content = returnTo === "admin"
      ? <AdminLoginPage onNavigate={onNavigate} />
      : <CustomerLoginPage onNavigate={onNavigate} returnTo={returnTo} />;
  } else if (view === "customer-login") {
    content = <CustomerLoginPage onNavigate={onNavigate} />;
  } else if (view === "admin-login") {
    content = <AdminLoginPage onNavigate={onNavigate} />;
  } else if (view === "register") {
    content = <RegisterPage onNavigate={onNavigate} />;
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
        onAction={() => onNavigate("login", "account")}
        action="Go to login"
      />
    );
  } else if (view === "addresses") {
    content = user ? <AddressesPage user={user} applyUser={(updated, initiatingUserId) => updateSessionForUser(queryClient, initiatingUserId, updated)} /> : <AccessMessage title="Sign in to manage addresses" onAction={() => onNavigate("login", "account")} action="Go to login" />;
  } else if (view === "orders") {
    content = user ? <OrdersPage userId={user.id} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId)} /> : <AccessMessage title="Sign in to view your orders" onAction={() => onNavigate("login", "account")} action="Go to login" />;
  } else if (view === "order-detail") {
    content = user && activeOrderId ? <OrderDetailPage userId={user.id} orderId={activeOrderId} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? activeOrderId)} /> : <AccessMessage title="Sign in to view this order" onAction={() => onNavigate("login", "account")} action="Go to login" />;
  } else if (view === "tracking-detail") {
    content = user && activeOrderId ? <TrackingPage userId={user.id} orderId={activeOrderId} onNavigate={(next, _returnTo, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? activeOrderId)} /> : <AccessMessage title="Sign in to view tracking" onAction={() => onNavigate("login", "account")} action="Go to login" />;
  } else if (view === "checkout") {
    content = user ? <CheckoutPage user={user} onNavigate={(next) => onNavigate(next as PreviewView)} /> : <AccessMessage title="Sign in to checkout" onAction={() => onNavigate("login", "cart")} action="Go to login" />;
  } else if (view === "payment-return" || view === "payment-cancel") {
    content = user ? <PaymentStatePage userId={user.id} orderId={orderId} cancelled={view === "payment-cancel"} onNavigate={(next, selectedOrderId) => onNavigate(next as PreviewView, undefined, selectedOrderId ?? orderId)} /> : <AccessMessage title="Sign in to view payment status" onAction={() => onNavigate("login", "account")} action="Go to login" />;
  } else if (view === "cart") {
    content = (
      <CartPage
        onContinueShopping={() => onNavigate("shop")}
        onSignIn={() => onNavigate("login", "cart")}
        onCheckout={() => onNavigate(user ? "checkout" : "login", user ? undefined : "cart")}
      />
    );
  } else {
    content = (
      <section className="catalogue-section">
        {user && !isAdminUser(user) ? (
          <AccessMessage
            title="Administrator access denied"
            description="A matching email domain is not enough. The backend must confirm the verified administrator role and completed two-factor authentication. The current backend has no public admin-registration or invitation endpoint; ask the backend operator to provision an admin account through an approved secure process."
          />
        ) : !user ? (
          <AccessMessage
            title="Administrator sign-in required"
            description="Sign in with an authorized administrator account. The backend role and required two-factor authentication are checked after sign-in. There is no public admin-registration or invitation endpoint; ask the backend operator about approved secure provisioning."
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
    <CartProviderView
      content={
        <SiteFrame
          user={user}
          onLogout={() => void logout()}
          logoutBusy={logoutBusy}
          onNavigate={onNavigate}
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
      onSignIn={() => onNavigate("login", "cart")}
      onCheckout={() => onNavigate(user ? "checkout" : "login", user ? undefined : "cart")}
    />
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

function RegisterPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
  const queryClient = useQueryClient();
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
    setFeedback(null);
    setFieldError(null);
    if (fields.password.length < 12 || fields.password.length > 128) {
      setFieldError("Password must be 12 to 128 characters.");
      return;
    }
    if (fields.password !== fields.confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.register({
        email: fields.email.trim(),
        password: fields.password,
        ...(fields.displayName.trim() ? { displayName: fields.displayName.trim() } : {}),
      });
      setFields({ displayName: "", email: "", password: "", confirmPassword: "" });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      setFeedback({
        kind: result.emailVerificationEmailSent ? "success" : "info",
        message: result.emailVerificationEmailSent
          ? `Account created for ${result.user.email}. The backend reports that the email provider accepted the verification message; this does not confirm delivery. Verify the email before signing in.`
          : `Account created for ${result.user.email}, but the backend reports that no verification message was accepted by the email provider. Contact the site operator or request verification again when email delivery is available.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Registration") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPage
      title="Create an account"
      description="Customer registration. Email verification is required before login."
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
        <button className="underline" type="button" onClick={() => onNavigate("login")}>
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
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
  returnTo?: "cart" | "account" | "admin";
}) {
  return <LoginPage experience="customer" onNavigate={onNavigate} returnTo={returnTo} />;
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
}: {
  experience: LoginExperience;
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
  returnTo: "cart" | "account" | "admin" | undefined;
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
      } else {
        const result = await authApi.confirmTwoFactor(code.trim());
        setRecoveryCodes(result.recoveryCodes);
        setCode("");
        setStep("recovery-codes");
        await refreshSession(queryClient, "admin");
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
        <Button onClick={() => onNavigate("account")}>Continue to account</Button>
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
              ? "Set up two-factor authentication"
              : "Verify sign-in"
      }
    >
      {step === "credentials" ? (
        <form className="space-y-4" onSubmit={(event) => void submitCredentials(event)}>
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
          ) : null}
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
              Enter the authenticator code or a recovery code to finish signing in.
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
          <button className="underline" type="button" onClick={() => onNavigate("register")}>
            Register
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

function ForgotPasswordPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
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
      title="Forgot password"
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
