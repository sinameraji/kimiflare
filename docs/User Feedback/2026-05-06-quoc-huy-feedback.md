# 2026-05-06 — QUOC HUY EARLY USER FEEDBACK (CANONICAL)

## User Profile Context

User: Quoc Huy

Characteristics:
- highly technical early adopter,
- cloned Kimiflare repository,
- ran local dev build,
- patched locally,
- used both production and development versions,
- benchmarked Kimiflare against mature coding harnesses.

Tools mentally referenced by user:
- Claude Code
- pi.dev
- OpenCode CLI
- Gemini CLI

This is therefore high-signal power-user feedback, not casual user commentary.

---

## Overall Sentiment

Overall sentiment was strongly positive.

Verbatim user reactions included:

> “It’s already awesome.”
> “Admirable considering the speed.”
> “Respect.”

However, the dominant concern repeated across the conversation was:

> “But u need a lot more time to make it stable.”

This indicates:
the user sees strong product promise, but does not yet fully trust Kimiflare as a daily technical driver.

---

# EXTRACTED FEEDBACK ITEMS

---

## 1. Full UI Freeze / Unresponsive States
### User quotes
> “Totally unresponsive.”
> “Prod kept freezing.”
> “Prod was too risky.”
> “Freezes = I lose a working session.”

### Interpretation
Kimiflare is currently exhibiting one or more serious TUI deadlock or render-lock conditions.

This is the single biggest trust blocker mentioned.

### Severity
Severity A — Trust Blocker

---

## 2. Slash Commands Seem Correlated With Random Freeze Behavior
### User quotes
> “Slash command.”
> “Slash command but randomly.”
> “I can’t pinpoint.”

### Interpretation
User repeatedly associated freezes with slash command usage, suggesting slash command execution is one of the highest-risk architectural surfaces.

### Severity
Severity A — Trust Blocker

---

## 3. Theme Picker Specifically Triggered Hard Freeze
### User quotes
> “I got stuck here trying to change the theme.”
> “Totally unresponsive.”

### Interpretation
`/themes` interaction can deadlock or freeze the TUI.

This matters not because themes are important, but because small UI interactions currently feel unsafe.

### Severity
Severity A — Trust Blocker

---

## 4. Production Build Feels Unsafe Compared To Dev Build
### User quotes
> “I’m using the dev version so I can patch.”
> “Prod was too risky.”

### Interpretation
User perceives packaged production Kimiflare as less trustworthy and less diagnosable than local dev mode.

### Severity
Severity A — Trust Blocker

---

## 5. Session Safety Is Not Trusted Enough
### User quotes
> “Freezes = I lose a working session.”
> “Sessions support.”
> “Work is so much better with them.”

### Interpretation
Current `/resume` support is not sufficient to make user feel crash-safe.

User is asking for stronger guarantees around:
- autosave,
- interrupted session persistence,
- long-session trust.

### Severity
Severity A / B boundary

---

## 6. Intra-Session Restore / Checkpointing Requested
### User quotes
> “Restore to a point within a session.”
> “U also should have session ID as well.”

### Interpretation
User is not merely asking to reopen old sessions.

User likely wants:
- checkpoint snapshots,
- timeline rewind,
- branch from earlier point in same conversation.

This is a mature harness expectation.

### Severity
Severity B — Daily Driver Gap

---

## 7. AGENT.md / Persistent Repository Instruction Support Requested
### User quotes
> “agent.md support”

### Interpretation
User expects Kimiflare to automatically absorb persistent repository-level context such as:
- coding standards,
- architecture notes,
- files not to touch,
- testing conventions.

This means Kimiflare currently feels too stateless compared to mature coding harnesses.

### Severity
Severity B — Daily Driver Gap

---

## 8. Skills System Requested
### User quotes
> “SKILLS.”
> “It’s an industry standard at this point.”
> “Any dev tool need to have a skill.”

### Interpretation
User expects reusable abstractions/workflows comparable to mature agent systems.

Important, but not above trust blockers.

### Severity
Severity C — Maturity Feature

---

## 9. Theme Persistence Is Broken
### User quotes
> “Doesn’t persist after selection.”
> “I selected light, but it always goes back to first on list.”

### Severity
Severity D — Polish / Minor reliability signal

---

## 10. Theme Coverage / Contrast / TUI Polish
### User quotes
> “Theme support miss some text styles.”
> “Contrast in theme is not WCAG compliant yet.”
> “Rendering of the TUI.”

### Severity
Severity D — Polish

---

## 11. Ctrl+C Should Require Double Confirmation
### User quote
> “It should need x2 of the combination. Else it would be triggered accidentally.”

### Severity
Severity D — UX Polish

---

## 12. Mature Harness Benchmarking Recommendation
### User quotes
> “Would u consider using parts of pi.dev?”
> “I think u could accelerate a lot by forking it.”
> “All edge cases have been fixed by a lot of usage.”
> “Incredibly minimal and efficient.”

### Interpretation
User strongly believes Kimiflare should study mature harnesses to avoid reinventing solved trust problems.

### Severity
Strategic product signal

---

## 13. Positive Delight Signal — Voice Note Feature
### User quote
> “Love the voice note to creator feature lol ❤️”

### Interpretation
Direct builder-user communication is a meaningful delight and loyalty signal.

Should be preserved.

### Severity
Positive product signal

---

# FOUNDER TAKEAWAY

This user is not dismissing Kimiflare.

He is attempting to shape it into something he would trust daily.

That is a very positive signal.

However, the conversation makes one thing clear:

Kimiflare's immediate risk is not lack of features.

Kimiflare's immediate risk is lack of trust under long technical usage.

Trust blockers should therefore outrank maturity features in upcoming engineering prioritization.
