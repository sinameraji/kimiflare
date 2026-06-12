# Headless / CI Mode Parity with OpenCode

> Status: Planning complete — ready for implementation  
> Author: kimiflare  
> Date: 2026-06-12  
> Branch: `feat/headless-ci-parity`

---

## 1. Executive Summary

**This is a very achievable goal.** KimiFlare's existing architecture already covers ~60% of OpenCode's headless/CI surface. We have a solid print mode (`-p`), an NDJSON emit protocol (`--emit-events`), a permission system with auto-approval (`--dangerously-allow-all`), session persistence, and an SDK with an RPC server. The remaining gaps are incremental enhancements and one medium-sized feature (a persistent HTTP server).

**Estimated effort: 2–3 weeks of focused work** for one developer, or one sprint for a small team.

---

## 2. Current State Assessment

### 2.1 What KimiFlare Already Has

| Feature | Location | Notes |
|---------|----------|-------|
| **One-shot headless prompt** | `src/index.tsx:21` (`-p, --print <prompt>`) | Streams reply to stdout, exits. Foundation is solid. |
| **NDJSON event stream** | `src/emit-mode.ts` (`--emit-events`) | Camouflage protocol — more structured than OpenCode's `--format json`. Already supports multi-turn via stdin. |
| **Auto-approval** | `src/index.tsx:23` (`--dangerously-allow-all`) | Equivalent to OpenCode's `--dangerously-skip-permissions`. |
| **Model override** | `src/index.tsx:22` (`-m, --model <id>`) | Works in both print and interactive modes. |
| **Multi-turn stdin** | `src/emit-mode.ts:156` (`--multi-turn`) | Reads `UserInputSubmitted` NDJSON lines from stdin after initial turn. |
| **Bidirectional permissions** | `src/emit-mode.ts:114` | `PermissionResponse` messages on stdin resolve pending asks. |
| **Session persistence** | `src/sessions.ts` | Full load/save with checkpoints, artifacts, titles. |
| **SDK / RPC server** | `src/sdk/rpc.ts` (`--mode rpc`) | Stdio-based JSON-RPC for editor integrations (Zed, etc.). |
| **Tool hooks** | `src/hooks/manager.ts` | Pre/Post tool-use hooks fire in print mode too (M6.1). |
| **Output reduction** | `src/tools/reducer.ts` | Large tool outputs are capped automatically. |
| **Budget exhaustion** | `src/agent/loop.ts` | Exits 42 when `maxInputTokens` is hit. |
| **Reasoning output** | `src/index.tsx:24` (`--reasoning`) | Streams reasoning blocks to stderr in print mode. |
| **Continue on limit** | `src/index.tsx:25` (`--continue-on-limit`) | Resets tool-call counter at 200 calls. |

### 2.2 What's Missing vs. OpenCode

| OpenCode Feature | KimiFlare Gap | Complexity |
|------------------|---------------|------------|
| `opencode run [message..]` | **Naming only** — we have `-p`. Minor UX difference. | Trivial |
| `opencode serve` (persistent HTTP server) | **No HTTP server.** RPC is stdio-only. | Medium |
| `--attach http://...` | **No attach mode.** Cannot connect CLI to a warm server. | Medium (depends on serve) |
| `--format json` (raw JSON events) | **Only NDJSON via `--emit-events`.** No plain JSONL for print mode. | Low |
| `--file` / `-f` (file attachments) | **Not supported in print/emit mode.** | Low |
| `--continue` / `-c` in headless | **`--continue` is interactive-only.** Print mode always starts fresh. | Low |
| `--session <id>` in headless | **Session ID is ignored in print mode.** | Low |
| `--dir <path>` | **Always uses `process.cwd()`.** | Low |
| `--title <title>` | **Sessions auto-titled.** No override in headless. | Low |
| `--thinking` | **We have `--reasoning`.** Naming mismatch only. | Trivial |
| `--variant` (model variant) | **No variant support.** | Low |
| Server-Sent Events (`/event`) | **No SSE endpoint.** | Medium (depends on serve) |
| OpenAPI spec | **No HTTP API docs.** | Low (depends on serve) |
| mDNS discovery | **Not implemented.** | Low |
| `--share` | **No session sharing.** | Medium |

---

## 3. Root Cause: Why the Gaps Exist

### 3.1 Print Mode Was Built as a "Simple Utility"

`runPrintMode` (`src/index.tsx:360`) was designed for quick one-offs:
- No session loading — always starts with a fresh `[system, user]` message pair.
- No file attachment parsing — the TUI handles `@file` mentions via `input-handlers.ts`.
- Permission asker is a binary: `allowAll ? "allow" : "deny"` — no gradation.

### 3.2 Emit Mode Is Tightly Coupled to Camouflage

