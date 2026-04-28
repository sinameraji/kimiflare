import { relative } from "node:path";
import type { Location, Hover, DocumentSymbol, WorkspaceSymbol, Diagnostic, WorkspaceEdit, CodeAction } from "./protocol.js";
import { fromUri, symbolKindName, diagnosticSeverityName } from "./protocol.js";

export function formatLocation(loc: Location, cwd: string): string {
  const path = fromUri(loc.uri);
  const rel = relative(cwd, path) || path;
  return `${rel}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
}

export function formatLocations(locs: Location | Location[] | null | undefined, cwd: string): string {
  if (!locs) return "No locations found.";
  const arr = Array.isArray(locs) ? locs : [locs];
  if (arr.length === 0) return "No locations found.";
  return arr.map((l) => formatLocation(l, cwd)).join("\n");
}

export function formatHover(hover: Hover | null | undefined): string {
  if (!hover) return "No hover information found.";
  const contents = hover.contents;
  if (typeof contents === "string") {
    return contents;
  }
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }
  return contents.value;
}

export function formatDocumentSymbols(symbols: DocumentSymbol[] | null | undefined, cwd: string, indent = 0): string {
  if (!symbols || symbols.length === 0) return "No symbols found.";
  const lines: string[] = [];
  for (const sym of symbols) {
    const path = fromUri(sym.range.start.line + ":" + (sym.range.start.character + 1));
    const prefix = "  ".repeat(indent);
    const detail = sym.detail ? ` — ${sym.detail}` : "";
    lines.push(`${prefix}${sym.name} (${symbolKindName(sym.kind)})${detail}`);
    if (sym.children && sym.children.length > 0) {
      lines.push(formatDocumentSymbols(sym.children, cwd, indent + 1));
    }
  }
  return lines.join("\n");
}

export function formatWorkspaceSymbols(symbols: WorkspaceSymbol[] | null | undefined, cwd: string): string {
  if (!symbols || symbols.length === 0) return "No symbols found.";
  return symbols
    .map((s) => {
      const path = fromUri(s.location.uri);
      const rel = relative(cwd, path) || path;
      const container = s.containerName ? ` in ${s.containerName}` : "";
      return `${s.name} (${symbolKindName(s.kind)})${container} — ${rel}:${s.location.range.start.line + 1}:${s.location.range.start.character + 1}`;
    })
    .join("\n");
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return "No diagnostics.";
  return diagnostics
    .map((d) => {
      const severity = diagnosticSeverityName(d.severity);
      const code = d.code !== undefined ? ` [${d.code}]` : "";
      const source = d.source ? ` (${d.source})` : "";
      return `${severity}${code}${source} — line ${d.range.start.line + 1}: ${d.message}`;
    })
    .join("\n");
}

export function formatWorkspaceEdit(edit: WorkspaceEdit | null | undefined, cwd: string): string {
  if (!edit) return "No edits.";
  const lines: string[] = [];
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const path = fromUri(uri);
      const rel = relative(cwd, path) || path;
      lines.push(`File: ${rel}`);
      for (const e of edits) {
        lines.push(`  ${e.range.start.line + 1}:${e.range.start.character + 1}-${e.range.end.line + 1}:${e.range.end.character + 1}: ${e.newText}`);
      }
    }
  }
  if (lines.length === 0) return "No edits.";
  return lines.join("\n");
}

export function formatCodeActions(actions: CodeAction[] | null | undefined): string {
  if (!actions || actions.length === 0) return "No code actions available.";
  return actions
    .map((a, i) => {
      const kind = a.kind ? ` [${a.kind}]` : "";
      return `${i + 1}. ${a.title}${kind}`;
    })
    .join("\n");
}
