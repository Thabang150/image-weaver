import { describe, expect, it } from "vitest";
import { googlePlaceToAddress, mergeGoogleAddress } from "@/lib/google-address";
import { normalizeSouthAfricanProvince } from "@/lib/south-african-address";

function component(longText: string, ...types: string[]) {
  return { longText, types };
}

describe("Google Places South African address mapping", () => {
  it("maps only components actually provided, including unit and complex details", () => {
    expect(
      googlePlaceToAddress({
        formattedAddress: "12 Main Road, Unit 5, Observatory, Cape Town, 7925",
        addressComponents: [
          component("12", "street_number"),
          component("Main Road", "route"),
          component("Unit 5", "subpremise"),
          component("The Observatory Complex", "premise"),
          component("Observatory", "sublocality_level_1"),
          component("Cape Town", "locality"),
          component("Western Cape", "administrative_area_level_1"),
          component("7925", "postal_code"),
          { longText: "South Africa", shortText: "ZA", types: ["country"] },
        ],
        location: { lat: () => -33.9, lng: () => 18.5 },
      }),
    ).toEqual({
      formattedAddress: "12 Main Road, Unit 5, Observatory, Cape Town, 7925",
      addressLine1: "12 Main Road",
      addressLine2: "Unit 5",
      localArea: "Observatory",
      city: "Cape Town",
      province: "Western Cape",
      postalCode: "7925",
      country: "South Africa",
      lat: -33.9,
      lng: 18.5,
    });
  });

  it("maps route without inventing a street number and leaves absent suburb, city and postal code blank", () => {
    expect(
      googlePlaceToAddress({
        addressComponents: [
          component("Main Road", "route"),
          component("Gauteng", "administrative_area_level_1"),
          { longText: "South Africa", shortText: "ZA", types: ["country"] },
        ],
      }),
    ).toEqual({
      addressLine1: "Main Road",
      province: "Gauteng",
      country: "South Africa",
    });
  });

  it("uses postal town when locality is absent and maps all nine provinces", () => {
    const provinces = [
      ["Eastern Cape", "EC"],
      ["Free State", "FS"],
      ["Gauteng", "GP"],
      ["KwaZulu-Natal", "KZN"],
      ["Limpopo", "LP"],
      ["Mpumalanga", "MP"],
      ["Northern Cape", "NC"],
      ["North West", "NW"],
      ["Western Cape", "WC"],
    ] as const;

    for (const [province, abbreviation] of provinces) {
      expect(
        googlePlaceToAddress({
          addressComponents: [
            { longText: province, shortText: abbreviation, types: ["administrative_area_level_1"] },
            component("Test Town", "postal_town"),
            { longText: "ZA", types: ["country"] },
          ],
        }),
      ).toMatchObject({ province, city: "Test Town", country: "South Africa" });
      expect(normalizeSouthAfricanProvince(abbreviation)).toBe(province);
    }
  });

  it("rejects unsupported countries and invalid postal codes without inventing values", () => {
    expect(
      googlePlaceToAddress({
        addressComponents: [{ longText: "US", types: ["country"] }],
      }),
    ).toBeUndefined();
    expect(
      googlePlaceToAddress({
        addressComponents: [component("12A", "postal_code")],
      }),
    ).toEqual({});
  });

  it("omits invalid or incomplete coordinates", () => {
    const invalidLocations: Array<{ lat: () => number; lng?: () => number } | undefined> = [
      { lat: () => 91, lng: () => 18 },
      { lat: () => -33, lng: () => 181 },
      { lat: () => 0, lng: () => 0 },
      { lat: () => Number.NaN, lng: () => 18 },
      { lat: () => -33 },
      undefined,
    ];

    for (const location of invalidLocations) {
      expect(googlePlaceToAddress(location ? { location } : {})).toEqual({});
    }
  });

  it("preserves manually entered fields when Google omits them and clears stale coordinates", () => {
    const current = {
      label: "Delivery",
      addressLine1: "Manual street",
      addressLine2: "Flat 2",
      localArea: "Manual suburb",
      city: "Manual city",
      province: "Gauteng",
      postalCode: "2091",
      country: "South Africa",
      lat: -26.2,
      lng: 28.0,
    };

    expect(mergeGoogleAddress(current, { addressLine1: "12 Main Road" })).toEqual({
      ...current,
      addressLine1: "12 Main Road",
      lat: undefined,
      lng: undefined,
    });
  });

  it("does not retain invalid or partial selected coordinates", () => {
    const current = { addressLine1: "Old street", lat: -26, lng: 28 };
    expect(mergeGoogleAddress(current, { addressLine1: "New street", lat: 0, lng: 0 })).toEqual({
      addressLine1: "New street",
      lat: undefined,
      lng: undefined,
    });
    expect(mergeGoogleAddress(current, { lat: -33 })).toEqual({
      addressLine1: "Old street",
      lat: undefined,
      lng: undefined,
    });
  });
});
