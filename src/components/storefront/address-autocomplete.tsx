import { useEffect, useState, type ChangeEvent } from "react";
import { mapboxFeatureToAddress, type SelectedDeliveryAddress } from "@/lib/mapbox-address";
import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
} from "@/lib/south-african-address";

type MapboxSuggestion = {
  feature: unknown;
  label: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSuggestions(value: unknown): MapboxSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value["features"])) return [];
  return value["features"].flatMap((rawFeature): MapboxSuggestion[] => {
    if (!isRecord(rawFeature) || !isRecord(rawFeature["properties"])) return [];
    const properties = rawFeature["properties"];
    const label =
      typeof properties["full_address"] === "string"
        ? properties["full_address"]
        : typeof properties["name"] === "string"
          ? properties["name"]
          : "";
    if (!label || mapboxFeatureToAddress(rawFeature) === undefined) return [];
    return [{ feature: rawFeature, label }];
  });
}

export function MapboxAddressAutocomplete({
  onSelect,
  disabled = false,
}: {
  onSelect: (address: SelectedDeliveryAddress) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState<string>();
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim() ?? "";

  useEffect(() => {
    const searchQuery = query.trim();
    if (!accessToken || searchQuery.length < 4 || disabled) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setSearchedFor(undefined);
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.search = new URLSearchParams({
        q: searchQuery,
        country: "za",
        types: "address",
        autocomplete: "true",
        permanent: "true",
        language: "en",
        limit: "5",
        access_token: accessToken,
      }).toString();

      void fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Address search is unavailable.");
          return (await response.json()) as unknown;
        })
        .then((response) => {
          setSuggestions(parseSuggestions(response));
          setSearchedFor(searchQuery);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setSearchedFor(searchQuery);
          setError(
            "Address search is temporarily unavailable. You can enter the address manually.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, disabled, query]);

  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="block space-y-1 text-sm">
        <span>Find your address (optional)</span>
        <input
          autoComplete="off"
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2"
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSuggestions([]);
            setSearchedFor(undefined);
            setError(null);
          }}
          placeholder={
            accessToken
              ? "Start typing a street address"
              : "Address search is not configured; enter your address below"
          }
          aria-describedby="mapbox-address-help"
          aria-expanded={suggestions.length > 0}
          aria-controls="mapbox-address-suggestions"
        />
      </label>
      <p id="mapbox-address-help" className="text-xs text-muted-foreground">
        {loading
          ? "Searching addresses…"
          : accessToken
            ? "Choose a suggestion to fill any available address fields, then review and edit them below. Search is powered by Mapbox."
            : "Address search is unavailable. You can still enter every address field manually."}
      </p>
      {error ? (
        <p className="text-sm text-muted-foreground" role="status">
          {error}
        </p>
      ) : null}
      {accessToken && searchedFor === query.trim() && suggestions.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground" role="status">
          No matching address was found. You can enter the address manually.
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <ul
          id="mapbox-address-suggestions"
          className="divide-y rounded-md border border-border"
          role="listbox"
          aria-label="Address suggestions"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.label} role="option" aria-selected="false">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                disabled={disabled}
                onClick={() => {
                  const address = mapboxFeatureToAddress(suggestion.feature);
                  if (address) onSelect(address);
                  setQuery(suggestion.label);
                  setSuggestions([]);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
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
