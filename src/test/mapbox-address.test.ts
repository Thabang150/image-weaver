import { describe, expect, it } from "vitest";
import { mapboxFeatureToAddress } from "@/lib/mapbox-address";
import { normalizeSouthAfricanProvince } from "@/lib/south-african-address";

describe("Mapbox delivery address mapping", () => {
  it("maps available South African fields and a valid coordinate pair", () => {
    expect(
      mapboxFeatureToAddress({
        type: "Feature",
        geometry: { type: "Point", coordinates: [28.2293, -25.7479] },
        properties: {
          context: {
            address: {
              name: "10 Test Street",
              address_number: "10",
              street_name: "Test Street",
            },
            country: { country_code: "ZA" },
            region: { name: "Gauteng" },
            postcode: { name: "0081" },
            place: { name: "Pretoria" },
            neighborhood: { name: "Test Suburb" },
          },
        },
      }),
    ).toEqual({
      addressLine1: "10 Test Street",
      localArea: "Test Suburb",
      city: "Pretoria",
      province: "Gauteng",
      postalCode: "0081",
      country: "South Africa",
      lat: -25.7479,
      lng: 28.2293,
    });
  });

  it("leaves missing components blank and drops invalid coordinates", () => {
    expect(
      mapboxFeatureToAddress({
        geometry: { coordinates: [0, 0] },
        properties: {
          context: {
            country: { country_code: "ZA" },
            place: { name: "Small Town" },
          },
        },
      }),
    ).toEqual({
      city: "Small Town",
      country: "South Africa",
    });
  });

  it("rejects unsupported countries without inventing fields", () => {
    expect(
      mapboxFeatureToAddress({
        properties: { context: { country: { country_code: "NA" } } },
      }),
    ).toBeUndefined();
  });

  it("maps all nine South African province names and abbreviations from Mapbox regions", () => {
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
        mapboxFeatureToAddress({
          properties: {
            context: {
              country: { country_code: "za" },
              region: { name: province },
              address: { address_number: "1", street_name: "Test Road" },
              locality: { name: "Test suburb" },
              place: { name: "Test town" },
              postcode: { name: "0001" },
            },
          },
        }),
      ).toMatchObject({
        addressLine1: "1 Test Road",
        localArea: "Test suburb",
        city: "Test town",
        province,
        postalCode: "0001",
        country: "South Africa",
      });

      expect(normalizeSouthAfricanProvince(abbreviation)).toBe(province);
    }
  });

  it("does not submit incomplete coordinate pairs", () => {
    expect(
      mapboxFeatureToAddress({
        geometry: { coordinates: [28.2293] },
        properties: {
          context: { country: { country_code: "ZA" } },
        },
      }),
    ).toEqual({ country: "South Africa" });
  });
});
