import { describe, it } from "node:test";
import assert from "node:assert";
import { createTwoFilesPatch } from "./diff.js";

describe("createTwoFilesPatch", () => {
  it("identical strings produce headers-only patch", () => {
    const result = createTwoFilesPatch("a", "b", "hello\nworld\n", "hello\nworld\n", "", "", { context: 2 });
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n");
  });

  it("adds a line", () => {
    const result = createTwoFilesPatch("a", "b", "hello\n", "hello\nworld\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +1,2 @@\n hello\n+world\n");
  });

  it("removes a line", () => {
    const result = createTwoFilesPatch("a", "b", "hello\nworld\n", "hello\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,2 +1,1 @@\n hello\n-world\n");
  });

  it("changes a line", () => {
    const result = createTwoFilesPatch("a", "b", "hello\nworld\n", "hello\nearth\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,2 +1,2 @@\n hello\n-world\n+earth\n");
  });

  it("empty old string", () => {
    const result = createTwoFilesPatch("a", "b", "", "hello\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -0,0 +1,1 @@\n+hello\n");
  });

  it("empty new string", () => {
    const result = createTwoFilesPatch("a", "b", "hello\n", "", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +0,0 @@\n-hello\n");
  });

  it("both empty strings", () => {
    const result = createTwoFilesPatch("a", "b", "", "", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n");
  });

  it("no trailing newline in old", () => {
    const result = createTwoFilesPatch("a", "b", "hello", "hello\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-hello\n\\ No newline at end of file\n+hello\n");
  });

  it("no trailing newline in new", () => {
    const result = createTwoFilesPatch("a", "b", "hello\n", "hello", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-hello\n+hello\n\\ No newline at end of file\n");
  });

  it("respects context option", () => {
    const result = createTwoFilesPatch("a", "b", "a\nb\nc\nd\ne\n", "a\nb\nc\nX\ne\n", "", "", { context: 2 });
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -2,4 +2,4 @@\n b\n c\n-d\n+X\n e\n");
  });

  it("multiline change", () => {
    const result = createTwoFilesPatch("a", "b", "a\nb\nc\nd\n", "a\nB\nC\nd\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n");
  });

  it("add at start", () => {
    const result = createTwoFilesPatch("a", "b", "b\nc\n", "a\nb\nc\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,2 +1,3 @@\n+a\n b\n c\n");
  });

  it("remove at start", () => {
    const result = createTwoFilesPatch("a", "b", "a\nb\nc\n", "b\nc\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,3 +1,2 @@\n-a\n b\n c\n");
  });

  it("add at end", () => {
    const result = createTwoFilesPatch("a", "b", "a\nb\n", "a\nb\nc\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,2 +1,3 @@\n a\n b\n+c\n");
  });

  it("remove at end", () => {
    const result = createTwoFilesPatch("a", "b", "a\nb\nc\n", "a\nb\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,3 +1,2 @@\n a\n b\n-c\n");
  });

  it("single line no newline", () => {
    const result = createTwoFilesPatch("a", "b", "a", "b", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n");
  });

  it("single line with newline", () => {
    const result = createTwoFilesPatch("a", "b", "a\n", "b\n", "", "");
    assert.strictEqual(result, "===================================================================\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  });

  it("same filename includes Index header", () => {
    const result = createTwoFilesPatch("file.txt", "file.txt", "a\n", "b\n", "", "");
    assert.strictEqual(result, "Index: file.txt\n===================================================================\n--- file.txt\n+++ file.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  });

  it("quotes filenames with special chars", () => {
    const result = createTwoFilesPatch("file\tname", "file\tname", "a\n", "b\n", "", "");
    assert.strictEqual(result, "Index: file\tname\n===================================================================\n--- \"file\\tname\"\n+++ \"file\\tname\"\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  });
});
