# Feature Backlog

Ideas and planned features for kimiflare, prioritized by impact vs. effort.

---

## 1. MCP Server Integration

**Status:** Not started  
**Impact:** High — unlocks 20+ external integrations without building each one  
**Effort:** Medium

### What

Support [Model Context Protocol](https://modelcontextprotocol.io) servers so users can plug in external tools (GitHub, Sentry, docs search, databases, etc.) alongside kimiflare's built-in tools.

### Why

OpenCode supports local and remote MCP servers. This is their main extensibility mechanism — they don't build GitHub/Sentry/Context7 integrations themselves; they just speak MCP. We should do the same.

### Scope

- Local MCP servers via stdio (spawn a subprocess, speak JSON-RPC over stdin/stdout)
- Remote MCP servers via SSE or HTTP (with optional OAuth)
- Dynamic tool registration: MCP tools appear alongside `read`, `write`, `edit`, etc.
- Config-driven: users declare servers in `~/.config/kimiflare/config.json`
- Tool name prefixing to avoid collisions (`mcp_<server>_<tool>`)

### Kimiflare Prompt

```
Implement MCP server integration for kimiflare.

1. Add `@modelcontextprotocol/sdk` as a dependency in package.json.
2. Create `src/mcp/manager.ts`:
   - A class `McpManager` that maintains a map of active MCP clients.
   - `addLocalServer(name, command, env?)` — spawns a stdio subprocess, initializes the MCP client, and fetches the tool list.
   - `addRemoteServer(name, url, headers?)` — connects to a remote MCP server over SSE/HTTP.
   - `getAllTools()` — returns a flat list of `ToolSpec` objects, one per MCP tool, with names prefixed as `mcp_<server>_<tool>`.
   - `removeServer(name)` — cleans up the client and removes its tools.
   - Handle reconnection and basic error surfacing.
3. Create `src/mcp/adapter.ts`:
   - `mcpToolToSpec(serverName, mcpTool)` — converts an MCP `Tool` definition into our internal `ToolSpec` format.
   - The `run` function should call `mcpClient.callTool({ name: originalToolName, arguments: args })` and return the result content as a string.
4. Extend `src/config.ts`:
   - Add `mcpServers?: Record<string, { type: "local" | "remote"; command?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string>; enabled?: boolean }>` to `KimiConfig`.
   - Load and validate MCP server config on startup.
5. Extend `src/app.tsx`:
   - After config loads, initialize the `McpManager` with any enabled servers from config.
   - Merge MCP tools into the tool list passed to `runAgentTurn` and `buildSystemPrompt`.
   - Show an info event when MCP servers connect and how many tools they expose.
6. Extend `src/tools/executor.ts`:
   - Ensure the executor can handle dynamically registered tools (it already should, but verify).
7. Add a `/mcp` slash command in `src/app.tsx`:
   - `/mcp list` — list connected servers and their tools.
   - `/mcp reload` — disconnect and reconnect all configured servers.

Keep the implementation minimal. Don't implement OAuth for remote servers in this first pass — just support API-key headers. Don't implement MCP resources or prompts, only tools.
```

---

## 2. Undo / Redo Stack

**Status:** Not started  
**Impact:** High — critical safety net when the agent makes bad changes  
**Effort:** Medium

### What

Track every mutating file operation across a session and let the user revert the last turn's changes with `/undo`, then restore them with `/redo`.

### Why

OpenCode has `/undo` and `/redo` as built-in commands. When the agent goes off track, users can instantly roll back instead of manually reverting with git. This builds trust in autonomous mode.

### Scope

- Snapshot files before any `write`, `edit`, or mutating `bash` command
- Group snapshots by "turn" (one user message + all agent tool calls)
- `/undo` reverts every file changed in the most recent turn
- `/redo` restores the undone changes
- Stack is per-session; persisted in session files if feasible

### Kimiflare Prompt

```
Implement an undo/redo stack for kimiflare.

1. Create `src/undo.ts`:
   - Define types:
     - `FileSnapshot = { path: string; before: string | null }` — `null` means the file didn't exist.
     - `UndoFrame = { id: string; snapshots: FileSnapshot[]; undone: boolean }`
     - `UndoStack = { frames: UndoFrame[]; redoStack: UndoFrame[] }`
   - `createUndoStack()` — returns a fresh stack.
   - `pushFrame(stack, snapshots)` — pushes a new frame onto `frames` and clears `redoStack`.
   - `undo(stack)` — pops the last non-undone frame from `frames`, restores all `before` snapshots (deleting files that were created), marks it undone, and pushes it onto `redoStack`. Returns the frame ID or null.
   - `redo(stack)` — pops from `redoStack`, re-applies the "after" state (we need to store after too, or re-execute). Actually, store `after` in the frame as well so redo can restore it. Returns the frame ID or null.
   - `getCurrentFrame(stack)` — returns the latest frame for display.

2. Modify `src/tools/write.ts` and `src/tools/edit.ts`:
   - Before writing or editing, read the current file content (or note that it doesn't exist) and return a `FileSnapshot` alongside the normal result.
   - The `ToolResult` type in `src/tools/executor.ts` already exists; extend it with an optional `snapshots?: FileSnapshot[]` field.

3. Modify `src/tools/bash.ts`:
   - This is trickier. After a bash command runs, we don't know what files changed. For the first pass, only snapshot files if the command is a known mutator (e.g., contains `>`, `mv`, `cp`, `rm`, `git checkout`, `git reset`, `npm install`, etc.).
   - Alternatively, skip bash snapshots for now and only support undo for `write` and `edit`. Document this limitation.
   - Let's go with: only `write` and `edit` participate in undo for the first version. Add a comment in `src/undo.ts` about future bash integration.

4. Modify `src/tools/executor.ts`:
   - After each tool runs, if it returned snapshots, collect them.
   - Add a method `collectSnapshots(snapshots: FileSnapshot[])` that the agent loop can call after a turn completes.

5. Modify `src/agent/loop.ts`:
   - After all tool calls in a turn finish, if any snapshots were collected, push a single `UndoFrame` containing all of them.
   - Pass the undo stack through `AgentTurnOpts` or manage it at the app level.

6. Modify `src/app.tsx`:
   - Maintain an `UndoStack` in a ref.
   - Add `/undo` and `/redo` slash commands:
     - `/undo` — calls `undo(stack)`, restores files, shows an info event with the frame ID and list of files reverted.
     - `/redo` — calls `redo(stack)`, re-applies files, shows an info event.
   - After a successful agent turn, if any write/edit tools ran, automatically push a frame.
   - Show the number of undoable turns in the status bar (optional, nice-to-have).

7. Modify `src/sessions.ts`:
   - Persist the undo stack in the session file so `/resume` preserves it.
   - Update `Session` type to include `undoStack?: UndoStack`.

Keep the implementation file-system only. Don't try to undo git operations or bash side effects beyond write/edit.
```

---

## 3. Custom Slash Commands

**Status:** Not started  
**Impact:** Medium — power-user feature for reusable workflows  
**Effort:** Low

### What

Let users define reusable prompt templates as markdown files in `~/.config/kimiflare/commands/` or `.kimiflare/commands/`. Typing `/my-command` in the TUI sends the templated prompt to the LLM.

### Why

OpenCode has this and it's genuinely useful. Users create `/test`, `/review`, `/component Button` as shortcuts for common prompts. It reduces repetitive typing and standardizes team workflows.

### Scope

- Markdown files with YAML frontmatter (`description`, `agent`, `model`)
- Template body supports placeholders: `$ARGUMENTS`, `$1`, `$2`, ...
- Shell output injection: `` !`command` `` runs a shell command and inserts stdout
- File inclusion: `@path/to/file` reads the file and inserts its content
- Commands override nothing; built-ins always win

### Kimiflare Prompt

```
Implement custom slash commands for kimiflare.

1. Create `src/commands/loader.ts`:
   - `loadCustomCommands()` — globs these paths in order:
     - `.kimiflare/commands/*.md` (project-local)
     - `~/.config/kimiflare/commands/*.md` (global)
   - For each file, parse the filename (without `.md`) as the command name.
   - Parse YAML frontmatter from the file. Expected fields:
     - `description?: string` — shown in help
     - `agent?: "build" | "plan"` — overrides current agent for this command
     - `model?: string` — overrides current model for this command
   - The rest of the file (after frontmatter) is the template body.
   - Return `CustomCommand[]` where each command has `name`, `description`, `template`, `agent?`, `model?`.
   - If two files have the same name, project-local wins over global.

2. Create `src/commands/renderer.ts`:
   - `renderCommand(cmd, rawInput)` — takes a `CustomCommand` and the full user input string (e.g., `/component Button --props color`), returns the rendered prompt string.
   - Replace `$ARGUMENTS` with everything after the command name (`Button --props color`).
   - Replace `$1`, `$2`, etc. with positional arguments (split on whitespace, respecting quotes).
   - Replace `` !`command` `` patterns: detect backtick-wrapped commands prefixed with `!`, run them via `bash -c`, and insert their stdout into the template. Fail gracefully if the command errors.
   - Replace `@path/to/file` patterns: read the file relative to cwd and insert its content. Fail gracefully if missing.

3. Modify `src/app.tsx`:
   - On app mount (after config loads), call `loadCustomCommands()` and store the result in a ref or state.
   - In `handleSlash`, after checking all built-in commands, check if the input matches a custom command name.
   - If matched:
     - Render the template via `renderCommand`.
     - If the command specifies `agent` or `model`, temporarily override for this turn (or show an info event saying which overrides apply).
     - Send the rendered prompt as a user message and run the agent turn.
   - Add custom commands to `/help` output under a "Custom commands" section, listing name + description.

4. Add an example command file at `backlog/example-commands/test.md`:
   ```markdown
   ---
   description: Run tests and analyze failures
   ---
   Run the full test suite with coverage report and show any failures.
   Focus on the failing tests and suggest fixes.
   ```

5. Don't implement subtask/agent-switching logic beyond model/agent overrides for now. Keep it simple: the rendered prompt is just sent as a user message in the current session.
```

---

## Notes

- All three features are independent and can be built in any order.
- MCP is the highest leverage but also the most complex.
- Undo/redo is the most user-facing safety improvement.
- Custom commands are the easiest win and good for dogfooding.
