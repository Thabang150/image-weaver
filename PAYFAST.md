# PayFast hosted checkout

The backend creates signed hosted-checkout fields and processes public PayFast ITNs. It does not
render a frontend form or implement frontend return/cancel pages. A real sandbox payment has not
been completed, so this integration is not yet verified.

## Routes and order eligibility

### Create a hosted checkout

`POST /api/v1/orders/:orderId/payfast/checkout`

This route requires an authenticated customer, the session CSRF token, and ownership of the order.
It accepts no payment amount from the browser. An order must be `pending_payment`, have a
`reserved` stock reservation, and have no unresolved (`pending` or `reconciliation`) payment
attempt. The order must also have a selected, persisted Ship Logic shipping quote associated with
its currently verified package and address data. A unique attempt and merchant reference are
persisted transactionally before the response is returned. A failed or cancelled attempt can be
retried while the order and selected quote remain eligible.

The server recalculates each line total from the order's immutable persisted quantity and unit price,
checks each result against the persisted line subtotal, and checks the sum against `subtotalCents`.
The amount is represented as:

```text
productSubtotalCents - discountCents + shippingCents + additionalChargesCents = totalCents
```

There is currently no order discount or other supported charge field, so those components are zero.
Shipping is populated from the selected persisted Ship Logic rate. Checkout verifies the selected
quote belongs to the order and that its parcel/address fingerprint still matches current backend
data. The rate returned by Ship Logic is inclusive of VAT; the backend does not add VAT again.
No browser-supplied fee is used.

The response contains `paymentAttemptId`, `merchantReference`, `amountCents`, `currency`,
`amountBreakdown`, `checkoutUrl`, `method: "POST"`, and signed `fields`. A future storefront must
POST those fields to PayFast. PayFast requires `merchant_key` in the hosted-checkout fields, so that
field is returned and visible to the browser; it is not an account passphrase. The passphrase is
used only by the backend to sign and validate notifications and is never returned. Checkout uses the
configured sandbox/live endpoint. Return/cancel URLs point to the configured `FRONTEND_URL`; those
destinations do not change payment status.

### Public ITN callback

`POST /api/v1/payments/payfast/itn`

The callback accepts `application/x-www-form-urlencoded` and is mounted before session/CSRF
middleware. The exception is limited to this endpoint. It retains the raw body, verifies the
PayFast field-order signature, checks the source address, POSTs the ordered notification fields
without the signature to the environment-matched PayFast validation endpoint, and requires the
exact response `VALID`. It then verifies the configured merchant ID, payment reference, PayFast
transaction ID, status, ZAR currency (if included by PayFast), and exact persisted
amount/payment-attempt currency.

`200 OK` is returned only after the MongoDB transaction commits. A validated `COMPLETE` changes an
eligible order to `paid` and commits its existing stock reservation; inventory is not decremented a
second time. A valid completion received after the order/reservation is no longer eligible is
persisted as `reconciliation` and does not mark the order paid. `FAILED` and `CANCELLED` attempts
are terminal. Repeated identical notifications are idempotent; conflicting notifications are
rejected. A browser return URL is never proof of payment.

The callback source check dynamically resolves the current IPv4 addresses of PayFast's published
service hostnames (`www`, `sandbox`, `w1w`, and `w2w.payfast.co.za`) rather than relying on a
hardcoded CIDR list. Source addresses are taken from Express `req.ip` only with `TRUST_PROXY=true`;
otherwise the socket peer address is used. On Render, enable `TRUST_PROXY=true` so the single trusted
Render proxy hop is handled correctly. No arbitrary forwarded header is read directly. Source
address allowlisting still needs validation against real sandbox ITNs and PayFast's current
deployment behavior.

Customer-owned `GET /api/v1/orders/:orderId` returns the persisted order/payment status, amount,
currency, selected shipping quote and available quote options, PayFast transaction ID, and
timestamps. It does not return signature material, credentials, or reconciliation internals. See
[`SHIPLOGIC.md`](./SHIPLOGIC.md) for provider configuration and the shipping quote flow.

