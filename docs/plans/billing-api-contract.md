# KimiFlare Cloud — Billing API Contract

> This doc defines the server endpoints the KimiFlare CLI expects from the managed KimiFlare Cloud worker.  
> Implement these in the Cloudflare Worker that backs `api.kimiflare.com`.

---

## Authentication

All billing endpoints require the same auth as the rest of the Cloud API:

- Header: `Authorization: Bearer <jwt>`
- Optional header: `X-Device-ID: <device-id>`

The JWT is issued by the worker during device-code auth and stored in `~/.config/kimiflare/cloud.json`.

---

## Endpoints

### `GET /v1/billing/status`

Returns the user's current subscription status.

**Response 200:**
```json
{
  "status": "inactive",
  "plan": null,
  "current_period_end": null
}
```

`status` enum: `inactive | active | past_due | canceled`

- `inactive` — never subscribed, or subscription ended.
- `active` — currently paid and in good standing.
- `past_due` — subscription exists but latest invoice failed.
- `canceled` — subscription canceled, still active until period end.

`plan` is an opaque string like `"pro"` or `null`.

`current_period_end` is an ISO timestamp or `null`.

---

### `POST /v1/billing/checkout`

Creates a Stripe Checkout session for the user and returns the URL to complete payment.

**Request body:**
```json
{
  "price_id": "price_xxx" // optional; worker can default to the canonical Pro price
}
```

**Response 200:**
```json
{
  "url": "https://checkout.stripe.com/pay/cs_test_xxx"
}
```

**Response 4xx/5xx:**
```json
{
  "error": "human readable message"
}
```

Server-side responsibilities:
1. Look up or create a Stripe Customer for the authenticated user.
2. Create a Checkout Session in **subscription mode** with the requested price.
3. Store `customer_id` and `subscription_id` on the user row in D1.
4. Return the Checkout URL.

---

### `POST /v1/billing/portal`

Creates a Stripe Customer Portal session so the user can manage/cancel their subscription.

**Response 200:**
```json
{
  "url": "https://billing.stripe.com/session/test_xxx"
}
```

---

## Webhooks (server-to-Stripe)

The worker must expose a Stripe webhook endpoint (e.g., `POST /v1/billing/webhook`) and handle these events:

### `checkout.session.completed`

- Mark the user's subscription as `active`.
- Store `stripe_subscription_id` and `stripe_customer_id`.
- Provision the paid usage allowance.

### `invoice.paid`

- Keep subscription `active`.
- Reset/extend the paid usage allowance for the new period.

### `invoice.payment_failed`

- Mark subscription as `past_due`.
- Optionally downgrade to free tier immediately or after a grace period.

### `customer.subscription.deleted`

- Mark subscription as `canceled`.
- Revert to free tier at period end.

---

## Usage enforcement

The worker already enforces the free token cap. With billing, the enforcement logic becomes:

```
if user.subscription_status == 'active':
    allow up to PAID_ALLOWANCE tokens
else:
    allow up to FREE_TIER_TOKENS
    if exceeded:
        return HTTP 402 with message prompting /upgrade
```

Recommended allowances for the 21-day experiment:

| Tier | Tokens | Notes |
|------|--------|-------|
| Free | 5,000,000 input tokens | Existing cap |
| Pro  | 50,000,000 input tokens | ~$20 of model usage at K2.7-code rates |

---

## D1 schema additions

Add these columns to the `users` table (or create a `subscriptions` table):

```sql
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN subscription_plan TEXT;
ALTER TABLE users ADD COLUMN current_period_end INTEGER; -- unix seconds
```

---

## Stripe products

For the experiment, create one product:

| Field | Value |
|-------|-------|
| Product name | KimiFlare Pro |
| Price | $10 USD / month |
| Price ID | `price_xxx` (store in worker env) |

No trials, no coupons required for the first version. The CLI can pass an optional `price_id` if you want to A/B test pricing later.
