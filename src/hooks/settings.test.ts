import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  loadHooksSettings,
  appendHook,
  setHookEnabled,
  globalSettingsPath,
  projectSettingsPath,
  deriveHookId,
} from "./settings.js";

let projectDir: string;
let xdgDir: string;
let originalXdg: string | undefined;

before(() => {
  // Sandbox both global (via XDG_CONFIG_HOME) and project paths so
  // these tests can't pollute the user's real config.
  originalXdg = process.env.XDG_CONFIG_HOME;
  xdgDir = mkdtempSync(join(tmpdir(), "hooks-xdg-"));
  process.env.XDG_CONFIG_HOME = xdgDir;
});

after(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  rmSync(xdgDir, { recursive: true, force: true });
});

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hooks-project-"));
  // Wipe the sandboxed global settings between tests so tests don't
  // see each other's writes.
  const gp = globalSettingsPath();
  if (existsSync(gp)) rmSync(gp, { force: true });
});

describe("loadHooksSettings", () => {
  it("returns empty hooks when no settings files exist", () => {
    const cfg = loadHooksSettings(projectDir);
    assert.deepStrictEqual(cfg, { hooks: {} });
  });

  it("loads + normalizes a project settings file", () => {
    mkdirSync(join(projectDir, ".kimiflare"), { recursive: true });
    writeFileSync(
      projectSettingsPath(projectDir),
      JSON.stringify({
        hooks: {
          Stop: [{ command: "printf '\\a'", description: "bell" }],
        },
      }),
      "utf8",
    );
    const cfg = loadHooksSettings(projectDir);
    assert.strictEqual(cfg.hooks?.Stop?.length, 1);
    assert.strictEqual(cfg.hooks!.Stop![0]!.enabled, true);
    assert.strictEqual(cfg.hooks!.Stop![0]!.source, "project");
    assert.strictEqual(typeof cfg.hooks!.Stop![0]!.id, "string");
  });

  it("drops malformed hook entries silently", () => {
    mkdirSync(join(projectDir, ".kimiflare"), { recursive: true });
    writeFileSync(
      projectSettingsPath(projectDir),
      JSON.stringify({
        hooks: {
          Stop: [
            { command: "good" },
            { description: "no command" },
            null,
            "not-an-object",
          ],
        },
      }),
      "utf8",
    );
    const cfg = loadHooksSettings(projectDir);
    assert.strictEqual(cfg.hooks?.Stop?.length, 1);
    assert.strictEqual(cfg.hooks!.Stop![0]!.command, "good");
  });

  it("does not crash on invalid JSON", () => {
    mkdirSync(join(projectDir, ".kimiflare"), { recursive: true });
    writeFileSync(projectSettingsPath(projectDir), "{not valid json", "utf8");
    const cfg = loadHooksSettings(projectDir);
    assert.deepStrictEqual(cfg, { hooks: {} });
  });

  it("merges global + project (project entries listed after global)", () => {
    mkdirSync(join(xdgDir, "kimiflare"), { recursive: true });
    writeFileSync(
      globalSettingsPath(),
      JSON.stringify({
        hooks: {
          Stop: [{ command: "global-bell" }],
        },
      }),
      "utf8",
    );
    mkdirSync(join(projectDir, ".kimiflare"), { recursive: true });
    writeFileSync(
      projectSettingsPath(projectDir),
      JSON.stringify({
        hooks: {
          Stop: [{ command: "project-bell" }],
        },
      }),
      "utf8",
    );
    const cfg = loadHooksSettings(projectDir);
    assert.strictEqual(cfg.hooks?.Stop?.length, 2);
    assert.strictEqual(cfg.hooks!.Stop![0]!.source, "global");
    assert.strictEqual(cfg.hooks!.Stop![0]!.command, "global-bell");
    assert.strictEqual(cfg.hooks!.Stop![1]!.source, "project");
    assert.strictEqual(cfg.hooks!.Stop![1]!.command, "project-bell");
  });

  it("preserves explicit enabled=false", () => {
    mkdirSync(join(projectDir, ".kimiflare"), { recursive: true });
    writeFileSync(
      projectSettingsPath(projectDir),
      JSON.stringify({
        hooks: { Stop: [{ command: "x", enabled: false }] },
      }),
      "utf8",
    );
    const cfg = loadHooksSettings(projectDir);
    assert.strictEqual(cfg.hooks?.Stop?.[0]?.enabled, false);
  });
});

describe("deriveHookId", () => {
  it("is stable across runs", () => {
    assert.strictEqual(
      deriveHookId("Stop", "printf '\\a'"),
      deriveHookId("Stop", "printf '\\a'"),
    );
  });

  it("varies with event + command", () => {
    assert.notStrictEqual(
      deriveHookId("Stop", "x"),
      deriveHookId("PreToolUse", "x"),
    );
    assert.notStrictEqual(
      deriveHookId("Stop", "a"),
      deriveHookId("Stop", "b"),
    );
  });

  it("is 8 hex chars", () => {
    assert.match(deriveHookId("Stop", "x"), /^[0-9a-f]{8}$/);
  });
});

describe("appendHook + setHookEnabled", () => {
  it("creates the settings file if it doesn't exist", () => {
    const path = appendHook("project", projectDir, "Stop", {
      command: "printf '\\a'",
      description: "bell",
    });
    assert.ok(existsSync(path));
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.strictEqual(parsed.hooks.Stop.length, 1);
    assert.strictEqual(parsed.hooks.Stop[0].command, "printf '\\a'");
    // `source` is internal — must not bleed into the written file.
    assert.strictEqual(parsed.hooks.Stop[0].source, undefined);
  });

  it("appends to an existing settings file", () => {
    appendHook("project", projectDir, "Stop", { command: "first" });
    appendHook("project", projectDir, "Stop", { command: "second" });
    const parsed = JSON.parse(readFileSync(projectSettingsPath(projectDir), "utf8"));
    assert.strictEqual(parsed.hooks.Stop.length, 2);
    assert.strictEqual(parsed.hooks.Stop[0].command, "first");
    assert.strictEqual(parsed.hooks.Stop[1].command, "second");
  });

  it("setHookEnabled flips a hook with a matching id", () => {
    appendHook("project", projectDir, "Stop", {
      id: "my-hook",
      command: "x",
      enabled: true,
    });
    const path = setHookEnabled(projectDir, "my-hook", false);
    assert.strictEqual(path, projectSettingsPath(projectDir));
    const parsed = JSON.parse(readFileSync(projectSettingsPath(projectDir), "utf8"));
    assert.strictEqual(parsed.hooks.Stop[0].enabled, false);
  });

  it("setHookEnabled returns null when no hook matches", () => {
    assert.strictEqual(setHookEnabled(projectDir, "nonexistent", false), null);
  });
});

// Silence unused homedir import in some test environments.
void homedir;
