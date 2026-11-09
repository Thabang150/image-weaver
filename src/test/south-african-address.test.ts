import { describe, expect, it } from "vitest";

import {
  isSouthAfricanPostalCode,
  normalizeSouthAfricanProvince,
  SOUTH_AFRICAN_PROVINCES,
} from "@/lib/south-african-address";

describe("South African delivery address normalization", () => {
  it("normalizes all province names and abbreviations to provider zone names", () => {
    const abbreviations = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

    SOUTH_AFRICAN_PROVINCES.forEach((province, index) => {
      expect(normalizeSouthAfricanProvince(province)).toBe(province);
      expect(normalizeSouthAfricanProvince(abbreviations[index] ?? "")).toBe(province);
      expect(normalizeSouthAfricanProvince(` ${province.toUpperCase()} `)).toBe(province);
    });

    expect(normalizeSouthAfricanProvince("Kwa Zulu Natal")).toBe("KwaZulu-Natal");
    expect(normalizeSouthAfricanProvince("Gauteng Province")).toBe("Gauteng");
    expect(normalizeSouthAfricanProvince("Gauteng!")).toBeUndefined();
    expect(normalizeSouthAfricanProvince("Gauteng 1")).toBeUndefined();
    expect(normalizeSouthAfricanProvince("Unknown Province")).toBeUndefined();
  });

  it("accepts only four-digit South African postal code strings", () => {
    expect(isSouthAfricanPostalCode("2091")).toBe(true);
    expect(isSouthAfricanPostalCode(" 0081 ")).toBe(true);
    expect(isSouthAfricanPostalCode("209")).toBe(false);
    expect(isSouthAfricanPostalCode("20A1")).toBe(false);
    expect(isSouthAfricanPostalCode("12345")).toBe(false);
  });
});
