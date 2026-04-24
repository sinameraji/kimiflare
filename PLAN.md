# Plan: `kimiflare` — Claude Code-style CLI powered by Kimi-K2.6

> Living document. Keep updated at every milestone so context survives compaction.

## Context

Build a terminal coding agent, similar in spirit to Claude Code, driven by the `@cf/moonshotai/kimi-k2.6` model hosted on Cloudflare Workers AI. User has large Cloudflare credits and wants them used directly — no AI Gateway, no OpenAI-compat layer; calls go straight to the native Workers AI `ai/run` REST endpoint.

- **Model**: `@cf/moonshotai/kimi-k2.6`. 262,144-token context, native function calling, streaming, reasoning, vision (unused in v1).
- **Endpoint**: `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/moonshotai/kimi-k2.6` · `Authorization: Bearer $CLOUDFLARE_API_TOKEN`.
- **Pricing**: $0.95 / M input, $0.16 / M cached input, $4.00 / M output.

Outcome: a `kimiflare` binary that opens a TUI, lets the user chat, calls Kimi-k2.6 with tools (file I/O, bash, search, web fetch), streams tokens, asks permission before mutating anything, and loops tool results back to the model until it stops.

## Probe findings (verified against the live API)

- Non-streaming body is wrapped: `{result: {...OpenAI chat.completion...}, success, errors, messages}`. Unwrap `result`.
- Streaming body is raw SSE — `data: {json}\n\n`, terminal `data: [DONE]`. OpenAI-compatible chunks.
- Kimi emits `delta.reasoning_content` BEFORE `delta.content`. Both are independent streams that share the `max_completion_tokens` budget. Use a generous cap (16384) so reasoning doesn't eat the final answer.
- Tool calls: first chunk has `{id, name, arguments: ""}`; later chunks carry only `arguments` delta, `index` identifies which call. Key accumulator by `index`, not `id`.
- Tool round-trip matches OpenAI spec: `role=assistant` with `tool_calls[]`, followed by `role=tool` with `tool_call_id`.
- Transient `HTTP 200 + success:false + errors[0].code:3040` ("Capacity temporarily exceeded"). Must retry with exponential backoff.
- Extra `data: {"response":"","usage":{...}}` event arrives before `[DONE]` — parser should ignore unknown events.
- `usage` rolls up in every streaming chunk → free live cost display.
- Tool-call `id` format is `"functions.<name>:<N>"`; treat as opaque string.

## Stack

- Node 20+ (built-in fetch / ReadableStream / AbortController), ESM.
- TypeScript. `tsup` builds, `tsx` for dev.
- Ink + `ink-text-input`, `ink-spinner`, `ink-select-input`. React 18.
- `commander` for CLI args. `fast-glob` for globs. `diff` for unified diffs. `turndown` for HTML→markdown.
- No `openai` SDK. Direct `fetch`.

## File layout

```
/Users/sinameraji/kimiflare/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── bin/kimiflare.mjs                # shebang shim → dist/index.js
├── src/
│   ├── index.tsx               # CLI entry (commander → Ink render or one-shot)
│   ├── app.tsx                 # Ink root: chat + input + permission modal
│   ├── config.ts               # env + ~/.config/kimiflare/config.json
│   ├── agent/
│   │   ├── client.ts           # Cloudflare Workers AI client (fetch + SSE + retry)
│   │   ├── stream.ts           # delta accumulator (reasoning/content/tool_calls)
│   │   ├── loop.ts             # model ↔ tools orchestration
│   │   ├── messages.ts         # message types
│   │   └── system-prompt.ts    # cwd/platform/date/tools
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── executor.ts
│   │   ├── read.ts | write.ts | edit.ts | bash.ts | glob.ts | grep.ts | web-fetch.ts
│   ├── ui/
│   │   ├── chat.tsx | input.tsx | permission.tsx | tool-view.tsx | diff-view.tsx | spinner.tsx
│   └── util/
│       ├── sse.ts
│       ├── paths.ts
│       └── errors.ts
```

## Core designs

### Cloudflare Workers AI client (`src/agent/client.ts`)

`runKimi({ messages, tools, signal })`:

- POSTs to `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/moonshotai/kimi-k2.6` with Bearer token.
- Body: `{ messages, tools, tool_choice: "auto", parallel_tool_calls: true, stream: true, temperature: 0.2, max_completion_tokens: 16384 }`.
- Returns an async iterator: `{type:"reasoning",delta}`, `{type:"text",delta}`, `{type:"tool_call_start",index,id,name}`, `{type:"tool_call_args",index,argsDelta}`, `{type:"usage",usage}`, `{type:"done",finishReason,usage}`.
- Retries on `code:3040` up to 5× with backoff (500ms, 1s, 2s, 4s, 8s + jitter).

### SSE reader (`src/util/sse.ts`)

