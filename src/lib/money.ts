const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

export function formatZarCents(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) {
    throw new TypeError("ZAR amount must be a safe integer number of cents.");
  }

  return zarFormatter.format(amountCents / 100);
}
