# ShipLogic storefront checkout and fulfilment

The storefront requests and selects a shipping rate before creating an order. Backend payment,
shipment booking, tracking, cancellation and waybill behavior is documented in the backend
[`docs/SHIPLOGIC.md`](../heathywayssa-backend/docs/SHIPLOGIC.md) and official-doc reference. This
environment has not contacted ShipLogic or booked a shipment.

## Configuration

Set these values in the backend environment only:

| Variable | Purpose |
| --- | --- |
| `SHIPLOGIC_API_URL` | Explicit HTTPS API origin. Sandbox: `https://api.shiplogic.com`; production: `https://api.portal.thecourierguy.co.za`, as documented by ShipLogic. |
| `SHIPLOGIC_BEARER_TOKEN` | Ship Logic API key sent only in the backend `Authorization: Bearer ...` request header. |
| `SHIPLOGIC_COLLECTION_COMPANY` | Collection business name; defaults to `Healthy Ways SA`. |
| `SHIPLOGIC_COLLECTION_STREET_ADDRESS` | Collection street address. |
| `SHIPLOGIC_COLLECTION_LOCAL_AREA` | Collection suburb/local area. |
| `SHIPLOGIC_COLLECTION_CITY` | Collection city. |
| `SHIPLOGIC_COLLECTION_ZONE` | Collection province/zone. |
| `SHIPLOGIC_COLLECTION_POSTAL_CODE` | Collection postal code. |
| `SHIPLOGIC_COLLECTION_COUNTRY_CODE` | Two-letter country code; currently `ZA`. |
| `SHIPLOGIC_COLLECTION_CONTACT_NAME` | Collection contact name, required to book a paid order. |
| `SHIPLOGIC_COLLECTION_CONTACT_EMAIL` | Collection contact email, or configure a mobile number. |
| `SHIPLOGIC_COLLECTION_CONTACT_MOBILE` | Collection contact mobile number, or configure an email. |

If the URL or token is missing, other backend APIs still start but rate requests and booking are
unavailable. The API URL is an origin. Credentials must remain server-side.

## Trusted data prerequisites

The rate request uses the order's persisted delivery address and product IDs/quantities, plus the
configured backend collection address. The delivery address must have a `localArea` as well as the
existing street, city, province, postal code, and South African country fields. Older saved
addresses and orders without `localArea` remain readable, but cannot be quoted until the customer
adds that locality before creating a new order.

Each product must have an administrator-configured `shippingParcel`:

```json
{
  "lengthCm": 30,
  "widthCm": 20,
  "heightCm": 10,
  "weightGrams": 250,
  "verified": true
}
```

The values must be measurements of the actual packed shipping unit, not approximate bottle/product
metadata. The administrator update endpoint is `PATCH /api/v1/admin/products/:productId`; its
request schema accepts `shippingParcel` as above, or `null` to remove it. Approximate packaging
estimates do not satisfy this requirement. The backend currently represents each ordered unit as
one parcel using that product's verified packed-unit measurements. For quantity 3, it submits
three parcels. Ensure that parcel measurement is appropriate for each separately packed unit; a
combined-cart packing rule is not implemented.

For example, after an administrator has measured the actual package, the admin API request uses:

```json
{
  "shippingParcel": {
    "lengthCm": 12,
    "widthCm": 8,
    "heightCm": 5,
    "weightGrams": 250,
    "verified": true
  }
}
```

These numbers are illustrative only and must be replaced with measured data. Customer address
records accept an optional `localArea` field at `POST /api/v1/users/me/addresses` and
`PATCH /api/v1/users/me/addresses/:addressId`. Update the saved address before creating an order;
existing order address snapshots remain unchanged.

Collection and delivery addresses are validated server-side. The current delivery model has no
coordinate fields, so `lat` and `lng` are omitted. Only South African delivery country values `ZA`
and `South Africa` are accepted for quotes; the Ship Logic payload uses `ZA`.

## Quote-before-order checkout flow

The customer checkout sends the saved `addressId` to `POST /api/v1/shipping/quote`, displays the
returned rates, then selects the chosen rate through
`POST /api/v1/shipping/quote/:quoteId/select` using that rate's `quoteId` as `rateId`. The backend
binds the quote to the authenticated customer, current cart, address and verified parcel data.

