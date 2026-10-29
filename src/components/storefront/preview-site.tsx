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

export type PreviewView =
  | "shop"
  | "login"
  | "register"
  | "verify-email"
  | "customer-verify-email"
  | "admin-verify-email"
  | "account"
  | "cart"
  | "admin"
  | "admin-login"
  | "admin-register"
  | "forgot-password"
  | "reset-password"
  | "admin-forgot-password"
  | "admin-reset-password"
  | "payment-return"
  | "payment-cancel";

interface PreviewSiteProps {
  view: PreviewView;
  product: string | undefined;
  returnTo: "cart" | "account" | "admin" | undefined;
  verificationToken: string | undefined;
  checkoutOrderId: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin", token?: string) => void;
  onSelectProduct: (slug: string) => void;
  onBackToCatalogue: () => void;
}

interface Feedback {
  message: string;
  kind: "success" | "error" | "info";
}

const inputClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function describeAuthError(error: unknown, action: string): string {
  if (error instanceof ApiHttpError) {
    if (error.isCsrfFailure) {
      return error.csrfRefreshError
        ? "The backend rejected the security token and a fresh token could not be obtained. Refresh the page and try again."
        : "The backend rejected the security token after one refresh attempt. Refresh the page and try again.";
    }
    if (error.status === 401 && action.toLowerCase().includes("sign in")) {
      return "Sign-in failed. Check your email and password, and confirm your email address is verified.";
    }
    if (error.status === 401) {
      return `${action} was not accepted. Check the code and try again before the challenge expires.`;
    }
    if (error.status === 403) {
      return "The backend denied this request. Your session may have expired, or recent authentication may be required.";
    }
    if (error.status === 409) {
      return (
        error.message || "This account or request already exists. Check the details and try again."
      );
    }
    if (error.status === 400) {
      return (
        error.message || `${action} was not accepted. Check the required fields and try again.`
      );
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

function PaymentResultPage({
  orderId,
  cancelled,
  user,
  sessionLoading,
  onNavigate,
}: {
  orderId: string | undefined;
  cancelled: boolean;
  user: PublicUser | undefined;
  sessionLoading: boolean;
  onNavigate: PreviewSiteProps["onNavigate"];
}) {
  const orderQuery = useQuery({
    queryKey: ["orders", "customer", orderId],
    queryFn: () => ordersApi.getCustomerOrder(orderId ?? ""),
    enabled: Boolean(orderId && user),
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "pending_payment" ? 8000 : false),
  });
  const isPaid = orderQuery.data?.status === "paid";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-5 py-12">
      <span className="eyebrow">{cancelled ? "Payment cancelled" : "Payment status"}</span>
      <h1 className="section-title">
        {isPaid
          ? "Payment confirmed"
          : orderQuery.isLoading
            ? "Checking your order"
            : cancelled
              ? "Payment was not completed"
              : "Payment confirmation pending"}
      </h1>
      {!orderId ? (
        <p className="rounded-md border border-destructive/40 p-4 text-sm" role="alert">
          The payment return did not include an order reference. No payment status can be confirmed
          here.
        </p>
      ) : sessionLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your customer session…
        </p>
      ) : !user ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign in to retrieve the latest status of your order. A redirect from PayFast is not
            payment confirmation.
          </p>
          <Button type="button" onClick={() => onNavigate("login", "cart")}>
            Sign in to check order
          </Button>
        </div>
      ) : orderQuery.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Retrieving payment status from the store…
        </p>
      ) : orderQuery.isError ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive" role="alert">
            Order status could not be retrieved. Retry before treating this payment as complete.
          </p>
          <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
            Retry status check
          </Button>
        </div>
      ) : orderQuery.data ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <p className="font-medium">Order {orderQuery.data.orderNumber}</p>
          {isPaid ? (
            <p className="text-sm" role="status">
              The backend has confirmed your payment. Your order total was{" "}
              {formatZarCents(orderQuery.data.totalCents)}.
            </p>
          ) : orderQuery.data.status === "pending_payment" ? (
            <p className="text-sm" role="status">
              The store has not received final payment confirmation yet. This page checks again
              automatically; you can also refresh the status.
            </p>
          ) : (
            <p className="text-sm" role="status">
              The backend currently reports “{orderQuery.data.status.replace(/_/g, " ")}”. Contact
              support if you believe payment was completed.
            </p>
          )}
          {cancelled && !isPaid ? (
            <p className="text-sm text-muted-foreground">
              PayFast returned to the cancellation page. The order status shown above comes from the
              store and is authoritative.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void orderQuery.refetch()}
            disabled={orderQuery.isFetching}
          >
            {orderQuery.isFetching ? "Refreshing…" : "Refresh payment status"}
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="outline" onClick={() => onNavigate("shop")}>
        Continue shopping
      </Button>
    </main>
  );
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
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin", token?: string) => void;
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
            <Button type="button" variant="ghost" onClick={() => onNavigate("cart")}>
              Cart
            </Button>
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
          <div className="flex items-center gap-4">
            <span>Rooted in nature. Made for your wellbeing.</span>
            <button
              className="underline underline-offset-4"
              type="button"
              onClick={() => onNavigate("admin-login", "admin")}
            >
              Admin Login
            </button>
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
  checkoutOrderId,
  isEmailLink,
  onClearEmailLink,
  onNavigate,
  onSelectProduct,
  onBackToCatalogue,
}: PreviewSiteProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const user = sessionQuery.data?.status === "authenticated" ? sessionQuery.data.user : undefined;
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function logout() {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      const result = await authApi.logout();
      queryClient.setQueryData(["session"], { status: "unauthenticated" });
      queryClient.removeQueries({ queryKey: ["cart"] });
      queryClient.removeQueries({ queryKey: ["orders"] });
      if (result.csrfRefreshFailed) {
        setLogoutError(
          "You are signed out, but the security token could not be refreshed. Reload before making another account change.",
        );
      }
      onNavigate("shop");
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 401) {
        queryClient.setQueryData(["session"], { status: "unauthenticated" });
        queryClient.removeQueries({ queryKey: ["cart"] });
        queryClient.removeQueries({ queryKey: ["orders"] });
        setLogoutError("Your session had expired. You have been signed out on this device.");
        onNavigate("shop");
      } else {
        setLogoutError(describeAuthError(error, "Sign out"));
      }
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
    content = <CustomerLoginPage onNavigate={onNavigate} returnTo={returnTo} />;
  } else if (view === "admin-login") {
    content = <AdminLoginPage onNavigate={onNavigate} />;
  } else if (view === "register") {
    content = <CustomerRegisterPage onNavigate={onNavigate} />;
  } else if (view === "admin-register") {
    content = <AdminRegisterPage onNavigate={onNavigate} />;
  } else if (view === "verify-email") {
    content = <VerificationFlowChoice onNavigate={onNavigate} token={verificationToken} />;
  } else if (view === "customer-verify-email") {
    content = (
      <CustomerEmailVerificationPage
        onNavigate={onNavigate}
        verificationToken={verificationToken}
        isEmailLink={isEmailLink}
        onClearEmailLink={onClearEmailLink}
      />
    );
  } else if (view === "admin-verify-email") {
    content = (
      <AdminEmailVerificationPage
        onNavigate={onNavigate}
        verificationToken={verificationToken}
        isEmailLink={isEmailLink}
        onClearEmailLink={onClearEmailLink}
      />
    );
  } else if (view === "forgot-password") {
    content = <ForgotPasswordPage onNavigate={onNavigate} />;
  } else if (view === "reset-password") {
    content = <ResetPasswordFlowChoice onNavigate={onNavigate} token={verificationToken} />;
  } else if (view === "admin-forgot-password") {
    content = <AdminForgotPasswordPage onNavigate={onNavigate} />;
  } else if (view === "admin-reset-password") {
    content = (
      <AdminResetPasswordPage onNavigate={onNavigate} verificationToken={verificationToken} />
    );
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
  } else if (view === "cart") {
    content = (
      <CartPage
        onContinueShopping={() => onNavigate("shop")}
        onSignIn={() => onNavigate("login", "cart")}
        user={user}
      />
    );
  } else if (view === "payment-return" || view === "payment-cancel") {
    content = (
      <PaymentResultPage
        orderId={checkoutOrderId}
        cancelled={view === "payment-cancel"}
        user={user}
        sessionLoading={sessionQuery.isLoading}
        onNavigate={onNavigate}
      />
    );
  } else {
    content = (
      <section className="catalogue-section">
        {user && !isAdminUser(user) ? (
          <AccessMessage
            title="Administrator access denied"
            description="A matching email domain is not enough. The backend must confirm the verified administrator role and completed two-factor authentication."
          />
        ) : !user ? (
          <>
            <AccessMessage
              title="Administrator sign-in required"
              description="Sign in with an authorized administrator account. The backend checks the administrator role and requires verified email and authenticator-app enrollment. Eligible addresses must use the exact @healtywayssa.co.za domain."
              onAction={() => onNavigate("admin-login", "admin")}
              action="Administrator sign in"
            />
            <p className="mx-auto mt-4 max-w-xl text-center text-sm">
              Need administrator access?{" "}
              <button
                className="underline"
                type="button"
                onClick={() => onNavigate("admin-register")}
              >
                Register as an administrator
              </button>
            </p>
          </>
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
      onCheckout={() => onNavigate("cart")}
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
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h1 className="section-title">{title}</h1>
      {description ? <p className="mt-3 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-7">{children}</div>
    </main>
  );
}

interface RegistrationFields {
  displayName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
}

function RegistrationInputs({
  fields,
  setFields,
  fieldError,
}: {
  fields: RegistrationFields;
  setFields: (fields: RegistrationFields) => void;
  fieldError: string | null;
}) {
  return (
    <>
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
        <span>Phone number (optional)</span>
        <input
          className={inputClass}
          type="tel"
          autoComplete="tel"
          maxLength={30}
          value={fields.phoneNumber}
          onChange={(event) => setFields({ ...fields, phoneNumber: event.currentTarget.value })}
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
          onChange={(event) => setFields({ ...fields, confirmPassword: event.currentTarget.value })}
        />
      </label>
      {fieldError ? (
        <p role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : null}
    </>
  );
}

function CustomerRegisterPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<RegistrationFields>({
    displayName: "",
    email: "",
    phoneNumber: "",
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
        ...(fields.phoneNumber.trim() ? { phoneNumber: fields.phoneNumber.trim() } : {}),
      });
      setFields({
        displayName: "",
        email: "",
        phoneNumber: "",
        password: "",
        confirmPassword: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      setFeedback({
        kind: result.emailVerificationEmailSent ? "success" : "info",
        message: result.emailVerificationEmailSent
          ? `Account created for ${result.user.email}. Verify your email before signing in.`
          : `Account created for ${result.user.email}, but no verification email was accepted by the email provider. Request verification again when email delivery is available.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Registration") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPage
      title="Customer Registration"
      eyebrow="Customer Access"
      description="Create a customer account. Email verification is required before login."
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <RegistrationInputs fields={fields} setFields={setFields} fieldError={fieldError} />
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create customer account"}
        </Button>
      </form>
      <p className="mt-5 text-sm">
        Already registered?{" "}
        <button className="underline" type="button" onClick={() => onNavigate("login")}>
          Customer Login
        </button>
      </p>
      <p className="mt-2 text-sm">
        Need to verify your customer email?{" "}
        <button
          className="underline"
          type="button"
          onClick={() => onNavigate("customer-verify-email")}
        >
          Customer email verification
        </button>
      </p>
    </FormPage>
  );
}

function AdminRegisterPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<RegistrationFields>({
    displayName: "",
    email: "",
    phoneNumber: "",
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
    if (!fields.email.trim().toLowerCase().endsWith("@healtywayssa.co.za")) {
      setFieldError(
        "Only the exact @healtywayssa.co.za email domain is eligible for administrator registration.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.registerAdmin({
        email: fields.email.trim(),
        password: fields.password,
        ...(fields.displayName.trim() ? { displayName: fields.displayName.trim() } : {}),
        ...(fields.phoneNumber.trim() ? { phoneNumber: fields.phoneNumber.trim() } : {}),
      });
      setFields({ displayName: "", email: "", phoneNumber: "", password: "", confirmPassword: "" });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      setFeedback({
        kind: result.emailVerificationEmailSent ? "success" : "info",
        message: result.emailVerificationEmailSent
          ? `Administrator account created for ${result.user.email}. Verify the email first; authenticator-app TOTP enrollment is also mandatory.`
          : `Administrator account created for ${result.user.email}, but the backend did not accept an email for delivery. Request verification when email delivery is available. Email verification and TOTP enrollment are required.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: describeAuthError(error, "Administrator registration"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPage
      title="Administrator Registration"
      eyebrow="Administrator Access"
      description="Only the exact @healtywayssa.co.za domain is eligible. The backend assigns the role. Email verification and authenticator-app TOTP enrollment are both required."
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <RegistrationInputs fields={fields} setFields={setFields} fieldError={fieldError} />
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={busy}>
          {busy ? "Creating administrator account…" : "Register administrator"}
        </Button>
      </form>
      <p className="mt-5 text-sm">
        Already registered?{" "}
        <button className="underline" type="button" onClick={() => onNavigate("admin-login")}>
          Administrator Login
        </button>
      </p>
      <p className="mt-2 text-sm">
        Need to verify your administrator email?{" "}
        <button
          className="underline"
          type="button"
          onClick={() => onNavigate("admin-verify-email")}
        >
          Administrator email verification
        </button>
      </p>
    </FormPage>
  );
}

type CustomerLoginStep = "credentials" | "email-otp" | "two-factor";
type AdminLoginStep =
  "credentials" | "enrollment" | "two-factor" | "session-check" | "recovery-codes";

function CustomerLoginPage({
  onNavigate,
  returnTo,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
  returnTo: "cart" | "account" | "admin" | undefined;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<CustomerLoginStep>("credentials");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function rejectUnexpectedFlow(message: string) {
    try {
      await authApi.logout();
    } catch {
      // The flow is rejected regardless; the backend remains authoritative.
    }
    queryClient.setQueryData(["session"], { status: "unauthenticated" });
    setStep("credentials");
    setCode("");
    setFeedback({ kind: "error", message });
  }

  async function finishCustomerLogin() {
    const session = await authApi.getSession();
    queryClient.setQueryData(["session"], session);
    if (
      session.status !== "authenticated" ||
      !session.user.roles.includes("customer") ||
      session.user.roles.includes("admin")
    ) {
      await rejectUnexpectedFlow(
        "This account did not complete customer sign-in. Use the correct access area or contact support.",
      );
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["cart"] });
    onNavigate(returnTo ?? "account");
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await authApi.login({ email: email.trim(), password });
      setPassword("");
      if ("emailOtpRequired" in response) {
        setStep("email-otp");
      } else if ("twoFactorRequired" in response) {
        await rejectUnexpectedFlow(
          "The backend returned an administrator-style challenge for customer sign-in. No customer session was accepted.",
        );
      } else if ("twoFactorEnrollmentRequired" in response) {
        await rejectUnexpectedFlow(
          "This account requires administrator authenticator enrollment. Continue through Administrator Access instead.",
        );
      } else if (
        response.user.roles.includes("customer") &&
        !response.user.roles.includes("admin")
      ) {
        await finishCustomerLogin();
      } else {
        await rejectUnexpectedFlow(
          "This account is not a customer account. Continue through Administrator Access if appropriate.",
        );
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Customer sign in") });
    } finally {
      setBusy(false);
    }
  }

  async function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (step === "email-otp") {
        const response = await authApi.verifyEmailOtp(code.trim());
        setCode("");
        if ("twoFactorRequired" in response) {
          setStep("two-factor");
        } else if (
          response.user.roles.includes("customer") &&
          !response.user.roles.includes("admin")
        ) {
          await finishCustomerLogin();
        } else {
          await rejectUnexpectedFlow(
            "The verified account is not a customer account. Customer access was not granted.",
          );
        }
      } else {
        const response = await authApi.verifyTwoFactor(code.trim());
        setCode("");
        if (response.user.roles.includes("customer") && !response.user.roles.includes("admin")) {
          await finishCustomerLogin();
        } else {
          await rejectUnexpectedFlow(
            "The verified account is not a customer account. Customer access was not granted.",
          );
        }
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Customer sign in") });
    } finally {
      setBusy(false);
    }
  }

  async function resendEmailOtp() {
    setBusy(true);
    setFeedback(null);
    try {
      await authApi.resendEmailOtp();
      setFeedback({
        kind: "info",
        message:
          "A new sign-in code was requested. Check your email; the previous code is no longer valid.",
      });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Email code resend") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPage
      title={
        step === "credentials"
          ? "Customer Login"
          : step === "email-otp"
            ? "Customer Email Verification"
            : "Customer Two-Factor Verification"
      }
      eyebrow="Customer Access"
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
            {busy ? "Signing in…" : "Customer Login"}
          </Button>
          <p>
            <button
              className="text-sm underline"
              type="button"
              onClick={() => onNavigate("forgot-password")}
            >
              Forgot password?
            </button>
          </p>
          <p className="text-sm">
            New customer?{" "}
            <button className="underline" type="button" onClick={() => onNavigate("register")}>
              Create a customer account
            </button>
          </p>
          <p className="text-sm">
            Administrator?{" "}
            <button
              className="underline"
              type="button"
              onClick={() => onNavigate("admin-login", "admin")}
            >
              Administrator Login
            </button>
          </p>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void submitChallenge(event)}>
          <p className="text-sm">
            {step === "email-otp"
              ? "Enter the six-digit code sent to your email."
              : "Enter your customer authenticator or recovery code."}
          </p>
          <label className="block space-y-1 text-sm">
            <span>{step === "email-otp" ? "Email code" : "Authenticator or recovery code"}</span>
            <input
              className={inputClass}
              inputMode={step === "two-factor" ? "text" : "numeric"}
              autoComplete="one-time-code"
              minLength={6}
              maxLength={step === "two-factor" ? 32 : 6}
              pattern={step === "two-factor" ? undefined : "[0-9]{6}"}
              required
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          </label>
          <FeedbackMessage feedback={feedback} />
          <Button type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Continue customer sign-in"}
          </Button>
          {step === "email-otp" ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void resendEmailOtp()}
            >
              {busy ? "Requesting…" : "Resend email code"}
            </Button>
          ) : null}
        </form>
      )}
    </FormPage>
  );
}

function AdminLoginPage({
  onNavigate,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin") => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<AdminLoginStep>("credentials");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [secret, setSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function rejectUnexpectedFlow(message: string) {
    try {
      await authApi.logout();
    } catch {
      // The flow is rejected regardless; the backend remains authoritative.
    }
    queryClient.setQueryData(["session"], { status: "unauthenticated" });
    setStep("credentials");
    setCode("");
    setFeedback({ kind: "error", message });
  }

  async function loadAdminSession() {
    const session = await authApi.getSession();
    queryClient.setQueryData(["session"], session);
    if (
      session.status !== "authenticated" ||
      !session.user.roles.includes("admin") ||
      session.user.roles.includes("customer")
    ) {
      try {
        await authApi.logout();
      } catch {
        // Do not grant access when the backend session role does not match.
      }
      queryClient.setQueryData(["session"], { status: "unauthenticated" });
      setStep("credentials");
      setFeedback({
        kind: "error",
        message:
          "The backend did not confirm an administrator session. Administrator access was not granted.",
      });
      return false;
    }
    await queryClient.invalidateQueries({ queryKey: ["cart"] });
    return true;
  }

  async function finishAdminLogin() {
    if (!(await loadAdminSession())) return;
    onNavigate("admin");
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await authApi.login({ email: email.trim(), password });
      setPassword("");
      if ("twoFactorEnrollmentRequired" in response) {
        const enrollment = await authApi.enrollTwoFactor();
        setProvisioningUri(enrollment.provisioningUri);
        setSecret(enrollment.secret);
        setStep("enrollment");
      } else if ("twoFactorRequired" in response) {
        setStep("two-factor");
      } else if ("emailOtpRequired" in response) {
        await rejectUnexpectedFlow(
          "The backend returned a customer email-code challenge. No customer challenge will be continued here; use Customer Access if this is a customer account.",
        );
      } else if (
        response.user.roles.includes("admin") &&
        !response.user.roles.includes("customer")
      ) {
        await finishAdminLogin();
      } else {
        await rejectUnexpectedFlow(
          "The backend authenticated this account as a customer, not an administrator. Customer access was not granted here.",
        );
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Administrator sign in") });
    } finally {
      setBusy(false);
    }
  }

  async function submitFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      if (step === "enrollment") {
        const result = await authApi.confirmTwoFactor(code.trim());
        setRecoveryCodes(result.recoveryCodes);
        setCode("");
        setStep("recovery-codes");
        if (result.csrfRefreshFailed) {
          setFeedback({
            kind: "error",
            message:
              "Enrollment succeeded. Save your one-time recovery codes, then refresh before continuing.",
          });
        }
      } else {
        const result = await authApi.verifyTwoFactor(code.trim());
        setCode("");
        if (!result.user.roles.includes("admin") || result.user.roles.includes("customer")) {
          await rejectUnexpectedFlow("The backend-confirmed account is not an administrator.");
        } else {
          setStep("session-check");
          await finishAdminLogin();
        }
      }
    } catch (error) {
      setFeedback({
        kind: "error",
        message: describeAuthError(error, "Administrator two-factor verification"),
      });
    } finally {
      setBusy(false);
    }
  }

  if (step === "recovery-codes" && recoveryCodes) {
    return (
      <FormPage title="Save administrator recovery codes" eyebrow="Administrator Access">
        <p className="text-sm">These codes are displayed once. Save them securely.</p>
        <ul className="my-4 list-disc pl-6">
          {recoveryCodes.map((entry) => (
            <li key={entry}>
              <code>{entry}</code>
            </li>
          ))}
        </ul>
        <FeedbackMessage feedback={feedback} />
        <p className="text-sm">
          Enrollment is complete. Sign in again with your administrator credentials and
          authenticator code to establish a fresh session.
        </p>
        <Button type="button" onClick={() => onNavigate("admin-login")}>
          Continue to administrator login
        </Button>
      </FormPage>
    );
  }

  return (
    <FormPage
      title={
        step === "credentials"
          ? "Administrator Login"
          : step === "enrollment"
            ? "Administrator Authenticator Setup"
            : step === "session-check"
              ? "Confirm Administrator Session"
              : "Administrator Two-Factor Verification"
      }
      eyebrow="Administrator Access"
      description={
        step === "credentials"
          ? "Sign-in requires a backend-confirmed admin role, verified email, and mandatory authenticator verification."
          : undefined
      }
    >
      {step === "credentials" ? (
        <form className="space-y-4" onSubmit={(event) => void submitCredentials(event)}>
          <label className="block space-y-1 text-sm">
            <span>Administrator email</span>
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
            {busy ? "Signing in…" : "Administrator Login"}
          </Button>
          <p>
            <button
              className="text-sm underline"
              type="button"
              onClick={() => onNavigate("admin-forgot-password")}
            >
              Forgot administrator password?
            </button>
          </p>
          <p className="text-sm">
            Need administrator access?{" "}
            <button
              className="underline"
              type="button"
              onClick={() => onNavigate("admin-register")}
            >
              Administrator registration
            </button>
          </p>
          <p className="text-sm">
            Customer?{" "}
            <button className="underline" type="button" onClick={() => onNavigate("login")}>
              Customer Login
            </button>
          </p>
        </form>
      ) : step === "session-check" ? (
        <div className="space-y-4">
          <p className="text-sm">
            The authenticator challenge was accepted. Confirming the backend session and
            administrator role before opening the dashboard.
          </p>
          <FeedbackMessage feedback={feedback} />
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void finishAdminLogin()
                .catch((error: unknown) => {
                  setFeedback({
                    kind: "error",
                    message: describeAuthError(error, "Administrator session check"),
                  });
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Checking session…" : "Check administrator session"}
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void submitFactor(event)}>
          {step === "enrollment" ? (
            <div className="space-y-2 text-sm">
              <p>
                Scan the provisioning URI if supported by your authenticator app, or add the account
                manually with this URI or secret.
              </p>
              <code className="block break-all rounded bg-muted p-3">{provisioningUri}</code>
              <p>Authenticator secret</p>
              <code className="block break-all rounded bg-muted p-3">{secret}</code>
            </div>
          ) : (
            <p className="text-sm">Enter the current authenticator code or a recovery code.</p>
          )}
          <label className="block space-y-1 text-sm">
            <span>
              {step === "enrollment"
                ? "Six-digit authenticator code"
                : "Authenticator or recovery code"}
            </span>
            <input
              className={inputClass}
              inputMode={step === "two-factor" ? "text" : "numeric"}
              autoComplete="one-time-code"
              minLength={6}
              maxLength={step === "two-factor" ? 32 : 6}
              pattern={step === "two-factor" ? undefined : "[0-9]{6}"}
              required
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          </label>
          <FeedbackMessage feedback={feedback} />
          <Button type="submit" disabled={busy}>
            {busy
              ? "Verifying…"
              : step === "enrollment"
                ? "Confirm administrator setup"
                : "Verify administrator sign-in"}
          </Button>
        </form>
      )}
    </FormPage>
  );
}

async function refreshSession(queryClient: ReturnType<typeof useQueryClient>) {
  const session = await authApi.getSession();
  queryClient.setQueryData(["session"], session);
  await queryClient.invalidateQueries({ queryKey: ["cart"] });
}

type EmailLinkStatus = "loading" | "success" | "invalid" | "error" | "missing";

function VerificationFlowChoice({
  onNavigate,
  token,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin", token?: string) => void;
  token: string | undefined;
}) {
  return (
    <FormPage
      title="Choose your email verification area"
      description="The verification link does not identify whether the account is a customer or administrator. Choose the account type you registered; the backend will validate the token."
    >
      <div className="flex flex-col gap-3">
        <Button type="button" onClick={() => onNavigate("customer-verify-email", undefined, token)}>
          Verify customer account
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onNavigate("admin-verify-email", undefined, token)}
        >
          Verify administrator account
        </Button>
      </div>
    </FormPage>
  );
}

