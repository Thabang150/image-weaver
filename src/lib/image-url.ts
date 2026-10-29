function normalizeAllowedHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = trimmed.toLowerCase().replace(/^https?:\/\//, "");
  const hostname = candidate.split("/")[0].split(":")[0];
  const normalized = hostname.replace(/^\.+/, "").replace(/\.+$/, "");

  if (!normalized || !/^[a-z0-9.-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getAllowedHosts() {
  const configuredHosts = (import.meta.env.VITE_PRODUCT_IMAGE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(normalizeAllowedHost)
    .filter((host): host is string => host !== null);
  return new Set(["res.cloudinary.com", ...configuredHosts]);
}

export function isAllowedProductImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      getAllowedHosts().has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function getAllowedProductImageUrls(values: readonly string[]): string[] {
  return values.filter(isAllowedProductImageUrl);
}
