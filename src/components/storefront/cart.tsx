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
  type FormEvent,
} from "react";

import {
  AddressAutocomplete,
  type SelectedDeliveryAddress,
} from "@/components/storefront/address-autocomplete";
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
import { authApi, type PublicUser } from "@/lib/api/auth";
import { catalogueApi } from "@/lib/api/catalogue";
import {
  ordersApi,
  type CustomerOrder,
  type PayFastCheckout,
  type ShippingQuote,
} from "@/lib/api/orders";
import { getAllowedProductImageUrls } from "@/lib/image-url";
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

  const enqueueCartOperation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
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
    },
    [queryClient],
  );

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
                          void changeItemQuantity(item.productId, -1).catch(() => undefined)
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
                          void changeItemQuantity(item.productId, 1).catch(() => undefined)
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

interface StoredCheckoutState {
  idempotencyKey?: string;
  addressId?: string;
  orderId?: string;
}

function CartProductImage({ slug, name }: { slug: string | undefined; name: string }) {
  const productQuery = useQuery({
    queryKey: ["catalogue", "product", slug],
    queryFn: () => catalogueApi.getProductBySlug(slug ?? ""),
    enabled: Boolean(slug),
    retry: false,
  });
  const image = productQuery.data
    ? getAllowedProductImageUrls(productQuery.data.product.imageReferences)[0]
    : undefined;

  return image ? (
    <img className="cart-product-image" src={image} alt={name} loading="lazy" />
  ) : (
    <div className="cart-product-image cart-product-image-placeholder" aria-hidden="true">
      <ShoppingBag size={18} />
    </div>
  );
}