`runEmitMode` (`src/emit-mode.ts:57`) emits the Camouflage event protocol. It's powerful but opinionated:
- Event names like `AssistantStreamStarted`, `UserMessageCreated` are Camouflage-specific.
- There's no "plain JSONL" mode for generic scripting.
- Multi-turn is stdin-driven, not HTTP-driven.

### 3.3 No HTTP Layer

The RPC server (`src/sdk/rpc.ts:21`) is stdio-based by design — it's for ACP (Agent Client Protocol) editor integration. There's no Hono/Express/Fastify server in the main CLI bundle. The `remote/worker/` sub-project has Hono, but it's a separate deployable artifact, not a local CLI feature.

---

## 4. Implementation Plan

### Phase 1: Enhanced Print Mode (Week 1)

**Goal:** Close the "simple headless" gap without adding a server.

#### 4.1.1 P1.1 — Session Continuation in Print Mode

**Files:** `src/index.tsx`, `src/print-mode.ts` (new)

**Work:**
- Extract `runPrintMode` from `src/index.tsx` into a new `src/print-mode.ts` module.
- Add `--continue` and `--session <id>` support to print mode.
- When continuing, load the session file from `~/.local/share/kimiflare/sessions/`, filter out old system prompts, and append the new user prompt.
- Preserve the session's artifact store across turns.

**Interface:**
```bash
kimiflare -p "fix the bug" --continue          # continue last session in cwd
kimiflare -p "fix the bug" --session abc123     # continue specific session
```

#### 4.1.2 P1.2 — File Attachments in Headless Mode

**Files:** `src/print-mode.ts`, `src/emit-mode.ts`

**Work:**
- Add `--file <path>` / `-f <path>` CLI flag (repeatable).
- Read file contents and inject them into the user message using the same format as TUI `@file` mentions (`src/ui/input-handlers.ts`).
- Support glob patterns (`--file "src/**/*.ts"`).
- In emit mode, emit `FileAttached` events so the TUI renderer can show them.

**Interface:**
```bash
kimiflare -p "refactor these" -f src/utils.ts -f src/helpers.ts
kimiflare -p "review" -f "docs/**/*.md"
```

#### 4.1.3 P1.3 — `--format json` for Print Mode

**Files:** `src/print-mode.ts`

**Work:**
- Add `--format <mode>` flag with values: `text` (default), `json`, `stream-json`.
- `text`: current behavior — assistant text to stdout, tool metadata to stderr.
- `json`: single JSON object at the end containing `{ text, toolCalls[], usage, duration }`.
- `stream-json`: NDJSON lines, one per event (assistant delta, tool call, tool result, usage update). This is a simplified, non-Camouflage version of `--emit-events`.

**Interface:**
```bash
kimiflare -p "list files" --format json
kimiflare -p "list files" --format stream-json
```

#### 4.1.4 P1.4 — `--dir` and `--title` Flags

**Files:** `src/print-mode.ts`, `src/emit-mode.ts`

**Work:**
- `--dir <path>`: `process.chdir()` before running, or pass `cwd` override to `ToolExecutor` and `buildSystemPrompt`.
- `--title <title>`: override auto-generated session title when saving.

**Interface:**
```bash
kimiflare -p "analyze" --dir ./other-project --title "security-audit"
```

#### 4.1.5 P1.5 — Rename `--reasoning` to `--thinking` (Alias)

**Files:** `src/index.tsx`

**Work:**
- Keep `--reasoning` for back-compat.
- Add `--thinking` as an alias. Update docs.

---

### Phase 2: Persistent HTTP Server (Week 2)

**Goal:** Build `kimiflare serve` — a local HTTP server that avoids cold-start costs and enables multi-client access.

#### 4.2.1 P2.1 — HTTP Server Core

**Files:** `src/server/index.ts` (new), `src/server/routes.ts` (new)

**Work:**
- Add a new CLI subcommand: `kimiflare serve`.
- Use **Hono** (already a transitive dep via `remote/worker/`) or Node's built-in `http` module to avoid new dependencies.
- Bind to `localhost` by default, configurable via `--port` and `--hostname`.
- Support `KIMIFLARE_SERVER_PASSWORD` for HTTP Basic Auth (username defaults to `kimiflare`).

**Interface:**
```bash
kimiflare serve --port 4096 --hostname 127.0.0.1
```

**Architecture decision:** Use Node's built-in `http` + `createServer` to keep the bundle self-contained. Hono is nice but adds a dep to the main CLI. If we already bundle Hono for remote, check `tsup.config.ts` externals first.

#### 4.2.2 P2.2 — Session Management API

**Files:** `src/server/routes.ts`

