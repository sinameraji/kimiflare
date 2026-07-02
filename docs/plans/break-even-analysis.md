# KimiFlare — What It Takes to Break Even in Month 1

> Companion to `30-day-revenue-scenarios.md`.  
> We start from the current Option B plan and show which levers get each scenario to ≥$0 net.

---

## 1. Baseline (current Option B plan)

| Scenario | Signups | Paid users | Net (30 days) |
|----------|--------:|-----------:|--------------:|
| Pessimistic | 50 | 3 | **–$298** |
| Okay | 150 | 18 | **–$1,016** |
| Optimistic | 500 | 125 | **–$3,845** |

The losses come from four places:

1. **Free trial COGS** — $5 given to every signup.
2. **Referral credits** — $8 per referred signup.
3. **Pro users** — charged $25, cost ~$38 on average.
4. **Power users** — charged $99, cost ~$220 on average.

Only **Starter** users are profitable on average ($10 revenue vs. ~$7 cost).

---

## 2. Single-lever changes

### 2.1 Eliminate the free trial entirely

If every new user must pay before using anything:

| Scenario | Savings | New net |
|----------|--------:|--------:|
| Pessimistic | $250 | **–$48** |
| Okay | $750 | **–$266** |
| Optimistic | $2,500 | **–$1,345** |

**Verdict:** Helps, but does not fix the Pro/Power unit economics. Not enough alone.

---

### 2.2 Eliminate referral rewards

| Scenario | Savings | New net |
|----------|--------:|--------:|
| Pessimistic | $40 | **–$258** |
| Okay | $120 | **–$896** |
| Optimistic | $400 | **–$3,445** |

**Verdict:** Minor lever. Referrals are not the main problem.

---

### 2.3 Reduce free trial to $1 (~2M tokens)

| Scenario | Savings | New net |
|----------|--------:|--------:|
| Pessimistic | $200 | **–$98** |
| Okay | $600 | **–$416** |
| Optimistic | $2,000 | **–$1,845** |

**Verdict:** A cheap trial still lets users try the product but cuts losses significantly.

---

### 2.4 Fix Pro pricing to break even

Pro users currently lose ~$13/user on average. To break even on Pro alone, the Pro plan must cover the $38 average model cost.

| Pro price needed | Includes |
|-----------------:|----------|
| **$38/mo** | $38 usage (~95M tokens) |
| **$45/mo** | $38 usage + small margin |

If we keep the $60 allowance but price at cost:

| Scenario | Extra Pro revenue | New net |
|----------|------------------:|--------:|
| Pessimistic | 1 user × $13 = $13 | **–$285** |
| Okay | 4 users × $13 = $52 | **–$964** |
| Optimistic | 31 users × $13 = $403 | **–$3,442** |

**Verdict:** Fixing Pro alone is not enough because Power users lose far more.

---

### 2.5 Fix Power pricing to break even

Power users currently lose ~$121/user on average. To break even on Power alone:

| Power price needed | Includes |
|-------------------:|----------|
| **$220/mo** | $220 usage (~550M tokens) |
| **$249/mo** | $220 usage + margin |

If we raise Power from $99 to $220:

| Scenario | Extra Power revenue | New net |
|----------|--------------------:|--------:|
| Pessimistic | 0 users | **–$298** |
| Okay | 1 user × $121 = $121 | **–$895** |
| Optimistic | 6 users × $121 = $726 | **–$3,119** |

**Verdict:** Big impact in the Optimistic scenario, but still not enough alone.

---

### 2.6 Reduce Power users' cost (cheaper model or hard caps)

If we cap Power users at $99 of model cost per month (i.e., the subscription price equals the cost ceiling):

| Scenario | Power cost saved | New net |
|----------|-----------------:|--------:|
| Pessimistic | $0 | **–$298** |
| Okay | 1 × ($220–$99) = $121 | **–$895** |
| Optimistic | 6 × ($220–$99) = $726 | **–$3,119** |

