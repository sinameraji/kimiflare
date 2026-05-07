import { describe, it } from "node:test";
import assert from "node:assert";
import { AbortScope } from "./abort-scope.js";

describe("AbortScope", () => {
  it("creates a standalone scope that can be aborted", () => {
    const scope = new AbortScope();
    assert.strictEqual(scope.isAborted, false);
    scope.abort("test");
    assert.strictEqual(scope.isAborted, true);
    assert.strictEqual(scope.reason, "test");
    assert.strictEqual(scope.signal.aborted, true);
  });

  it("propagates abort from parent to child", () => {
    const parent = new AbortScope();
    const child = parent.createChild();
    assert.strictEqual(child.isAborted, false);
    parent.abort("parent_gone");
    assert.strictEqual(child.isAborted, true);
    assert.strictEqual(child.reason, "parent_gone");
  });

  it("propagates abort from grandparent to grandchild", () => {
    const grandparent = new AbortScope();
    const parent = grandparent.createChild();
    const child = parent.createChild();
    grandparent.abort("root");
    assert.strictEqual(parent.isAborted, true);
    assert.strictEqual(child.isAborted, true);
  });

  it("does not propagate abort from child to parent", () => {
    const parent = new AbortScope();
    const child = parent.createChild();
    child.abort("child_gone");
    assert.strictEqual(parent.isAborted, false);
    assert.strictEqual(child.isAborted, true);
  });

  it("detaches child from parent", () => {
    const parent = new AbortScope();
    const child = parent.createChild();
    child.detach();
    parent.abort("parent_gone");
    assert.strictEqual(child.isAborted, false);
  });

  it("returns an already-aborted child when parent is already aborted", () => {
    const parent = new AbortScope();
    parent.abort("done");
    const child = parent.createChild();
    assert.strictEqual(child.isAborted, true);
  });

  it("idempotent abort", () => {
    const scope = new AbortScope();
    scope.abort("first");
    scope.abort("second");
    assert.strictEqual(scope.reason, "first");
  });
});
