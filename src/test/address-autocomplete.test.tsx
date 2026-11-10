import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AddressLocationFields,
  GooglePlacesAutocomplete,
  ManualDeliveryAddressForm,
} from "@/components/storefront/address-autocomplete";

function AddressFieldsHarness() {
  const [address, setAddress] = useState({
    addressLine1: "12 Main Road",
    addressLine2: "Unit 2",
    localArea: "Observatory",
    city: "Cape Town",
    province: "Western Cape",
    postalCode: "7925",
    country: "South Africa",
    lat: -33.9,
    lng: 18.5,
  });

  return (
    <>
      <AddressLocationFields value={address} onChange={setAddress} includeCountry />
      <output data-testid="address-value">{JSON.stringify(address)}</output>
    </>
  );
}

class TestPlaceAutocompleteElement extends HTMLElement {
  disabled = false;
  includedRegionCodes: string[] = [];
  placeholder = "";

  constructor() {
    super();
    window.testPlaceAutocompleteElement = this;
  }
}

declare global {
  interface Window {
    testPlaceAutocompleteElement?: TestPlaceAutocompleteElement;
    google?: {
      maps?: {
        importLibrary?: (library: "places") => Promise<{
          PlaceAutocompleteElement: typeof TestPlaceAutocompleteElement;
        }>;
      };
    };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.google;
  delete window.testPlaceAutocompleteElement;
});

