import { useEffect, useRef, useState } from "react";

export interface SelectedDeliveryAddress {
  placeId: string;
  formattedAddress: string;
  addressLine1: string;
  localArea: string;
  city: string;
  province: string;
  postalCode: string;
  country: "South Africa";
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface Place {
  address_components?: AddressComponent[];
  formatted_address?: string;
  place_id?: string;
}

interface AutocompleteInstance {
  addListener(event: "place_changed", callback: () => void): { remove(): void };
  getPlace(): Place;
}

interface GoogleMapsApi {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        options: {
          componentRestrictions: { country: "za" };
          fields: string[];
          types: string[];
        },
      ) => AutocompleteInstance;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleMapsApi;
    gm_authFailure?: () => void;
  }
}

let placesScriptPromise: Promise<void> | null = null;

function loadPlacesScript(apiKey: string): Promise<void> {
  if (window.google?.maps.places) return Promise.resolve();
  if (placesScriptPromise) return placesScriptPromise;

  placesScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-places="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          placesScriptPromise = null;
          reject(new Error("Address search could not be loaded."));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.dataset.googlePlaces = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=en&region=ZA`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      placesScriptPromise = null;
      script.remove();
      reject(new Error("Address search could not be loaded."));
    };
    document.head.append(script);
  });

  return placesScriptPromise;
}

function componentValue(components: AddressComponent[], type: string): string {
  return components.find((component) => component.types.includes(type))?.long_name.trim() ?? "";
}

function localAreaValue(components: AddressComponent[]): string {
  for (const type of ["sublocality_level_1", "sublocality", "neighborhood"]) {
    const value = componentValue(components, type);
    if (value) return value;
  }
  return "";
}

function resolveAddress(place: Place): SelectedDeliveryAddress | null {
  if (!place.place_id || !place.formatted_address || !place.address_components) return null;
  const components = place.address_components;
  const streetNumber = componentValue(components, "street_number");
  const route = componentValue(components, "route");
  const city = componentValue(components, "locality") || componentValue(components, "postal_town");
  const province = componentValue(components, "administrative_area_level_1");
  const postalCode = componentValue(components, "postal_code");
  const countryComponent = components.find((component) => component.types.includes("country"));
  const localArea = localAreaValue(components);

  if (
    countryComponent?.short_name.toUpperCase() !== "ZA" ||
    !route ||
    !localArea ||
    !city ||
    !province ||
    !postalCode
  ) {
    return null;
  }

  return {
    placeId: place.place_id,
    formattedAddress: place.formatted_address,
    addressLine1: [streetNumber, route].filter(Boolean).join(" "),
    localArea,
    city,
    province,
    postalCode,
    country: "South Africa",
  };
}

export function AddressAutocomplete({
  onSelect,
}: {
  onSelect: (address: SelectedDeliveryAddress | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listenerRef = useRef<{ remove(): void } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<SelectedDeliveryAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (active) {
        setError(
          "Address search could not authenticate. Check the browser key and its website restrictions.",
        );
      }
    };
    setLoading(true);
    void loadPlacesScript(apiKey)
      .then(() => {
        const input = inputRef.current;
        if (!active || !input || !window.google?.maps.places) return;
        const autocomplete = new window.google.maps.places.Autocomplete(input, {
          componentRestrictions: { country: "za" },
          fields: ["address_components", "formatted_address", "place_id"],
          types: ["address"],
        });
        listenerRef.current = autocomplete.addListener("place_changed", () => {
          const address = resolveAddress(autocomplete.getPlace());
          setSelectedAddress(address);
          onSelectRef.current(address);
          setError(
            address
              ? null
              : "That result is incomplete for delivery. Choose a South African address with a street, suburb, city, province and postal code.",
          );
          if (address) setQuery(address.formattedAddress);
        });
        setError(null);
      })
      .catch(() => {
        if (active) setError("Address search is temporarily unavailable. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      listenerRef.current?.remove();
      listenerRef.current = null;
      window.gm_authFailure = previousAuthFailure;
    };
  }, [apiKey]);

  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span>Search for your delivery address</span>
        <input
          ref={inputRef}
          autoComplete="off"
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2"
          value={query}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            setQuery(nextQuery);
            if (selectedAddress) {
              setSelectedAddress(null);
              onSelectRef.current(null);
            }
            if (error) setError(null);
          }}
          onBlur={() => {
            if (query.trim() && !selectedAddress && !error) {
              setError(
                "Select an address from the provider suggestions. Typed text cannot be used for delivery.",
              );
            }
          }}
          placeholder="Start typing a street address"
          disabled={!apiKey || loading}
          aria-describedby="checkout-address-help"
        />
      </label>
      <p id="checkout-address-help" className="text-xs text-muted-foreground">
        {selectedAddress
          ? `Selected: ${selectedAddress.formattedAddress}`
          : loading
            ? "Loading address search…"
            : apiKey
              ? "Choose an address from the suggestions. Typed text alone cannot be used for delivery."
              : "Address search is not configured. The store administrator must add a restricted Places API key."}
      </p>
      {selectedAddress ? (
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            setQuery("");
            setSelectedAddress(null);
            onSelectRef.current(null);
            inputRef.current?.focus();
          }}
        >
          Change selected address
        </button>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
