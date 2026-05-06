# Skills Market Research — How the Industry Does It

> Research date: 2026-05-06  
> Researcher: kimiflare  
> Scope: Claude Code, Cursor, GitHub Copilot, Aider, Pi (P-I)  
> Question: How do people actually use skills? Is there a shared format? What does KimiFlare have today?

---

## 1. Executive Summary

**Skills** (also called Rules, Instructions, Conventions, or Prompts) are user-defined markdown files that inject domain-specific instructions into an AI assistant's system prompt. Despite being a near-universal feature across modern coding agents, there is **zero interoperability** between tools, **no dominant marketplace**, and **no shared format**. Users overwhelmingly create their own skills manually and curate them over time, much like `.vimrc` or shell aliases.

This represents a significant opportunity for KimiFlare: we can define a clean, extensible standard, make auto-activation actually work, and combine skills with our semantic memory system to create a uniquely personalized experience.

---

## 2. How People Actually Use Skills

### The dominant pattern: DIY curation

Users do **not** import skills from a store. They write them themselves, iteratively, based on friction they experience in daily work. A typical journey:

1. **Frustration:** The AI keeps writing tests with Enzyme instead of Testing Library.
2. **Creation:** User writes a skill file: "Always use React Testing Library. Never use Enzyme."
3. **Refinement:** Over weeks, they add more rules: "Mock fetch with MSW," "Use `screen.getByRole` for queries."
4. **Sharing (rarely):** They might paste it in a team Slack or commit it to the repo. There is no marketplace.

### Why no marketplace exists

- **Too personal:** A skill that works for one team's React conventions is useless for another.
- **Too simple:** Most skills are 5–20 lines of markdown. The overhead of "installing" them feels silly.
- **No standard:** Even if someone shared a skill, it wouldn't work in your tool without manual translation.

### The exception: team/project conventions

The one place sharing *does* happen is within a team or open-source project. A repo might contain:
- `.cursorrules` (Cursor)
- `.github/copilot-instructions.md` (Copilot)
- `.claude/skills/` (Claude Code)
- `.aider.conventions.md` (Aider)

These are committed to version control so every contributor gets the same AI behavior.

---

## 3. Tool-by-Tool Breakdown

### 3.1 Claude Code (Anthropic)

| Attribute | Detail |
|-----------|--------|
| **What they call it** | Skills / Commands |
| **Format** | Markdown with YAML frontmatter |
| **Location** | `.claude/skills/` (project-local), `~/.claude/skills/` (global) |
| **Frontmatter** | `name`, `description`, `type` (`prompt` or `command`) |
| **Auto-activation** | No — must be loaded with `/load <skill>` |
| **Marketplace** | None |
| **Example** | See below |

```markdown
---
name: test-driven-dev
description: Always write tests before implementation
type: prompt
---

When asked to write code:
1. Write the test first
2. Run it to confirm it fails
3. Write the minimal implementation
4. Run tests to confirm pass
```

**Notes:**
- The `type: command` variant lets users define custom slash commands that run shell scripts or JS.
- Skills are explicitly loaded per-session, which gives control but adds friction.
- The format is clean and well-documented in Anthropic's docs.

---

### 3.2 Cursor

| Attribute | Detail |
|-----------|--------|
| **What they call it** | Rules |
| **Format** | Plain text (no frontmatter, no structure) |
| **Location** | `.cursorrules` (project-local), Settings > Rules (global) |
| **Frontmatter** | None |
| **Auto-activation** | Always — if `.cursorrules` exists, it's always injected |
| **Marketplace** | None |
| **Example** | See below |

```text
Always use TypeScript strict mode.
Prefer functional components over class components.
Use `const` instead of `let` where possible.
```

**Notes:**
- Dead simple. No YAML, no globs, no conditional activation.
- The `.cursorrules` file is just raw text appended to the system prompt.
- Global rules in settings UI are separate from project-local `.cursorrules`.
- Because it's always-on, users keep it short to avoid token bloat.

---

### 3.3 GitHub Copilot