export function CartPage({
  onContinueShopping,
  onSignIn,
  user,
}: {
  onContinueShopping: () => void;
  onSignIn: () => void;
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
  const [selectedAddress, setSelectedAddress] = useState<SelectedDeliveryAddress | null>(null);
  const [recipientName, setRecipientName] = useState(user?.displayName ?? "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? "");
  const [addressLine2, setAddressLine2] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [quotes, setQuotes] = useState<ShippingQuote[] | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<ShippingQuote | null>(null);
  const [paymentCheckout, setPaymentCheckout] = useState<PayFastCheckout | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [restoringCheckout, setRestoringCheckout] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreOrderId, setRestoreOrderId] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<{
    addressId: string;
    idempotencyKey: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const submitLockRef = useRef(false);
  const storageKey = user ? `healthywayssa-checkout-${user.id}` : null;

  const describeCheckoutError = useCallback((error: unknown): string => {
    if (error instanceof ApiHttpError) {
      if (error.isCsrfFailure) {
        return "The security token was rejected after one refresh attempt. Refresh the page before retrying.";
      }
      if (error.status === 401)
        return "Your sign-in has expired. Sign in again to continue checkout.";
      if (error.status === 403)
        return "This order action is not permitted for the current account.";
      if (error.status === 409) {
        return typeof error.body === "object" &&
          error.body !== null &&
          "error" in error.body &&
          typeof error.body.error === "string"
          ? error.body.error
          : "The cart, address or delivery quote changed. Refresh delivery options and review your order.";
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
  }, []);

  function persistCheckout(value: StoredCheckoutState): boolean {
    if (!storageKey) return false;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch {
      setCheckoutError(
        "Checkout progress could not be saved in this browser. Enable session storage and try again.",
      );
      return false;
    }
  }

  useEffect(() => {
    if (!user || !storageKey) return;
    let active = true;
    let stored: StoredCheckoutState | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          stored = {
            ...(typeof record["idempotencyKey"] === "string"
              ? { idempotencyKey: record["idempotencyKey"] }
              : {}),
            ...(typeof record["addressId"] === "string" ? { addressId: record["addressId"] } : {}),
            ...(typeof record["orderId"] === "string" ? { orderId: record["orderId"] } : {}),
          };
        }
      }
    } catch {
      setCheckoutError("Saved checkout progress could not be read. You can start a new checkout.");
    }
    if (!stored) return;
    if (stored.addressId && stored.idempotencyKey) {
      setPendingAttempt({ addressId: stored.addressId, idempotencyKey: stored.idempotencyKey });
      const savedAddress = user.addresses.find((address) => address.id === stored?.addressId);
      if (savedAddress) {
        setRecipientName(savedAddress.recipientName);
        setPhoneNumber(savedAddress.phoneNumber);
        setAddressLine2(savedAddress.addressLine2 ?? "");
        setDeliveryInstructions(savedAddress.deliveryInstructions ?? "");
        setSelectedAddress({
          placeId: `saved:${savedAddress.id}`,
          formattedAddress: [
            savedAddress.addressLine1,
            savedAddress.localArea,
            savedAddress.city,
            savedAddress.province,
            savedAddress.postalCode,
            savedAddress.country,
          ]
            .filter(Boolean)
            .join(", "),
          addressLine1: savedAddress.addressLine1,
          localArea: savedAddress.localArea ?? "",
          city: savedAddress.city,
          province: savedAddress.province,
          postalCode: savedAddress.postalCode,
          country: "South Africa",
        });
      }
    }
    if (stored.orderId) {
      setRestoreOrderId(stored.orderId);
      setRestoringCheckout(true);
      void ordersApi
        .getCustomerOrder(stored.orderId)
        .then((restored) => {
          if (active) {
            setOrder(restored);
            setRestoreFailed(false);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setRestoreFailed(true);
            setCheckoutError(describeCheckoutError(error));
            setCheckoutMessage(
              "Your saved order could not be loaded. Retry the request before creating another order.",
            );
          }
        })
        .finally(() => {
          if (active) setRestoringCheckout(false);
        });
    }
    return () => {
      active = false;
    };
  }, [describeCheckoutError, storageKey, user]);

  useEffect(() => {
    if (!pendingAttempt?.addressId) {
      setRecipientName((current) => current || user?.displayName || "");
      setPhoneNumber((current) => current || user?.phoneNumber || "");
    }
  }, [pendingAttempt?.addressId, user?.displayName, user?.phoneNumber]);

  const onAddressSelect = useCallback((address: SelectedDeliveryAddress | null) => {
    setSelectedAddress(address);
    setCheckoutError(null);
    if (address) setCheckoutMessage(null);
  }, []);

  async function retryOrderRestore() {
    if (!restoreOrderId || restoringCheckout) return;
    setRestoringCheckout(true);
    setCheckoutError(null);
    try {
      setOrder(await ordersApi.getCustomerOrder(restoreOrderId));
      setRestoreFailed(false);
    } catch (error) {
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setRestoringCheckout(false);
    }
  }

  function startNewCheckout() {
    if (!storageKey) return;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      setCheckoutError(
        "Saved checkout progress could not be cleared. Close and reopen the tab before starting a new order.",
      );
      return;
    }
    setOrder(null);
    setRestoreOrderId(null);
    setRestoreFailed(false);
    setPendingAttempt(null);
    setSelectedAddress(null);
    setSelectedQuote(null);
    setQuotes(null);
    setPaymentCheckout(null);
    setCheckoutError(null);
    setCheckoutMessage(null);
    void retryCart();
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutBusy || submitLockRef.current || !user || !selectedAddress) return;
    if (!recipientName.trim() || !phoneNumber.trim()) {
      setCheckoutError("Enter the recipient name and phone number for the delivery.");
      return;
    }
    if (!selectedAddress.localArea.trim()) {
      setCheckoutError("Choose a suggestion that includes a suburb or local area.");
      return;
    }
    if (cart?.hasUnavailableItems) {
      setCheckoutError("Remove unavailable or out-of-stock products before continuing.");
      return;
    }

    submitLockRef.current = true;
    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutMessage(null);
    try {
      let addressId = pendingAttempt?.addressId ?? "";
      let idempotencyKey = pendingAttempt?.idempotencyKey ?? "";
      if (!addressId) {
        idempotencyKey ||= crypto.randomUUID();
        if (!persistCheckout({ idempotencyKey })) return;

        const candidate = {
          label: "Delivery address",
          recipientName: recipientName.trim(),
          phoneNumber: phoneNumber.trim(),
          addressLine1: selectedAddress.addressLine1,
          addressLine2: addressLine2.trim(),
          localArea: selectedAddress.localArea,
          city: selectedAddress.city,
          province: selectedAddress.province,
          postalCode: selectedAddress.postalCode,
          country: selectedAddress.country,
          deliveryInstructions: deliveryInstructions.trim(),
        };
        const matchingAddress = user.addresses.find(
          (address) =>
            address.addressLine1 === candidate.addressLine1 &&
            (address.localArea ?? "") === candidate.localArea &&
            address.city === candidate.city &&
            address.province === candidate.province &&
            address.postalCode === candidate.postalCode &&
            address.country === candidate.country &&
            address.recipientName === candidate.recipientName &&
            address.phoneNumber === candidate.phoneNumber &&
            (address.addressLine2 ?? "") === candidate.addressLine2 &&
            (address.deliveryInstructions ?? "") === candidate.deliveryInstructions,
        );
        const updatedUser = matchingAddress ? user : await authApi.addAddress(candidate);
        if (!matchingAddress) {
          addressId =
            updatedUser.addresses.find(
              (address) =>
                address.addressLine1 === candidate.addressLine1 &&
                address.localArea === candidate.localArea &&
                address.city === candidate.city &&
                address.province === candidate.province &&
                address.postalCode === candidate.postalCode &&
                address.recipientName === candidate.recipientName,
            )?.id ?? "";
          if (!addressId)
            throw new Error("The saved delivery address was missing from the response.");
          queryClient.setQueryData(["session"], { status: "authenticated", user: updatedUser });
        } else {
          addressId = matchingAddress.id;
        }
        setPendingAttempt({ addressId, idempotencyKey });
        if (!persistCheckout({ addressId, idempotencyKey })) return;
      }

      const created = await ordersApi.createCustomerOrder(addressId, idempotencyKey);
      setOrder(created);
      setPendingAttempt({ addressId, idempotencyKey });
      setSelectedQuote(null);
      setQuotes(null);
      if (!persistCheckout({ addressId, idempotencyKey, orderId: created.id })) return;
      setCheckoutMessage(
        `Order ${created.orderNumber} was created. Choose a delivery service to continue.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["orders", "customer"] }),
      ]);
    } catch (error) {
      setCheckoutError(describeCheckoutError(error));
    } finally {
      submitLockRef.current = false;
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
    setPaymentCheckout(null);
    try {
      const response = await ordersApi.requestShippingQuotes(order.id);
      setQuotes(response.rates);
      setCheckoutMessage(
        response.rates.length
          ? "Choose an available delivery service. Rates are provided for this address."
          : "No delivery services are available right now. You can retry later.",
      );
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 422) {
        setQuotes([]);
        setCheckoutMessage(
          "No delivery services were returned. Review the delivery address or retry later.",
        );
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
    setSelectedQuote(null);
    setPaymentCheckout(null);
    try {
      await ordersApi.selectShippingQuote(order.id, quote.quoteId);
      const refreshed = await ordersApi.getCustomerOrder(order.id);
      setOrder(refreshed);
      setSelectedQuote(quote);
      setCheckoutMessage(`${quote.serviceLevel.name} is selected. Review the order total below.`);
    } catch (error) {
      if (error instanceof ApiHttpError && (error.status === 409 || error.status === 422)) {
        setQuotes(null);
        setCheckoutMessage(
          "That delivery rate expired or is no longer available. Refresh the rates to choose again.",
        );
      }
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function initiatePayment() {
    if (!order || !selectedQuote || checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutMessage(null);
    setPaymentCheckout(null);
    try {
      const response = await ordersApi.initiatePayFastCheckout(order.id);
      if (
        response.amountBreakdown.shippingCents !== selectedQuote.rateCents ||
        response.amountBreakdown.productSubtotalCents !== order.subtotalCents ||
        response.amountCents !== order.totalCents
      ) {
        setCheckoutError(
          "Payment is paused because the backend payment total does not match this order and selected delivery rate. Refresh the delivery options or contact support.",
        );
        return;
      }
      setPaymentCheckout(response);
      setCheckoutMessage(
        "The backend confirmed the shipping-inclusive amount. Continue to PayFast to complete payment.",
      );
    } catch (error) {
      setCheckoutError(describeCheckoutError(error));
    } finally {
      setCheckoutBusy(false);
    }
  }

  const checkoutStep = order ? (selectedQuote ? 4 : 3) : 2;

  return (
    <section className="catalogue-section" aria-labelledby="cart-page-title">
      <header className="catalogue-header">
        <span className="eyebrow">Secure checkout</span>
        <h1 id="cart-page-title" className="section-title mt-3">
          Your basket
        </h1>
      </header>
      <ol className="checkout-progress" aria-label="Checkout progress">
        {["Basket", "Delivery address", "Delivery service", "Review & payment"].map(
          (label, index) => (
            <li
              className={index + 1 <= checkoutStep ? "checkout-progress-active" : ""}
              key={label}
              aria-current={index + 1 === checkoutStep ? "step" : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      {notice ? (
        <p className="cart-notice" role="status">
          {notice}
        </p>
      ) : null}
      {restoringCheckout ? (
        <p className="catalogue-status" role="status">
          Restoring your saved checkout…
        </p>
      ) : null}
      {!restoringCheckout && isCartLoading ? (
        <p className="catalogue-status" role="status">
          Loading basket…
        </p>
      ) : !restoringCheckout && cartError ? (
        <div className="catalogue-error" role="alert">
          <p>{getCartErrorMessage(cartError)}</p>
          {cartError instanceof ApiHttpError && cartError.status === 401 ? (
            <Button type="button" variant="outline" onClick={onSignIn}>
              Sign in to use your basket
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void retryCart()}>
            Retry basket
          </Button>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </div>
      ) : !restoringCheckout && (!cart || cart.items.length === 0) && !order ? (
        <div className="cart-empty" role="status">
          <ShoppingBag aria-hidden="true" size={22} />
          <p>Your basket is empty.</p>
          <Button type="button" variant="outline" onClick={onContinueShopping}>
            Continue shopping
          </Button>
        </div>
      ) : (
        <>
          {cart && !order ? (
            <>
              <div className="cart-list" aria-live="polite">
                {cart.items.map((item) => (
                  <div className="cart-item" key={item.productId}>
                    <CartProductImage slug={item.product?.slug} name={getItemLineLabel(item)} />
                    <div className="cart-item-copy">
                      <span className="cart-item-name">{getItemLineLabel(item)}</span>
                      {item.available && item.unitPriceCents !== null ? (
                        <span className="cart-item-price">
                          {formatZarCents(item.unitPriceCents)}
                        </span>
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
                        aria-label={`Remove ${getItemLineLabel(item)} from basket`}
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
                  Clear basket
                </Button>
              </div>
            </>
          ) : null}

          {restoreFailed ? (
            <section className="checkout-panel mt-5" role="alert">
              <p>Your saved order must be recovered before another order can be created.</p>
              <Button type="button" variant="outline" onClick={() => void retryOrderRestore()}>
                Retry loading saved order
              </Button>
            </section>
          ) : null}
          {!order && !restoreFailed ? (
            <section className="checkout-panel mt-5" aria-labelledby="delivery-address-title">
              <div>
                <span className="checkout-step-label">Step 2 of 4</span>
                <h2 id="delivery-address-title" className="text-xl font-medium">
                  Delivery address
                </h2>
                <p className="text-sm text-muted-foreground">
                  Select a verified South African address so we can request accurate delivery
                  options.
                </p>
              </div>
              {!user ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Sign in to save your delivery address and place this order.
                  </p>
                  <Button type="button" variant="outline" onClick={onSignIn}>
                    Sign in to checkout
                  </Button>
                </div>
              ) : (
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={(event) => void createOrder(event)}
                >
                  {pendingAttempt?.addressId && selectedAddress ? (
                    <div className="checkout-review-address sm:col-span-2">
                      <strong>Verified delivery address saved</strong>
                      <p>{selectedAddress.formattedAddress}</p>
                      <p className="text-muted-foreground">
                        This address is locked for the safe retry of your existing order attempt.
                      </p>
                    </div>
                  ) : (
                    <div className="sm:col-span-2">
                      <AddressAutocomplete onSelect={onAddressSelect} />
                    </div>
                  )}
                  {selectedAddress ? (
                    <>
                      <label className="space-y-1 text-sm">
                        <span>Recipient name</span>
                        <input
                          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                          maxLength={100}
                          required
                          value={recipientName}
                          disabled={Boolean(pendingAttempt?.addressId)}
                          onChange={(event) => setRecipientName(event.currentTarget.value)}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span>Delivery phone number</span>
                        <input
                          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                          autoComplete="tel"
                          maxLength={30}
                          required
                          value={phoneNumber}
                          disabled={Boolean(pendingAttempt?.addressId)}
                          onChange={(event) => setPhoneNumber(event.currentTarget.value)}
                        />
                      </label>
                      <label className="space-y-1 text-sm sm:col-span-2">
                        <span>Apartment, unit or complex (optional)</span>
                        <input
                          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                          maxLength={200}
                          value={addressLine2}
                          disabled={Boolean(pendingAttempt?.addressId)}
                          onChange={(event) => setAddressLine2(event.currentTarget.value)}
                        />
                      </label>
                      <label className="space-y-1 text-sm sm:col-span-2">
                        <span>Delivery instructions (optional)</span>
                        <textarea
                          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2"
                          maxLength={500}
                          value={deliveryInstructions}
                          disabled={Boolean(pendingAttempt?.addressId)}
                          onChange={(event) => setDeliveryInstructions(event.currentTarget.value)}
                        />
                      </label>
                      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm sm:col-span-2">
                        <strong>Selected delivery address</strong>
                        <p>{selectedAddress.formattedAddress}</p>
                        <p className="text-muted-foreground">
                          {selectedAddress.localArea}, {selectedAddress.city},{" "}
                          {selectedAddress.province} {selectedAddress.postalCode}
                        </p>
                      </div>
                    </>
                  ) : null}
                  {cart?.hasUnavailableItems ? (
                    <p className="cart-item-unavailable sm:col-span-2" role="alert">
                      Remove unavailable or out-of-stock products before continuing.
                    </p>
                  ) : null}
                  <div className="sm:col-span-2">
                    <Button
                      type="submit"
                      disabled={
                        checkoutBusy ||
                        restoringCheckout ||
                        isBusy ||
                        !selectedAddress ||
                        !recipientName.trim() ||
                        !phoneNumber.trim() ||
                        Boolean(cart?.hasUnavailableItems)
                      }
                    >
                      {checkoutBusy
                        ? "Saving address and creating order…"
                        : pendingAttempt?.addressId
                          ? "Retry order creation"
                          : "Save verified address and continue"}
                    </Button>
                  </div>
                </form>
              )}
            </section>
          ) : null}

          {checkoutError ? (
            <p
              className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {checkoutError}
            </p>
          ) : null}
          {checkoutMessage ? (
            <p
              className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm"
              role="status"
            >
              {checkoutMessage}
            </p>
          ) : null}

          {order ? (
            <section className="checkout-panel mt-5" aria-labelledby="checkout-review-title">
              <div>
                <span className="checkout-step-label">
                  {selectedQuote ? "Step 4 of 4" : "Step 3 of 4"}
                </span>
                <h2 id="checkout-review-title" className="text-xl font-medium">
                  Review order {order.orderNumber}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Order status: {order.status.replace(/_/g, " ")}
                </p>
              </div>
              <div className="checkout-review-address">
                <h3 className="font-medium">Delivering to</h3>
                <p>
                  {order.deliveryAddress.recipientName} · {order.deliveryAddress.phoneNumber}
                </p>
                <p>
                  {order.deliveryAddress.addressLine1}
                  {order.deliveryAddress.addressLine2
                    ? `, ${order.deliveryAddress.addressLine2}`
                    : ""}
                  {order.deliveryAddress.localArea ? `, ${order.deliveryAddress.localArea}` : ""},{" "}
                  {order.deliveryAddress.city}, {order.deliveryAddress.province}{" "}
                  {order.deliveryAddress.postalCode}, {order.deliveryAddress.country}
                </p>
              </div>
              <ul className="checkout-review-items">
                {order.items.map((item) => (
                  <li key={`${order.id}-${item.productId}`}>
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <strong>{formatZarCents(item.lineSubtotalCents)}</strong>
                  </li>
                ))}
              </ul>
              <div className="checkout-delivery-options">
                <div>
                  <h3 className="font-medium">Delivery service</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a live rate from Ship Logic. Rates are refreshed on request.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={checkoutBusy}
                  onClick={() => void requestQuotes()}
                >
                  {checkoutBusy && quotes === null
                    ? "Loading delivery rates…"
                    : quotes === null
                      ? "Get delivery options"
                      : "Refresh delivery options"}
                </Button>
                {quotes?.length === 0 ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    No rates are available. Retry when delivery service is available.
                  </p>
                ) : null}
                {quotes?.length ? (
                  <ul className="grid gap-3">
                    {quotes.map((quote) => (
                      <li
                        className={`checkout-quote ${selectedQuote?.quoteId === quote.quoteId ? "checkout-quote-selected" : ""}`}
                        key={quote.quoteId}
                      >
                        <div>
                          <strong>{quote.serviceLevel.name}</strong>
                          {quote.serviceLevel.deliveryDateFrom ||
                          quote.serviceLevel.deliveryDateTo ? (
                            <p className="text-sm text-muted-foreground">
                              Estimated delivery:{" "}
                              {quote.serviceLevel.deliveryDateFrom &&
                              quote.serviceLevel.deliveryDateTo
                                ? `${quote.serviceLevel.deliveryDateFrom} – ${quote.serviceLevel.deliveryDateTo}`
                                : (quote.serviceLevel.deliveryDateFrom ??
                                  quote.serviceLevel.deliveryDateTo)}
                            </p>
                          ) : null}
                          <p>{formatZarCents(quote.rateCents)}</p>
                        </div>
                        <Button
                          type="button"
                          variant={
                            selectedQuote?.quoteId === quote.quoteId ? "secondary" : "outline"
                          }
                          disabled={checkoutBusy}
                          onClick={() => void selectQuote(quote)}
                        >
                          {selectedQuote?.quoteId === quote.quoteId ? "Selected" : "Select service"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <dl className="checkout-total-list">
                <div>
                  <dt>Merchandise subtotal</dt>
                  <dd>{formatZarCents(order.subtotalCents)}</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>
                    {selectedQuote ? formatZarCents(selectedQuote.rateCents) : "Choose a service"}
                  </dd>
                </div>
                <div className="checkout-grand-total">
                  <dt>Backend order total</dt>
                  <dd>{formatZarCents(order.totalCents)}</dd>
                </div>
              </dl>
              {selectedQuote && !paymentCheckout ? (
                <Button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => void initiatePayment()}
                >
                  {checkoutBusy ? "Preparing secure payment…" : "Continue to payment"}
                </Button>
              ) : null}
              {paymentCheckout ? (
                <div className="checkout-payment-handoff">
                  <p>
                    PayFast will collect{" "}
                    <strong>{formatZarCents(paymentCheckout.amountBreakdown.totalCents)}</strong>,
                    including {formatZarCents(paymentCheckout.amountBreakdown.shippingCents)}{" "}
                    delivery.
                  </p>
                  <form method="post" action={paymentCheckout.checkoutUrl}>
                    {Object.entries(paymentCheckout.fields).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <Button type="submit">Continue to secure PayFast checkout</Button>
                  </form>
                </div>
              ) : null}
              {order.status === "paid" ? (
                <Button type="button" variant="outline" onClick={startNewCheckout}>
                  Start a new checkout
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Payment is confirmed by the backend after PayFast’s notification. Returning from
                PayFast alone is not proof of payment.
              </p>
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