**Work:**
- `POST /prompt` — submit a prompt, get a session ID back.
- `GET /session/:id` — get session state, messages, usage.
- `POST /session/:id/prompt` — send a follow-up to an existing session.
- `DELETE /session/:id` — delete a session.
- `GET /session` — list all sessions.

**Request/response shape:** JSON, matching the SDK types (`src/sdk/types.ts`).

#### 4.2.3 P2.3 — Server-Sent Events Stream

**Files:** `src/server/sse.ts` (new)

**Work:**
- `GET /event` — SSE endpoint that streams session events.
- First event: `server.connected`.
- Subsequent events: `assistant.delta`, `tool.call`, `tool.result`, `usage.update`, `session.completed`, `error`.
- Support `Last-Event-ID` for resumable streams.

**This is the most important feature for CI/scripting.** It lets external tools observe agent progress in real time without polling.

#### 4.2.4 P2.4 — Attach Mode for CLI

**Files:** `src/index.tsx`, `src/attach-mode.ts` (new)

**Work:**
- Add `--attach <url>` flag to print mode.
- Instead of running `runAgentTurn` locally, POST to `http://<url>/prompt` and stream the SSE response to stdout.
- This avoids MCP/LSP cold-boot times on every CLI invocation — the server keeps them warm.

**Interface:**
```bash
# Terminal 1
kimiflare serve --port 4096

# Terminal 2
kimiflare -p "explain this" --attach http://localhost:4096
kimiflare -p "fix the bug" --attach http://localhost:4096 --format json
```

#### 4.2.5 P2.5 — OpenAPI Spec

**Files:** `src/server/openapi.ts` (new)

**Work:**
- Auto-generate an OpenAPI 3.1 spec from the route handlers.
- Serve it at `GET /doc`.
- This is low-effort high-value — enables codegen, documentation, and Postman imports.

---

### Phase 3: Advanced Features (Week 3)

#### 4.3.1 P3.1 — Permission Rules Config File

**Files:** `src/config.ts`, `src/tools/executor.ts`

**Work:**
- Add a `permissions` field to `~/.config/kimiflare/config.json`:
  ```json
  {
    "permissions": {
      "bash": { "~/trusted/**": "allow", "**": "ask" },
      "write": { "**": "ask" },
      "edit": { "**": "ask" }
    }
  }
  ```
- In headless mode, evaluate these rules before falling back to `--dangerously-allow-all` or deny.
- This gives OpenCode-style granular control without requiring `--dangerously-allow-all` for every CI run.

#### 4.3.2 P3.2 — Model Variant Support

**Files:** `src/config.ts`, `src/agent/client.ts`

**Work:**
- Add `--variant <variant>` flag (e.g., `--variant reasoning`).
- Map variants to provider-specific parameters (e.g., `reasoning_effort` for Anthropic, `thinking` for OpenAI).

#### 4.3.3 P3.3 — Session Sharing

**Files:** `src/server/routes.ts`, `src/sessions.ts`

**Work:**
- `POST /session/:id/share` — generate a shareable token.
- `GET /session/shared/:token` — read-only access to a session transcript.
- Useful for sharing agent runs with teammates or attaching them to PRs.

#### 4.3.4 P3.4 — mDNS Discovery (Optional)

**Files:** `src/server/mdns.ts` (new)

**Work:**
- Advertise `kimiflare serve` instances on the local network via Bonjour/mDNS.
- Enables `kimiflare -p "..." --attach http://kimiflare.local` without knowing the IP.
- Add `--mdns` and `--mdns-domain` flags.

**Note:** This requires a new dependency (`bonjour-service` or similar). Consider making it optional.

---

## 5. Architecture Decisions

### 5.1 Why Not Reuse `remote/worker/`?

The `remote/worker/` sub-project is a Cloudflare Worker (Hono + Wrangler) designed for remote deployment. It has auth, rate limiting, and multi-tenant concerns that are overkill for a local CLI server. The local server should be:
- Zero-config (no Wrangler, no CF account).
- Single-tenant (one user, one machine).
- Lightweight (no bundling, no deploy step).

**Decision:** Build a separate `src/server/` module using Node's built-in `http`. Share types and session logic with the SDK.

### 5.2 Why Not Replace `--emit-events` with `--format json`?

`--emit-events` is the Camouflage wire protocol. It's stable and has a consumer (the Rust TUI). `--format json` is a user-facing scripting convenience. They serve different audiences.

**Decision:** Keep both. `--format json` is a simplified, documented format for scripts. `--emit-events` remains the Camouflage integration point.

### 5.3 Permission Model in Headless Mode

OpenCode's `--dangerously-skip-permissions` auto-approves anything not explicitly denied. KimiFlare's `--dangerously-allow-all` is the same. But OpenCode also supports config-based rules.

**Decision:** Implement config-based rules (P3.1) as the primary headless permission mechanism. `--dangerously-allow-all` becomes the "I know what I'm doing" escape hatch. In `-p` mode without either, default to `deny` with a clear stderr message.

