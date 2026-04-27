import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns whole input as body when no frontmatter fence", () => {
    const r = parseFrontmatter("just body\nno fence");
    assert.equal(r.body, "just body\nno fence");
    assert.deepEqual(r.data, {});
    assert.deepEqual(r.errors, []);
  });

  it("parses simple flat keys", () => {
    const r = parseFrontmatter("---\ndescription: hi\nmodel: foo\n---\nbody\n");
    assert.equal(r.data.description, "hi");
    assert.equal(r.data.model, "foo");
    assert.equal(r.body, "body\n");
    assert.deepEqual(r.errors, []);
  });

  it("strips matched double-quote pairs", () => {
    const r = parseFrontmatter('---\ndescription: "hello world"\n---\n');
    assert.equal(r.data.description, "hello world");
  });

  it("strips matched single-quote pairs", () => {
    const r = parseFrontmatter("---\ndescription: 'hello world'\n---\n");
    assert.equal(r.data.description, "hello world");
  });

  it("does not strip mismatched quotes", () => {
    const r = parseFrontmatter("---\ndescription: \"hello'\n---\n");
    assert.equal(r.data.description, "\"hello'");
  });

  it("ignores comment lines and blank lines", () => {
    const r = parseFrontmatter("---\n# a comment\n\nmodel: foo\n---\n");
    assert.equal(r.data.model, "foo");
    assert.deepEqual(r.errors, []);
  });

  it("flags unparseable lines with errors", () => {
    const r = parseFrontmatter("---\nthis is not valid\n---\nbody\n");
    assert.deepEqual(r.data, {});
    assert.ok(r.errors.some((e) => e.includes("unparseable line")));
  });

  it("flags unclosed frontmatter", () => {
    const r = parseFrontmatter("---\ndescription: oops\nbody without close\n");
    assert.ok(r.errors.some((e) => e.includes("not closed")));
  });

  it("supports CRLF line endings", () => {
    const r = parseFrontmatter("---\r\ndescription: hi\r\n---\r\nbody\r\n");
    assert.equal(r.data.description, "hi");
    assert.equal(r.body, "body\r\n");
  });

  it("trims trailing whitespace from values", () => {
    const r = parseFrontmatter("---\ndescription:    hi   \n---\n");
    assert.equal(r.data.description, "hi");
  });

  it("accepts keys with hyphens, digits, and underscores", () => {
    const r = parseFrontmatter("---\nfoo-bar: 1\nfoo1: 2\nfoo_bar: 3\n---\n");
    assert.equal(r.data["foo-bar"], "1");
    assert.equal(r.data.foo1, "2");
    assert.equal(r.data.foo_bar, "3");
    assert.deepEqual(r.errors, []);
  });
});