This is the same financial effect as raising Power price to $220. The difference is user experience: a hard cap stops them instead of charging more.

**Verdict:** Necessary, but must be paired with other changes.

---

## 3. Combined-lever scenarios that break even

### Scenario A — Pessimistic (50 signups, 3 paid)

To break even, we need to close a **$298** gap.

| Change | Impact | Running net |
|--------|--------|------------:|
| Baseline | — | –$298 |
| Reduce trial to $1 | +$200 | –$98 |
| Eliminate referrals | +$40 | –$58 |
| Raise Power to $220 | +$0 (no Power users) | –$58 |
| Raise Pro to $38 | +$13 | **–$45** |
| Raise Starter to $12 | +$4 | **–$41** |

Even with all of the above, Pessimistic still loses ~$41. The only way to fully break even at this scale is to **eliminate the free trial entirely**:

| Change | Impact | Running net |
|--------|--------|------------:|
| Baseline | — | –$298 |
| Eliminate free trial | +$250 | –$48 |
| Eliminate referrals | +$40 | **–$8** |
| Raise Pro to $38 | +$13 | **+$5** |

**Conclusion for Pessimistic:** Break-even requires no free trial, no referrals, and Pro priced at cost. This is basically a paid-only product.

---

### Scenario B — Okay (150 signups, 18 paid)

To break even, close a **$1,016** gap.

| Change | Impact | Running net |
|--------|--------|------------:|
| Baseline | — | –$1,016 |
| Reduce trial to $1 | +$600 | –$416 |
| Eliminate referrals | +$120 | –$296 |
| Raise Power to $220 | +$121 | –$175 |
| Raise Pro to $45 | +$68 (4 users × $17) | **–$107** |
| Raise Starter to $15 | +$65 (13 users × $5) | **–$42** |

Still slightly red. Add one more change:

| Change | Impact | Running net |
|--------|--------|------------:|
| Previous | — | –$42 |
| Reduce trial to $0 | +$150 | **+$108** |

**Conclusion for Okay:** Break-even requires a very small or no free trial, no referral rewards, Pro at $45, Power at $220, and Starter at $15.

---

### Scenario C — Optimistic (500 signups, 125 paid)

To break even, close a **$3,845** gap.

| Change | Impact | Running net |
|--------|--------|------------:|
| Baseline | — | –$3,845 |
| Reduce trial to $1 | +$2,000 | –$1,845 |
| Eliminate referrals | +$400 | –$1,445 |
| Raise Power to $220 | +$726 | –$719 |
| Raise Pro to $45 | +$620 (31 × $20) | –$99 |
| Raise Starter to $15 | +$440 (88 × $5) | **+$341** |

**Conclusion for Optimistic:** Break-even is achievable with a $1 trial, no referrals, Pro at $45, Power at $220, and Starter at $15.

---

## 4. The "minimum viable pricing" to break even

Across all three scenarios, the smallest set of changes that gets every scenario to ≥$0 is:

| Plan | Current | Break-even price |
|------|--------:|-----------------:|
| Free trial | $5 | **$0 or $1** |
| Starter | $10 | **$15** |
| Pro | $25 | **$45** |
| Power | $99 | **$220** |
| Referrals | $8/referral | **Disabled or delayed** |

With this pricing:

| Scenario | Signups | Paid users | **Net** |
|----------|--------:|-----------:|--------:|
| Pessimistic | 50 | 3 | **+$5** |
| Okay | 150 | 18 | **+$108** |
| Optimistic | 500 | 125 | **+$341** |

This is technically break-even but leaves almost no margin for churn, refunds, support, or infrastructure costs beyond model spend.

---

## 5. A more realistic profitable pricing

To actually make money, add a 20–30% gross margin on top of COGS:

| Plan | Price | Includes | Margin |
|------|------:|----------|--------|
| Free trial | $0 | $1 (~2M tokens) | — |
| Starter | **$12** | $8 usage | ~33% |
| Pro | **$55** | $38 usage | ~31% |
| Power | **$279** | $220 usage | ~21% |
| Referrals | $3 inviter / $1 invitee | — | low cost |

