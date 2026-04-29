import { LspConnection } from "./connection.js";
import { LspClient } from "./client.js";
import { toUri } from "./protocol.js";
import type { LspServerConfig } from "../config.js";

interface ActiveServer {
  id: string;
  rootUri: string;
  config: LspServerConfig;
  connection: LspConnection;
  client: LspClient;
  state: "starting" | "running" | "crashed";
  restartAttempts: number;
  pid?: number;
}

export interface LspServerStatus {
  id: string;
  rootUri: string;
  state: "starting" | "running" | "crashed";
  pid?: number;
  toolCount: number;
}

export class LspManager {
  private servers = new Map<string, ActiveServer>();
  private readonly maxRestartAttempts = 3;

  private key(id: string, rootUri: string): string {
    return `${id}::${rootUri}`;
  }

  async startServer(id: string, config: LspServerConfig, rootPath: string): Promise<void> {
    const rootUri = toUri(rootPath);
    const k = this.key(id, rootUri);

    if (this.servers.has(k)) {
      await this.stopServer(id, rootPath);
    }

    const connection = new LspConnection();
    const server: ActiveServer = {
      id,
      rootUri,
      config,
      connection,
      client: new LspClient(connection, rootUri),
      state: "starting",
      restartAttempts: 0,
    };
    this.servers.set(k, server);

    try {
      await connection.start(config.command, config.env);
      server.pid = connection["child"]?.pid;
      await server.client.initialize();
      server.state = "running";
    } catch (e) {
      server.state = "crashed";
      throw new Error(`LSP server "${id}" failed: ${(e as Error).message}`);
    }
  }

  async stopServer(id: string, rootPath: string): Promise<void> {
    const rootUri = toUri(rootPath);
    const k = this.key(id, rootUri);
    const server = this.servers.get(k);
    if (!server) return;

    this.servers.delete(k);
    try {
      await server.client.shutdown();
    } catch {
      // ignore
    }
    server.connection.kill();
  }

  async stopAll(): Promise<void> {
    for (const [k, server] of this.servers) {
      try {
        await server.client.shutdown();
      } catch {
        // ignore
      }
      server.connection.kill();
      this.servers.delete(k);
    }
  }

  getClient(id: string, rootPath: string): LspClient | undefined {
    const rootUri = toUri(rootPath);
    const k = this.key(id, rootUri);
    const server = this.servers.get(k);
    if (server?.state === "running") {
      return server.client;
    }
    return undefined;
  }

  /** Find the first running client for a given server ID, regardless of root. */
  findClient(id: string): LspClient | undefined {
    for (const [, server] of this.servers) {
      if (server.id === id && server.state === "running") {
        return server.client;
      }
    }
    return undefined;
  }

  /** Auto-detect which server ID to use for a given file path. */
  resolveClientForPath(filePath: string): { id: string; client: LspClient } | undefined {
    for (const [, server] of this.servers) {
      if (server.state !== "running") continue;
      // Simple prefix match on rootUri
      if (filePath.startsWith(server.rootUri.replace("file://", ""))) {
        return { id: server.id, client: server.client };
      }
    }
    // Fallback: return first running client
    for (const [, server] of this.servers) {
      if (server.state === "running") {
        return { id: server.id, client: server.client };
      }
    }
    return undefined;
  }

  listActive(): LspServerStatus[] {
    const out: LspServerStatus[] = [];
    for (const [, server] of this.servers) {
      out.push({
        id: server.id,
        rootUri: server.rootUri,
        state: server.state,
        pid: server.pid,
        toolCount: this.estimateToolCount(server.client.getCapabilities()),
      });
    }
    return out;
  }

  notifyChange(path: string, content: string): void {
    for (const [, server] of this.servers) {
      if (server.state === "running") {
        server.client.didChange(path, content);
      }
    }
  }

  private estimateToolCount(capabilities: Record<string, unknown>): number {
    let count = 0;
    const caps = [
      "hoverProvider",
      "definitionProvider",
      "referencesProvider",
      "documentSymbolProvider",
      "workspaceSymbolProvider",
      "renameProvider",
      "codeActionProvider",
      "implementationProvider",
      "typeDefinitionProvider",
    ];
    for (const cap of caps) {
      if (capabilities[cap]) count++;
    }
    return count;
  }
}
