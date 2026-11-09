import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
} from "@/lib/south-african-address";

export interface SelectedDeliveryAddress {
  formattedAddress?: string;
  addressLine1?: string;
  addressLine2?: string;
  localArea?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: "South Africa";
  lat?: number;
  lng?: number;
}

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlace {
  addressComponents?: GoogleAddressComponent[];
  formattedAddress?: string;
  location?: {
    lat?: () => number;
    lng?: () => number;
  };
}

function componentValue(
  components: GoogleAddressComponent[],
  ...types: string[]
): string | undefined {
  const component = components.find((entry) => types.some((type) => entry.types?.includes(type)));
  const value = component?.longText?.trim() || component?.shortText?.trim();
  return value || undefined;
}

function validCoordinatePair(
  location: GooglePlace["location"],
): { lat: number; lng: number } | undefined {
  if (typeof location?.lat !== "function" || typeof location.lng !== "function") return undefined;
  try {
    const lat = location.lat();
    const lng = location.lng();
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      (lat === 0 && lng === 0)
    ) {
      return undefined;
    }
    return { lat, lng };
  } catch {
    return undefined;
  }
}

export function googlePlaceToAddress(place: GooglePlace): SelectedDeliveryAddress | undefined {
  const components = place.addressComponents ?? [];
  const country = components.find((component) => component.types?.includes("country"));
  const countryCode = country?.shortText?.trim() || country?.longText?.trim();
  if (countryCode && countryCode.toUpperCase() !== "ZA") return undefined;

  const streetNumber = componentValue(components, "street_number");
  const route = componentValue(components, "route");
  const streetAddress = [streetNumber, route].filter(Boolean).join(" ") || route;
  const provinceComponent = components.find((component) =>
    component.types?.includes("administrative_area_level_1"),
  );
  const province = provinceComponent
    ? normalizeSouthAfricanProvince(provinceComponent.longText ?? provinceComponent.shortText ?? "")
    : undefined;
  const postalCode = componentValue(components, "postal_code");
  const localArea =
    componentValue(components, "sublocality_level_1") ??
    componentValue(components, "sublocality") ??
    componentValue(components, "neighborhood") ??
    componentValue(components, "sublocality_level_2");
  const city = componentValue(components, "locality") ?? componentValue(components, "postal_town");
  const subpremise = componentValue(components, "subpremise");
  const coordinates = validCoordinatePair(place.location);

  return {
    ...(place.formattedAddress?.trim() ? { formattedAddress: place.formattedAddress.trim() } : {}),
    ...(streetAddress ? { addressLine1: streetAddress } : {}),
    ...(subpremise ? { addressLine2: subpremise } : {}),
    ...(localArea ? { localArea } : {}),
    ...(city ? { city } : {}),
    ...(province ? { province } : {}),
    ...(postalCode && isSouthAfricanPostalCode(postalCode) ? { postalCode } : {}),
    ...(countryCode?.toUpperCase() === "ZA" ? { country: "South Africa" as const } : {}),
    ...(coordinates ?? {}),
  };
}

export function mergeGoogleAddress<T extends { lat?: number; lng?: number }>(
  current: T,
  selected: SelectedDeliveryAddress,
): T {
  const { formattedAddress: _formattedAddress, ...selectedFields } = selected;
  const next = { ...current, ...selectedFields };
  delete next.lat;
  delete next.lng;
  if (
    selected.lat !== undefined &&
    selected.lng !== undefined &&
    Number.isFinite(selected.lat) &&
    Number.isFinite(selected.lng) &&
    selected.lat >= -90 &&
    selected.lat <= 90 &&
    selected.lng >= -180 &&
    selected.lng <= 180 &&
    !(selected.lat === 0 && selected.lng === 0)
  ) {
    next.lat = selected.lat;
    next.lng = selected.lng;
  }
  return next;
}
