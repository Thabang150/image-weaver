import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManualDeliveryAddressForm } from "@/components/storefront/address-autocomplete";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("manual checkout delivery address", () => {
  it("accepts structured customer-entered fields without loading Google Places", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "leftover-demo-key");
    vi.stubEnv("VITE_GOOGLE_MAPS_AUTOCOMPLETE_ENABLED", "true");
    const onSelect = vi.fn();

    render(<ManualDeliveryAddressForm onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText("Street address and number"), {
      target: { value: "12 Main Road" },
    });
    fireEvent.change(screen.getByLabelText("Suburb or local area"), {
      target: { value: "Observatory" },
    });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Cape Town" } });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Western Cape" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "7925" } });

    expect(onSelect).toHaveBeenLastCalledWith({
      formattedAddress: "12 Main Road, Observatory, Cape Town, Western Cape, 7925, South Africa",
      addressLine1: "12 Main Road",
      localArea: "Observatory",
      city: "Cape Town",
      province: "Western Cape",
      postalCode: "7925",
      country: "South Africa",
    });
    expect(document.querySelector('script[data-google-places="true"]')).toBeNull();
    expect(screen.getByText(/Copy your address from Google Maps if needed/)).toBeVisible();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("shows field-level errors for missing address components when requested", () => {
    render(<ManualDeliveryAddressForm onSelect={vi.fn()} showValidationErrors />);

    expect(screen.getByText("Street address and number is required.")).toBeVisible();
    expect(screen.getByText("Suburb or local area is required.")).toBeVisible();
    expect(screen.getByText("City is required.")).toBeVisible();
    expect(screen.getByText("Province is required.")).toBeVisible();
    expect(screen.getByText("Postal code is required.")).toBeVisible();
  });
});
