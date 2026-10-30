import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  addItem: (productId: string, quantity?: number) => Promise<void>;
  updateItem: (productId: string, quantity: number) => Promise<void>;
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("healthyways.cart.snapshot", JSON.stringify({ savedAt: new Date().toISOString() }));
  }, []);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const cartUserId = sessionQuery.data?.status === "authenticated" ? sessionQuery.data.user.id : "anonymous";

  const {
    data: cart,
    isPending: isCartLoading,
    error: cartError,
    refetch: retryCart,
  } = useQuery({
    queryKey: ["cart", cartUserId],
    queryFn: () => cartApi.getCart(),
    retry: false,
    staleTime: 30_000,
  });

  const totalQuantity = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const currentCartUserId = () => {
    const session = queryClient.getQueryData<{ status: string; user?: { id: string } }>(["session"]);
    return session?.status === "authenticated" ? session.user?.id : "anonymous";
  };

  const addItemMutation = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const mutationUserId = cartUserId;
      try {
        return { cart: await cartApi.addItem(productId, quantity), mutationUserId };
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
      try { return { cart: await cartApi.updateItem(productId, quantity), mutationUserId }; }
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
      try { return { cart: await cartApi.removeItem(productId), mutationUserId }; }
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
      try { return { cart: await cartApi.clearCart(), mutationUserId }; }
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
        addItemMutation.isPending ||
        updateItemMutation.isPending ||
        removeItemMutation.isPending ||
        clearCartMutation.isPending,
      notice,
      setNotice,
      addItem: async (productId: string, quantity = 1) => {
        await addItemMutation.mutateAsync({ productId, quantity });
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
            <Button type="button" variant="default" disabled={isBusy || cart.hasUnavailableItems} onClick={() => { setIsOpen(false); onCheckout?.(); }}>
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
          <Button type="button" disabled={isBusy || cart.hasUnavailableItems} onClick={onCheckout}>
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

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      disabled={!cart || disabled || isBusy}
      aria-busy={isBusy}
      onClick={() => {
        if (!cart) return;
        void cart.addItem(productId, quantity).catch(() => undefined);
      }}
    >
      {isBusy ? "Adding…" : (children ?? "Add to cart")}
    </Button>
  );
}
