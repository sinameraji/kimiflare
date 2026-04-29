import { pathToFileURL, fileURLToPath } from "node:url";

/** Convert a filesystem path to a file:// URI. */
export function toUri(path: string): string {
  return pathToFileURL(path).href;
}

/** Convert a file:// URI to a filesystem path. */
export function fromUri(uri: string): string {
  return fileURLToPath(uri);
}

/** JSON-RPC message types for LSP. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** LSP-specific initialize params / response shapes we need. */
export interface InitializeParams {
  processId: number | null;
  rootUri: string | null;
  capabilities: Record<string, unknown>;
  workspaceFolders?: Array<{ uri: string; name: string }> | null;
}

export interface InitializeResult {
  capabilities: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
}

/** Text document sync kinds. */
export const TextDocumentSyncKind = {
  None: 0,
  Full: 1,
  Incremental: 2,
} as const;

/** Position in a document (0-based). */
export interface Position {
  line: number;
  character: number;
}

/** Range in a document. */
export interface Range {
  start: Position;
  end: Position;
}

/** Location (file + range). */
export interface Location {
  uri: string;
  range: Range;
}

/** Hover result. */
export interface Hover {
  contents: string | { language: string; value: string } | Array<string | { language: string; value: string }>;
  range?: Range;
}

/** Document symbol (simplified). */
export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

/** Workspace symbol (simplified). */
export interface WorkspaceSymbol {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

/** Diagnostic severity. */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

/** Diagnostic (simplified). */
export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

/** Text edit for workspace edits. */
export interface TextEdit {
  range: Range;
  newText: string;
}

/** Workspace edit result. */
export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: unknown[];
}

/** Code action (simplified). */
export interface CodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  command?: unknown;
  diagnostics?: Diagnostic[];
}

/** Symbol kind values (subset). */
export const SymbolKind = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Boolean: 17,
  Array: 18,
  Object: 19,
  Key: 20,
  Null: 21,
  EnumMember: 22,
  Struct: 23,
  Event: 24,
  Operator: 25,
  TypeParameter: 26,
} as const;

/** Symbol kind to human-readable string. */
export function symbolKindName(kind: number): string {
  const names: Record<number, string> = {
    1: "file",
    2: "module",
    3: "namespace",
    4: "package",
    5: "class",
    6: "method",
    7: "property",
    8: "field",
    9: "constructor",
    10: "enum",
    11: "interface",
    12: "function",
    13: "variable",
    14: "constant",
    15: "string",
    16: "number",
    17: "boolean",
    18: "array",
    19: "object",
    20: "key",
    21: "null",
    22: "enumMember",
    23: "struct",
    24: "event",
    25: "operator",
    26: "typeParameter",
  };
  return names[kind] ?? "unknown";
}

/** Diagnostic severity to human-readable string. */
export function diagnosticSeverityName(severity?: number): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "unknown";
  }
}
