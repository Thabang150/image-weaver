import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  googlePlaceToAddress,
  mergeGoogleAddress,
  type SelectedDeliveryAddress,
} from "@/lib/google-address";
import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
} from "@/lib/south-african-address";

interface GooglePlacePrediction {
  toPlace(): {
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
    formattedAddress?: string;
    location?: { lat?: () => number; lng?: () => number };
    fetchFields(options: { fields: string[] }): Promise<void>;
  };
}

interface GooglePlacesLibrary {
  PlaceAutocompleteElement: new () => GoogleAutocompleteElement;
}

interface GoogleAutocompleteElement extends HTMLElement {
  disabled: boolean;
  includedRegionCodes: string[];
  placeholder: string;
}

interface GoogleMapsWindow extends Window {
  google?: {
    maps?: {
      importLibrary?: (library: "places") => Promise<GooglePlacesLibrary>;
    };
  };
}

let placesLibraryPromise: Promise<GooglePlacesLibrary> | undefined;

function importPlacesLibrary(): Promise<GooglePlacesLibrary> {
  const maps = (window as GoogleMapsWindow).google?.maps;
  if (!maps?.importLibrary) {
    return Promise.reject(new Error("Google Maps JavaScript API is unavailable."));
  }
  return maps.importLibrary("places");
}

