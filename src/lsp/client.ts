import type { LspConnection } from "./connection.js";
import type {
  InitializeParams,
  InitializeResult,
  Position,
  Location,
  Hover,
  DocumentSymbol,
  WorkspaceSymbol,
  Diagnostic,
  WorkspaceEdit,
  CodeAction,
} from "./protocol.js";
import { toUri, fromUri } from "./protocol.js";

interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

export class LspClient {
  private connection: LspConnection;
  private rootUri: string;
  private serverCapabilities: Record<string, unknown> = {};
  private openDocuments = new Map<string, OpenDocument>();
  private diagnosticsCache = new Map<string, Diagnostic[]>();
  private initialized = false;
  private initializing: Promise<void> | null = null;

  constructor(connection: LspConnection, rootUri: string) {
    this.connection = connection;
    this.rootUri = rootUri;
    this.connection.on("notification", (method: string, params: unknown) => {
      if (method === "textDocument/publishDiagnostics") {
        const p = params as { uri: string; diagnostics: Diagnostic[] };
        this.diagnosticsCache.set(p.uri, p.diagnostics);
      }
    });
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const params: InitializeParams = {
        processId: process.pid,
        rootUri: this.rootUri,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: false },
            completion: { dynamicRegistration: false },
            hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
            definition: { dynamicRegistration: false, linkSupport: false },
            references: { dynamicRegistration: false },
            documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
            codeAction: { dynamicRegistration: false },
            formatting: { dynamicRegistration: false },
            rename: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false, versionSupport: false },
          },
          workspace: {
            workspaceFolders: false,
            configuration: false,
            didChangeConfiguration: { dynamicRegistration: false },
          },
        },
      };

      const result = (await this.connection.request("initialize", params, signal)) as InitializeResult;
      this.serverCapabilities = result.capabilities;
      this.connection.notify("initialized", {});
      this.initialized = true;
    })();

    return this.initializing;
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    if (!this.initialized) return;
    try {
      await this.connection.request("shutdown", undefined, signal);
    } catch {
      // ignore
    }
    this.connection.notify("exit");
    this.initialized = false;
    this.initializing = null;
  }

  getCapabilities(): Record<string, unknown> {
    return this.serverCapabilities;
  }

  didOpen(path: string, languageId: string, content: string): void {
    const uri = toUri(path);
    const doc: OpenDocument = { uri, languageId, version: 1, content };
    this.openDocuments.set(uri, doc);
    this.connection.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text: content },
    });
  }

  didClose(path: string): void {
    const uri = toUri(path);
    this.openDocuments.delete(uri);
    this.diagnosticsCache.delete(uri);
    this.connection.notify("textDocument/didClose", { textDocument: { uri } });
  }

  didChange(path: string, content: string): void {
    const uri = toUri(path);
    const doc = this.openDocuments.get(uri);
    if (!doc) {
      // Auto-open if not already open
      const ext = path.split(".").pop() ?? "";
      this.didOpen(path, ext, content);
      return;
    }
    doc.version += 1;
    doc.content = content;
    this.connection.notify("textDocument/didChange", {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text: content }],
    });
  }

  getDiagnostics(path: string): Diagnostic[] {
    const uri = toUri(path);
    return this.diagnosticsCache.get(uri) ?? [];
  }

  async hover(path: string, position: Position, signal?: AbortSignal): Promise<Hover | null> {
    const result = await this.connection.request(
      "textDocument/hover",
      { textDocument: { uri: toUri(path) }, position },
      signal,
    );
    return (result as Hover | null) ?? null;
  }

  async definition(path: string, position: Position, signal?: AbortSignal): Promise<Location | Location[] | null> {
    const result = await this.connection.request(
      "textDocument/definition",
      { textDocument: { uri: toUri(path) }, position },
      signal,
    );
    return (result as Location | Location[] | null) ?? null;
  }

  async references(path: string, position: Position, signal?: AbortSignal): Promise<Location[] | null> {
    const result = await this.connection.request(
      "textDocument/references",
      { textDocument: { uri: toUri(path) }, position, context: { includeDeclaration: true } },
      signal,
    );
    return (result as Location[] | null) ?? null;
  }

  async documentSymbols(path: string, signal?: AbortSignal): Promise<DocumentSymbol[] | null> {
    const result = await this.connection.request(
      "textDocument/documentSymbol",
      { textDocument: { uri: toUri(path) } },
      signal,
    );
    return (result as DocumentSymbol[] | null) ?? null;
  }

  async workspaceSymbol(query: string, signal?: AbortSignal): Promise<WorkspaceSymbol[] | null> {
    const result = await this.connection.request("workspace/symbol", { query }, signal);
    return (result as WorkspaceSymbol[] | null) ?? null;
  }

  async rename(path: string, position: Position, newName: string, signal?: AbortSignal): Promise<WorkspaceEdit | null> {
    const result = await this.connection.request(
      "textDocument/rename",
      { textDocument: { uri: toUri(path) }, position, newName },
      signal,
    );
    return (result as WorkspaceEdit | null) ?? null;
  }

  async codeAction(path: string, range: { start: Position; end: Position }, signal?: AbortSignal): Promise<CodeAction[] | null> {
    const result = await this.connection.request(
      "textDocument/codeAction",
      {
        textDocument: { uri: toUri(path) },
        range,
        context: { diagnostics: this.getDiagnostics(path) },
      },
      signal,
    );
    return (result as CodeAction[] | null) ?? null;
  }

  async implementation(path: string, position: Position, signal?: AbortSignal): Promise<Location | Location[] | null> {
    const result = await this.connection.request(
      "textDocument/implementation",
      { textDocument: { uri: toUri(path) }, position },
      signal,
    );
    return (result as Location | Location[] | null) ?? null;
  }

  async typeDefinition(path: string, position: Position, signal?: AbortSignal): Promise<Location | Location[] | null> {
    const result = await this.connection.request(
      "textDocument/typeDefinition",
      { textDocument: { uri: toUri(path) }, position },
      signal,
    );
    return (result as Location | Location[] | null) ?? null;
  }

  listOpenDocuments(): string[] {
    return Array.from(this.openDocuments.keys()).map(fromUri);
  }
}