Only after a rate is selected does checkout create an order, sending `addressId` and the selected
`shippingQuoteId` to `POST /api/v1/orders` with the existing `Idempotency-Key`. The backend
revalidates the quote and stock before reserving inventory or clearing the cart. The browser never
supplies an authoritative price or provider service identifier.

Rates expire after the provider-documented five-minute service-level lifetime. Checkout handles
quote expiry or changed rates by requiring a refreshed selection; it must not create an order with
an invented zero-shipping fallback.

## Legacy existing-order quote and selection API

The order-scoped endpoints below remain for existing pending orders and recovery; new checkout uses
the cart-scoped flow above.

Both endpoints require an authenticated customer, order ownership, customer role, and the normal
session CSRF token. Neither accepts a price, dimensions, weight, provider service identifier, or
total from the browser.

### Request current rates

`POST /api/v1/orders/:orderId/shipping/quote`

Send an empty JSON object. The backend sends `POST {SHIPLOGIC_API_URL}/rates` with JSON:

```json
{
  "collection_address": {
    "type": "business",
    "company": "Healthy Ways SA",
    "street_address": "Configured collection address",
    "local_area": "Configured collection area",
    "city": "Configured collection city",
    "zone": "Configured collection province",
    "country": "ZA",
    "code": "Configured collection postal code"
  },
  "delivery_address": {
    "type": "residential",
    "street_address": "Persisted street address",
    "local_area": "Persisted delivery locality",
    "city": "Persisted city",
    "zone": "Persisted province",
    "country": "ZA",
    "code": "Persisted postal code"
  },
  "parcels": [
    {
      "submitted_length_cm": 30,
      "submitted_width_cm": 20,
      "submitted_height_cm": 10,
      "submitted_weight_kg": 0.25
    }
  ]
}
```

The example dimensions above are illustrative only and must not be copied as product data unless
they are accurate measurements. No `declared_value`, minimum collection date, or minimum delivery
date is submitted; those optional request fields are not needed by the current flow.

The response adapter reads `rates` and `service_days` from the provider response. It requires each
usable rate to contain `rate` and `service_level.id`, `service_level.code`, and
`service_level.name`. It converts the decimal `rate` to integer cents using decimal parsing and uses
that amount as the shipping total. `rate` already includes VAT; the backend does not add VAT,
surcharges, extras, or adjustments to it. Valid `rate_excluding_vat` and `base_rate` values are
stored for information only. The `surcharges`, `rate_adjustments`,
`time_based_rate_adjustments`, and `extras` fields are retained as bounded, sanitized JSON when
well-formed; they are informational only and never added to `rate`. Service-level
descriptions/dates/cut-off times, service-day arrays, and actual/charged/volumetric weights are
retained when well-formed.

The supplied provider response shape is `message`, `service_days.collection_service_days`,
`service_days.delivery_service_days`, and `rates` (`null` or an array). A rate may contain `rate`,
`rate_excluding_vat`, `base_rate`, `service_level`, `surcharges`, `rate_adjustments`,
`time_based_rate_adjustments`, `extras`, `charged_weight`, `actual_weight`, and
`volumetric_weight`. `service_level` may contain `id`, `code`, `name`, `description`,
`delivery_date_from`, `delivery_date_to`, `collection_date`, `collection_cut_off_time`, `vat_type`,
and `insurance_disabled`. Only the fields with supported safe normalization are exposed; unknown
or malformed optional fields are omitted. The response does not include a currency field, so rates
are treated as ZAR for this configured South African store. Confirm that currency assumption with
the provider account before using a non-South-African account.

The returned API response contains an internally generated `quoteId` for each persisted choice,
the service level, `rateCents`, currency (`ZAR` for this South African store), and relevant provider
dates/weights. Provider IDs/codes and amounts are not accepted back as authoritative selection
input.

Example backend response:

