import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "./diff.js";

function patch(oldStr: string, newStr: string): string {
  return createTwoFilesPatch("f", "f", oldStr, newStr, "", "", { context: 2 });
}

describe("createTwoFilesPatch", () => {
  it("identical strings produce headers-only patch", () => {
    const result = patch("a\nb\nc\n", "a\nb\nc\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n",
    );
  });

  it("empty both sides", () => {
    const result = patch("", "");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n",
    );
  });

  it("empty old side", () => {
    const result = patch("", "a\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -0,0 +1,1 @@\n" +
        "+a\n",
    );
  });

  it("empty new side", () => {
    const result = patch("a\n", "");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,1 +0,0 @@\n" +
        "-a\n",
    );
  });

  it("single line changed", () => {
    const result = patch("a\nb\nc\n", "a\nX\nc\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,3 +1,3 @@\n" +
        " a\n" +
        "-b\n" +
        "+X\n" +
        " c\n",
    );
  });

  it("no trailing newline old", () => {
    const result = patch("a\nb", "a\nb\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,2 +1,2 @@\n" +
        " a\n" +
        "-b\n" +
        "\\ No newline at end of file\n" +
        "+b\n",
    );
  });

  it("no trailing newline new", () => {
    const result = patch("a\nb\n", "a\nb");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,2 +1,2 @@\n" +
        " a\n" +
        "-b\n" +
        "+b\n" +
        "\\ No newline at end of file\n",
    );
  });

  it("no trailing newline both", () => {
    const result = patch("a\nb", "a\nX");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,2 +1,2 @@\n" +
        " a\n" +
        "-b\n" +
        "\\ No newline at end of file\n" +
        "+X\n" +
        "\\ No newline at end of file\n",
    );
  });

  it("multi hunk", () => {
    const result = patch(
      "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n",
      "1\n2\n3\nX\n5\n6\n7\nY\n9\n10\n",
    );
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -2,9 +2,9 @@\n" +
        " 2\n" +
        " 3\n" +
        "-4\n" +
        "+X\n" +
        " 5\n" +
        " 6\n" +
        " 7\n" +
        "-8\n" +
        "+Y\n" +
        " 9\n" +
        " 10\n",
    );
  });

  it("special chars", () => {
    const result = patch("foo\tbar\n", "foo\tbaz\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,1 +1,1 @@\n" +
        "-foo\tbar\n" +
        "+foo\tbaz\n",
    );
  });

  it("long context", () => {
    const result = patch(
      "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n",
      "a\nb\nc\nd\ne\nX\ng\nh\ni\nj\n",
    );
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -4,5 +4,5 @@\n" +
        " d\n" +
        " e\n" +
        "-f\n" +
        "+X\n" +
        " g\n" +
        " h\n",
    );
  });

  it("whitespace only change", () => {
    const result = patch("  a\n", "a\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,1 +1,1 @@\n" +
        "-  a\n" +
        "+a\n",
    );
  });

  it("CRLF old", () => {
    const result = patch("a\r\nb\r\n", "a\nb\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,2 +1,2 @@\n" +
        "-a\r\n" +
        "-b\r\n" +
        "+a\n" +
        "+b\n",
    );
  });

  it("add at end", () => {
    const result = patch("a\n", "a\nb\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,1 +1,2 @@\n" +
        " a\n" +
        "+b\n",
    );
  });

  it("remove at end", () => {
    const result = patch("a\nb\n", "a\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,2 +1,1 @@\n" +
        " a\n" +
        "-b\n",
    );
  });

  it("replace all", () => {
    const result = patch("a\nb\nc\n", "x\ny\nz\n");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,3 +1,3 @@\n" +
        "-a\n" +
        "-b\n" +
        "-c\n" +
        "+x\n" +
        "+y\n" +
        "+z\n",
    );
  });

  it("single line no newline", () => {
    const result = patch("hello", "world");
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -1,1 +1,1 @@\n" +
        "-hello\n" +
        "\\ No newline at end of file\n" +
        "+world\n" +
        "\\ No newline at end of file\n",
    );
  });

  it("large identical prefix and suffix", () => {
    const result = patch(
      "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n",
      "1\n2\n3\n4\nX\n6\n7\n8\n9\n10\n",
    );
    assert.equal(
      result,
      "Index: f\n" +
        "===================================================================\n" +
        "--- f\t\n" +
        "+++ f\t\n" +
        "@@ -3,5 +3,5 @@\n" +
        " 3\n" +
        " 4\n" +
        "-5\n" +
        "+X\n" +
        " 6\n" +
        " 7\n",
    );
  });
});
