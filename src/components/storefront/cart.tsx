import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiHttpError, CsrfTokenError } from "@/lib/api/client";
import { cartApi, type Cart, type CartLine } from "@/lib/api/cart";
import { type PublicUser } from "@/lib/api/auth";
import { ordersApi, type CustomerOrder, type ShippingQuote } from "@/lib/api/orders";
import { formatZarCents } from "@/lib/money";

interface CartContextValue {
  isOpen: boolean;
  setIsOpen: (nextValue: boolean) => void;
  cart: Cart | undefined;
  isCartLoading: boolean;
  cartError: Error | null;
  retryCart: () => Promise<unknown>;
  totalQuantity: number;
  isBusy: boolean;
  notice: string | null;
  setNotice: (nextNotice: string | null) => void;
  addItem: (productId: string, quantity?: number) => Promise<void>;
  changeItemQuantity: (productId: string, delta: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

function getCartErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError) {
    if (error.isCsrfFailure) {
      return "The cart request could not be verified after one token refresh. Refresh the page and try again.";
    }
    if (error.status === 401) {
      return "Please sign in to use your cart.";
    }
    if (error.status === 403) {
      return "Your cart session expired. Please try again.";
    }
    if (
      typeof error.body === "object" &&
      error.body !== null &&
      !Array.isArray(error.body) &&
      "error" in error.body &&
      typeof error.body.error === "string" &&
      error.body.error.trim()
    ) {
      return error.body.error;
    }
    return `The cart is unavailable (HTTP ${error.status}).`;
  }
  if (error instanceof CsrfTokenError) {
    return "The cart request could not be secured because a CSRF token was unavailable. Refresh the page and try again.";
  }
  return "The cart could not be reached. Check your connection and try again.";
}