## Environment variables

Configure these in backend `.env` or Render service environment settings only. Do not use
`NEXT_PUBLIC_`/`VITE_` names, commit real credentials, or expose merchant secrets in frontend
configuration.

| Variable | Purpose |
| --- | --- |
| `PAYFAST_MERCHANT_ID` | Merchant ID for the selected PayFast environment |
| `PAYFAST_MERCHANT_KEY` | Merchant key stored in backend configuration and included in the signed PayFast checkout fields, as required by the hosted-checkout protocol |
| `PAYFAST_PASSPHRASE` | Exact account passphrase; set an explicitly empty value only if the account has no passphrase |
| `PAYFAST_MODE` | Explicitly `sandbox` or `live`; there is no default |
| `BACKEND_PUBLIC_URL` | Public HTTPS backend origin; on Render use `https://heathywayssa-backend.onrender.com` |
| `FRONTEND_URL` | HTTPS origin for the future storefront return/cancel destinations |
| `TRUST_PROXY` | Set to `true` on Render; the app trusts one proxy hop |
| `SHIPLOGIC_API_URL` | HTTPS Ship Logic API origin for the configured sandbox/production account |
| `SHIPLOGIC_BEARER_TOKEN` | Backend-only Ship Logic API key sent as a Bearer token |
| `SHIPLOGIC_COLLECTION_*` | Backend-only configured collection company/address fields; see [`SHIPLOGIC.md`](./SHIPLOGIC.md) |

If any PayFast variable is provided, all six PayFast variables (including an explicit
`PAYFAST_PASSPHRASE`, which may be empty) are required. Invalid or partial configuration fails
startup. With no PayFast values configured, checkout responds safely that PayFast is unavailable.
Use separate sandbox and live credentials/settings; never silently switch modes.

`PAYFAST_MODE=sandbox` selects:

- Checkout: `https://sandbox.payfast.co.za/eng/process`
- ITN validation: `https://sandbox.payfast.co.za/eng/query/validate`

`PAYFAST_MODE=live` selects the corresponding `www.payfast.co.za` endpoints.

## PayFast dashboard and Render setup

1. Configure the sandbox merchant ID, merchant key, and the same passphrase (or explicitly empty
   passphrase) in Render. Set `PAYFAST_MODE=sandbox`.
2. Set `BACKEND_PUBLIC_URL=https://heathywayssa-backend.onrender.com` and `TRUST_PROXY=true`.
3. Set `FRONTEND_URL` to the actual storefront HTTPS origin. The backend appends
   `/payment/return?orderId=...` and `/payment/cancel?orderId=...`; those frontend pages are not
   implemented in this repository.
4. Configure the sandbox ITN/notification URL in the PayFast dashboard to exactly:

   `https://heathywayssa-backend.onrender.com/api/v1/payments/payfast/itn`

5. Keep the sandbox credentials and sandbox mode for testing. Only move to live after separate
   live-account configuration and successful sandbox validation.

The checkout signature follows PayFast's hosted-checkout field order, excludes blank optional
fields, and URL-encodes values. ITN signature construction uses the received parameter order and
form encoding, excluding only the final signature field. The server-validation request is a
separate payload: ordered encoded notification fields without the signature, with the configured
passphrase appended according to PayFast's official SDK behavior. Only exact `VALID` is accepted.

## Manual sandbox testing

Use a sandbox customer/order and a non-production database. The order must be owned by the signed-in
customer, `pending_payment`, and have `stockReservationStatus: "reserved"`. It must also have
verified packed-product measurements, a delivery-address local area, and a selected persisted
Ship Logic rate. The seeded catalogue currently has no verified shipping parcel data, so configure
real measurements on a test product before creating an eligible order.

Using HTTPie in PowerShell, authenticate with the existing customer authentication flow first:

