import { describe, expect, it } from "vitest";

import { formatZarCents } from "@/lib/money";

describe("formatZarCents", () => {
  it("formats zero cents as South African rand", () => {
    expect(formatZarCents(0)).toBe(
      new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: "ZAR",
      }).format(0),
    );
  });

  it("converts integer cents to rand for ordinary and decimal-rand amounts", () => {
    const format = new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    });
    expect(formatZarCents(12345)).toBe(format.format(123.45));
    expect(formatZarCents(1)).toBe(format.format(0.01));
  });

  it("rejects values that are not safe integer cents", () => {
    expect(() => formatZarCents(1.5)).toThrow("safe integer");
    expect(() => formatZarCents(Number.MAX_SAFE_INTEGER + 1)).toThrow("safe integer");
  });
});
