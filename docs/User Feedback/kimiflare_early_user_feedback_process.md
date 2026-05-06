# EARLY USER FEEDBACK PROCESS — KIMIFLARE

This folder stores structured feedback from real Kimiflare users, especially technical early adopters.

The purpose is not to collect random feature wishes.

The purpose is to systematically identify:

- trust blockers,
- daily-driver maturity gaps,
- repeated competitive benchmark patterns,
- and product delight signals.

Every new user who provides substantial feedback should receive their own markdown file in this folder.

Recommended naming convention:

`YYYY-MM-DD-username-feedback.md`

Example:

`2026-05-06-quoc-huy-feedback.md`

---

# HOW TO PROCESS EACH USER'S FEEDBACK

For every user conversation, feedback should be extracted into the following sections:

## 1. User Profile Context
Document:
- technical sophistication,
- whether they used prod/dev,
- whether they cloned locally,
- what mature tools they benchmark against,
- whether they are casual or power users.

This matters because power-user feedback carries architectural signals, not just UI opinions.

---

## 2. Overall Sentiment
Capture:
- positive sentiment,
- frustration level,
- whether they are trying to abandon the product or shape it.

Important distinction:

A user saying “this is useless” is very different from a user saying “this needs to be more stable.”

The latter often means they want it to become a daily driver.

---

## 3. Raw User Quotes
Preserve important verbatim user quotes.

This prevents future engineering planning from becoming founder paraphrase.

Actual user language provides urgency and context.

---

## 4. Extracted Feedback Items
Each concrete piece of feedback should be converted into:

- issue title,
- user quote,
- interpretation,
- probable severity.

---

## 5. Severity Classification

All extracted items must be classified into:

### Severity A — Trust Blockers
Anything that makes a user feel unsafe using Kimiflare in real work.

Examples:
- freezes
- crashes
- deadlocks
- lost sessions
- hidden failures

### Severity B — Daily Driver Gaps
Things that make Kimiflare feel immature compared to serious competitors.

Examples:
- weak session ergonomics
- lack of AGENT.md
- command fragility

### Severity C — Maturity Features
Important but non-blocking serious-tool expectations.

Examples:
- skills
- advanced abstractions
- richer workflows

### Severity D — Polish
Visual or ergonomic niceties.

---

## 6. Convert Into Investigation or GitHub Issues
Do not jump directly into coding.

Feedback should first be converted into:
- investigation tasks,
- architecture research tasks,
- or precise implementation tickets.

---

# GLOBAL RULES

## Rule 1 — Do not overreact to one user's wishlist
Single-user feature requests are signals, not roadmap truth.

Repeated requests across users matter much more.

## Rule 2 — Trust blockers outrank sexy features
Missing features are tolerated.
Instability is not.

## Rule 3 — Preserve user quotes
Never store only founder interpretation.

## Rule 4 — Distinguish between:
- bug,
- architecture weakness,
- maturity gap,
- nice-to-have.

---

# WHY THIS FOLDER EXISTS

Kimiflare is moving from prototype stage to daily-driver stage.

This means user feedback must be treated as:

- engineering intelligence,
- trust intelligence,
- and maturity intelligence.

Not as random Discord chatter.
