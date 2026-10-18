import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiHttpError } from "@/lib/api/client";
import { cartApi, type Cart, type CartLine } from "@/lib/api/cart";
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
  return "The cart could not be reached. Check your connection and try again.";
}

export function CartProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

export function CartSheet() {
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
            <Button className="cart-checkout-disabled" type="button" variant="default" disabled>
              Checkout — coming next
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
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
