import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { ApiHttpError, CsrfTokenError, PreviewMutationBlockedError } from "@/lib/api/client";
import { cartApi, type Cart, type CartLine } from "@/lib/api/cart";
import { authApi } from "@/lib/api/auth";
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
  addItem: (product: GuestCartProduct, quantity?: number) => Promise<void>;
  updateItem: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  syncGuestCart: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);
const GUEST_CART_KEY = "healthyways.guest-cart.v1";
const GUEST_CART_MERGE_KEY = "healthyways.guest-cart-merge.v1";

interface GuestCartProduct {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
}

interface PendingGuestCartMerge {
  userId: string;
  quantities: Record<string, number>;
}

function makeCart(items: CartLine[]): Cart {
  const totalCents = items.reduce((total, item) => total + (item.lineSubtotalCents ?? 0), 0);
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(itemCount)) {
    throw new Error("Cart totals exceed the supported limit.");
  }
  return { items, itemCount, currency: "ZAR", totalCents, hasUnavailableItems: false };
}

function readGuestCart(): Cart {
  if (typeof window === "undefined") return makeCart([]);
  const saved = window.localStorage.getItem(GUEST_CART_KEY);
  if (saved === null) return makeCart([]);

  let value: unknown;
  try {
    value = JSON.parse(saved) as unknown;
  } catch (error) {
    throw new Error("The saved guest cart could not be read.", { cause: error });
  }
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) {
    throw new Error("The saved guest cart has an invalid format.");
  }

  const items = value.items.map((entry): CartLine => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("productId" in entry) ||
      typeof entry.productId !== "string" ||
      !("quantity" in entry) ||
      typeof entry.quantity !== "number" ||
      !Number.isSafeInteger(entry.quantity) ||
      entry.quantity < 1 ||
      entry.quantity > 99 ||
      !("product" in entry) ||
      typeof entry.product !== "object" ||
      entry.product === null ||
      !("name" in entry.product) ||
      typeof entry.product.name !== "string" ||
      !("slug" in entry.product) ||
      typeof entry.product.slug !== "string" ||
      !("unitPriceCents" in entry) ||
      typeof entry.unitPriceCents !== "number" ||
      !Number.isSafeInteger(entry.unitPriceCents) ||
      entry.unitPriceCents <= 0
    ) {
      throw new Error("The saved guest cart contains an invalid item.");
    }
    const lineSubtotalCents = entry.unitPriceCents * entry.quantity;
    if (!Number.isSafeInteger(lineSubtotalCents)) {
      throw new Error("The saved guest cart contains an invalid total.");
    }
    return {
      productId: entry.productId,
      quantity: entry.quantity,
      available: true,
      product: { name: entry.product.name, slug: entry.product.slug },
      unitPriceCents: entry.unitPriceCents,
      lineSubtotalCents,
    };
  });
  return makeCart(items);
}

function saveGuestCart(cart: Cart): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart));
  }
}

function readPendingGuestCartMerge(): PendingGuestCartMerge | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(GUEST_CART_MERGE_KEY);
  if (saved === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(saved) as unknown;
  } catch (error) {
    throw new Error("The saved cart transfer could not be read.", { cause: error });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("userId" in value) ||
    typeof value.userId !== "string" ||
    !("quantities" in value) ||
    typeof value.quantities !== "object" ||
    value.quantities === null ||
    Array.isArray(value.quantities)
  ) {
    throw new Error("The saved cart transfer has an invalid format.");
  }
  for (const [productId, quantity] of Object.entries(value.quantities)) {
    if (!/^[a-f\d]{24}$/i.test(productId) || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("The saved cart transfer contains an invalid item.");
    }
  }
  const quantities: Record<string, number> = {};
  for (const [productId, quantity] of Object.entries(value.quantities)) {
    if (typeof quantity === "number") quantities[productId] = quantity;
  }
  return { userId: value.userId, quantities };
}

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
  if (error instanceof PreviewMutationBlockedError) {
    return error.message;
  }
  return "The cart could not be reached. Check your connection and try again.";
}

