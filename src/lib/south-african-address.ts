export const SOUTH_AFRICAN_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "Northern Cape",
  "North West",
  "Western Cape",
] as const;

const provinceNamesByInput: Record<string, (typeof SOUTH_AFRICAN_PROVINCES)[number]> = {
  easterncape: "Eastern Cape",
  ec: "Eastern Cape",
  freestate: "Free State",
  fs: "Free State",
  gauteng: "Gauteng",
  gp: "Gauteng",
  kwazulunatal: "KwaZulu-Natal",
  kzn: "KwaZulu-Natal",
  limpopo: "Limpopo",
  lp: "Limpopo",
  mpumalanga: "Mpumalanga",
  mp: "Mpumalanga",
  northerncape: "Northern Cape",
  nc: "Northern Cape",
  northwest: "North West",
  nw: "North West",
  westerncape: "Western Cape",
  wc: "Western Cape",
};

export function normalizeSouthAfricanProvince(
  value: string,
): (typeof SOUTH_AFRICAN_PROVINCES)[number] | undefined {
  const normalizedValue = value.trim().toLowerCase();
  if (!/^[a-z\s-]+$/.test(normalizedValue)) return undefined;
  const key = normalizedValue.replace(/[\s-]/g, "").replace(/province$/, "");
  return provinceNamesByInput[key];
}

export function isSouthAfricanPostalCode(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}