describe("manual checkout delivery address", () => {
  it("keeps the shared address fields editable and clears coordinates after a location edit", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    render(<AddressFieldsHarness />);

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Stellenbosch" } });

    expect(screen.getByLabelText("Street address and number")).toHaveValue("12 Main Road");
    expect(screen.getByLabelText("Apartment, unit or complex (optional)")).toHaveValue("Unit 2");
    expect(screen.getByLabelText("Suburb or local area")).toHaveValue("Observatory");
    expect(screen.getByLabelText("Province")).toHaveValue("Western Cape");
    expect(screen.getByLabelText("Postal code")).toHaveValue("7925");
    expect(screen.getByLabelText("Country")).toHaveValue("South Africa");
    expect(screen.getByTestId("address-value")).not.toHaveTextContent('"lat"');
    expect(screen.getByTestId("address-value")).not.toHaveTextContent('"lng"');
  });

  it("fills the shared form from a Google suggestion and permits customer corrections", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-public-key");
    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          PlaceAutocompleteElement: TestPlaceAutocompleteElement,
        }),
      },
    };
    if (!customElements.get("test-place-autocomplete")) {
      customElements.define("test-place-autocomplete", TestPlaceAutocompleteElement);
    }
    render(<AddressFieldsHarness />);
    await waitFor(() => expect(window.testPlaceAutocompleteElement).toBeDefined());

    const place = {
      addressComponents: [
        { longText: "4", types: ["street_number"] },
        { longText: "Church Street", types: ["route"] },
        { longText: "Flat 8", types: ["subpremise"] },
        { longText: "City Bowl", types: ["sublocality_level_1"] },
        { longText: "Cape Town", types: ["locality"] },
        {
          longText: "Western Cape",
          shortText: "WC",
          types: ["administrative_area_level_1"],
        },
        { longText: "8001", types: ["postal_code"] },
        { longText: "South Africa", shortText: "ZA", types: ["country"] },
      ],
      formattedAddress: "4 Church Street, Cape Town, South Africa",
      location: { lat: () => -33.9, lng: () => 18.4 },
      fetchFields: vi.fn().mockResolvedValue(undefined),
    };
    const event = new Event("gmp-select") as Event & {
      placePrediction?: { toPlace: () => typeof place };
    };
    event.placePrediction = { toPlace: () => place };
    window.testPlaceAutocompleteElement!.dispatchEvent(event);

    await waitFor(() =>
      expect(screen.getByLabelText("Street address and number")).toHaveValue("4 Church Street"),
    );
    expect(screen.getByLabelText("Apartment, unit or complex (optional)")).toHaveValue("Flat 8");
    expect(screen.getByLabelText("Suburb or local area")).toHaveValue("City Bowl");
    expect(screen.getByLabelText("City")).toHaveValue("Cape Town");
    expect(screen.getByLabelText("Province")).toHaveValue("Western Cape");
    expect(screen.getByLabelText("Postal code")).toHaveValue("8001");
    expect(screen.getByTestId("address-value")).toHaveTextContent('"lat":-33.9');

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Wynberg" } });
    expect(screen.getByLabelText("City")).toHaveValue("Wynberg");
    expect(screen.getByTestId("address-value")).not.toHaveTextContent('"lat"');
    expect(screen.getByTestId("address-value")).not.toHaveTextContent('"lng"');
  });

  it("accepts structured customer-entered fields without requiring address search", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
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
  });

  it("keeps manual entry available when Google is not configured", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    render(
      <>
        <GooglePlacesAutocomplete onSelect={vi.fn()} />
        <ManualDeliveryAddressForm onSelect={vi.fn()} />
      </>,
    );
    expect(screen.getByText(/not configured/i)).toBeVisible();
    expect(screen.getByLabelText(/Street address and number/)).toBeVisible();
  });

  it("keeps manual entry available when the Google library fails to load", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-public-key");
    window.google = {
      maps: {
        importLibrary: vi.fn().mockRejectedValue(new Error("Google unavailable")),
      },
    };
    render(
      <>
        <GooglePlacesAutocomplete onSelect={vi.fn()} />
        <ManualDeliveryAddressForm onSelect={vi.fn()} />
      </>,
    );

    expect(await screen.findByText(/Google address search is unavailable/i)).toBeVisible();
    expect(screen.getByLabelText(/Street address and number/)).toBeVisible();
  });

  it("configures the new Places element for South Africa and maps a selected suggestion", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-public-key");
    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          PlaceAutocompleteElement: TestPlaceAutocompleteElement,
        }),
      },
    };
    if (!customElements.get("test-place-autocomplete")) {
      customElements.define("test-place-autocomplete", TestPlaceAutocompleteElement);
    }
    const onSelect = vi.fn();
    render(<GooglePlacesAutocomplete onSelect={onSelect} />);

    await waitFor(() => expect(window.testPlaceAutocompleteElement).toBeDefined());
    const autocomplete = window.testPlaceAutocompleteElement!;
    expect(autocomplete.includedRegionCodes).toEqual(["za"]);
    expect(autocomplete.placeholder).toContain("street, suburb, complex or area");

    const fetchFields = vi.fn().mockResolvedValue(undefined);
    const place = {
      addressComponents: [
        { longText: "12", types: ["street_number"] },
        { longText: "Main Road", types: ["route"] },
        { longText: "Unit 5", types: ["subpremise"] },
        { longText: "Observatory", types: ["sublocality_level_1"] },
        { longText: "Cape Town", types: ["locality"] },
        {
          longText: "Western Cape",
          shortText: "WC",
          types: ["administrative_area_level_1"],
        },
        { longText: "7925", types: ["postal_code"] },
        { longText: "South Africa", shortText: "ZA", types: ["country"] },
      ],
      formattedAddress: "12 Main Road, Observatory, Cape Town, 7925, South Africa",
      location: { lat: () => -33.9, lng: () => 18.5 },
      fetchFields,
    };
    const event = new Event("gmp-select") as Event & {
      placePrediction?: { toPlace: () => typeof place };
    };
    event.placePrediction = { toPlace: () => place };
    autocomplete.dispatchEvent(event);

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        formattedAddress: place.formattedAddress,
        addressLine1: "12 Main Road",
        addressLine2: "Unit 5",
        localArea: "Observatory",
        city: "Cape Town",
        province: "Western Cape",
        postalCode: "7925",
        country: "South Africa",
        lat: -33.9,
        lng: 18.5,
      }),
    );
    expect(fetchFields).toHaveBeenCalledWith({
      fields: ["addressComponents", "formattedAddress", "location"],
    });
  });

  it("leaves manual entry available when Google produces no selected suggestion", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-public-key");
    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          PlaceAutocompleteElement: TestPlaceAutocompleteElement,
        }),
      },
    };
    if (!customElements.get("test-place-autocomplete")) {
      customElements.define("test-place-autocomplete", TestPlaceAutocompleteElement);
    }
    const onSelect = vi.fn();
    render(
      <>
        <GooglePlacesAutocomplete onSelect={onSelect} />
        <ManualDeliveryAddressForm onSelect={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(window.testPlaceAutocompleteElement).toBeDefined());
    expect(screen.getByLabelText(/Street address and number/)).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
