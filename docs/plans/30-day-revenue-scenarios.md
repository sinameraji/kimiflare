# KimiFlare — 30-Day Revenue vs. Spend Scenarios

> Based on the pricing in `stripe-payments-referrals-plan.md` (Option B: OpenCode-style caps).  
> Goal: estimate first-month revenue and model COGS under pessimistic / okay / optimistic signup assumptions.

---

## 1. Pricing assumed

| Plan | Monthly price | Included usage | Overage |
|------|--------------:|---------------:|---------|
| Free trial | $0 | $5 (~10M tokens) | — |
| Starter | $10 | $20 (~50M tokens) | Credits at cost + 20% |
| Pro | $25 | $60 (~150M tokens) | Credits at cost + 10% |
| Power | $99 | $300 (~750M tokens) | Credits at cost |
| Credit packs | $2.50 / $10 / $18 | 10M / 50M / 100M tokens | — |

**Referral rewards:** inviter $5 credit, invitee $3 credit.

---

## 2. Core assumptions

### 2.1 Signups and conversion

| Scenario | 30-day signups | Trial→paid conversion | Paid users |
|----------|---------------:|----------------------:|-----------:|
| Pessimistic | 50 | 5% | 2–3 |
| Okay | 150 | 12% | 18 |
| Optimistic | 500 | 25% | 125 |

### 2.2 Paid plan mix

Based on the historical cohort distribution (most users are light; a few are heavy):

| Plan | Share | Why |
|------|------:|-----|
| Starter | 70% | Light/moderate usage (<$20/mo model cost) |
| Pro | 25% | Regular usage ($20–$60/mo model cost) |
| Power | 5% | Heavy usage (>$60/mo model cost) |

### 2.3 Usage per paid plan

Derived from the last free cohort (43 active users, 7 days, $495 cost).  
Monthly usage = weekly usage × 4.3.

| Plan | Avg monthly model cost | Subscription revenue | Gross margin before credits |
|------|-----------------------:|---------------------:|----------------------------:|
| Starter | ~$7 | $10 | +$3 |
| Pro | ~$38 | $25 | –$13 |
| Power | ~$220 | $99 | –$121 |

**Important:** the plan as written is **loss-making on Pro and Power users** if they use anything close to their allowance. The $25 Pro plan covers only ~$25 of model cost; the $99 Power plan covers only ~$99 of model cost. Heavy users burn far more.

### 2.4 Credit top-ups

We assume some paid users exceed their allowance and buy credits:

| Plan | % exceeding allowance | Avg credit purchase | Markup | Net credit revenue after COGS |
|------|----------------------:|--------------------:|-------:|------------------------------:|
| Starter | 15% | $8 | +20% | +$1.33 per buyer |
| Pro | 25% | $35 | +10% | +$3.18 per buyer |
| Power | 40% | $120 | 0% | $0 per buyer |

Power users get credits at cost, so top-ups break even (they just stop the bleeding).

### 2.5 Referrals

- 10% of signups arrive via referral.
- Each referral costs us $5 (inviter) + $3 (invitee) = **$8 in credits**.
- These credits are redeemed as model usage, so they directly add to COGS.

### 2.6 Stripe fees

- 2.9% + $0.30 per transaction.
- Subscriptions are one transaction per paid user per month.
- Credit top-ups are one transaction per buyer.

### 2.7 Free-trial COGS

- Every signup gets $5 of credits (~10M tokens).
- This is pure cost until they convert.

---

## 3. Scenario calculations

### 3.1 Pessimistic — 50 signups, 5% conversion

