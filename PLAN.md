# Implementation Plan: Web Search, GitHub Read-Only, Headless Browser

## Overview
Add three new native tool categories to KimiFlare:
1. **Web Search** (`search_web`) — query-based web search without requiring a known URL
2. **GitHub Read-Only** (`github_read_pr`, `github_read_issue`, `github_read_code`) — structured GitHub API access, whitelisted in plan mode
3. **Headless Browser** (`browser_fetch`) — JS-rendered page extraction via Playwright

## Design Decisions

### Web Search
- **Provider**: DuckDuckGo HTML scraping (no API key required)
- **Fallback**: If DuckDuckGo blocks us, degrade gracefully with a clear error
- **Output**: List of results with title, URL, and snippet
- **Permission**: `needsPermission: false` (read-only, no side effects)
- **Plan mode**: Whitelisted (read-only)

### GitHub Read-Only
- **Auth**: Reuse existing `githubOAuthToken` from config
- **Tools**:
  - `github_read_pr` — read a PR by owner/repo/number
  - `github_read_issue` — read an issue by owner/repo/number
  - `github_read_code` — read file contents from a repo at a specific ref
- **Permission**: `needsPermission: false` (read-only, no side effects)
- **Plan mode**: Whitelisted (explicitly read-only)
- **Why native tools vs gh CLI**: Native tools are always safe (no write ops), so they bypass permission prompts and work in plan mode

### Headless Browser
- **Engine**: Playwright (Chromium in headless mode)
- **Behavior**: Launch invisible browser, navigate, wait for load, extract text + screenshot option
- **Output**: Extracted page text (via readability-style extraction) + optional screenshot path
- **Permission**: `needsPermission: false` for text extraction, `needsPermission: true` for screenshots (files on disk)
- **Plan mode**: Text extraction whitelisted; screenshots blocked
- **Dependency**: `playwright` as optional peer dependency — tool gracefully errors if not installed

## Files to Create/Modify

### New files
- `src/tools/web-search.ts` — DuckDuckGo search implementation
- `src/tools/github.ts` — GitHub API read-only tools
- `src/tools/browser.ts` — Playwright headless browser tool
- `src/tools/web-search.test.ts` — tests for search
- `src/tools/github.test.ts` — tests for GitHub tools
- `src/tools/browser.test.ts` — tests for browser tool

### Modified files
- `src/tools/executor.ts` — register new tools in `ALL_TOOLS`
- `src/tools/reducer.ts` — add reduction rules for `search_web`, `github_read_*`, `browser_fetch`
- `src/mode.ts` — update `isBlockedInPlanMode` and `isReadOnlyBash` if needed
- `src/agent/system-prompt.ts` — mention new tools in static prefix (optional)
- `package.json` — add `playwright` to optional dependencies or devDependencies

## Implementation Order
1. Web search (simplest, no external deps)
2. GitHub read-only (reuses existing auth)
3. Headless browser (most complex, optional dep)
4. Reducer updates + mode updates
5. Tests
6. Typecheck + commit