export function CartProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queuedOperations, setQueuedOperations] = useState(0);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const {
    data: cart,
    isPending: isCartLoading,
    error: cartError,
    refetch: retryCart,
  } = useQuery({
    queryKey: ["cart"],
    queryFn: () => cartApi.getCart(),
    retry: false,
    staleTime: 30_000,
  });

  const totalQuantity = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const enqueueCartOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    setQueuedOperations((count) => count + 1);
    const run = async () => {
      await queryClient.cancelQueries({ queryKey: ["cart"], exact: true });
      return operation();
    };
    const result = operationQueueRef.current.then(run, run);
    operationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => setQueuedOperations((count) => Math.max(0, count - 1)));
  }, [queryClient]);

  const addItemMutation = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      cartApi.addItem(productId, quantity),
    onSuccess: (updatedCart, variables) => {
      queryClient.setQueryData(["cart"], updatedCart);
      setNotice(
        `Added ${variables.quantity} item${variables.quantity > 1 ? "s" : ""} to your cart.`,
      );
      setIsOpen(true);
    },
    onError: (error) => {
      setNotice(getCartErrorMessage(error));
      setIsOpen(true);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      cartApi.updateItem(productId, quantity),
    onSuccess: (updatedCart, variables) => {
      queryClient.setQueryData(["cart"], updatedCart);
      setNotice(`Updated quantity to ${variables.quantity}.`);
    },
    onError: (error) => {
      setNotice(getCartErrorMessage(error));
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: ({ productId }: { productId: string }) => cartApi.removeItem(productId),
    onSuccess: (updatedCart) => {
      queryClient.setQueryData(["cart"], updatedCart);
      setNotice("Item removed from your cart.");
    },
    onError: (error) => {
      setNotice(getCartErrorMessage(error));
    },
  });

  const clearCartMutation = useMutation({
    mutationFn: () => cartApi.clearCart(),
    onSuccess: (updatedCart) => {
      queryClient.setQueryData(["cart"], updatedCart);
      setNotice("Your cart has been cleared.");
    },
    onError: (error) => {
      setNotice(getCartErrorMessage(error));
    },
  });

  const value = useMemo<CartContextValue>(
    () => ({
      isOpen,
      setIsOpen,
      cart,
      isCartLoading,
      cartError,
      retryCart,
      totalQuantity,
      isBusy:
        queuedOperations > 0 ||
        addItemMutation.isPending ||
        updateItemMutation.isPending ||
        removeItemMutation.isPending ||
        clearCartMutation.isPending,
      notice,
      setNotice,
      addItem: async (productId: string, quantity = 1) => {
        await enqueueCartOperation(() => addItemMutation.mutateAsync({ productId, quantity }));
      },
      changeItemQuantity: async (productId: string, delta: number) => {
        await enqueueCartOperation(async () => {
          const currentCart = queryClient.getQueryData<Cart>(["cart"]);
          const item = currentCart?.items.find((line) => line.productId === productId);
          if (!item || !item.available || !Number.isInteger(delta) || delta === 0) return;
          const quantity = Math.min(99, Math.max(1, item.quantity + delta));
          if (quantity !== item.quantity) {
            await updateItemMutation.mutateAsync({ productId, quantity });
          }
        });
      },
      removeItem: async (productId: string) => {
        await enqueueCartOperation(() => removeItemMutation.mutateAsync({ productId }));
      },
      clearCart: async () => {
        await enqueueCartOperation(() => clearCartMutation.mutateAsync());
      },
    }),
    [
      addItemMutation,
      cart,
      cartError,
      clearCartMutation,
      isOpen,
      notice,
      removeItemMutation,
      totalQuantity,
      updateItemMutation,
      queuedOperations,
      queryClient,
      enqueueCartOperation,
      isCartLoading,
      retryCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useOptionalCart() {
  return useContext(CartContext);
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("CartProvider must wrap components that use the cart.");
  }
  return context;
}

function getItemLineLabel(item: CartLine): string {
  if (item.product) {
    return item.product.name;
  }
  return "Unavailable product";
}

export function CartTrigger() {
  const cart = useOptionalCart();
  const totalQuantity = cart?.totalQuantity ?? 0;
  const setIsOpen = cart?.setIsOpen ?? (() => undefined);

  return (
    <Button
      type="button"
      variant="outline"
      className="cart-trigger"
      onClick={() => setIsOpen(true)}
      aria-label={totalQuantity > 0 ? `Open cart with ${totalQuantity} items` : "Open cart"}
    >
      <ShoppingBag aria-hidden="true" size={16} />
      <span>Cart</span>
      {totalQuantity > 0 ? <span className="cart-badge">{totalQuantity}</span> : null}
    </Button>
  );
}

export function CartSheet({
  onSignIn,
  onCheckout,
}: {
  onSignIn?: () => void;
  onCheckout?: () => void;
} = {}) {
  const {
    isOpen,
    setIsOpen,
    cart,
    isCartLoading,
    cartError,
    retryCart,
    notice,
    setNotice,
    isBusy,
    changeItemQuantity,
    removeItem,
    clearCart,
  } = useCart();

  const cartItems = cart?.items ?? [];

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) {
          setNotice(null);
        }
      }}
    >
      <SheetContent className="cart-sheet" aria-describedby="cart-sheet-description">
        <SheetHeader className="cart-sheet-header">
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription id="cart-sheet-description">
            Review your saved products before checkout.
          </SheetDescription>
        </SheetHeader>

        {notice ? <p className="cart-notice">{notice}</p> : null}

        {isCartLoading && !order ? (
          <p className="cart-status" role="status">
            Loading cart…
          </p>
        ) : cartError && !order ? (
          <div className="cart-error" role="alert">
            <p>{getCartErrorMessage(cartError)}</p>
            {cartError instanceof ApiHttpError && cartError.status === 401 && onSignIn ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                  setNotice(null);
                  onSignIn();
                }}
              >
                Sign in to use your cart
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => void retryCart()}>
              Retry cart
            </Button>
          </div>
        ) : !cart ? (
          <p className="cart-status" role="status">
            Loading cart…
          </p>
        ) : cart.items.length === 0 ? (
          <div className="cart-empty" role="status">
            <ShoppingBag aria-hidden="true" size={22} />
            <p>Your cart is empty.</p>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Continue shopping
            </Button>
          </div>
        ) : (
          <>
            <div className="cart-list" aria-live="polite">
              {cartItems.map((item) => (
                <div className="cart-item" key={item.productId}>
                  <div className="cart-item-copy">
                    <span className="cart-item-name">{getItemLineLabel(item)}</span>
                    {item.available && item.unitPriceCents !== null ? (
                      <span className="cart-item-price">{formatZarCents(item.unitPriceCents)}</span>
                    ) : (
                      <span className="cart-item-price cart-item-unavailable">Unavailable</span>
                    )}
                  </div>

                  <div className="cart-item-controls">
                    <div className="cart-quantity-row">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="cart-quantity-button"
                        aria-label={`Decrease quantity for ${getItemLineLabel(item)}`}
                        onClick={() =>
                          void changeItemQuantity(item.productId, -1).catch(
                            () => undefined,
                          )
                        }
                        disabled={isBusy || !item.available || item.quantity <= 1}
                      >
                        <Minus aria-hidden="true" size={14} />
                      </Button>
                      <span aria-live="polite">{item.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="cart-quantity-button"
                        aria-label={`Increase quantity for ${getItemLineLabel(item)}`}
                        onClick={() =>
                          void changeItemQuantity(item.productId, 1).catch(
                            () => undefined,
                          )
                        }
                        disabled={isBusy || !item.available || item.quantity >= 99}
                      >
                        <Plus aria-hidden="true" size={14} />
                      </Button>
                    </div>

                    {item.available && item.lineSubtotalCents !== null ? (
                      <span className="cart-subtotal">
                        {formatZarCents(item.lineSubtotalCents)}
                      </span>
                    ) : (
                      <span className="cart-subtotal cart-item-unavailable">—</span>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${getItemLineLabel(item)} from cart`}
                      onClick={() => void removeItem(item.productId).catch(() => undefined)}
                      disabled={isBusy}
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary">
              <div>
                <span className="cart-summary-label">Merchandise subtotal</span>
                <strong>{formatZarCents(cart.totalCents)}</strong>
              </div>
              <Button
                variant="outline"
                onClick={() => void clearCart().catch(() => undefined)}
                disabled={isBusy}
              >
                Clear cart
              </Button>
            </div>
            <Button
              className="cart-checkout-disabled"
              type="button"
              variant="default"
              onClick={() => {
                setIsOpen(false);
                setNotice(null);
                onCheckout?.();
              }}
            >
              Continue to checkout
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function CartPage({
  onContinueShopping,
  onSignIn,
  onManageAddress,
  user,
}: {
  onContinueShopping: () => void;
  onSignIn: () => void;
  onManageAddress: () => void;
  user: PublicUser | undefined;
}) {
  const {
    cart,
    isCartLoading,
    cartError,
    retryCart,
    notice,
    isBusy,
    changeItemQuantity,
    removeItem,
    clearCart,
  } = useCart();
  const [addressId, setAddressId] = useState("");
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [quotes, setQuotes] = useState<ShippingQuote[] | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<ShippingQuote | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<{
    addressId: string;
    idempotencyKey: string;
  } | null>(null);
  const queryClient = useQueryClient();

  function describeCheckoutError(error: unknown): string {
    if (error instanceof ApiHttpError) {
      if (error.isCsrfFailure) {
        return "The security token was rejected after one refresh attempt. Refresh the page before retrying.";
      }
      if (error.status === 401) return "Your sign-in has expired. Sign in again to continue checkout.";
      if (error.status === 403) return "This order action is not permitted for the current account.";
      if (error.status === 409) {
        return typeof error.body === "object" &&
          error.body !== null &&
          "error" in error.body &&
          typeof error.body.error === "string"
          ? error.body.error
          : "The cart or selected address changed. Review your details and try again.";
      }
      if (
        typeof error.body === "object" &&
        error.body !== null &&
        "error" in error.body &&
        typeof error.body.error === "string" &&
        error.body.error.trim()
      ) {
        return error.body.error;
      }
      return `Checkout could not be completed (HTTP ${error.status}).`;
    }
    if (error instanceof CsrfTokenError) {
      return "A security token was unavailable. Refresh the page and try again.";
    }
    return "Checkout could not be completed. Check your connection and try again.";
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutBusy || !user) return;
    const selectedAddress = user.addresses.find((address) => address.id === addressId);
    if (!selectedAddress || !selectedAddress.localArea?.trim()) {
      setCheckoutError("Choose a saved delivery address with a suburb / local area.");
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutMessage(null);
    const attempt =
      pendingAttempt?.addressId === addressId
        ? pendingAttempt
        : { addressId, idempotencyKey: crypto.randomUUID() };
    setPendingAttempt(attempt);
    try {
      const created = await ordersApi.createCustomerOrder(addressId, attempt.idempotencyKey);
      setOrder(created);
      setPendingAttempt(null);
      setCheckoutMessage(`Order ${created.orderNumber} was created. Request delivery rates below.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["orders", "customer"] }),
      ]);
    } catch (error) {
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function requestQuotes() {
    if (!order || checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutMessage(null);
    setQuotes(null);
    setSelectedQuote(null);
    try {
      const response = await ordersApi.requestShippingQuotes(order.id);
      setQuotes(response.rates);
      setCheckoutMessage(
        response.rates.length
          ? "Available delivery services are shown below."
          : "No delivery rates are available for this order right now.",
      );
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 422) {
        setQuotes([]);
        setCheckoutMessage("No delivery rates were returned. You can retry after reviewing the order details.");
      }
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function selectQuote(quote: ShippingQuote) {
    if (!order || checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutMessage(null);
    try {
      await ordersApi.selectShippingQuote(order.id, quote.quoteId);
      const refreshed = await ordersApi.getCustomerOrder(order.id);
      setOrder(refreshed);
      setSelectedQuote(quote);
      setCheckoutMessage(`${quote.serviceLevel.name} selected.`);
    } catch (error) {
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <section className="catalogue-section" aria-labelledby="cart-page-title">
      <header className="catalogue-header">
        <span className="eyebrow">Your selections</span>
        <h1 id="cart-page-title" className="section-title mt-3">
          Your cart
        </h1>
      </header>
      {notice ? (
        <p className="cart-notice" role="status">
          {notice}
        </p>
      ) : null}
      {isCartLoading ? (
        <p className="catalogue-status" role="status">
          Loading cart…
        </p>
      ) : cartError ? (
        <div className="catalogue-error" role="alert">
          <p>{getCartErrorMessage(cartError)}</p>
          {cartError instanceof ApiHttpError && cartError.status === 401 ? (
            <Button type="button" variant="outline" onClick={onSignIn}>
              Sign in to use your cart
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void retryCart()}>
            Retry cart
          </Button>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </div>
      ) : (!cart || cart.items.length === 0) && !order ? (
        <div className="cart-empty" role="status">
          <ShoppingBag aria-hidden="true" size={22} />
          <p>Your cart is empty.</p>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </div>
      ) : (
        <>
          {cart && !order ? <div className="cart-list" aria-live="polite">
            {cart.items.map((item) => (
              <div className="cart-item" key={item.productId}>
                <div className="cart-item-copy">
                  <span className="cart-item-name">{getItemLineLabel(item)}</span>
                  {item.available && item.unitPriceCents !== null ? (
                    <span className="cart-item-price">{formatZarCents(item.unitPriceCents)}</span>
                  ) : (
                    <span className="cart-item-price cart-item-unavailable">
                      Unavailable — remove this item to continue
                    </span>
                  )}
                </div>
                <div className="cart-item-controls">
                  <div className="cart-quantity-row">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Decrease quantity for ${getItemLineLabel(item)}`}
                      disabled={isBusy || !item.available || item.quantity <= 1}
                      onClick={() =>
                        void changeItemQuantity(item.productId, -1).catch(() => undefined)
                      }
                    >
                      <Minus aria-hidden="true" size={14} />
                    </Button>
                    <span aria-live="polite">{item.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Increase quantity for ${getItemLineLabel(item)}`}
                      disabled={isBusy || !item.available || item.quantity >= 99}
                      onClick={() =>
                        void changeItemQuantity(item.productId, 1).catch(() => undefined)
                      }
                    >
                      <Plus aria-hidden="true" size={14} />
                    </Button>
                  </div>
                  {item.available && item.lineSubtotalCents !== null ? (
                    <span className="cart-subtotal">{formatZarCents(item.lineSubtotalCents)}</span>
                  ) : (
                    <span className="cart-subtotal cart-item-unavailable">—</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${getItemLineLabel(item)} from cart`}
                    disabled={isBusy}
                    onClick={() => void removeItem(item.productId).catch(() => undefined)}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div> : null}
          {cart && !order ? (
            <div className="cart-summary">
              <div>
                <span className="cart-summary-label">Merchandise subtotal</span>
                <strong>{formatZarCents(cart.totalCents)}</strong>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => void clearCart().catch(() => undefined)}
              >
                Clear cart
              </Button>
            </div>
          ) : null}
          {!order ? (
            <form className="mt-5 space-y-4 rounded-lg border border-border bg-card p-4" onSubmit={(event) => void createOrder(event)}>
              <h2 className="text-lg font-medium">Delivery and shipping</h2>
              {!user ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Sign in to choose a saved delivery address and create your order.</p>
                  <Button type="button" variant="outline" onClick={onSignIn}>Sign in to checkout</Button>
                </div>
              ) : user.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add a saved delivery address in My Account before checkout.</p>
              ) : (
                <>
                  {cart?.hasUnavailableItems ? (
                    <p className="cart-item-unavailable" role="alert">
                      Remove unavailable or out-of-stock items before creating this order.
                    </p>
                  ) : null}
                  <label className="block space-y-1 text-sm">
                    <span>Delivery address</span>
                    <select
                      className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                      value={addressId}
                      onChange={(event) => {
                        setAddressId(event.currentTarget.value);
                        setCheckoutError(null);
                        setPendingAttempt(null);
                      }}
                      required
                      disabled={checkoutBusy}
                    >
                      <option value="">Choose a saved address</option>
                      {user.addresses.map((address) => (
                        <option key={address.id} value={address.id} disabled={!address.localArea?.trim()}>
                          {address.label}{address.localArea?.trim() ? ` — ${address.localArea}` : " — add suburb/local area in My Account"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground">A suburb/local area is required for shipping quotes. Older saved addresses without one can be updated in My Account.</p>
                      {!user.addresses.some((address) => address.localArea?.trim()) ? (
                        <Button type="button" variant="link" className="px-0" onClick={onManageAddress}>
                          Manage saved addresses
                        </Button>
                      ) : null}
                  <Button
                    type="submit"
                    disabled={checkoutBusy || isBusy || !addressId || cart?.hasUnavailableItems}
                  >
                    {checkoutBusy ? "Creating order…" : pendingAttempt?.addressId === addressId ? "Retry order creation" : "Create order and continue"}
                  </Button>
                </>
              )}
            </form>
          ) : null}
          {checkoutError ? <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{checkoutError}</p> : null}
          {checkoutMessage ? <p className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm" role="status">{checkoutMessage}</p> : null}
          {order ? (
            <section className="mt-5 space-y-4 rounded-lg border border-border bg-card p-4" aria-labelledby="shipping-quote-title">
              <div>
                <h2 id="shipping-quote-title" className="text-lg font-medium">Order {order.orderNumber}</h2>
                <p className="text-sm text-muted-foreground">Status: {order.status.replace(/_/g, " ")}</p>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Merchandise subtotal</dt><dd className="font-medium">{formatZarCents(order.subtotalCents)}</dd></div>
                <div><dt className="text-muted-foreground">Shipping fee</dt><dd className="font-medium">{selectedQuote ? formatZarCents(selectedQuote.rateCents) : "Not selected"}</dd></div>
                <div><dt className="text-muted-foreground">Order total</dt><dd className="font-medium">{formatZarCents(order.totalCents)}</dd></div>
              </dl>
              <Button type="button" variant="outline" disabled={checkoutBusy} onClick={() => void requestQuotes()}>
                {checkoutBusy && quotes === null ? "Requesting rates…" : "Request delivery rates"}
              </Button>
              {quotes?.length === 0 ? <p className="text-sm text-muted-foreground">No rates were returned. You can try again later.</p> : null}
              {quotes?.length ? (
                <ul className="space-y-3">
                  {quotes.map((quote) => (
                    <li key={quote.quoteId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                      <div className="text-sm">
                        <strong>{quote.serviceLevel.name}</strong>
                        {quote.serviceLevel.deliveryDateFrom || quote.serviceLevel.deliveryDateTo ? (
                          <p className="text-muted-foreground">
                            Estimated delivery: {quote.serviceLevel.deliveryDateFrom && quote.serviceLevel.deliveryDateTo
                              ? `${quote.serviceLevel.deliveryDateFrom} – ${quote.serviceLevel.deliveryDateTo}`
                              : quote.serviceLevel.deliveryDateFrom ?? quote.serviceLevel.deliveryDateTo}
                          </p>
                        ) : null}
                        <p>{formatZarCents(quote.rateCents)}</p>
                      </div>
                      <Button type="button" variant={selectedQuote?.quoteId === quote.quoteId ? "secondary" : "outline"} disabled={checkoutBusy} onClick={() => void selectQuote(quote)}>
                        {selectedQuote?.quoteId === quote.quoteId ? "Selected" : "Select service"}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted-foreground">Payment is not available in this checkout stage.</p>
            </section>
          ) : null}
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </>
      )}
    </section>
  );
}

export function CartAddButton({
  productId,
  quantity = 1,
  disabled = false,
  children,
}: {
  productId: string;
  quantity?: number;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const cart = useOptionalCart();
  const isBusy = cart?.isBusy ?? false;
  const existingQuantity =
    cart?.cart?.items.find((item) => item.productId === productId)?.quantity ?? 0;
  const quantityLimitReached = existingQuantity + quantity > 99;

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      disabled={!cart || disabled || isBusy || quantityLimitReached}
      aria-busy={isBusy}
      onClick={() => {
        if (!cart) return;
        void cart.addItem(productId, quantity).catch(() => undefined);
      }}
    >
      {isBusy
        ? "Adding…"
        : quantityLimitReached
          ? "Maximum quantity in cart"
          : (children ?? "Add to cart")}
    </Button>
  );
}
