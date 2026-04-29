import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcNotification, JsonRpcResponse } from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
}

export class LspConnection extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = "";
  private closed = false;
  private readonly requestTimeoutMs: number;

  constructor(requestTimeoutMs = 10000) {
    super();
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async start(command: string[], env?: Record<string, string>, spawnTimeoutMs = 30000): Promise<void> {
    if (this.child) {
      throw new Error("LSP connection already started");
    }

    return new Promise((resolve, reject) => {
      const abortController = new AbortController();
      const spawnTimer = setTimeout(() => {
        abortController.abort();
        this.kill();
        reject(new Error(`LSP server spawn timed out after ${spawnTimeoutMs}ms`));
      }, spawnTimeoutMs);

      try {
        const child = spawn(command[0]!, command.slice(1), {
          env: { ...process.env, ...env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        child.on("error", (err) => {
          clearTimeout(spawnTimer);
          reject(new Error(`LSP server spawn failed: ${err.message}`));
        });

        child.on("exit", (code, signal) => {
          this.closed = true;
          this.child = null;
          for (const [, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(new Error(`LSP server exited (code=${code}, signal=${signal})`));
          }
          this.pending.clear();
          this.emit("exit", code, signal);
        });

        child.stdout!.setEncoding("utf8");
        child.stdout!.on("data", (chunk: string) => {
          this.buffer += chunk;
          this.processBuffer();
        });

        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", (chunk: string) => {
          this.emit("stderr", chunk);
        });

        // Wait a tick for immediate spawn errors
        setImmediate(() => {
          if (child.pid) {
            clearTimeout(spawnTimer);
            this.child = child;
            resolve();
          }
        });
      } catch (err) {
        clearTimeout(spawnTimer);
        reject(new Error(`LSP server spawn failed: ${(err as Error).message}`));
      }
    });
  }

  request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed || !this.child) {
      return Promise.reject(new Error("LSP connection is closed"));
    }

    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      const pending: PendingRequest = { resolve, reject, signal, timer };
      this.pending.set(id, pending);

      if (signal) {
        const onAbort = () => {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error("LSP request cancelled"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.send(msg);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed || !this.child) {
      return;
    }
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  kill(): void {
    this.closed = true;
    if (this.child) {
      this.child.kill("SIGTERM");
      // Force kill after 5s if still alive
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill("SIGKILL");
        }
      }, 5000);
    }
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("LSP connection killed"));
    }
    this.pending.clear();
  }

  private send(msg: JsonRpcMessage): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    this.child!.stdin!.write(header + body);
  }

  private processBuffer(): void {
    while (true) {
      const headerMatch = this.buffer.match(/Content-Length:\s*(\d+)\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1]!, 10);
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) break;

      const raw = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(raw) as JsonRpcMessage;
      } catch {
        this.emit("error", new Error("LSP protocol error: invalid JSON-RPC message"));
        continue;
      }

      if ("id" in msg && (msg.id !== undefined && msg.id !== null)) {
        // Response
        const response = msg as JsonRpcResponse;
        const id = response.id!;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          clearTimeout(pending.timer);
          if (pending.signal) {
            pending.signal.removeEventListener("abort", () => {});
          }
          if (response.error) {
            pending.reject(new Error(`LSP ${response.error.message} (code ${response.error.code})`));
          } else {
            pending.resolve(response.result);
          }
        }
      } else if ("method" in msg) {
        // Notification
        this.emit("notification", msg.method, msg.params);
      }
    }
  }
}
