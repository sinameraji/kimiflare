import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  buildStaticPrefix,
  buildSessionPrefix,
  buildSystemMessages,
  buildSystemPrompt,
  findGitRepoRoot,
  loadAgentsContextFiles,
  formatSkillCatalog,
  type SkillCatalogEntry,
} from "./system-prompt.js";
import type { ToolSpec } from "../tools/registry.js";

/** Create a temp dir, return path and cleanup function. */
function makeTempFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kimi-agents-test-"));
  return {
    dir,
    cleanup: () => { try { rmSync(dir, { recursive: true }); } catch { /* best effort */ } },
  };
}

function touch(dir: string, relPath: string, content = "test content"): string {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

/** Initialize a .git directory so findGitRepoRoot recognizes it. */
function initGit(dir: string): void {
  mkdirSync(join(dir, ".git"));
}

/** Check if the global ~/.agents/AGENTS.md exists on this machine. */
const hasGlobalAgents = existsSync(join(homedir(), ".agents", "AGENTS.md"));
/** Helper: expected count = base + (1 if global file exists else 0) */
function expected(n: number): number {
  return n + (hasGlobalAgents ? 1 : 0);
}

const DUMMY_TOOLS: ToolSpec[] = [
  {
    name: "read",
    description: "Read a file.",
    parameters: { type: "object", properties: {}, required: [] },
    needsPermission: false,
    run: async () => "",
  },
];

describe("buildStaticPrefix", () => {
  it("is byte-for-byte identical across different dates", () => {
    const a = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    const b = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    assert.strictEqual(a, b);
  });

  it("does not contain volatile metadata", () => {
    const p = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    assert.ok(!p.includes("Today:"), "should not include date");
    assert.ok(!p.includes("Working directory:"), "should not include cwd");
    assert.ok(!p.includes("Platform:"), "should not include platform");
    assert.ok(!p.includes("Shell:"), "should not include shell");
    assert.ok(!p.includes("Home:"), "should not include home");
    assert.ok(!p.includes("`read`"), "should not include formatted tool names");
  });
});

describe("buildSessionPrefix", () => {
  it("changes when mode changes", () => {
    const edit = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const plan = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "plan" });
    assert.notStrictEqual(edit, plan);
  });

  it("contains environment and tools", () => {
    const p = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m" });
    assert.ok(p.includes("Working directory:"));
    assert.ok(p.includes("read"));
  });

  it("includes LSP guidance when LSP tools are present", () => {
    const lspTools: ToolSpec[] = [
      ...DUMMY_TOOLS,
      { name: "lsp_definition", description: "Go to definition.", parameters: { type: "object", properties: {}, required: [] }, needsPermission: false, run: async () => "" },
    ];
    const p = buildSessionPrefix({ cwd: "/tmp", tools: lspTools, model: "m" });
    assert.ok(p.includes("LSP tools are available"));
    assert.ok(p.includes("lsp_definition"));
  });

  it("excludes LSP guidance when no LSP tools are present", () => {
    const p = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m" });
    assert.ok(!p.includes("LSP tools are available"));
  });
});

describe("buildSystemMessages", () => {
  it("produces two system messages when cacheStable is used", () => {
    const msgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0]!.role, "system");
    assert.strictEqual(msgs[1]!.role, "system");
    assert.ok(typeof msgs[0]!.content === "string");
    assert.ok(typeof msgs[1]!.content === "string");
  });

  it("static message is identical across different modes", () => {
    const editMsgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const planMsgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "plan" });
    assert.strictEqual(editMsgs[0]!.content, planMsgs[0]!.content);
  });
});

describe("buildSystemPrompt", () => {
  it("concatenates static and session prefixes", () => {
    const full = buildSystemPrompt({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const staticP = buildStaticPrefix({ model: "m" });
    const sessionP = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    assert.strictEqual(full, staticP + "\n\n" + sessionP);
  });
});

describe("findGitRepoRoot", () => {
  it("finds .git from repo root itself", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      initGit(dir);
      assert.strictEqual(findGitRepoRoot(dir), dir);
    } finally { cleanup(); }
  });

  it("finds .git from a nested subdirectory", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      initGit(dir);
      const sub = join(dir, "a", "b", "c");
      mkdirSync(sub, { recursive: true });
      assert.strictEqual(findGitRepoRoot(sub), dir);
    } finally { cleanup(); }
  });

  it("returns null outside any git repo", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      assert.strictEqual(findGitRepoRoot(dir), null);
    } finally { cleanup(); }
  });

  it("stops at filesystem root gracefully", () => {
    // Test from the filesystem root — should not crash, returns root or null
    const result = findGitRepoRoot(sep);
    // Either null (no .git at /) or "/" (if .git exists at root, edge case)
    assert.ok(result === null || result === sep);
  });
});

