# PR1 Development Plan: `/fresh` Command

## Goal
Implement a `/fresh` slash command that extracts the last assistant message (the plan), copies it to clipboard, resets the session, and seeds a new session with just that plan.

## Branch
`feat/fresh-command` (already created off latest main)

## Step-by-Step Implementation

### Step 1: Create `src/agent/distill.ts`
**New file.** Pure function to extract the plan from message history.

```ts
import type { ChatMessage } from "./messages.js";

/**
 * Extract the last substantive assistant message from a conversation.
 * Returns clean plan text, or null if no suitable message found.
 */
export function distillSessionPlan(messages: ChatMessage[]): string | null {
  // Scan in reverse for the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;

    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
    }

    text = text.trim();
    // Require at least some substance (not just "ok" or "done")
    if (text.length > 20) {
      return text;
    }
  }
  return null;
}
```

**Test file:** `src/agent/distill.test.ts`
- Test with no assistant messages → returns null
- Test with short assistant message (<20 chars) → returns null
- Test with valid plan message → returns text
- Test with content parts array → returns concatenated text

### Step 2: Create `src/util/clipboard.ts`
**New file.** Cross-platform clipboard writer with graceful fallback.

```ts
import { execSync } from "node:child_process";
import { platform } from "node:os";

export interface ClipboardResult {
  success: boolean;
  message: string;
}

export function writeToClipboard(text: string): ClipboardResult {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync("pbcopy", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
    if (os === "win32") {
      execSync("clip", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
    // Linux — try xclip first, then xsel
    try {
      execSync("xclip -selection clipboard", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    } catch {
      execSync("xsel --clipboard --input", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
  } catch {
    return {
      success: false,
      message: "Clipboard not available — plan will be shown below",
    };
  }
}
```

### Step 3: Register `/fresh` in built-in commands
**File:** `src/commands/builtins.ts`

Add to `BUILTIN_COMMANDS` array:
```ts
{ name: "fresh", description: "Reset session and start fresh with the last plan", source: "builtin" },
```

### Step 4: Implement `handleFresh` in slash command dispatcher
**File:** `src/ui/slash-commands.ts`

Add to `SlashContext` interface (around line 135):
```ts
resetSession: () => void;
// ... existing
```
*(Note: `resetSession` is already in `SlashContext` via `use-session-manager.ts`)*

Add handler function before the `handlers` record:
```ts
const handleFresh: Handler = (ctx) => {
  const { busy, mkKey, setEvents, messagesRef } = ctx;
  if (busy) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "can't /fresh while model is running — press Esc to interrupt first" },
    ]);
    return true;
  }

  const plan = distillSessionPlan(messagesRef.current);
  if (!plan) {
    setEvents((e) => [
      ...e,
      { kind: "error", key: mkKey(), text: "No plan found to start fresh with." },
    ]);
    return true;
  }

  const { writeToClipboard } = await import("../util/clipboard.js");
  const clipResult = writeToClipboard(plan);

  // Reset session (reuse /clear logic)
  if (ctx.cacheStableRef.current && messagesRef.current.length >= 2) {
    messagesRef.current = [messagesRef.current[0]!, messagesRef.current[1]!];
  } else {
    messagesRef.current = [messagesRef.current[0]!];
  }
  ctx.resetSession();
  ctx.executorRef.current.clearArtifacts();
  if (ctx.flushTimeoutRef.current) {
    clearTimeout(ctx.flushTimeoutRef.current);
    ctx.flushTimeoutRef.current = null;
  }
  ctx.pendingTextRef.current.clear();
  ctx.activeAsstIdRef.current = null;
  ctx.pendingToolCallsRef.current.clear();
  ctx.usageRef.current = null;
  ctx.turnCounterRef.current = 0;
  setEvents([]);
  ctx.setUsage(null);
  ctx.setSessionUsage(null);
  ctx.gatewayMetaRef.current = null;
  ctx.setGatewayMeta(null);
  ctx.clearTaskTracking();
  ctx.compactSuggestedRef.current = false;
  ctx.updateNudgedRef.current = false;

  // Seed with plan
  messagesRef.current.push({ role: "user", content: plan });

  setEvents((e) => [
    ...e,
    {
      kind: "info",
      key: mkKey(),
      text: clipResult.success
        ? "Plan copied to clipboard. Starting fresh session with plan only…"
        : "Clipboard unavailable. Starting fresh session with plan only…",
    },
  ]);

  if (!clipResult.success) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "--- Plan ---\n" + plan },
    ]);
  }

  return true;
};
```

Register in `handlers` record:
```ts
"/fresh": handleFresh,
```

### Step 5: Wire through app.tsx
**File:** `src/app.tsx`

Ensure `resetSession` is passed through `buildSlashContext` dependencies (line ~1423). It already is — verify it's in the dependency array.

### Step 6: Optional nudge on mode switch
**File:** `src/mode.ts` or `src/ui/slash-commands.ts` (`handleMode`)

In `handleMode`, when switching from `plan` to `auto` or `edit`, check message count. If above threshold (e.g., 10 non-system messages), emit a tip:
```ts
if (ctx.mode === "plan" && (arg === "auto" || arg === "edit")) {
  const nonSystemCount = ctx.messagesRef.current.filter((m) => m.role !== "system").length;
  if (nonSystemCount > 10) {
    setEvents((e) => [
      ...e,
      { kind: "info", key: mkKey(), text: "Tip: you have extensive planning context. Run `/fresh` to start clean with just the plan." },
    ]);
  }
}
```

### Step 7: Run typecheck and tests
```bash
npm run typecheck
npm test
```

### Step 8: Update help menu
**File:** `src/ui/help-menu.tsx`

Add `/fresh` to the command list.

### Step 9: Commit
```bash
git add -A
git commit -m "feat: add /fresh command to reset session with distilled plan

- Add distillSessionPlan() to extract last assistant message
- Add cross-platform clipboard utility
- Register /fresh slash command
- Reset session and seed with plan on execution
- Show tip when switching from plan to auto/edit with heavy context

Co-authored-by: kimiflare <kimiflare@proton.me>"
```

## Files Modified / Created

| Status | File |
|--------|------|
| **Create** | `src/agent/distill.ts` |
| **Create** | `src/agent/distill.test.ts` |
| **Create** | `src/util/clipboard.ts` |
| **Modify** | `src/commands/builtins.ts` |
| **Modify** | `src/ui/slash-commands.ts` |
| **Modify** | `src/ui/help-menu.tsx` |
| **Verify** | `src/app.tsx` (deps array) |

## Notes
- Keep `handleFresh` logic DRY with `handleClear` — consider extracting a shared `resetSessionState()` helper if appropriate
- The clipboard utility should be best-effort; never block the core flow
- `distillSessionPlan` is intentionally simple now — it will be reused for PR2 (resume fresh)
