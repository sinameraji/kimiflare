import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatLocation,
  formatLocations,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatDiagnostics,
  formatWorkspaceEdit,
  formatCodeActions,
} from "./adapter.js";
import type { Location, Hover, DocumentSymbol, WorkspaceSymbol, Diagnostic, WorkspaceEdit, CodeAction } from "./protocol.js";

const CWD = "/project";

function loc(uri: string, line: number, char: number): Location {
  return { uri, range: { start: { line, character: char }, end: { line, character: char } } };
}

describe("formatLocation", () => {
  it("formats a location with relative path", () => {
    const result = formatLocation(loc("file:///project/src/index.ts", 4, 9), CWD);
    assert.strictEqual(result, "src/index.ts:5:10");
  });

  it("falls back to absolute path when outside cwd", () => {
    const result = formatLocation(loc("file:///other/project/foo.ts", 0, 0), CWD);
    assert.ok(result.includes("/other/project/foo.ts"));
  });
});

describe("formatLocations", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatLocations(null, CWD), "No locations found.");
  });

  it("returns fallback for empty array", () => {
    assert.strictEqual(formatLocations([], CWD), "No locations found.");
  });

  it("formats multiple locations", () => {
    const result = formatLocations([loc("file:///project/a.ts", 0, 0), loc("file:///project/b.ts", 1, 2)], CWD);
    assert.strictEqual(result, "a.ts:1:1\nb.ts:2:3");
  });

  it("formats single location", () => {
    const result = formatLocations(loc("file:///project/a.ts", 0, 0), CWD);
    assert.strictEqual(result, "a.ts:1:1");
  });
});

describe("formatHover", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatHover(null), "No hover information found.");
  });

  it("formats string contents", () => {
    assert.strictEqual(formatHover({ contents: "hello" }), "hello");
  });

  it("formats array of strings", () => {
    assert.strictEqual(formatHover({ contents: ["a", "b"] }), "a\n\nb");
  });

  it("formats MarkupContent", () => {
    assert.strictEqual(formatHover({ contents: { language: "markdown", value: "md" } }), "md");
  });

  it("formats mixed array", () => {
    assert.strictEqual(formatHover({ contents: ["a", { language: "plaintext", value: "b" }] }), "a\n\nb");
  });
});

describe("formatDocumentSymbols", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatDocumentSymbols(null, CWD), "No symbols found.");
  });

  it("returns fallback for empty array", () => {
    assert.strictEqual(formatDocumentSymbols([], CWD), "No symbols found.");
  });

  it("formats flat symbols", () => {
    const symbols: DocumentSymbol[] = [
      { name: "foo", kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, detail: "function" },
      { name: "bar", kind: 13, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
    ];
    const result = formatDocumentSymbols(symbols, CWD);
    assert.ok(result.includes("foo (function) — function"));
    assert.ok(result.includes("bar (variable)"));
  });

  it("formats nested symbols", () => {
    const symbols: DocumentSymbol[] = [
      {
        name: "MyClass",
        kind: 5,
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        children: [
          { name: "method", kind: 6, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }, selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } } },
        ],
      },
    ];
    const result = formatDocumentSymbols(symbols, CWD);
    assert.ok(result.includes("MyClass (class)"));
    assert.ok(result.includes("  method (method)"));
  });
});

describe("formatWorkspaceSymbols", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatWorkspaceSymbols(null, CWD), "No symbols found.");
  });

  it("formats symbols with container", () => {
    const symbols: WorkspaceSymbol[] = [
      { name: "foo", kind: 12, location: loc("file:///project/src/a.ts", 4, 0), containerName: "MyClass" },
    ];
    const result = formatWorkspaceSymbols(symbols, CWD);
    assert.ok(result.includes("foo (function) in MyClass"));
    assert.ok(result.includes("src/a.ts:5:1"));
  });
});

describe("formatDiagnostics", () => {
  it("returns fallback for empty array", () => {
    assert.strictEqual(formatDiagnostics([]), "No diagnostics.");
  });

  it("formats error diagnostic", () => {
    const diagnostics: Diagnostic[] = [
      { range: { start: { line: 4, character: 0 }, end: { line: 4, character: 1 } }, severity: 1, code: "TS2345", source: "tsc", message: "Type mismatch" },
    ];
    const result = formatDiagnostics(diagnostics);
    assert.ok(result.includes("error [TS2345] (tsc)"));
    assert.ok(result.includes("line 5: Type mismatch"));
  });

  it("formats warning without code or source", () => {
    const diagnostics: Diagnostic[] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: "Unused var" },
    ];
    const result = formatDiagnostics(diagnostics);
    assert.ok(result.includes("warning"));
    assert.ok(result.includes("line 1: Unused var"));
  });
});

describe("formatWorkspaceEdit", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatWorkspaceEdit(null, CWD), "No edits.");
  });

  it("formats changes", () => {
    const edit: WorkspaceEdit = {
      changes: {
        "file:///project/src/a.ts": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "bar" }],
      },
    };
    const result = formatWorkspaceEdit(edit, CWD);
    assert.ok(result.includes("File: src/a.ts"));
    assert.ok(result.includes("1:1-1:4: bar"));
  });

  it("returns fallback when no changes", () => {
    const edit: WorkspaceEdit = {};
    assert.strictEqual(formatWorkspaceEdit(edit, CWD), "No edits.");
  });
});

describe("formatCodeActions", () => {
  it("returns fallback for null", () => {
    assert.strictEqual(formatCodeActions(null), "No code actions available.");
  });

  it("returns fallback for empty array", () => {
    assert.strictEqual(formatCodeActions([]), "No code actions available.");
  });

  it("formats actions with kind", () => {
    const actions: CodeAction[] = [
      { title: "Fix import", kind: "quickfix" },
      { title: "Remove unused" },
    ];
    const result = formatCodeActions(actions);
    assert.ok(result.includes("1. Fix import [quickfix]"));
    assert.ok(result.includes("2. Remove unused"));
  });
});