```powershell
$API = 'https://heathywayssa-backend.onrender.com/api/v1'
$Session = 'healthywayssa-payfast-sandbox'
$csrf = (http --session=$Session GET "$API/auth/csrf-token" | ConvertFrom-Json).csrfToken
$OrderId = '<customer-owned-pending-payment-order-id>'

$rates = http --session=$Session POST `
  "$API/orders/$OrderId/shipping/quote" "x-csrf-token:$csrf" | ConvertFrom-Json
$rates | ConvertTo-Json -Depth 8
$QuoteId = $rates.rates[0].quoteId
http --session=$Session POST `
  "$API/orders/$OrderId/shipping/quote/$QuoteId/select" "x-csrf-token:$csrf"

$checkout = http --session=$Session --body --json POST `
  "$API/orders/$OrderId/payfast/checkout" "x-csrf-token:$csrf" | ConvertFrom-Json
$checkout | ConvertTo-Json -Depth 8
```

Expected response shape:

```json
{
  "paymentAttemptId": "<attempt-id>",
  "merchantReference": "HW-<order-number>-<attempt-id>",
  "amountCents": 13295,
  "currency": "ZAR",
  "amountBreakdown": {
    "productSubtotalCents": 12345,
    "discountCents": 0,
    "shippingCents": 950,
    "additionalChargesCents": 0,
    "totalCents": 13295
  },
  "checkoutUrl": "https://sandbox.payfast.co.za/eng/process",
  "method": "POST",
  "fields": {
    "merchant_id": "<sandbox-merchant-id>",
    "merchant_key": "<sandbox-merchant-key>",
    "return_url": "https://<storefront>/payment/return?orderId=<order-id>",
    "cancel_url": "https://<storefront>/payment/cancel?orderId=<order-id>",
    "notify_url": "https://heathywayssa-backend.onrender.com/api/v1/payments/payfast/itn",
    "email_address": "<test-customer-email>",
    "m_payment_id": "<merchant-reference>",
    "amount": "132.95",
    "item_name": "Healthy Ways SA <order-number>",
    "item_description": "Order <order-number>",
    "currency": "ZAR",
    "signature": "<signature>"
  }
}
```

The future storefront must POST the returned `fields` to `checkoutUrl` using the returned method.
The `merchant_key` field is required by PayFast and will be visible in the browser as part of the
hosted-checkout submission. Never return or log `PAYFAST_PASSPHRASE`; it remains backend-only.

Before requesting checkout, obtain and select a persisted Ship Logic rate as described in
[`SHIPLOGIC.md`](./SHIPLOGIC.md). Checkout is rejected until a rate has been selected.
Complete payment with a PayFast sandbox buyer account. The buyer return page is not authoritative;
wait for PayFast to send the ITN to the public Render URL. Then query the order:

```powershell
http --session=$Session GET "$API/orders/$OrderId"
```

After successful ITN processing, expect `status: "paid"`, `stockReservationStatus: "committed"`, and
the matching attempt to have `status: "complete"`, `paymentStatus: "COMPLETE"`, and a transaction
ID. Do not forge ITNs or manually mark the order paid. If PayFast accepts a sandbox payment but the
ITN is not processed, inspect the Render logs and the PayFast dashboard before retrying.

Common blockers include incomplete PayFast or Ship Logic environment configuration, missing
verified product parcel data or delivery local area, an order not owned by the customer, an
order/reservation in an ineligible state, an unresolved attempt, an unselected quote, missing
frontend URL, Render proxy configuration, or PayFast source validation rejecting its callback
address. A successful checkout response only creates an attempt; it does not prove payment.

## References

- [PayFast Developer Documentation](https://developers.payfast.co.za/docs)
- [PayFast official PHP SDK — hosted checkout and signature construction](https://github.com/Payfast/payfast-php-sdk/blob/master/lib/Auth.php)
- [PayFast official PHP SDK — ITN validation, server confirmation, and callback processing](https://github.com/Payfast/payfast-php-sdk/blob/master/lib/PaymentIntegrations/Notification.php)
- [PayFast official PHP SDK — custom hosted checkout fields](https://github.com/Payfast/payfast-php-sdk/blob/master/lib/PaymentIntegrations/CustomIntegration.php)