| Line item | Calculation | Amount |
|-----------|-------------|--------:|
| Signups | 50 | — |
| Paid users | 50 × 5% = 2.5 → round to 3 | 3 |
| Starter (70%) | 2 users × $10 | $20 |
| Pro (25%) | 1 user × $25 | $25 |
| Power (5%) | 0 users | $0 |
| **Gross subscription revenue** | | **$45** |
| Credit top-ups | Starter: 2 × 15% × $8 = $2.40; Pro: 1 × 25% × $35 = $8.75 | $11.15 |
| **Gross revenue** | | **$56.15** |
| Free-trial COGS | 50 × $5 | –$250 |
| Paid-user model COGS | Starter: 2 × $7; Pro: 1 × $38; Power: 0 | –$52 |
| Credit COGS (buyers only) | Starter: $2.40/1.2 = $2.00; Pro: $8.75/1.1 = $7.95 | –$9.95 |
| Referral credits COGS | 50 × 10% × $8 | –$40 |
| **Total model COGS** | | **–$351.95** |
| Net before Stripe | $56.15 – $351.95 | **–$295.80** |
| Stripe fees | 3 subs × $0.30 + 2.9% × $56.15 | –$2.53 |
| **Net after Stripe** | | **–$298.33** |

**Interpretation:** With only 3 paid users out of 50, free-trial costs dominate. You lose ~$300 in the first month.

---

### 3.2 Okay — 150 signups, 12% conversion

| Line item | Calculation | Amount |
|-----------|-------------|--------:|
| Signups | 150 | — |
| Paid users | 150 × 12% = 18 | 18 |
| Starter (70% = 13) | 13 × $10 | $130 |
| Pro (25% = 4) | 4 × $25 | $100 |
| Power (5% = 1) | 1 × $99 | $99 |
| **Gross subscription revenue** | | **$329** |
| Credit top-ups | Starter: 13×15%×$8=$15.60; Pro: 4×25%×$35=$35; Power: 1×40%×$120=$48 | $98.60 |
| **Gross revenue** | | **$427.60** |
| Free-trial COGS | 150 × $5 | –$750 |
| Paid-user model COGS | Starter: 13×$7=$91; Pro: 4×$38=$152; Power: 1×$220=$220 | –$463 |
| Credit COGS | Starter: $15.60/1.2=$13; Pro: $35/1.1=$31.82; Power: $48/1=$48 | –$92.82 |
| Referral credits COGS | 150 × 10% × $8 | –$120 |
| **Total model COGS** | | **–$1,425.82** |
| Net before Stripe | $427.60 – $1,425.82 | **–$998.22** |
| Stripe fees | 18 subs × $0.30 + 2.9% × $427.60 | –$17.80 |
| **Net after Stripe** | | **–$1,016.02** |

**Interpretation:** Even with 18 paid users, the generous allowances and free-trial credits push you ~$1,000 in the red. The single Power user alone costs ~$121 more than their subscription.

---

### 3.3 Optimistic — 500 signups, 25% conversion

| Line item | Calculation | Amount |
|-----------|-------------|--------:|
| Signups | 500 | — |
| Paid users | 500 × 25% = 125 | 125 |
| Starter (70% = 88) | 88 × $10 | $880 |
| Pro (25% = 31) | 31 × $25 | $775 |
| Power (5% = 6) | 6 × $99 | $594 |
| **Gross subscription revenue** | | **$2,249** |
| Credit top-ups | Starter: 88×15%×$8=$105.60; Pro: 31×25%×$35=$271.25; Power: 6×40%×$120=$288 | $664.85 |
| **Gross revenue** | | **$2,913.85** |
| Free-trial COGS | 500 × $5 | –$2,500 |
| Paid-user model COGS | Starter: 88×$7=$616; Pro: 31×$38=$1,178; Power: 6×$220=$1,320 | –$3,114 |
| Credit COGS | Starter: $105.60/1.2=$88; Pro: $271.25/1.1=$246.59; Power: $288/1=$288 | –$622.59 |
| Referral credits COGS | 500 × 10% × $8 | –$400 |
| **Total model COGS** | | **–$6,636.59** |
| Net before Stripe | $2,913.85 – $6,636.59 | **–$3,722.74** |
| Stripe fees | 125 subs × $0.30 + 2.9% × $2,913.85 | –$122.00 |
| **Net after Stripe** | | **–$3,844.74** |

