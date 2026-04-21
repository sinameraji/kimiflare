export type Mode = "edit" | "plan" | "auto";

export const MODES: Mode[] = ["edit", "plan", "auto"];

export function nextMode(m: Mode): Mode {
  const i = MODES.indexOf(m);
  return MODES[(i + 1) % MODES.length]!;
}

export function modeDescription(m: Mode): string {
  switch (m) {
    case "edit":
      return "edit — default; prompts for permission before mutating tools";
    case "plan":
      return "plan — read-only research; blocks writes/edits/bash until you exit plan mode";
    case "auto":
      return "auto — autonomous; auto-approves every tool call (use with care)";
  }
}

export const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

export function isBlockedInPlanMode(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName);
}

export function systemPromptForMode(m: Mode): string {
  if (m === "plan") {
    return "\n\nPLAN MODE is active. The user wants you to investigate and produce a plan WITHOUT making any changes. Do not call write, edit, or bash. Only use read/glob/grep/web-fetch. At the end, present a concise plan (bullets, files to change, approach). The user will review and then exit plan mode to execute.";
  }
  if (m === "auto") {
    return "\n\nAUTO MODE is active. The user has opted into autonomous execution — every tool call will be auto-approved. Work efficiently, but do not take irreversible destructive actions (rm -rf, git push --force, dropping tables, etc.) without pausing to describe them in chat first. Prefer smaller reversible steps.";
  }
  return "";
}