---

## 6. Testing Strategy

### 6.1 Unit Tests

- `print-mode.test.ts`: test session loading, file attachment injection, format output.
- `server/routes.test.ts`: test HTTP routes with `node:test` and `supertest` (or raw `http` requests).
- `server/sse.test.ts`: test SSE event streaming and reconnection.

### 6.2 Integration Tests

- Start `kimiflare serve`, run `kimiflare -p "..." --attach`, verify output.
- Test MCP cold-boot avoidance: measure time with/without `--attach`.
- Test permission rules: config file with `allow` for `bash` in `~/tmp/**`, run a bash tool in that dir, verify no prompt.

### 6.3 CI/CD

- Add a GitHub Actions job that runs `kimiflare -p "list files" --format json` and validates the JSON schema.
- Add a job that starts `kimiflare serve`, hits `/doc`, and verifies the OpenAPI spec is valid (using `swagger-parser`).

---

## 7. Migration & Backward Compatibility

| Change | Backward Compatible? | Mitigation |
|--------|---------------------|------------|
| Extract `runPrintMode` to `src/print-mode.ts` | ✅ Yes | Re-export from `index.tsx` if needed. |
| Add `--format`, `--file`, `--dir`, `--title` | ✅ Yes | New flags, no breaking changes. |
| Add `--thinking` alias | ✅ Yes | `--reasoning` still works. |
| Add `kimiflare serve` subcommand | ✅ Yes | New entry point, no existing behavior changed. |
| Config-based permission rules | ✅ Yes | Only evaluated when `permissions` key is present. |
| `--attach` flag | ✅ Yes | New flag. |

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| HTTP server bloats the bundle | Medium | Medium | Use Node built-in `http`, no Hono/Express. Make server code lazy-loaded (`await import("./server")`). |
| SSE connections leak on crash | Low | Medium | Use `AbortController` per connection, clean up on `process.on('exit')`. |
| Session file corruption with concurrent writes | Low | High | Use atomic writes (`writeFile` to temp, then `rename`). Server holds in-memory lock per session ID. |
| Permission rules are confusing | Medium | Medium | Document with examples. Start with simple glob patterns only. |
| MCP servers don't work well in server mode | Medium | High | Test MCP lifecycle carefully. Each session may need its own MCP client pool, or share a global one with reference counting. |

---

## 9. Success Criteria

We will consider this plan complete when:

1. [ ] `kimiflare -p "do X" --format json` produces valid, documented JSON.
2. [ ] `kimiflare -p "do X" -f file.ts` attaches files correctly.
3. [ ] `kimiflare -p "do X" --continue` resumes the last session.
4. [ ] `kimiflare serve` starts an HTTP server with SSE events.
5. [ ] `kimiflare -p "do X" --attach http://localhost:4096` connects to the server and streams output.
6. [ ] `GET /doc` returns a valid OpenAPI 3.1 spec.
7. [ ] Config-based permission rules work in headless mode.
8. [ ] All new code has co-located tests.
9. [ ] `npm run typecheck` passes.

---

## 10. Appendix: OpenCode → KimiFlare Command Mapping

| OpenCode | KimiFlare (after this plan) | Notes |
|----------|----------------------------|-------|
| `opencode run "prompt"` | `kimiflare -p "prompt"` | Same semantics. |
| `opencode run -m provider/model` | `kimiflare -p "..." -m @cf/moonshotai/kimi-k2.6` | Same. |
| `opencode run --format json` | `kimiflare -p "..." --format json` | New flag. |
| `opencode run --dangerously-skip-permissions` | `kimiflare -p "..." --dangerously-allow-all` | Already exists. |
| `opencode run --file path` | `kimiflare -p "..." -f path` | New flag. |
| `opencode run --continue` | `kimiflare -p "..." --continue` | New flag. |
| `opencode run --session id` | `kimiflare -p "..." --session id` | New flag. |
| `opencode run --dir path` | `kimiflare -p "..." --dir path` | New flag. |
| `opencode run --title title` | `kimiflare -p "..." --title title` | New flag. |
| `opencode serve` | `kimiflare serve` | New subcommand. |
| `opencode run --attach url` | `kimiflare -p "..." --attach url` | New flag. |
| `opencode serve --port 4096` | `kimiflare serve --port 4096` | Same. |
| `opencode serve --hostname 0.0.0.0` | `kimiflare serve --hostname 0.0.0.0` | Same. |
| `GET /event` (SSE) | `GET /event` (SSE) | New endpoint. |
| `GET /doc` (OpenAPI) | `GET /doc` (OpenAPI) | New endpoint. |

---

*Co-authored-by: kimiflare <kimiflare@proton.me>*