| Attribute | Detail |
|-----------|--------|
| **What they call it** | Instructions |
| **Format** | Markdown (no frontmatter) |
| **Location** | `.github/copilot-instructions.md` (project-local) |
| **Frontmatter** | None |
| **Auto-activation** | Always — if the file exists, it's always injected |
| **Marketplace** | None |
| **Example** | See below |

```markdown
# Copilot Instructions

This project uses Next.js App Router. Always use server components by default.
For client interactivity, use `"use client"` directives sparingly.
Style with Tailwind CSS. Never use inline styles.
```

**Notes:**
- Only project-local. No global instructions file.
- The `.github/` location is clever — it's already in version control and familiar to developers.
- Very limited compared to Claude Code or Pi. Just a blob of text.

---

### 3.4 Aider

| Attribute | Detail |
|-----------|--------|
| **What they call it** | Conventions |
| **Format** | Markdown (no frontmatter) |
| **Location** | `.aider.conventions.md` (project-local) |
| **Frontmatter** | None |
| **Auto-activation** | Always — if the file exists, it's always injected |
| **Marketplace** | None |
| **Example** | See below |

```markdown
# Coding Conventions

- Use descriptive variable names
- Add docstrings to all public functions
- Follow PEP 8 style guide
- Use type hints for function signatures
```

**Notes:**
- Aider is Python-focused, so conventions tend to be Python-specific.
- Same pattern as Copilot: one markdown file, always injected.
- No global scope, no conditional activation.

---

### 3.5 Pi (P-I / pi-mono)

| Attribute | Detail |
|-----------|--------|
| **What they call it** | Skills |
| **Format** | Markdown with YAML frontmatter |
| **Location** | `~/.config/pi/skills/` (global), `.pi/skills/` (project-local) |
| **Frontmatter** | `name`, `description`, `match` (file globs), `version` |
| **Auto-activation** | Yes — `match` globs determine when the skill is active |
| **Marketplace** | None |
| **Example** | See below |

```markdown
---
name: react-testing
description: Best practices for React component testing
match:
  - "*.test.tsx"
  - "*.test.ts"
version: 1.0.0
---

When writing React tests:
- Prefer React Testing Library over Enzyme
- Use `screen.getByRole` for accessibility-first queries
- Mock `fetch` with `msw`, not `jest.mock`
- Place test files next to source files (co-location)
```

**Notes:**
- Pi has the most structured skill system of any tool surveyed.
- The `match` field is the standout feature — skills activate automatically based on file globs.
- Versioning suggests future marketplace or sharing intent, but none exists yet.
- Global vs project-local scoping is well-designed.

---

## 4. Comparison Matrix

| Feature | Claude Code | Cursor | Copilot | Aider | Pi |
|---------|-------------|--------|---------|-------|-----|
| **Name** | Skills / Commands | Rules | Instructions | Conventions | Skills |
| **Format** | Markdown + YAML | Plain text | Markdown | Markdown | Markdown + YAML |
| **Frontmatter** | Yes | No | No | No | Yes |
| **Global scope** | Yes (`~/.claude/`) | Yes (settings) | No | No | Yes (`~/.config/pi/`) |
| **Project scope** | Yes (`.claude/`) | Yes (`.cursorrules`) | Yes (`.github/`) | Yes (`.aider.`) | Yes (`.pi/`) |
| **Auto-activation** | No (`/load` only) | Always | Always | Always | Yes (`match` globs) |
| **Conditional activation** | No | No | No | No | Yes (file globs) |
| **Custom commands** | Yes (`type: command`) | No | No | No | No |
| **Marketplace** | None | None | None | None | None |

---

## 5. Is There a Shared Format?

**No. Zero interoperability exists.**

A skill written for Claude Code will not work in Pi without manual translation. A `.cursorrules` file is just raw text with no structure. Copilot and Aider don't even use frontmatter.

### What this means for KimiFlare

This fragmentation is an **opportunity**, not a problem:

