import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  HOOK_EVENTS,
  type HookConfig,
  type HookEvent,
  type KimiflareSettings,
} from "./types.js";

/** Path to the global settings file. Honors XDG_CONFIG_HOME like the
 *  rest of the codebase. */
export function globalSettingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "settings.json");
}

/** Path to the per-project settings file, given a cwd. */
export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".kimiflare", "settings.json");
}

function readSettingsFile(path: string): KimiflareSettings | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as KimiflareSettings) : null;
  } catch {
    return null;
  }
}

/** Stable id derived from `event + command` for hooks that didn't set
 *  one explicitly. Eight hex chars is plenty for hand-typed disambig
 *  while staying short enough to type into `/hooks enable`. */
function deriveHookId(event: HookEvent, command: string): string {
  const h = createHash("sha256").update(`${event}\0${command}`).digest("hex");
  return h.slice(0, 8);
}

/**
 * Validate + normalize a single hook entry. Drops anything that isn't
 * the right shape rather than throwing — a malformed entry in
 * settings.json should not crash the agent.
 */
function normalizeHook(
  event: HookEvent,
  raw: unknown,
  source: HookConfig["source"],
): HookConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.command !== "string" || !r.command.trim()) return null;
  const enabled = typeof r.enabled === "boolean" ? r.enabled : true;
  const matcher = typeof r.matcher === "string" ? r.matcher : undefined;
  const timeoutMs = typeof r.timeoutMs === "number" && r.timeoutMs > 0 ? r.timeoutMs : undefined;
  const description = typeof r.description === "string" ? r.description : undefined;
  const id = typeof r.id === "string" && r.id.length > 0 ? r.id : deriveHookId(event, r.command);
  return { id, matcher, command: r.command, timeoutMs, enabled, description, source };
}

/** Merge two `hooks` blocks into one. Project entries come after
 *  global entries so they run later for a given event. */
function mergeHookMaps(
  a: KimiflareSettings["hooks"],
  b: KimiflareSettings["hooks"],
): KimiflareSettings["hooks"] {
  const out: KimiflareSettings["hooks"] = {};
  for (const ev of HOOK_EVENTS) {
    const left = a?.[ev] ?? [];
    const right = b?.[ev] ?? [];
    if (left.length + right.length === 0) continue;
    out[ev] = [...left, ...right];
  }
  return out;
}

/**
 * Load + merge global + project settings. Always returns a valid
 * (possibly empty) `KimiflareSettings`. Hook entries are normalized
 * and stamped with their `source`.
 */
export function loadHooksSettings(cwd: string): KimiflareSettings {
  const global = readSettingsFile(globalSettingsPath());
  const project = readSettingsFile(projectSettingsPath(cwd));

  const normalized = (
    raw: KimiflareSettings | null,
    source: NonNullable<HookConfig["source"]>,
  ): KimiflareSettings["hooks"] => {
    const out: KimiflareSettings["hooks"] = {};
    for (const ev of HOOK_EVENTS) {
      const list = raw?.hooks?.[ev];
      if (!Array.isArray(list)) continue;
      const cleaned = list
        .map((h) => normalizeHook(ev, h, source))
        .filter((h): h is HookConfig => h !== null);
      if (cleaned.length > 0) out[ev] = cleaned;
    }
    return out;
  };

  const merged = mergeHookMaps(normalized(global, "global"), normalized(project, "project"));
  return { hooks: merged };
}

// ── Edit operations used by the `/hooks` slash command ───────────────────

/**
 * Append a hook to the chosen settings file (global or project),
 * creating the file + parent dirs if needed. Returns the path
 * written to. Existing entries are preserved.
 */
export function appendHook(
  scope: "global" | "project",
  cwd: string,
  event: HookEvent,
  hook: HookConfig,
): string {
  const path = scope === "global" ? globalSettingsPath() : projectSettingsPath(cwd);
  const existing = readSettingsFile(path) ?? {};
  const hooks = existing.hooks ?? {};
  const list = hooks[event] ?? [];
  // Drop id/source before writing — id will be re-derived on load if
  // user wants stability; source is internal-only.
  const { source: _src, ...toWrite } = hook;
  list.push(toWrite);
  hooks[event] = list;
  existing.hooks = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return path;
}

/**
 * Flip `enabled` on a hook matched by its id. Searches both global
 * and project; the first match wins. Returns the file path that was
 * modified, or null if no hook with that id exists.
 */
export function setHookEnabled(cwd: string, id: string, enabled: boolean): string | null {
  for (const [scope, path] of [
    ["global", globalSettingsPath()],
    ["project", projectSettingsPath(cwd)],
  ] as const) {
    const existing = readSettingsFile(path);
    if (!existing?.hooks) continue;
    let changed = false;
    for (const ev of HOOK_EVENTS) {
      const list = existing.hooks[ev];
      if (!Array.isArray(list)) continue;
      for (const hook of list) {
        if (!hook || typeof hook !== "object") continue;
        const h = hook as HookConfig;
        const hookId = h.id ?? deriveHookId(ev, h.command);
        if (hookId === id) {
          h.enabled = enabled;
          changed = true;
        }
      }
    }
    if (changed) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(existing, null, 2) + "\n", "utf8");
      return path;
    }
    // suppress unused warning
    void scope;
  }
  return null;
}

// Re-export for tests
export { deriveHookId };
