# Guardrails Index

This directory contains the AI development governance framework for kimiflare.

## Files

| File | Purpose | Audience |
|------|---------|----------|
| [`README.md`](README.md) | Complete guardrail specification with 9 categories, acceptance criteria, and historical context | Human reviewers, AI agents, new contributors |
| [`scoring-rubric.md`](scoring-rubric.md) | Machine-readable scoring criteria (0–3 scale) with critical/high-priority/standard rule classification | Automated PR review agents, maintainers |
| [`file-checklist.md`](file-checklist.md) | Per-file checklists — when you touch a file, check these boxes | PR authors, reviewers |
| [`github-action-example.yml`](github-action-example.yml) | Example GitHub Actions workflow for automated guardrail checks | DevOps, maintainers |

## Quick Start

### For PR Authors
1. Check [`file-checklist.md`](file-checklist.md) for every file you modified.
2. Run `npm run typecheck && npm test && npm run build` locally.
3. Ensure your PR description references any guardrail sections that are relevant.

### For Reviewers
1. Read the relevant sections of [`README.md`](README.md) based on the PR scope.
2. Use [`scoring-rubric.md`](scoring-rubric.md) to score the PR objectively.
3. Copy the checklist from [`file-checklist.md`](file-checklist.md) into your review comment.

### For Automated Agents
1. Load [`README.md`](README.md) as system context.
2. Use [`scoring-rubric.md`](scoring-rubric.md) to produce a structured scorecard.
3. Reference specific guardrail section numbers in your feedback (e.g., "Violates 2.1.3").

## Guardrail Categories at a Glance

1. **Build & Runtime Safety** — TypeScript strictness, ESM conventions, error handling, file size limits
2. **Token Efficiency & Cost Control** — Prompt cache stability, context management, tool output reduction, LLM call minimization, cost visibility
3. **Agent Loop Safety** — Anti-loop guardrails, iteration limits, permission model, error recovery
4. **Data Integrity & Persistence** — Session persistence, memory DB, config backward compatibility
5. **TUI/UX Stability** — Event management, static rendering, theme contrast, input handling
6. **Security & Privacy** — Path safety, bash safety, secret redaction, model ID validation, sanitization
7. **Integration Consistency** — MCP lifecycle, AI Gateway headers, Workers AI API, SSE parsing
8. **Testing & Verification** — Test coverage, cost regression testing, integration testing
9. **Architecture & Design Principles** — Explicit-only memory, feature flags, determinism, graceful degradation

## Maintenance

- Update these files when new subsystems are added (e.g., new tool, new UI component, new memory feature).
- Version-bump the guardrails alongside major releases.
- Propose changes via PR with empirical justification (cost data, bug reports, user feedback).

---

*Last updated: 2026-04-27*