1. **We can define the standard.** A clean, documented format with YAML frontmatter, `match` globs, and semantic memory integration.
2. **We can be the first with a real marketplace.** If skills are shareable and versioned, a lightweight registry (even just a GitHub repo with curated submissions) would be novel.
3. **We can import from others.** A simple converter from `.cursorrules` or `.claude/skills/` to our format would lower the migration barrier.

---

## 6. What Does KimiFlare Have Today?

**Nothing equivalent to skills.**

| Component | What it does | Is it skills? |
|-----------|--------------|---------------|
| `src/agent/system-prompt.ts` | Hardcoded system prompt for the AI | No — not user-customizable |
| `src/memory/manager.ts` | Extracts facts/preferences from conversation, stores in SQLite | No — reactive, not proactive |
| Slash commands (`/cost`, `/compact`, etc.) | Built-in commands | No — hardcoded, not user-defined |
| `KIMI.md` | Project context file read at startup | No — for project info, not coding conventions |

### The gap

Users cannot currently:
- Define custom instructions that persist across sessions
- Auto-activate instructions based on file type or project
- Share team conventions via version control
- Override AI behavior for specific domains (testing, API design, etc.)

---

## 7. Opportunities for KimiFlare

### 7.1 Differentiation: Skills + Memory

No other tool combines **structured skills** with **semantic memory**. We could:

- **Reinforce skills with memory:** If a skill says "use Testing Library" and the user later corrects the AI, memory records the correction and strengthens the skill's weight.
- **Auto-generate skills from memory:** After N corrections in a domain, suggest creating a skill. "You've corrected React testing patterns 12 times. Create a skill?"
- **Skill-aware memory:** Memory extractions could be tagged with the active skill, making retrieval more precise.

### 7.2 Differentiation: Auto-activation That Works

Pi has `match` globs, but nobody else does. We could go further:

- **File globs:** `match: ["*.test.tsx"]`
- **Directory patterns:** `match: ["src/api/**"]`
- **Content heuristics:** Activate "Django" skill if `manage.py` exists
- **Stack detection:** Auto-activate React skill if `package.json` has `react` dependency

### 7.3 Differentiation: Cloud + Local Sync

Because KimiFlare has both BYOK and Cloud modes:

- **BYOK users:** Skills stored locally in `~/.config/kimiflare/skills/`
- **Cloud users:** Skills synced across devices via `api.kimiflare.com`
- **Team/enterprise:** Shared skill repositories, managed by admins

No other tool has this dual-mode architecture.

---

## 8. Design Principles for KimiFlare Skills

Based on this research, our skills system should follow these principles:

1. **Markdown + YAML frontmatter** — structured but familiar
2. **Auto-activation via `match`** — file globs, directory patterns, stack detection
3. **Global + project-local scopes** — personal preferences vs team conventions
4. **Lightweight** — no marketplace dependency, no complex packaging
5. **Memory integration** — skills and memory should reinforce each other
6. **Cloud sync** — skills follow the user across devices (cloud mode)
7. **Import-friendly** — easy migration from `.cursorrules`, `.claude/skills/`, etc.

---

## 9. Open Questions

1. Should skills be versioned? (Pi does; nobody else does)
2. Should we support custom slash commands (like Claude Code's `type: command`)?
3. Should skills be editable in the TUI, or only as files?
4. How do we prevent skill conflicts (two skills with contradictory instructions)?
5. Should we build a curated skill registry, or wait for organic community growth?

---

## 10. Sources

- Claude Code documentation: https://docs.anthropic.com/en/docs/claude-code/skills
- Cursor documentation: https://docs.cursor.com/context/rules
- GitHub Copilot documentation: https://docs.github.com/en/copilot/customizing-copilot
- Aider documentation: https://aider.chat/docs/usage/conventions.html
- Pi (P-I) source code: https://github.com/badlogic/pi-mono (analyzed via source)
- KimiFlare source code: `src/agent/system-prompt.ts`, `src/memory/manager.ts`, `src/app.tsx` (analyzed via source)

---

*Document written by kimiflare as part of the Skills & Session Tree planning initiative.*
