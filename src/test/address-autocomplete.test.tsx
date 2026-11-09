import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ManualDeliveryAddressForm,
  MapboxAddressAutocomplete,
} from "@/components/storefront/address-autocomplete";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("manual checkout delivery address", () => {
  it("accepts structured customer-entered fields without requiring address search", () => {
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
    const onSelect = vi.fn();

    render(<ManualDeliveryAddressForm onSelect={onSelect} showValidationErrors />);

    fireEvent.change(screen.getByLabelText(/Street address and number/), {
      target: { value: "12 Main Road" },
    });
    fireEvent.change(screen.getByLabelText(/Suburb or local area/), {
      target: { value: "Observatory" },
    });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: "Cape Town" } });
    fireEvent.change(screen.getByLabelText(/Province/), { target: { value: "Western Cape" } });
    fireEvent.change(screen.getByLabelText(/Postal code/), { target: { value: "7925" } });

    expect(onSelect).toHaveBeenLastCalledWith({
      formattedAddress: "12 Main Road, Observatory, Cape Town, Western Cape, 7925, South Africa",
      addressLine1: "12 Main Road",
      localArea: "Observatory",
      city: "Cape Town",
      province: "Western Cape",
      postalCode: "7925",
      country: "South Africa",
    });
    expect(screen.getByText(/Use address search above if helpful/)).toBeVisible();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("keeps address search optional when its public token is not configured", () => {
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
    render(<MapboxAddressAutocomplete onSelect={vi.fn()} />);
    expect(screen.getByText(/Address search is unavailable/)).toBeVisible();
  });

  it("requests permanent South African results and returns selected address fields", async () => {
    const onSelect = vi.fn();
    const fullAddress = "12 Main Road, Observatory, Cape Town, South Africa";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            properties: {
              full_address: fullAddress,
              context: {
                country: { country_code: "ZA" },
                address: { address_number: "12", street_name: "Main Road" },
                neighborhood: { name: "Observatory" },
                place: { name: "Cape Town" },
                region: { name: "Western Cape" },
                postcode: { name: "7925" },
              },
            },
            geometry: { type: "Point", coordinates: [18.5, -33.9] },
          },
        ],
      }),
    });
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "pk.test-token");
    vi.stubGlobal("fetch", fetchMock);

    render(<MapboxAddressAutocomplete onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Find your address (optional)"), {
      target: { value: "12 Main Road" },
    });

    fireEvent.click(await screen.findByRole("button", { name: fullAddress }));

    const [request] = fetchMock.mock.calls[0] ?? [];
    const requestUrl = new URL(String(request));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.mapbox.com/search/geocode/v6/forward",
    );
    expect(requestUrl.searchParams.get("country")).toBe("za");
    expect(requestUrl.searchParams.get("types")).toBe("address");
    expect(requestUrl.searchParams.get("permanent")).toBe("true");
    expect(onSelect).toHaveBeenCalledWith({
      addressLine1: "12 Main Road",
      localArea: "Observatory",
      city: "Cape Town",
      province: "Western Cape",
      postalCode: "7925",
      country: "South Africa",
      lat: -33.9,
      lng: 18.5,
    });
  });

  it("shows field-level errors for missing address components when requested", () => {
    render(<ManualDeliveryAddressForm onSelect={vi.fn()} showValidationErrors />);

    expect(screen.getByText("Street address and number is required.")).toBeVisible();
    expect(screen.getByText("Suburb or local area is required.")).toBeVisible();
    expect(screen.getByText("City is required.")).toBeVisible();
    expect(screen.getByText("Province is required.")).toBeVisible();
    expect(screen.getByText("Postal code is required.")).toBeVisible();
  });

  it("normalizes province abbreviations and rejects malformed postal codes", () => {
    const onSelect = vi.fn();
    render(<ManualDeliveryAddressForm onSelect={onSelect} showValidationErrors />);

    fireEvent.change(screen.getByLabelText(/Street address and number/), {
      target: { value: "10 Test Street" },
    });
    fireEvent.change(screen.getByLabelText(/Suburb or local area/), {
      target: { value: "Test Suburb" },
    });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: "Johannesburg" } });
    fireEvent.change(screen.getByLabelText(/Province/), { target: { value: "GP" } });
    fireEvent.change(screen.getByLabelText(/Postal code/), { target: { value: "209" } });

    expect(screen.getByText("Enter a four-digit South African postal code.")).toBeVisible();
    expect(onSelect).toHaveBeenLastCalledWith(null);

    fireEvent.change(screen.getByLabelText(/Postal code/), { target: { value: "2091" } });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ province: "Gauteng", postalCode: "2091" }),
    );
  });
});