```json
{
  "orderId": "<order-id>",
  "currency": "ZAR",
  "rates": [
    {
      "quoteId": "<internal-order-scoped-quote-id>",
      "serviceLevel": {
        "id": "17",
        "code": "EXAMPLE",
        "name": "Provider service",
        "deliveryDateFrom": "2026-10-27",
        "deliveryDateTo": "2026-10-29"
      },
      "rateCents": 12500,
      "rateExcludingVatCents": 10870,
      "baseRateCents": 10000,
      "currency": "ZAR",
      "retrievedAt": "2026-10-26T16:00:00.000Z"
    }
  ],
  "selectedQuote": null
}
```

The values above are illustrative, not provider rates. The service-level ID and `quoteId` formats
are strings in the backend API; the former is retained from Ship Logic, while the latter is an
internal MongoDB identifier.

If Ship Logic returns `rates: null` or an empty array, the backend clears previously persisted
choices and returns `422` with a no-rates message. A success message without an actual valid rate
does not create a quote. Upstream raw error bodies and authorization details are not returned or
logged; timeout/network failures and rate limits return safe service-unavailable responses.

### Select a returned rate

`POST /api/v1/orders/:orderId/shipping/quote/:quoteId/select`

Use a `quoteId` from the preceding response. The internal ID is scoped to that order; an ID from
another order is rejected. Selection persists the service/amount and updates `order.totalCents` to
the product subtotal plus selected shipping. Requesting rates again replaces the rate choices and
clears the prior selection. A selected quote can be used by checkout only while the order is
`pending_payment`, stock is reserved, no payment attempt is unresolved, and the stored parcel and
address fingerprint still matches current backend data.

The static rates response has no provider quote identifier or expiry timestamp. The shipment-
creation error documentation says a selected `service_level_id` expires when its rate revision is
more than five minutes old; the backend expires rate options accordingly and refreshes the selected
service and amount before payment and booking.

## PayFast integration

PayFast checkout requires a selected persisted Ship Logic rate. Its amount breakdown is:

```text
productSubtotalCents - discountCents + shippingCents + additionalChargesCents = totalCents
```

The existing order has no supported discount or other charge fields, so those components remain
zero. `shippingCents` comes only from the selected provider rate stored on the order. The exact
integer-cent total is saved in the payment attempt, converted to ZAR for the hosted checkout, and
compared with the ITN amount. A browser return/cancel URL does not change payment status.

See [`PAYFAST.md`](./PAYFAST.md) for PayFast configuration and sandbox payment instructions.

## Manual sandbox testing

Before quoting:

1. Configure the sandbox `SHIPLOGIC_API_URL` and sandbox bearer token in the backend environment.
2. Set verified `shippingParcel` values on every ordered product through the admin product endpoint.
3. Add `localArea` to the customer's saved address using `PATCH /api/v1/users/me/addresses/:addressId`
   or include it when creating a saved address. New orders snapshot the selected saved address,
   including `localArea`.
4. Obtain a CSRF token and preserve the customer session as for other authenticated writes.

PowerShell with HTTPie, after customer login and creation of `$API`, `$Session`, `$csrf`, and
`$AddressId`:

```powershell
$quote = http --session=$Session --body --json POST `
  "$API/shipping/quote" "x-csrf-token:$csrf" addressId="$AddressId" | ConvertFrom-Json
$quote | ConvertTo-Json -Depth 8

$quoteId = $quote.quoteId
$rateId = $quote.rates[0].quoteId
$selected = http --session=$Session --body --json POST `
  "$API/shipping/quote/$quoteId/select" "x-csrf-token:$csrf" rateId="$rateId" | ConvertFrom-Json
$selected | ConvertTo-Json -Depth 8
```

Create an order with `$quoteId` as `shippingQuoteId`, then request
`POST /api/v1/orders/:orderId/payfast/checkout` as shown in
[`PAYFAST.md`](./PAYFAST.md), submit the returned signed fields to the PayFast sandbox URL from the
future storefront, complete payment with a sandbox buyer, and confirm the resulting order using
`GET /api/v1/orders/:orderId`. A successful quote or checkout response is not proof of a completed
payment; the PayFast ITN must be delivered and validated.

Common blockers include missing Ship Logic API configuration, no returned rates, missing
`localArea`, unconfigured or approximate product measurements, invalid postal/address data, an
ineligible order, or a Ship Logic API/network/rate-limit error.