function CustomerEmailVerificationPage(props: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
}) {
  return <EmailVerificationForm {...props} isAdminFlow={false} />;
}

function AdminEmailVerificationPage(props: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
}) {
  return <EmailVerificationForm {...props} isAdminFlow />;
}

function EmailVerificationForm({
  onNavigate,
  verificationToken,
  isEmailLink,
  onClearEmailLink,
  isAdminFlow,
}: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
  isEmailLink: boolean;
  onClearEmailLink: () => void;
  isAdminFlow: boolean;
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
      title={isAdminFlow ? "Administrator Email Verification" : "Customer Email Verification"}
      eyebrow={isAdminFlow ? "Administrator Access" : "Customer Access"}
      description="Use your account's verification link or token. The backend validates it; a token does not establish an account role."
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
          <Button type="button" onClick={() => onNavigate(isAdminFlow ? "admin-login" : "login")}>
            Continue to {isAdminFlow ? "administrator" : "customer"} login
          </Button>
        ) : (
          <div className="flex flex-wrap gap-4">
            <button
              className="text-sm underline"
              type="button"
              onClick={() => onNavigate(isAdminFlow ? "admin-login" : "login")}
            >
              Back to {isAdminFlow ? "administrator" : "customer"} login
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
  return <ForgotPasswordForm onNavigate={onNavigate} />;
}