Projected net:

| Scenario | Signups | Paid users | **Net** |
|----------|--------:|-----------:|--------:|
| Pessimistic | 50 | 3 | **+$40** |
| Okay | 150 | 18 | **+$520** |
| Optimistic | 500 | 125 | **+$2,800** |

---

## 6. Alternative: keep low prices but cap usage tightly

Instead of raising prices, keep the attractive $10/$25/$99 prices but make the included allowances much smaller:

| Plan | Price | Includes | Overage |
|------|------:|----------|---------|
| Starter | $10 | **$8 usage** (~20M tokens) | +25% |
| Pro | $25 | **$22 usage** (~55M tokens) | +20% |
| Power | $99 | **$90 usage** (~220M tokens) | +10% |

This is the same economics as raising prices, but framed as "cheap plan + pay for what you use." Projected net:

| Scenario | Signups | Paid users | **Net** |
|----------|--------:|-----------:|--------:|
| Pessimistic | 50 | 3 | **+$5** |
| Okay | 150 | 18 | **+$150** |
| Optimistic | 500 | 125 | **+$900** |

This is the most honest version of the current plan and still competitive with OpenCode Go ($10 for $60 cap is an outlier we cannot match with Kimi K2.7-code).

---

## 7. The fastest path to not losing money

If you want to launch quickly and avoid losses, do all of these together:

1. **Cut the free trial to $1** (or require a $1 auth hold).
2. **Pause referral rewards** until unit economics are proven.
3. **Cap Starter at $8 of usage** for $10/mo.
4. **Cap Pro at $22 of usage** for $25/mo.
5. **Raise Power to $149** and cap at $120 of usage, or keep $99 and cap at $80.
6. **Add a $5/mo "Light" plan** with $4 of usage for very casual users.

With these changes, even the Pessimistic scenario is close to break-even, and Okay/Optimistic are profitable.

---

## 8. If you refuse to change prices or allowances

The only remaining levers are:

1. **Dramatically increase conversion** — e.g., 50% of signups pay.
2. **Dramatically reduce COGS** — switch to Kimi K2.5 ($0.55/M input, $2.19/M output) or another cheaper model as the default.
3. **Charge for the free trial** — e.g., $5 one-time signup fee that becomes credit.

### 8.1 What conversion rate is needed?

Holding everything else constant, the conversion rate needed to break even:

| Scenario | Current conversion | Break-even conversion |
|----------|-------------------:|----------------------:|
| Pessimistic | 5% | **~35%** |
| Okay | 12% | **~55%** |
| Optimistic | 25% | **~75%** |

These are unrealistic for a developer tool.

### 8.2 What COGS reduction is needed?

To make the current Option B break even, average model cost per paid user must drop by roughly **40%**. Options:

- Switch default model from **Kimi K2.7-code** to **Kimi K2.5**:
  - K2.5 input: $0.55/M vs. $0.95/M
  - K2.5 output: $2.19/M vs. $4.00/M
  - Estimated COGS reduction: **~40–50%**
- Aggressive prompt caching and context compaction.
- Route simple tasks to a cheaper model automatically.

If you switch the default to K2.5 and keep Option B pricing, the Optimistic scenario becomes roughly **break-even to slightly profitable**.

---

## 9. Bottom line

You have three realistic choices:

| Path | What you do | Month-1 outcome |
|------|-------------|-----------------|
| **A. Fix pricing** | Smaller allowances or higher prices | Break-even at low scale, profit at high scale |
| **B. Fix COGS** | Default to K2.5 or cheaper model | Break-even at high scale with current pricing |
| **C. Both** | Cheaper model + tighter allowances | Profitable even in Okay scenario |

**Recommended:** Do **C** — switch the default model to K2.5 (or make it the default for Starter/Pro) AND cap allowances at roughly the subscription price. This keeps KimiFlare competitive while making the business sustainable.
