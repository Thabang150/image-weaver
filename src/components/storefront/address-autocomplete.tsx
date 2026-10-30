import { useEffect, useRef, useState, type ChangeEvent } from "react";

export interface SelectedDeliveryAddress {
  placeId?: string;
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

export function GooglePlacesAddressAutocomplete({
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
  const isEnabled = false; // Re-enable only as an intentional checkout integration change.
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!isEnabled || !apiKey) return;
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
  }, [apiKey, isEnabled]);

  if (!isEnabled) return null;

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
          disabled={!isEnabled || !apiKey || loading}
          aria-describedby="checkout-address-help"
        />
      </label>
      <p id="checkout-address-help" className="text-xs text-muted-foreground">
        {selectedAddress
          ? `Selected: ${selectedAddress.formattedAddress}`
          : loading
            ? "Loading address search…"
            : !isEnabled
              ? "Address lookup is temporarily paused. Verified address selection is unavailable right now."
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

interface DeliveryAddressFields {
  addressLine1: string;
  localArea: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

const emptyDeliveryAddress: DeliveryAddressFields = {
  addressLine1: "",
  localArea: "",
  city: "",
  province: "",
  postalCode: "",
  country: "South Africa",
};

const addressFieldLimits: Partial<Record<keyof DeliveryAddressFields, number>> = {
  addressLine1: 120,
  city: 80,
  province: 80,
  postalCode: 12,
  country: 80,
};

function getDeliveryAddressErrors(
  fields: DeliveryAddressFields,
): Partial<Record<keyof DeliveryAddressFields, string>> {
  const errors: Partial<Record<keyof DeliveryAddressFields, string>> = {};
  const labels: Record<keyof DeliveryAddressFields, string> = {
    addressLine1: "Street address and number",
    localArea: "Suburb or local area",
    city: "City",
    province: "Province",
    postalCode: "Postal code",
    country: "Country",
  };

  const requiredFields: (keyof DeliveryAddressFields)[] = [
    "addressLine1",
    "localArea",
    "city",
    "province",
    "postalCode",
    "country",
  ];
  for (const key of requiredFields) {
    const value = fields[key].trim();
    if (!value) {
      errors[key] = `${labels[key]} is required.`;
    } else {
      const maxLength = addressFieldLimits[key];
      if (maxLength !== undefined && value.length > maxLength) {
        errors[key] = `${labels[key]} must be ${maxLength} characters or fewer.`;
      }
    }
  }
  if (fields.country.trim().toLowerCase() !== "south africa") {
    errors.country = "Delivery is currently available in South Africa only.";
  }
  return errors;
}

export function ManualDeliveryAddressForm({
  onSelect,
  showValidationErrors = false,
  disabled = false,
}: {
  onSelect: (address: SelectedDeliveryAddress | null) => void;
  showValidationErrors?: boolean;
  disabled?: boolean;
}) {
  const [fields, setFields] = useState<DeliveryAddressFields>(emptyDeliveryAddress);
  const [touched, setTouched] = useState<Partial<Record<keyof DeliveryAddressFields, boolean>>>({});
  const errors = getDeliveryAddressErrors(fields);

  function updateField(key: keyof DeliveryAddressFields, value: string) {
    const updated = { ...fields, [key]: value };
    setFields(updated);
    const nextErrors = getDeliveryAddressErrors(updated);
    if (Object.keys(nextErrors).length === 0) {
      const formattedAddress = [
        updated.addressLine1,
        updated.localArea,
        updated.city,
        updated.province,
        updated.postalCode,
        updated.country,
      ]
        .map((part) => part.trim())
        .join(", ");
      onSelect({
        formattedAddress,
        addressLine1: updated.addressLine1.trim(),
        localArea: updated.localArea.trim(),
        city: updated.city.trim(),
        province: updated.province.trim(),
        postalCode: updated.postalCode.trim(),
        country: "South Africa",
      });
    } else {
      onSelect(null);
    }
  }

  function renderFieldError(key: keyof DeliveryAddressFields) {
    const message = (showValidationErrors || touched[key]) && errors[key];
    return message ? (
      <span className="text-sm text-destructive" role="alert">
        {message}
      </span>
    ) : null;
  }

  function fieldProps(key: keyof DeliveryAddressFields) {
    return {
      value: fields[key],
      disabled,
      maxLength: addressFieldLimits[key],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        updateField(key, event.currentTarget.value),
      onBlur: () => setTouched((current) => ({ ...current, [key]: true })),
      "aria-invalid": Boolean((showValidationErrors || touched[key]) && errors[key]),
    };
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Manual delivery address">
      <p className="text-sm text-muted-foreground sm:col-span-2">
        Copy your address from Google Maps if needed, then enter your street address, suburb, city
        and postal code below. Please check your details carefully before continuing.
      </p>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span>Street address and number</span>
        <input
          {...fieldProps("addressLine1")}
          autoComplete="address-line1"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
          placeholder="Paste or enter your street address"
        />
        {renderFieldError("addressLine1")}
      </label>
      <label className="space-y-1 text-sm">
        <span>Suburb or local area</span>
        <input
          {...fieldProps("localArea")}
          autoComplete="address-level3"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        {renderFieldError("localArea")}
      </label>
      <label className="space-y-1 text-sm">
        <span>City</span>
        <input
          {...fieldProps("city")}
          autoComplete="address-level2"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        {renderFieldError("city")}
      </label>
      <label className="space-y-1 text-sm">
        <span>Province</span>
        <input
          {...fieldProps("province")}
          autoComplete="address-level1"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        {renderFieldError("province")}
      </label>
      <label className="space-y-1 text-sm">
        <span>Postal code</span>
        <input
          {...fieldProps("postalCode")}
          autoComplete="postal-code"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        {renderFieldError("postalCode")}
      </label>
      <label className="space-y-1 text-sm">
        <span>Country</span>
        <select
          {...fieldProps("country")}
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        >
          <option value="South Africa">South Africa</option>
        </select>
        {renderFieldError("country")}
      </label>
    </div>
  );
}
