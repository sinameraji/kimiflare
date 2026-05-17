/**
 * Code-mode + heavy-tier discoverability nudge.
 *
 * Fired once per session at the start of the first heavy + code-mode
 * turn where the Agent tool is actually in the per-turn tool list. The
 * nudge explains the Promise.all parallel-dispatch pattern so the
 * model treats Agent as a first-class code-mode primitive instead of
 * defaulting to inline reads.
 *
 * One-shot per session: subsequent turns don't repeat the nudge so the
 * conversation history doesn't fill with copies. Tied to sessionId so
 * a brand-new session starts the cycle over.
 *
 * Gating happens at the call site (loop.ts) — this module just owns
 * the once-per-session bookkeeping.
 */

const codeModeNudgeFired = new Set<string>();

export function _resetCodeModeNudgeForTests(): void {
  codeModeNudgeFired.clear();
}

export function shouldFireCodeModeNudge(sessionId: string | undefined): boolean {
  const key = sessionId ?? "default";
  if (codeModeNudgeFired.has(key)) return false;
  codeModeNudgeFired.add(key);
  return true;
}

export const CODE_MODE_NUDGE_TEXT = [
  "Code mode + Agent dispatch compose. For independent sub-investigations,",
  "use Promise.all to run subagents in parallel inside a single execute_code",
  "script — each child runs with its own isolated context and you receive",
  "their summaries together. Example:",
  "",
  "  const [a, b, c] = await Promise.all([",
  "    api.Agent({ subagent_type: \"explore\", description: \"task 1\", prompt: \"...\" }),",
  "    api.Agent({ subagent_type: \"explore\", description: \"task 2\", prompt: \"...\" }),",
  "    api.Agent({ subagent_type: \"explore\", description: \"task 3\", prompt: \"...\" }),",
  "  ]);",
  "",
  "Prefer this over reading many files inline when the sub-tasks are",
  "independent — it keeps each child's context lean and runs concurrently.",
  "Reach for inline reads/greps when the work is sequential or tightly coupled.",
].join("\n");
