import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
} from "@/lib/south-african-address";

export interface SelectedDeliveryAddress {
  formattedAddress?: string;
  addressLine1?: string;
  localArea?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: "South Africa";
  lat?: number;
  lng?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedName(context: Record<string, unknown>, key: string): string | undefined {
  const value = context[key];
  if (!isRecord(value) || typeof value["name"] !== "string") return undefined;
  const name = value["name"].trim();
  return name || undefined;
}

function mapboxCoordinatePair(value: unknown): { lat: number; lng: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [longitude, latitude] = value;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return undefined;
  }
  return { lat: latitude, lng: longitude };
}

export function mapboxFeatureToAddress(feature: unknown): SelectedDeliveryAddress | undefined {
  if (!isRecord(feature) || !isRecord(feature["properties"])) return undefined;
  const properties = feature["properties"];
  if (!isRecord(properties["context"])) return undefined;
  const context = properties["context"];
  const country = context["country"];
  if (
    !isRecord(country) ||
    typeof country["country_code"] !== "string" ||
    country["country_code"].toUpperCase() !== "ZA"
  ) {
    return undefined;
  }

  const addressContext = isRecord(context["address"]) ? context["address"] : {};
  const streetAddress =
    [
      typeof addressContext["address_number"] === "string"
        ? addressContext["address_number"].trim()
        : "",
      typeof addressContext["street_name"] === "string" ? addressContext["street_name"].trim() : "",
    ]
      .filter(Boolean)
      .join(" ") ||
    (typeof addressContext["name"] === "string" ? addressContext["name"].trim() : "");
  const province = nestedName(context, "region");
  const normalizedProvince = province ? normalizeSouthAfricanProvince(province) : undefined;
  const postalCode = nestedName(context, "postcode");
  const localArea = nestedName(context, "neighborhood") ?? nestedName(context, "locality");
  const city = nestedName(context, "place");
  const geometry = isRecord(feature["geometry"]) ? feature["geometry"] : undefined;
  const coordinates = mapboxCoordinatePair(geometry?.["coordinates"]);

  return {
    ...(streetAddress ? { addressLine1: streetAddress } : {}),
    ...(localArea ? { localArea } : {}),
    ...(city ? { city } : {}),
    ...(normalizedProvince ? { province: normalizedProvince } : {}),
    ...(postalCode && isSouthAfricanPostalCode(postalCode) ? { postalCode } : {}),
    country: "South Africa",
    ...(coordinates ?? {}),
  };
}