function loadGooglePlaces(apiKey: string): Promise<GooglePlacesLibrary> {
  if ((window as GoogleMapsWindow).google?.maps?.importLibrary) {
    return importPlacesLibrary();
  }
  if (placesLibraryPromise) return placesLibraryPromise;

  placesLibraryPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-places="true"]',
    );
    if (existing?.dataset["loaded"] === "true") {
      reject(new Error("Google Maps JavaScript API did not initialize."));
      return;
    }

    const script = existing ?? document.createElement("script");
    const created = existing === null;
    const onLoad = () => {
      script.dataset["loaded"] = "true";
      resolve();
    };
    const onError = () => reject(new Error("Google Maps JavaScript API could not be loaded."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    if (created) {
      script.dataset["googleMapsPlaces"] = "true";
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
        key: apiKey,
        v: "weekly",
        loading: "async",
      })}`;
      document.head.appendChild(script);
    }
  })
    .then(() => importPlacesLibrary())
    .catch((error: unknown) => {
      placesLibraryPromise = undefined;
      document.querySelector('script[data-google-maps-places="true"]')?.remove();
      throw error;
    });

  return placesLibraryPromise;
}

export function GooglePlacesAutocomplete({
  onSelect,
  disabled = false,
}: {
  onSelect: (address: SelectedDeliveryAddress) => void;
  disabled?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const disabledRef = useRef(disabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!apiKey) {
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    let selectionId = 0;
    let autocomplete: GoogleAutocompleteElement | undefined;
    const onPlaceSelected = async (event: Event) => {
      const prediction = (event as Event & { placePrediction?: GooglePlacePrediction })
        .placePrediction;
      if (!prediction) {
        setError("That suggestion could not be loaded. Please enter the address manually.");
        return;
      }
      const currentSelection = ++selectionId;
      setLoading(true);
      setError(null);
      try {
        const place = prediction.toPlace();
        await place.fetchFields({
          fields: ["addressComponents", "formattedAddress", "location"],
        });
        if (!active || currentSelection !== selectionId) return;
        const address = googlePlaceToAddress(place);
        if (!address) {
          setError("That result could not be used. Please review or enter the address manually.");
          return;
        }
        onSelectRef.current(address);
      } catch {
        if (active && currentSelection === selectionId) {
          setError("Google address details are unavailable. Please enter the address manually.");
        }
      } finally {
        if (active && currentSelection === selectionId) setLoading(false);
      }
    };

    setError(null);
    setLoading(true);
    void loadGooglePlaces(apiKey)
      .then(({ PlaceAutocompleteElement }) => {
        if (!active) return;
        autocomplete = new PlaceAutocompleteElement();
        autocomplete.includedRegionCodes = ["za"];
        autocomplete.placeholder = "Search street, suburb, complex or area";
        autocomplete.disabled = disabledRef.current;
        autocomplete.setAttribute("aria-label", "Find your address (optional)");
        autocomplete.className = "w-full";
        autocomplete.addEventListener("gmp-select", onPlaceSelected);
        setLoading(false);
        host.replaceChildren(autocomplete);
      })
      .catch(() => {
        if (active) {
          setError("Google address search is unavailable. You can enter the address manually.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
      selectionId += 1;
      autocomplete?.removeEventListener("gmp-select", onPlaceSelected);
      host.replaceChildren();
    };
  }, [apiKey]);

  useEffect(() => {
    disabledRef.current = disabled;
    const autocomplete = hostRef.current?.firstElementChild as
      GoogleAutocompleteElement | null | undefined;
    if (autocomplete) autocomplete.disabled = disabledRef.current;
  }, [disabled]);

  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="mb-1 block text-sm" htmlFor="google-address-search">
        Find your address (optional)
      </label>
      <div
        id="google-address-search"
        ref={hostRef}
        className="min-h-10"
        aria-label="Google address search"
      />
      <p className="text-xs text-muted-foreground" role={error ? "status" : undefined}>
        {error ??
          (loading
            ? "Loading Google address search…"
            : apiKey
              ? "Search by street, suburb, complex or area. Review and edit any fields below."
              : "Address search is not configured. You can enter every address field manually.")}
      </p>
    </div>
  );
}

export interface AddressLocationFieldsValue {
  addressLine1: string;
  addressLine2?: string;
  localArea?: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  lat?: number;
  lng?: number;
}

type AddressLocationTextKey =
  "addressLine1" | "addressLine2" | "localArea" | "city" | "province" | "postalCode" | "country";

function updateAddressLocationField<T extends AddressLocationFieldsValue>(
  current: T,
  key: AddressLocationTextKey,
  value: string,
): T {
  const next = { ...current, [key]: value };
  delete next.lat;
  delete next.lng;
  return next;
}

export function AddressLocationFields<T extends AddressLocationFieldsValue>({
  value,
  onChange,
  disabled = false,
  provinceOptions,
  includeCountry = false,
  onAddressSelected,
}: {
  value: T;
  onChange: Dispatch<SetStateAction<T>>;
  disabled?: boolean;
  provinceOptions?: readonly string[];
  includeCountry?: boolean;
  onAddressSelected?: () => void;
}) {
  const fieldClass =
    "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const updateField = (key: AddressLocationTextKey, nextValue: string) => {
    onChange((current) => updateAddressLocationField(current, key, nextValue));
  };
  const field = (
    key: AddressLocationTextKey,
    title: string,
    options: { required?: boolean; maxLength?: number; placeholder?: string } = {},
  ) => (
    <label className="space-y-1 text-sm" key={key}>
      <span>{title}</span>
      <input
        className={fieldClass}
        required={options.required}
        maxLength={options.maxLength}
        placeholder={options.placeholder}
        inputMode={key === "postalCode" ? "numeric" : undefined}
        pattern={key === "postalCode" ? "[0-9]{4}" : undefined}
        value={value[key] ?? ""}
        disabled={disabled}
        onChange={(event) => updateField(key, event.currentTarget.value)}
      />
    </label>
  );

  return (
    <>
      <GooglePlacesAutocomplete
        disabled={disabled}
        onSelect={(selected) => {
          onChange((current) => mergeGoogleAddress(current, selected));
          onAddressSelected?.();
        }}
      />
      {field("addressLine1", "Street address and number", {
        required: true,
        maxLength: 120,
        placeholder: "Street number and street name",
      })}
      {field("addressLine2", "Apartment, unit or complex (optional)", { maxLength: 120 })}
      {field("localArea", "Suburb or local area", {
        required: true,
        maxLength: 100,
        placeholder: "Suburb or neighbourhood",
      })}
      {field("city", "City", { required: true, maxLength: 80 })}
      <label className="space-y-1 text-sm">
        <span>Province</span>
        {provinceOptions ? (
          <select
            className={fieldClass}
            required
            value={value.province}
            disabled={disabled}
            onChange={(event) => updateField("province", event.currentTarget.value)}
          >
            <option value="">Select a province</option>
            {provinceOptions.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={fieldClass}
            required
            maxLength={80}
            value={value.province}
            disabled={disabled}
            onChange={(event) => updateField("province", event.currentTarget.value)}
          />
        )}
      </label>
      {field("postalCode", "Postal code", { required: true, maxLength: 4 })}
      {includeCountry ? field("country", "Country", { required: true, maxLength: 80 }) : null}
    </>
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
  postalCode: 4,
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
  const country = fields.country.trim().toLowerCase();
  if (country !== "south africa" && country !== "za") {
    errors.country = "Delivery is currently available in South Africa only.";
  }
  if (fields.province.trim() && !normalizeSouthAfricanProvince(fields.province)) {
    errors.province = "Enter a South African province name or abbreviation.";
  }
  if (fields.postalCode.trim() && !isSouthAfricanPostalCode(fields.postalCode)) {
    errors.postalCode = "Enter a four-digit South African postal code.";
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
        province: normalizeSouthAfricanProvince(updated.province) ?? updated.province.trim(),
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
      ...(key === "postalCode" ? { inputMode: "numeric" as const, pattern: "[0-9]{4}" } : {}),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        updateField(key, event.currentTarget.value),
      onBlur: () => setTouched((current) => ({ ...current, [key]: true })),
      "aria-invalid": Boolean((showValidationErrors || touched[key]) && errors[key]),
    };
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Manual delivery address">
      <p className="text-sm text-muted-foreground sm:col-span-2">
        Use address search above if helpful, or enter your street address, suburb, city and postal
        code below. Please review all details before continuing.
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
        <input
          {...fieldProps("country")}
          autoComplete="country-name"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        {renderFieldError("country")}
      </label>
    </div>
  );
}
