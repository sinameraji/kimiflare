import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";
import type { LspManager } from "../lsp/manager.js";
import { resolvePath, isPathOutside } from "../util/paths.js";
import {
  formatLocation,
  formatLocations,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatDiagnostics,
  formatWorkspaceEdit,
  formatCodeActions,
} from "../lsp/adapter.js";

function makeOutput(content: string): ToolOutput {
  const bytes = Buffer.byteLength(content, "utf8");
  return { content, rawBytes: bytes, reducedBytes: bytes };
}

function resolveLspPath(args: Record<string, unknown>, ctx: ToolContext): string {
  const raw = typeof args.path === "string" ? args.path : "";
  const resolved = resolvePath(ctx.cwd, raw);
  const rel = relative(ctx.cwd, resolved);
  if (isPathOutside(rel)) {
    throw new Error(`Path outside workspace: ${raw}`);
  }
  return resolved;
}

import { relative } from "node:path";

function toLspPosition(args: Record<string, unknown>): { line: number; character: number } {
  const line = typeof args.line === "number" ? Math.max(1, args.line) : 1;
  const col =
    typeof args.column === "number"
      ? args.column
      : typeof args.character === "number"
        ? args.character
        : typeof args.offset === "number"
          ? args.offset
          : 1;
  return { line: line - 1, character: Math.max(0, col - 1) };
}

function toLspRange(args: Record<string, unknown>): { start: { line: number; character: number }; end: { line: number; character: number } } {
  const startLine = typeof args.startLine === "number" ? Math.max(1, args.startLine) : 1;
  const startCol =
    typeof args.startColumn === "number"
      ? args.startColumn
      : typeof args.startCharacter === "number"
        ? args.startCharacter
        : 1;
  const endLine = typeof args.endLine === "number" ? Math.max(1, args.endLine) : startLine;
  const endCol =
    typeof args.endColumn === "number"
      ? args.endColumn
      : typeof args.endCharacter === "number"
        ? args.endCharacter
        : startCol;
  return {
    start: { line: startLine - 1, character: Math.max(0, startCol - 1) },
    end: { line: endLine - 1, character: Math.max(0, endCol - 1) },
  };
}

export function makeLspTools(manager: LspManager): ToolSpec[] {
  const tools: ToolSpec[] = [
    {
      name: "lsp_hover",
      description: "Show type signature and documentation for a symbol at a file:line:column.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
        },
        required: ["path", "line", "column"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.hover(path, toLspPosition(args), ctx.signal);
        return makeOutput(formatHover(result));
      },
    },
    {
      name: "lsp_definition",
      description: "Jump to the definition of a symbol.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
        },
        required: ["path", "line", "column"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.definition(path, toLspPosition(args), ctx.signal);
        return makeOutput(formatLocations(result, ctx.cwd));
      },
    },
    {
      name: "lsp_references",
      description: "Find all references to a symbol across the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
        },
        required: ["path", "line", "column"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.references(path, toLspPosition(args), ctx.signal);
        return makeOutput(formatLocations(result, ctx.cwd));
      },
    },
    {
      name: "lsp_documentSymbols",
      description: "List all symbols defined in a file (classes, functions, variables).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
        },
        required: ["path"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.documentSymbols(path, ctx.signal);
        return makeOutput(formatDocumentSymbols(result, ctx.cwd));
      },
    },
    {
      name: "lsp_workspaceSymbol",
      description: "Search symbols across the entire workspace by name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Symbol name query" },
        },
        required: ["query"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const query = typeof args.query === "string" ? args.query : "";
        // Use first available client for workspace-wide queries
        let result: Awaited<ReturnType<typeof manager.resolveClientForPath>> = undefined;
        for (const status of manager.listActive()) {
          const c = manager.findClient(status.id);
          if (c) {
            result = { id: status.id, client: c };
            break;
          }
        }
        if (!result) return makeOutput("No LSP server available.");
        const symbols = await result.client.workspaceSymbol(query, ctx.signal);
        return makeOutput(formatWorkspaceSymbols(symbols, ctx.cwd));
      },
    },
    {
      name: "lsp_diagnostics",
      description: "Get current errors, warnings, and hints for a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
        },
        required: ["path"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        // Ensure file is open so diagnostics are available
        client.client.didOpen(path, "", "");
        const diagnostics = client.client.getDiagnostics(path);
        return makeOutput(formatDiagnostics(diagnostics));
      },
    },
    {
      name: "lsp_rename",
      description: "Rename a symbol and return the workspace edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
          newName: { type: "string", description: "New symbol name" },
        },
        required: ["path", "line", "column", "newName"],
      },
      needsPermission: true,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.rename(path, toLspPosition(args), String(args.newName), ctx.signal);
        return makeOutput(formatWorkspaceEdit(result, ctx.cwd));
      },
    },
    {
      name: "lsp_codeAction",
      description: "Get available quick fixes or refactorings for a diagnostic range.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          startLine: { type: "integer", description: "1-based start line" },
          startColumn: { type: "integer", description: "1-based start column" },
          endLine: { type: "integer", description: "1-based end line" },
          endColumn: { type: "integer", description: "1-based end column" },
        },
        required: ["path", "startLine", "startColumn", "endLine", "endColumn"],
      },
      needsPermission: true,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.codeAction(path, toLspRange(args), ctx.signal);
        return makeOutput(formatCodeActions(result));
      },
    },
    {
      name: "lsp_implementation",
      description: "Find implementations of an interface or abstract method.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
        },
        required: ["path", "line", "column"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.implementation(path, toLspPosition(args), ctx.signal);
        return makeOutput(formatLocations(result, ctx.cwd));
      },
    },
    {
      name: "lsp_typeDefinition",
      description: "Jump to the type definition of a symbol.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          line: { type: "integer", description: "1-based line number" },
          column: { type: "integer", description: "1-based column number" },
        },
        required: ["path", "line", "column"],
      },
      needsPermission: false,
      run: async (args, ctx) => {
        const path = resolveLspPath(args, ctx);
        const client = manager.resolveClientForPath(path);
        if (!client) return makeOutput("No LSP server available for this file.");
        const result = await client.client.typeDefinition(path, toLspPosition(args), ctx.signal);
        return makeOutput(formatLocations(result, ctx.cwd));
      },
    },
  ];

  // Deterministic ordering (guardrail 9.3)
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}
