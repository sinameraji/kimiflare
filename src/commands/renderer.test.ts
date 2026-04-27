import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderCommand, tokenizeArgs } from "./renderer.js";
import type { CustomCommand } from "./types.js";

const cmd = (template: string, extras: Partial<CustomCommand> = {}): CustomCommand => ({
  name: "test", template, source: "project", filepath: "/fake.md", ...extras,
});
const tempDir = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), "kimiflare-renderer-"));
const writeIn = async (dir: string, name: string, contents: string): Promise<string> => {
  await writeFile(path.join(dir, name), contents, "utf8");
  return name;
};

describe("renderer", () => {
  it("tokenizes bare words", () => {
    assert.deepStrictEqual(tokenizeArgs("hello world"), ["hello", "world"]);
  });
  it("keeps double-quoted words together", () => {
    assert.deepStrictEqual(tokenizeArgs('"two words" three'), ["two words", "three"]);
  });
  it("keeps mixed quoted words together", () => {
    assert.deepStrictEqual(tokenizeArgs("'a b' c \"d e\""), ["a b", "c", "d e"]);
  });
  it("$ARGUMENTS raw substitution preserves quotes/whitespace", async () => {
    const result = await renderCommand(cmd("run $ARGUMENTS"), '  "a b"   c  ');
    assert.strictEqual(result.prompt, 'run   "a b"   c  ');
  });
  it("$1 $2 substitutes first/second token", async () => {
    assert.strictEqual((await renderCommand(cmd("$1 $2"), "hello world")).prompt, "hello world");
  });
  it("highest $N absorbs trailing tokens", async () => {
    const result = await renderCommand(cmd("$1 $3"), "a b c d e");
    assert.match(result.prompt, /a/);
    assert.match(result.prompt, /c d e/);
  });
  it("implicitly appends args when template has no placeholders", async () => {
    assert.strictEqual((await renderCommand(cmd("base"), "foo bar")).prompt, "base\n\nfoo bar");
  });
  it("does not append when template has $ARGUMENTS even if rendered args are empty", async () => {
    assert.strictEqual((await renderCommand(cmd("base $ARGUMENTS"), "")).prompt, "base ");
  });
  it("does not append when args are empty", async () => {
    assert.strictEqual((await renderCommand(cmd("base"), "")).prompt, "base");
  });
  it("substitutes shell output", async () => {
    assert.strictEqual((await renderCommand(cmd("!`echo hello`"), "")).prompt, "hello");
  });
  it("warns and substitutes empty string on shell timeout", async () => {
    const result = await renderCommand(cmd("!`sleep 2`"), "", { shellTimeoutMs: 100 });
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((warning) => warning.includes("shell command failed")));
  });
  it("substitutes existing temp file contents", async () => {
    const dir = await tempDir();
    const name = await writeIn(dir, "fixture.txt", "hello file");
    assert.strictEqual((await renderCommand(cmd(`@${name}`), "", { cwd: dir })).prompt, "hello file");
  });
  it("warns and substitutes empty string for missing file", async () => {
    const dir = await tempDir();
    const result = await renderCommand(cmd("@missing.txt"), "", { cwd: dir });
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((warning) => warning.includes("file inclusion failed")));
  });
  it("warns and substitutes empty string for oversize file", async () => {
    const dir = await tempDir();
    const name = await writeIn(dir, "big.txt", "x".repeat(200));
    const result = await renderCommand(cmd(`@${name}`), "", { cwd: dir, maxFileBytes: 100 });
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((warning) => warning.includes("exceeds")));
  });
  it("does not treat email addresses as file inclusions", async () => {
    const result = await renderCommand(cmd("Contact me@example.com today"), "");
    assert.strictEqual(result.prompt, "Contact me@example.com today");
  });
  it("does not include backtick-wrapped @ paths", async () => {
    assert.strictEqual((await renderCommand(cmd("`@foo.txt`"), "")).prompt, "`@foo.txt`");
  });
  it("warns when rendered prompt is empty", async () => {
    const result = await renderCommand(cmd("   "), "");
    assert.strictEqual(result.prompt.trim(), "");
    assert.ok(result.warnings.includes("rendered prompt is empty"));
  });
  it("strips leading slash command name before substitution", async () => {
    assert.strictEqual((await renderCommand(cmd("X $ARGUMENTS"), "/test foo bar")).prompt, "X foo bar");
  });
  it("treats args-only input as args", async () => {
    assert.strictEqual((await renderCommand(cmd("X $ARGUMENTS"), "foo bar")).prompt, "X foo bar");
  });
  it("single $N absorbs all remaining tokens", async () => {
    assert.strictEqual((await renderCommand(cmd("$1"), "foo bar baz")).prompt, "foo bar baz");
  });
  it("rejects @file paths outside cwd (parent traversal)", async () => {
    const result = await renderCommand(cmd("@../escape.txt"), "");
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((w) => w.includes("outside workspace")));
  });
  it("rejects @file paths with absolute prefix", async () => {
    const result = await renderCommand(cmd("@/etc/passwd"), "");
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((w) => w.includes("outside workspace")));
  });
  it("rejects @file paths with ~ prefix", async () => {
    const result = await renderCommand(cmd("@~/.ssh/id_rsa"), "");
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((w) => w.includes("outside workspace")));
  });
  it("preserves trailing sentence punctuation outside @file path", async () => {
    const dir = await tempDir();
    const name = await writeIn(dir, "note.txt", "FILE");
    const result = await renderCommand(cmd(`See @${name}.`), "", { cwd: dir });
    assert.strictEqual(result.prompt, "See FILE.");
  });
  it("allows filenames that begin with two dots inside cwd", async () => {
    const dir = await tempDir();
    await writeIn(dir, "..notes.md", "TWO_DOT_NAME");
    const result = await renderCommand(cmd("@..notes.md"), "", { cwd: dir });
    assert.strictEqual(result.prompt, "TWO_DOT_NAME");
  });
  it("rejects symlinks inside cwd that point outside", async () => {
    const dir = await tempDir();
    const outside = await tempDir();
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "SECRET", "utf8");
    await symlink(secret, path.join(dir, "link.txt"));
    const result = await renderCommand(cmd("@link.txt"), "", { cwd: dir });
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((w) => w.includes("symlink escapes workspace")));
  });
  it("uses a default shell timeout to bound renders", async () => {
    const start = Date.now();
    const result = await renderCommand(cmd("!`sleep 30`"), "");
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10_000, `expected default timeout to bound render, took ${elapsed}ms`);
    assert.strictEqual(result.prompt, "");
    assert.ok(result.warnings.some((w) => w.includes("shell command failed")));
  });
});