export function CartProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdminAuthPage =
    typeof window !== "undefined" &&
    /^\/admin\/(?:login|register|forgot-password)(?:\/|$)/.test(window.location.pathname);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.getSession(),
    retry: false,
    enabled: enabled && !isAdminAuthPage,
  });
  const cartUserId = sessionQuery.data?.status === "authenticated" ? sessionQuery.data.user.id : "anonymous";
  const hasAuthenticatedSession = sessionQuery.data?.status === "authenticated";

  const {
    data: cart,
    isPending: isCartPending,
    error: cartQueryError,
    refetch: refetchCart,
  } = useQuery({
    queryKey: ["cart", cartUserId],
    queryFn: () => hasAuthenticatedSession ? cartApi.getCart() : readGuestCart(),
    retry: false,
    staleTime: 30_000,
    enabled: enabled && !isAdminAuthPage && sessionQuery.isSuccess,
  });
  const isCartLoading =
    enabled &&
    !isAdminAuthPage &&
    (sessionQuery.isPending || (sessionQuery.isSuccess && isCartPending));
  const cartError = cartQueryError ?? (sessionQuery.isError ? sessionQuery.error : null);
  const resolvedCart = cart ?? (!enabled ? makeCart([]) : undefined);
  const retryCart = sessionQuery.isError ? sessionQuery.refetch : refetchCart;

  const totalQuantity = resolvedCart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const currentCartUserId = () => {
    const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
    return session?.status === "authenticated" ? session.user?.id : "anonymous";
  };

  const addItemMutation = useMutation({
    mutationFn: async ({ product, quantity }: { product: GuestCartProduct; quantity: number }) => {
      const mutationUserId = cartUserId;
      try {
        if (mutationUserId === "anonymous") {
          if (
            !/^[a-f\d]{24}$/i.test(product.id) ||
            typeof product.name !== "string" ||
            !product.name.trim() ||
            typeof product.slug !== "string" ||
            !product.slug.trim() ||
            !Number.isSafeInteger(product.priceCents) ||
            product.priceCents <= 0 ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            quantity > 99
          ) {
            throw new Error("Product details are not valid for a guest cart.");
          }
          const current = readGuestCart();
          const existing = current.items.find((item) => item.productId === product.id);
          const nextQuantity = Math.min(99, (existing?.quantity ?? 0) + quantity);
          const line: CartLine = {
            productId: product.id,
            quantity: nextQuantity,
            available: true,
            product: { name: product.name, slug: product.slug },
            unitPriceCents: product.priceCents,
            lineSubtotalCents: product.priceCents * nextQuantity,
          };
          const updated = makeCart([
            ...current.items.filter((item) => item.productId !== product.id),
            line,
          ]);
          saveGuestCart(updated);
          return { cart: updated, mutationUserId };
        }
        return { cart: await cartApi.addItem(product.id, quantity), mutationUserId };
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error("Cart update failed"), { mutationUserId });
      }
    },
    onSuccess: ({ cart: updatedCart, mutationUserId }, variables) => {
      queryClient.setQueryData(["cart", mutationUserId], updatedCart);
      if (currentCartUserId() === mutationUserId) {
        setNotice(`Added ${variables.quantity} item${variables.quantity > 1 ? "s" : ""} to your cart.`);
        setIsOpen(true);
      }
    },
    onError: (error: Error & { mutationUserId?: string }) => {
      if (error.mutationUserId && currentCartUserId() === error.mutationUserId) {
        setNotice(getCartErrorMessage(error));
        setIsOpen(true);
      }
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const mutationUserId = cartUserId;
      try {
        if (mutationUserId === "anonymous") {
          if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new Error("Cart quantity must be between 1 and 99.");
          }
          const current = readGuestCart();
          const updated = makeCart(current.items.map((item) => item.productId === productId
            ? {
                ...item,
                quantity,
                lineSubtotalCents: (item.unitPriceCents ?? 0) * quantity,
              }
            : item));
          saveGuestCart(updated);
          return { cart: updated, mutationUserId };
        }
        return { cart: await cartApi.updateItem(productId, quantity), mutationUserId };
      }
      catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Cart update failed"), { mutationUserId }); }
    },
    onSuccess: ({ cart: updatedCart, mutationUserId }, variables) => {
      queryClient.setQueryData(["cart", mutationUserId], updatedCart);
      if (currentCartUserId() === mutationUserId) setNotice(`Updated quantity to ${variables.quantity}.`);
    },
    onError: (error: Error & { mutationUserId?: string }) => {
      if (error.mutationUserId && currentCartUserId() === error.mutationUserId) setNotice(getCartErrorMessage(error));
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const mutationUserId = cartUserId;
      try {
        if (mutationUserId === "anonymous") {
          const updated = makeCart(readGuestCart().items.filter((item) => item.productId !== productId));
          saveGuestCart(updated);
          return { cart: updated, mutationUserId };
        }
        return { cart: await cartApi.removeItem(productId), mutationUserId };
      }
      catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Cart update failed"), { mutationUserId }); }
    },
    onSuccess: ({ cart: updatedCart, mutationUserId }) => {
      queryClient.setQueryData(["cart", mutationUserId], updatedCart);
      if (currentCartUserId() === mutationUserId) setNotice("Item removed from your cart.");
    },
    onError: (error: Error & { mutationUserId?: string }) => {
      if (error.mutationUserId && currentCartUserId() === error.mutationUserId) setNotice(getCartErrorMessage(error));
    },
  });

  const clearCartMutation = useMutation({
    mutationFn: async () => {
      const mutationUserId = cartUserId;
      try {
        if (mutationUserId === "anonymous") {
          const updated = makeCart([]);
          saveGuestCart(updated);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(GUEST_CART_MERGE_KEY);
          }
          return { cart: updated, mutationUserId };
        }
        return { cart: await cartApi.clearCart(), mutationUserId };
      }
      catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Cart update failed"), { mutationUserId }); }
    },
    onSuccess: ({ cart: updatedCart, mutationUserId }) => {
      queryClient.setQueryData(["cart", mutationUserId], updatedCart);
      if (currentCartUserId() === mutationUserId) setNotice("Your cart has been cleared.");
    },
    onError: (error: Error & { mutationUserId?: string }) => {
      if (error.mutationUserId && currentCartUserId() === error.mutationUserId) setNotice(getCartErrorMessage(error));
    },
  });

  const [isSyncingGuestCart, setIsSyncingGuestCart] = useState(false);
  const guestCartSyncRef = useRef<Promise<void> | null>(null);
  const syncGuestCart = useCallback(async () => {
    if (guestCartSyncRef.current) return guestCartSyncRef.current;

    const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
    const mutationUserId =
      session?.status === "authenticated" ? session.user?.id ?? "anonymous" : "anonymous";
    if (mutationUserId === "anonymous") return;
    const guestCart = readGuestCart();
    if (guestCart.items.length === 0) return;

    const sync = (async () => {
      setIsSyncingGuestCart(true);
      try {
        await queryClient.cancelQueries({ queryKey: ["cart", mutationUserId] });
        let pending = readPendingGuestCartMerge();
        if (!pending || pending.userId !== mutationUserId) {
          pending = { userId: mutationUserId, quantities: {} };
        }

        const newGuestLines = guestCart.items.filter(
          (item) => !(item.productId in pending.quantities),
        );
        if (newGuestLines.length > 0) {
          const remoteCart = await cartApi.getCart();
          for (const item of newGuestLines) {
            const existingQuantity =
              remoteCart.items.find((remoteItem) => remoteItem.productId === item.productId)
                ?.quantity ?? 0;
            pending.quantities[item.productId] = Math.min(99, existingQuantity + item.quantity);
          }
          window.localStorage.setItem(GUEST_CART_MERGE_KEY, JSON.stringify(pending));
        }

        for (const [productId, targetQuantity] of Object.entries(pending.quantities)) {
          let remoteCart = await cartApi.getCart();
          const existing = remoteCart.items.find((item) => item.productId === productId);
          if (!existing || existing.quantity < targetQuantity) {
            remoteCart = existing
              ? await cartApi.updateItem(productId, targetQuantity)
              : await cartApi.addItem(productId, targetQuantity);
          }
          queryClient.setQueryData(["cart", mutationUserId], remoteCart);

          const remaining = makeCart(
            readGuestCart().items.filter((item) => item.productId !== productId),
          );
          saveGuestCart(remaining);
          delete pending.quantities[productId];
          if (Object.keys(pending.quantities).length === 0) {
            window.localStorage.removeItem(GUEST_CART_MERGE_KEY);
          } else {
            window.localStorage.setItem(GUEST_CART_MERGE_KEY, JSON.stringify(pending));
          }
        }
        queryClient.setQueryData(["cart", "anonymous"], readGuestCart());
        setNotice("Your guest cart has been added to your account cart.");
      } catch (error) {
        await queryClient.invalidateQueries({ queryKey: ["cart", mutationUserId] });
        setNotice(getCartErrorMessage(error));
        throw error;
      } finally {
        setIsSyncingGuestCart(false);
      }
    })();

    guestCartSyncRef.current = sync;
    try {
      await sync;
    } finally {
      if (guestCartSyncRef.current === sync) guestCartSyncRef.current = null;
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled || !hasAuthenticatedSession) return;
    try {
      if (readGuestCart().items.length === 0) return;
    } catch (error) {
      setNotice(getCartErrorMessage(error));
      return;
    }
    void syncGuestCart().catch(() => undefined);
  }, [enabled, hasAuthenticatedSession, cartUserId, syncGuestCart]);

  const value = useMemo<CartContextValue>(
    () => ({
      isOpen,
      setIsOpen,
      cart: resolvedCart,
      isCartLoading,
      cartError,
      retryCart,
      totalQuantity,
      isBusy:
        addItemMutation.isPending ||
        updateItemMutation.isPending ||
        removeItemMutation.isPending ||
        clearCartMutation.isPending ||
        isSyncingGuestCart ||
        isCartLoading,
      notice,
      setNotice,
      addItem: async (product: GuestCartProduct, quantity = 1) => {
        await addItemMutation.mutateAsync({ product, quantity });
      },
      updateItem: async (productId: string, quantity: number) => {
        await updateItemMutation.mutateAsync({ productId, quantity });
      },
      removeItem: async (productId: string) => {
        await removeItemMutation.mutateAsync({ productId });
      },
      clearCart: async () => {
        await clearCartMutation.mutateAsync();
      },
      syncGuestCart,
    }),
    [
      addItemMutation,
      cartError,
      clearCartMutation,
      isOpen,
      isSyncingGuestCart,
      notice,
      removeItemMutation,
      resolvedCart,
      syncGuestCart,
      totalQuantity,
      updateItemMutation,
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

export function CartSheet({ onSignIn, onCheckout }: { onSignIn?: () => void; onCheckout?: () => void } = {}) {
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
    updateItem,
    removeItem,
    clearCart,
    syncGuestCart,
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

        {isCartLoading ? (
          <p className="cart-status" role="status">
            Loading cart…
          </p>
        ) : cartError ? (
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
                          void updateItem(item.productId, Math.max(1, item.quantity - 1)).catch(
                            () => undefined,
                          )
                        }
                        disabled={isBusy || item.quantity <= 1}
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
                          void updateItem(item.productId, Math.min(99, item.quantity + 1)).catch(
                            () => undefined,
                          )
                        }
                        disabled={isBusy || item.quantity >= 99}
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
              type="button"
              variant="default"
              disabled={isBusy || cart.hasUnavailableItems}
              onClick={() => {
                void syncGuestCart()
                  .then(() => {
                    setIsOpen(false);
                    onCheckout?.();
                  })
                  .catch(() => undefined);
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
  onCheckout,
}: {
  onContinueShopping: () => void;
  onSignIn: () => void;
  onCheckout: () => void;
}) {
  const {
    cart,
    isCartLoading,
    cartError,
    retryCart,
    notice,
    isBusy,
    updateItem,
    removeItem,
    clearCart,
    syncGuestCart,
  } = useCart();

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
      ) : !cart || cart.items.length === 0 ? (
        <div className="cart-empty" role="status">
          <ShoppingBag aria-hidden="true" size={22} />
          <p>Your cart is empty.</p>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </div>
      ) : (
        <>
          <div className="cart-list" aria-live="polite">
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
                        void updateItem(item.productId, item.quantity - 1).catch(() => undefined)
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
                        void updateItem(item.productId, item.quantity + 1).catch(() => undefined)
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
          </div>
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
          <Button
            type="button"
            disabled={isBusy || cart.hasUnavailableItems}
            onClick={() => {
              void syncGuestCart().then(onCheckout).catch(() => undefined);
            }}
          >
            Continue to checkout
          </Button>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </>
      )}
    </section>
  );
}

export function CartAddButton({
  product,
  quantity = 1,
  disabled = false,
  children,
}: {
  product: GuestCartProduct;
  quantity?: number;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const cart = useOptionalCart();
  const isBusy = cart?.isBusy ?? false;

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      disabled={!cart || disabled || isBusy}
      aria-busy={isBusy}
      onClick={() => {
        if (!cart) return;
        void cart.addItem(product, quantity).catch(() => undefined);
      }}
    >
      {isBusy && !cart.isCartLoading ? "Adding…" : (children ?? "Add to cart")}
    </Button>
  );
}