`async function* readSSE(stream: ReadableStream<Uint8Array>)` — splits on `\n\n`, strips `data: ` prefix, yields parsed JSON, stops on `[DONE]`.

### Agent loop (`src/agent/loop.ts`)

```
loop:
  stream = runKimi(messages, tools)
  collect content/reasoning/tool_calls from events
  push final assistant message to messages[]
  if tool_calls:
    for each tc (serialize mutating, parallel for readonly):
      result = executor.run(tc, askPermission)
      push { role:"tool", tool_call_id: tc.id, content: result }
    continue
  else:
    yield to UI
```

Max 50 iterations per user turn.

### Tools

| Tool        | Permission | Notes |
|-------------|------------|-------|
| `read`      | auto       | `path`, `offset?`, `limit?`. UTF-8 text, ≤2MB. |
| `write`     | prompt     | `path`, `content`. Diff preview. |
| `edit`      | prompt     | `path`, `old_string`, `new_string`, `replace_all?`. Unique-match enforced. |
| `bash`      | prompt     | `command`, `timeout_ms?` (default 120s, max 600s). Output capped 30KB. |
| `glob`      | auto       | `pattern`, `path?`. `fast-glob`, 200 results sorted by mtime. |
| `grep`      | auto       | Shells out to `rg` if present, JS fallback otherwise. |
| `web_fetch` | auto       | `url`, 20s timeout, HTML→markdown, ≤100KB. |

Permission modal scopes: **this call** / **this session for this tool** / **deny**. Bash session-allow is keyed by command prefix.

### System prompt

Injects cwd, platform, shell, date, and one-line per registered tool. Emphasizes: prefer tools over guessing, read before editing, explain briefly before asking permission.

### UI

- Chat scrollback: user (cyan), assistant text, collapsed tool blocks, streaming tokens live.
- Reasoning: dim collapsed block above final answer; off by default; toggle with `/reasoning` or Ctrl+R.
- Input: multi-line `ink-text-input`, slash commands `/clear /exit /model /cost /history /reasoning`.
- Permission modal: overlay with tool name + args (diff preview for edit/write, raw command for bash); 3-option select.
- Status line: model, running tokens, cost estimate.

### Config

Resolution: env vars → `~/.config/kimiflare/config.json` → first-run prompt writing chmod 600 file.

```jsonc
{ "accountId": "…", "apiToken": "…", "model": "@cf/moonshotai/kimi-k2.6" }
```

### Entry modes

- `kimiflare` — interactive TUI
- `kimiflare -p "prompt"` — one-shot to stdout; permissions auto-deny unless `--dangerously-allow-all`
- `kimiflare --model <id>` — override model
- Session transcripts persisted at `~/.local/share/kimiflare/sessions/*.jsonl` (resume v1-optional)

## Verification scenarios

1. `npm install && npm run build && kimiflare --help` (after `npm link` or symlink).
2. TUI opens with valid creds.
3. Plain chat streams tokens live.
4. Readonly tool auto-runs (glob/read).
5. Mutating tool triggers permission modal, write+bash round-trip works.
6. Multi-tool loop (grep across tree).
7. Web fetch + summarize.
8. `/cost` matches `0.95·in/1M + 4.00·out/1M`.
9. `kimiflare -p --dangerously-allow-all` one-shot exits cleanly.
10. Missing creds / network-kill errors are graceful.

Unit tests: SSE reader split-chunks + `[DONE]`; stream accumulator against recorded Kimi tool-call transcript; edit unique-match; bash command-prefix allowlist.

## Progress log

| Milestone | Status |
|-----------|--------|
| API probes (5) | ✅ — see "Probe findings" |
| Scaffolding (package.json / tsconfig / tsup / bin) | ✅ |
| SSE reader + client + accumulator | ✅ validated via scripts/replay-stream.ts against recorded probe-4 body |
| Tools + registry + executor + permissions | ✅ |
| Agent loop + system prompt + messages | ✅ |
| Config loader + print-mode CLI entry | ✅ — verified end-to-end (plain chat, readonly tools, mutating tools) |
| Ink TUI (chat / input / permission / status) | ✅ renders cleanly under a pty; awaiting real-TTY interactive test |
| Interactive CLI entry | ✅ |
| End-to-end verification (TUI) | 🔄 in progress — user will run `kimiflare` in their terminal |

## Deferred (pre-launch)

- **First-run credential wizard**: when config.json and env vars are both missing, walk the user through creating a Cloudflare API token, validate it with a tiny test call, save to `~/.config/kimiflare/config.json` (chmod 600). Today we just error out with instructions. Product is BYO-creds — every user supplies their own Cloudflare token; kimiflare does not proxy requests.
- **Npm publish / homebrew tap** so `npm i -g kimiflare` works.
- **Session transcripts** (`~/.local/share/kimiflare/sessions/*.jsonl`) + `--resume`.