function AdminForgotPasswordPage({ onNavigate }: { onNavigate: (view: PreviewView) => void }) {
  return <ForgotPasswordForm onNavigate={onNavigate} isAdminFlow />;
}

function ForgotPasswordForm({
  onNavigate,
  isAdminFlow = false,
}: {
  onNavigate: (view: PreviewView) => void;
  isAdminFlow?: boolean;
}) {
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
      title={isAdminFlow ? "Forgot administrator password" : "Forgot customer password"}
      eyebrow={isAdminFlow ? "Administrator Access" : "Customer Access"}
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
            onClick={() => onNavigate(isAdminFlow ? "admin-reset-password" : "reset-password")}
          >
            I have a {isAdminFlow ? "administrator" : "customer"} reset token
          </button>
        </p>
      </form>
      <p className="mt-4 text-sm">
        <button
          className="underline"
          type="button"
          onClick={() => onNavigate(isAdminFlow ? "admin-login" : "login")}
        >
          Back to {isAdminFlow ? "administrator" : "customer"} login
        </button>
      </p>
    </FormPage>
  );
}

function ResetPasswordFlowChoice({
  onNavigate,
  token,
}: {
  onNavigate: (view: PreviewView, returnTo?: "cart" | "account" | "admin", token?: string) => void;
  token: string | undefined;
}) {
  return (
    <FormPage
      title="Choose your password-reset area"
      description="The backend reset link does not identify the account type. Choose the area you used to register; the backend validates the token."
    >
      <div className="flex flex-col gap-3">
        <Button type="button" onClick={() => onNavigate("reset-password", undefined, token)}>
          Reset customer password
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onNavigate("admin-reset-password", undefined, token)}
        >
          Reset administrator password
        </Button>
      </div>
    </FormPage>
  );
}

