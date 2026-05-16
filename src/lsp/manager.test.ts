import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { LspManager, DEFAULT_LSP_MAX_RESTART_ATTEMPTS } from "./manager.js";
import type { LspServerConfig } from "../config.js";
import type { LspConnection } from "./connection.js";
import type { LspClient } from "./client.js";

class FakeConnection extends EventEmitter {
  startCalls = 0;
  killed = false;
  constructor(public timeoutMs: number) {
    super();
  }
  async start(_command: string[], _env?: Record<string, string>): Promise<void> {
    this.startCalls += 1;
  }
  kill(): void {
    this.killed = true;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request(_method: string, _params?: unknown, _signal?: AbortSignal): Promise<any> {
    return Promise.resolve(null);
  }
  notify(_method: string, _params?: unknown): void {}
  child = { pid: 1234 };
}

class FakeClient {
  initialized = 0;
  capabilities: Record<string, unknown> = {};
  async initialize(): Promise<void> {
    this.initialized += 1;
  }
  async shutdown(): Promise<void> {}
  didChange(_path: string, _content: string): void {}
  getCapabilities(): Record<string, unknown> {
    return this.capabilities;
  }
}

function buildManager(opts: { failInitializeUntilAttempt?: number } = {}) {
  let attempt = 0;
  const connections: FakeConnection[] = [];
  const clients: FakeClient[] = [];
  const restarts: Array<{ attempt: number; delayMs: number }> = [];
  let gaveUp: { attempts: number; reason: string } | undefined;

  const manager = new LspManager({
    sleep: () => Promise.resolve(),
    connectionFactory: (timeoutMs) => {
      const c = new FakeConnection(timeoutMs);
      connections.push(c);
      return c as unknown as LspConnection;
    },
    clientFactory: () => {
      const client = new FakeClient();
      clients.push(client);
      if (opts.failInitializeUntilAttempt !== undefined) {
        const myAttempt = attempt;
        attempt += 1;
        if (myAttempt < opts.failInitializeUntilAttempt) {
          client.initialize = async () => {
            throw new Error(`forced failure on attempt ${myAttempt}`);
          };
        }
      }
      return client as unknown as LspClient;
    },
    onRestart: (info) => restarts.push({ attempt: info.attempt, delayMs: info.delayMs }),
    onRestartGaveUp: (info) => {
      gaveUp = { attempts: info.attempts, reason: info.reason };
    },
  });
  return {
    manager,
    connections,
    clients,
    restarts,
    getGaveUp: () => gaveUp,
  };
}

const cfg: LspServerConfig = { command: ["fake-lsp"], timeoutMs: 1234 };
const rootPath = "/tmp/proj";

describe("LspManager — timeout threading", () => {
  it("passes config.timeoutMs into the LspConnection", async () => {
    const { manager, connections } = buildManager();
    await manager.startServer("ts", cfg, rootPath);
    assert.strictEqual(connections[0]?.timeoutMs, 1234);
  });

  it("uses the default when timeoutMs is unset", async () => {
    const { manager, connections } = buildManager();
    await manager.startServer("ts", { command: ["fake-lsp"] }, rootPath);
    assert.strictEqual(connections[0]?.timeoutMs, 10_000);
  });
});

describe("LspManager — auto-restart on exit", () => {
  it("does not restart on clean exit (code=0)", async () => {
    const { manager, connections, restarts } = buildManager();
    await manager.startServer("ts", cfg, rootPath);
    connections[0]!.emit("exit", 0, null);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(restarts.length, 0);
    const status = manager.listActive()[0]!;
    assert.strictEqual(status.state, "crashed");
    assert.strictEqual(status.restartAttempts, 0);
  });

  it("restarts on non-zero exit and increments attempts", async () => {
    const { manager, connections, restarts } = buildManager();
    await manager.startServer("ts", cfg, rootPath);
    connections[0]!.emit("exit", 1, null);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(restarts.length, 1);
    assert.strictEqual(restarts[0]!.attempt, 1);
    const status = manager.listActive()[0]!;
    assert.strictEqual(status.state, "running");
    assert.strictEqual(status.restartAttempts, 1);
    assert.strictEqual(connections.length, 2);
  });

  it("gives up after maxRestartAttempts consecutive failures", async () => {
    const max = DEFAULT_LSP_MAX_RESTART_ATTEMPTS;
    const { manager, connections, restarts, getGaveUp } = buildManager();
    await manager.startServer("ts", cfg, rootPath);
    for (let i = 0; i < max + 1; i++) {
      const latest = connections[connections.length - 1]!;
      latest.emit("exit", 1, null);
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.strictEqual(restarts.length, max);
    const status = manager.listActive()[0]!;
    assert.strictEqual(status.state, "crashed");
    assert.strictEqual(status.restartAttempts, max);
    const gaveUp = getGaveUp();
    assert.ok(gaveUp, "should have called onRestartGaveUp");
    assert.strictEqual(gaveUp!.attempts, max);
  });

  it("respects maxRestartAttempts=0 to disable auto-restart", async () => {
    const { manager, connections, restarts, getGaveUp } = buildManager();
    await manager.startServer(
      "ts",
      { command: ["fake-lsp"], maxRestartAttempts: 0 },
      rootPath,
    );
    connections[0]!.emit("exit", 1, null);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(restarts.length, 0);
    const gaveUp = getGaveUp();
    assert.ok(gaveUp);
    assert.strictEqual(manager.listActive()[0]!.state, "crashed");
  });

  it("does not restart after explicit stopServer", async () => {
    const { manager, connections, restarts } = buildManager();
    await manager.startServer("ts", cfg, rootPath);
    await manager.stopServer("ts", rootPath);
    connections[0]!.emit("exit", 1, null);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(restarts.length, 0);
  });
});
