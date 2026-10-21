function getAllowedHosts() {
  return new Set(
    (import.meta.env.VITE_PRODUCT_IMAGE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
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