function ResetPasswordPage({
  onNavigate,
  verificationToken,
}: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
}) {
  return (
    <PasswordResetForm
      onNavigate={onNavigate}
      verificationToken={verificationToken}
      isAdminFlow={false}
    />
  );
}

function AdminResetPasswordPage({
  onNavigate,
  verificationToken,
}: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
}) {
  return (
    <PasswordResetForm onNavigate={onNavigate} verificationToken={verificationToken} isAdminFlow />
  );
}

function PasswordResetForm({
  onNavigate,
  verificationToken,
  isAdminFlow,
}: {
  onNavigate: (view: PreviewView) => void;
  verificationToken: string | undefined;
  isAdminFlow: boolean;
}) {
  const [token, setToken] = useState(verificationToken ?? "");
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
    <FormPage
      title={isAdminFlow ? "Reset administrator password" : "Reset customer password"}
      eyebrow={isAdminFlow ? "Administrator Access" : "Customer Access"}
    >
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
        <button
          className="underline"
          type="button"
          onClick={() => onNavigate(isAdminFlow ? "admin-login" : "login")}
        >
          Back to {isAdminFlow ? "administrator" : "customer"} login
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
  localArea: "",
  city: "",
  province: "",
  postalCode: "",
  country: "South Africa",
  deliveryInstructions: "",
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
    queryKey: ["orders", "customer"],
    queryFn: () => ordersApi.listCustomerOrders(),
    retry: false,
  });

  function applyUser(updated: PublicUser) {
    queryClient.setQueryData(["session"], { status: "authenticated", user: updated });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await authApi.updateProfile({
        ...(profile.displayName.trim() ? { displayName: profile.displayName.trim() } : {}),
        ...(profile.phoneNumber.trim() ? { phoneNumber: profile.phoneNumber.trim() } : {}),
      });
      applyUser(updated);
      setFeedback({ kind: "success", message: "Profile updated." });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Profile update") });
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const payload: Omit<PublicAddress, "id"> = {
        label: address.label.trim(),
        recipientName: address.recipientName.trim(),
        phoneNumber: address.phoneNumber.trim(),
        addressLine1: address.addressLine1.trim(),
        ...(address.localArea?.trim() ? { localArea: address.localArea.trim() } : {}),
        city: address.city.trim(),
        province: address.province.trim(),
        postalCode: address.postalCode.trim(),
        country: address.country.trim(),
        addressLine2: address.addressLine2?.trim() ?? "",
        deliveryInstructions: address.deliveryInstructions?.trim() ?? "",
      };
      const updated = editingId
        ? await authApi.updateAddress(editingId, payload)
        : await authApi.addAddress(payload);
      applyUser(updated);
      setAddress(emptyAddress);
      setEditingId(null);
      setFeedback({ kind: "success", message: editingId ? "Address updated." : "Address saved." });
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Address save") });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAddress(addressId: string) {
    setBusy(true);
    setFeedback(null);
    try {
      applyUser(await authApi.deleteAddress(addressId));
      setFeedback({ kind: "success", message: "Address removed." });
      if (editingId === addressId) {
        setEditingId(null);
        setAddress(emptyAddress);
      }
    } catch (error) {
      setFeedback({ kind: "error", message: describeAuthError(error, "Address removal") });
    } finally {
      setBusy(false);
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
                    {entry.addressLine2 ? `, ${entry.addressLine2}` : ""}, {entry.city},{" "}
                    {entry.province}, {entry.postalCode}, {entry.country}
                  </p>
                  {entry.localArea ? <p>Suburb / local area: {entry.localArea}</p> : null}
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
              ["localArea", "Suburb / local area (needed for shipping quotes)", false],
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
                  {order.status === "pending_payment" ? "Pending payment — not paid" : "Cancelled"}
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