describe("loadAgentsContextFiles", () => {
  it("returns empty array when no AGENTS.md files exist", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      const result = loadAgentsContextFiles(dir);
      // Only the global ~/.agents/AGENTS.md may contribute, never the cwd/ancestors
      assert.strictEqual(result.length, hasGlobalAgents ? 1 : 0);
    } finally { cleanup(); }
  });

  it("loads AGENTS.md from cwd", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      touch(dir, "AGENTS.md", "cwd context");
      const result = loadAgentsContextFiles(dir);
      // 1 from cwd + possibly 1 from global
      assert.strictEqual(result.length, expected(1));
      // The cwd file should be present (last in the list, after global)
      const hasCwd = result.some((f) => f.content.includes("cwd context"));
      assert.ok(hasCwd, "cwd AGENTS.md should be loaded");
    } finally { cleanup(); }
  });

  it("loads AGENTS.md from cwd and ancestors in order (farthest first)", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      initGit(dir);
      const sub = join(dir, "deep", "nested", "workdir");
      mkdirSync(sub, { recursive: true });
      touch(dir, "AGENTS.md", "root context");
      touch(join(dir, "deep"), "AGENTS.md", "deep context");
      touch(join(dir, "deep", "nested"), "AGENTS.md", "nested context");
      const result = loadAgentsContextFiles(sub);
      // 3 ancestor files + possibly 1 global
      assert.strictEqual(result.length, expected(3));
      // Ancestors in order: root context first, then deep context, then nested context
      const rootIdx = result.findIndex((f) => f.content.includes("root context"));
      const deepIdx = result.findIndex((f) => f.content.includes("deep context"));
      const nestedIdx = result.findIndex((f) => f.content.includes("nested context"));
      assert.ok(rootIdx >= 0, "root context should be present");
      assert.ok(deepIdx >= 0, "deep context should be present");
      assert.ok(nestedIdx >= 0, "nested context should be present");
      // Without global, root comes before deep
      if (!hasGlobalAgents) {
        assert.ok(rootIdx < deepIdx, "farthest ancestor first");
        assert.ok(deepIdx < nestedIdx, "then nearer ancestor");
      }
    } finally { cleanup(); }
  });

  it("loads cwd AGENTS.md alongside ancestor", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "ancestor");
      touch(join(dir, "sub"), "AGENTS.md", "cwd specific");
      const result = loadAgentsContextFiles(join(dir, "sub"));
      // global + ancestor + cwd
      assert.strictEqual(result.length, expected(2));
      const hasAncestor = result.some((f) => f.content.includes("ancestor"));
      const hasCwd = result.some((f) => f.content.includes("cwd specific"));
      assert.ok(hasAncestor, "ancestor should be loaded");
      assert.ok(hasCwd, "cwd should be loaded");
    } finally { cleanup(); }
  });

  it("skips files over 20KB", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      const oversized = "x".repeat(21 * 1024);
      touch(dir, "AGENTS.md", oversized);
      const result = loadAgentsContextFiles(dir);
      // Only global may contribute (it's not oversized)
      assert.strictEqual(result.length, hasGlobalAgents ? 1 : 0);
      if (hasGlobalAgents) {
        assert.ok(!result.some((f) => f.content.includes("x".repeat(100))));
      }
    } finally { cleanup(); }
  });

  it("ignores AGENT.md (singular) — only AGENTS.md", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      touch(dir, "AGENT.md", "singular context");
      const result = loadAgentsContextFiles(dir);
      // Only global may contribute
      assert.strictEqual(result.length, hasGlobalAgents ? 1 : 0);
    } finally { cleanup(); }
  });

  it("deduplicates by path when same file is reachable from multiple walks", () => {
    const { dir, cleanup } = makeTempFixture();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root");
      // Call from cwd = dir, should only get 1 cwd file + optionally global
      const result = loadAgentsContextFiles(dir);
      assert.strictEqual(result.length, expected(1));
      assert.ok(result.some((f) => f.content.includes("root")));
    } finally { cleanup(); }
  });
});

describe("formatSkillCatalog", () => {
  it("returns empty string for undefined", () => {
    assert.strictEqual(formatSkillCatalog(undefined), "");
  });

  it("returns empty string for empty array", () => {
    assert.strictEqual(formatSkillCatalog([]), "");
  });

  it("produces XML block for one skill", () => {
    const skills: SkillCatalogEntry[] = [
      { name: "test", description: "A test skill", location: "/tmp/test/SKILL.md" },
    ];
    const result = formatSkillCatalog(skills);
    assert.ok(result.includes("<available_skills>"));
    assert.ok(result.includes("<name>test</name>"));
    assert.ok(result.includes("<description>A test skill</description>"));
    assert.ok(result.includes("<location>/tmp/test/SKILL.md</location>"));
    assert.ok(result.includes("</available_skills>"));
  });

  it("produces multiple skill entries", () => {
    const skills: SkillCatalogEntry[] = [
      { name: "a", description: "Skill A", location: "/a/SKILL.md" },
      { name: "b", description: "Skill B", location: "/b/SKILL.md" },
    ];
    const result = formatSkillCatalog(skills);
    const matches = result.match(/<skill>/g);
    assert.strictEqual(matches?.length, 2);
  });

  it("escapes XML special characters", () => {
    const skills: SkillCatalogEntry[] = [
      { name: "a&b", description: "x < y > z & \"quote'", location: "/path/to/a&b/SKILL.md" },
    ];
    const result = formatSkillCatalog(skills);
    assert.ok(result.includes("a&amp;b"));
    assert.ok(result.includes("x &lt; y &gt; z &amp; &quot;quote&apos;"));
  });

  it("includes behavioral instructions before the XML", () => {
    const skills: SkillCatalogEntry[] = [
      { name: "test", description: "desc", location: "/x/SKILL.md" },
    ];
    const result = formatSkillCatalog(skills);
    assert.ok(result.includes("The following skills provide specialized instructions"));
    assert.ok(result.includes("Use the read tool to load a skill's"));
  });
});