**Interpretation:** Strong traction (500 signups, 125 paid) still loses ~$3,800/month under the current plan. The unit economics do not work at scale because Pro/Power allowances are underpriced relative to COGS.

---

## 4. Summary table

| Scenario | Signups | Paid users | Gross revenue | Model COGS | Stripe fees | **Net (30 days)** |
|----------|--------:|-----------:|--------------:|-----------:|------------:|------------------:|
| Pessimistic | 50 | 3 | $56 | –$352 | –$3 | **–$298** |
| Okay | 150 | 18 | $428 | –$1,426 | –$18 | **–$1,016** |
| Optimistic | 500 | 125 | $2,914 | –$6,637 | –$122 | **–$3,845** |

---

## 5. Why every scenario is red

The plan as written has a **negative gross margin** on the two most expensive user tiers:

| Plan | You charge | Average model cost | Loss per user |
|------|-----------:|-------------------:|--------------:|
| Pro | $25 | ~$38 | –$13 |
| Power | $99 | ~$220 | –$121 |

Only **Starter** users are profitable on average, and only because most use far less than their $20 allowance.

The free trial ($5 per signup) and referral credits ($8 per referral) add fixed costs that scale with signups, not revenue.

---

## 6. Sustainability-adjusted pricing

To reach break-even or profit, the allowances must be closer to the subscription price. Two ways to fix it:

### Option A — Smaller allowances (keep low prices)

| Plan | Price | Includes | Overage |
|------|------:|----------|---------|
| Starter | $10 | $8 usage (~20M tokens) | +25% |
| Pro | $25 | $22 usage (~55M tokens) | +20% |
| Power | $99 | $90 usage (~220M tokens) | +10% |

This is less sexy but covers COGS. Estimated 30-day net at optimistic scale: **~+$200 to +$500**.

### Option B — Higher prices (keep generous allowances)

| Plan | Price | Includes |
|------|------:|----------|
| Starter | $15 | $20 usage |
| Pro | $45 | $60 usage |
| Power | $249 | $300 usage |

This matches the value proposition better but moves away from the $10 entry point. Estimated 30-day net at optimistic scale: **~+$800 to +$1,500**.

### Option C — Quota/turn-based (Cursor/Windsurf style)

Replace token allowances with **agent-turn quotas**, which are cheaper to fulfill and easier to market:

| Plan | Price | Includes |
|------|------:|----------|
| Starter | $10 | 100 agent turns/mo |
| Pro | $25 | 300 agent turns/mo |
| Power | $99 | 1,500 agent turns/mo |

This caps COGS per user tightly. Estimated 30-day net at optimistic scale: **~+$1,000 to +$2,000**.

---

## 7. Recommendation

**Do not launch with Option B as written.** It loses money at every scale because Pro and Power users cost more than they pay.

**Best path:** combine the marketing appeal of Option B with the COGS control of Option C:

- Keep **$10 Starter** but limit it to ~20M tokens or 100 agent turns.
- Keep **$25 Pro** but limit it to ~$25 of model usage or 300 turns.
- Introduce **Power at $149–$199** with a real unlimited/very-high quota.
- Offer **credit top-ups at a meaningful markup** (cost + 20–30%) so power users truly pay their own way.

If you want to launch fast and iterate, the safest first-month pricing is:

| Plan | Price | Includes | Overage |
|------|------:|----------|---------|
| Trial | $0 | $3 (~6M tokens) | — |
| Starter | $10 | $8 usage | +25% |
| Pro | $25 | $22 usage | +20% |
| Power | $149 | $120 usage | +10% |

This gives a realistic shot at breaking even in the Okay scenario and being profitable in the Optimistic scenario.

---

## 8. Open questions

1. Are you okay moving away from the $10 = $20 usage framing?
2. Do you want to cap usage by tokens, dollar value, or agent turns?
3. Should the free trial require a card up front to reduce trial farming?
4. Are you willing to lose money in month 1 to gather conversion data?
