# Learnings

A public log of what we've learned building kimiflare — research, design analysis, post-mortems, and longer-form notes.

## What lives here

Long-form documents that benefit from being diff-able, greppable, and durable:

- **Research and design analysis** — multi-page studies that map a problem space before any code gets written.
- **Post-mortems** — when something broke, what we learned, and what we changed.
- **Architecture decisions** — write-ups of choices that shape the codebase, with the reasoning preserved.

If a document is more than a couple of paragraphs and you'd want to read it again later, it goes here.

## What doesn't live here

Short notes, one-paragraph learnings, "we hit X and the fix was Y" observations, and things that need active discussion go in **GitHub issues** with the `learning` label. Issues are better for short, threaded, status-tracked items.

## Naming convention

`YYYY-MM-DD-short-topic.md` — date-first so the folder reads as a timeline. Use lowercase, hyphenated. Keep the topic short; the file itself can be long.

## Index

| Date | Document |
|---|---|
| 2026-05-01 | [Research Agent spiral and persona design](2026-05-01-research-agent-spiral-and-persona-design.md) — post-mortem of the 150-tool-call web-fetch spiral; proposes the Research Brief format and Senior Staff Engineer personality |
| 2026-04-27 | [Agent-system integration research](2026-04-27-agent-system-integration.md) — how `compact`, compiled context, code mode, and agent memory should work together |
