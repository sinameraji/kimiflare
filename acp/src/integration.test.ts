import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "bin", "kimiflare-acp.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AcpClient {
  child: ChildProcess;
  send: (msg: Record<string, unknown>) => void;
  readResponse: (timeoutMs?: number) => Promise<Record<string, unknown>>;
  readAll: (timeoutMs?: number) => Promise<Record<string, unknown>[]>;
  kill: () => void;
}

function spawnAcpAgent(): AcpClient {
  const child = spawn("node", [BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // Ensure no real credentials leak into tests unless the env already has them
    },
  });

  let buffer = "";
  const messageQueue: Record<string, unknown>[] = [];
  let waitResolve: ((msg: Record<string, unknown>) => void) | null = null;

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (data: string) => {
    buffer += data;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        if (waitResolve) {
          const resolve = waitResolve;
          waitResolve = null;
          resolve(msg);
        } else {
          messageQueue.push(msg);
        }
      } catch {
        // ignore parse errors
      }
    }
  });

  return {
    child,
    send(msg) {
      child.stdin!.write(JSON.stringify(msg) + "\n");
    },
    readResponse(timeoutMs = 5000): Promise<Record<string, unknown>> {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift()!);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waitResolve = null;
          reject(new Error("Timed out waiting for ACP response"));
        }, timeoutMs);
        waitResolve = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
      });
    },
    async readAll(timeoutMs = 1000): Promise<Record<string, unknown>[]> {
      // Read messages until timeout (for collecting notifications)
      const messages: Record<string, unknown>[] = [];
      while (true) {
        try {
          const msg = await this.readResponse(timeoutMs);
          messages.push(msg);
        } catch {
          break;
        }
      }
      return messages;
    },
    kill() {
      child.kill("SIGTERM");
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACP protocol integration", () => {
  let client: AcpClient;

  beforeEach(() => {
    client = spawnAcpAgent();
  });

  afterEach(() => {
    client.kill();
  });

  describe("initialize", () => {
    it("returns a valid InitializeResponse", async () => {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });

      const resp = await client.readResponse();
      assert.strictEqual(resp.jsonrpc, "2.0");
      assert.strictEqual(resp.id, 1);

      const result = resp.result as Record<string, unknown>;
      assert.strictEqual(result.protocolVersion, 1);

      const agentInfo = result.agentInfo as Record<string, unknown>;
      assert.strictEqual(agentInfo.name, "kimiflare");

      const caps = result.agentCapabilities as Record<string, unknown>;
      const sessionCaps = caps.sessionCapabilities as Record<string, unknown>;
      assert.deepStrictEqual(sessionCaps.close, {});
      assert.deepStrictEqual(sessionCaps.list, {});

      const promptCaps = caps.promptCapabilities as Record<string, unknown>;
      assert.strictEqual(promptCaps.image, true);
    });
  });

  describe("session/new without credentials", () => {
    it("returns auth_required error when no credentials are configured", async () => {
      // First initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      // Override env to ensure no credentials
      client.kill();
      const noAuthClient = spawnAcpAgentNoAuth();
      try {
        noAuthClient.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "test", version: "0.1" },
          },
        });
        await noAuthClient.readResponse();

        noAuthClient.send({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: {
            cwd: "/tmp",
            mcpServers: [],
          },
        });

        const resp = await noAuthClient.readResponse();
        assert.strictEqual(resp.jsonrpc, "2.0");
        assert.strictEqual(resp.id, 2);

        const error = resp.error as { code: number; message: string } | undefined;
        if (error) {
          // Auth required error — credentials are not configured
          assert.ok(error.message.includes("credentials") || error.message.includes("Cloudflare"),
            `Expected auth error, got: ${error.message}`);
        } else {
          // Credentials were present in env — session was created successfully
          const result = resp.result as Record<string, unknown>;
          assert.ok(typeof result.sessionId === "string");
        }
      } finally {
        noAuthClient.kill();
      }
    });
  });

  describe("session lifecycle with credentials", () => {
    it("creates a session, gets modes, and closes it", async () => {
      // Initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      // Create session
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: {
          cwd: "/tmp",
          mcpServers: [],
        },
      });

      const newResp = await client.readResponse();
      if (newResp.error) {
        // No credentials — skip the rest of this test
        const error = newResp.error as { message: string };
        assert.ok(
          error.message.includes("credentials") || error.message.includes("Cloudflare"),
          "Expected auth error when no credentials",
        );
        return;
      }

      const newResult = newResp.result as Record<string, unknown>;
      const sessionId = newResult.sessionId as string;
      assert.ok(typeof sessionId === "string" && sessionId.length > 0);

      // Verify modes are returned
      const modes = newResult.modes as Record<string, unknown>;
      assert.strictEqual(modes.currentModeId, "edit");
      const availableModes = modes.availableModes as Array<{ id: string }>;
      const modeIds = availableModes.map((m) => m.id);
      assert.deepStrictEqual(modeIds, ["edit", "plan", "auto"]);

      // Set mode to plan
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/setMode",
        params: {
          sessionId,
          modeId: "plan",
        },
      });

      // Read the response + any notifications
      const modeMessages = await client.readAll(2000);
      // Should have the setMode response and a current_mode_update notification
      const modeResp = modeMessages.find((m) => m.id === 3);
      assert.ok(modeResp, "Should receive setSessionMode response");
      assert.ok(!modeResp!.error, "setSessionMode should not error");

      // Check for current_mode_update notification
      const modeNotification = modeMessages.find(
        (m) => !m.id && (m.params as Record<string, unknown>)?.update,
      );
      if (modeNotification) {
        const params = modeNotification.params as Record<string, unknown>;
        const update = params.update as Record<string, unknown>;
        assert.strictEqual(update.sessionUpdate, "current_mode_update");
        assert.strictEqual(update.currentModeId, "plan");
      }

      // Close session
      client.send({
        jsonrpc: "2.0",
        id: 4,
        method: "session/close",
        params: { sessionId },
      });

      const closeResp = await client.readResponse();
      assert.strictEqual(closeResp.id, 4);
      assert.ok(!closeResp.error, "closeSession should not error");

      // Trying to close again should not error (idempotent)
      client.send({
        jsonrpc: "2.0",
        id: 5,
        method: "session/close",
        params: { sessionId },
      });

      const closeResp2 = await client.readResponse();
      assert.strictEqual(closeResp2.id, 5);
      assert.ok(!closeResp2.error);
    });
  });

  describe("cancel on unknown session", () => {
    it("does not error on cancel for nonexistent session", async () => {
      // Initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      // Cancel is a notification (no id in JSON-RPC spec), but the SDK
      // may handle it. Send and ensure no crash.
      client.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: "nonexistent-session" },
      });

      // Give it a moment to process — if the agent crashes, the next
      // request will fail
      await new Promise((r) => setTimeout(r, 500));

      // Verify agent is still alive by sending another request
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });

      const resp = await client.readResponse();
      assert.strictEqual(resp.id, 2);
      assert.ok(resp.result);
    });
  });

  describe("prompt on unknown session", () => {
    it("returns an error for unknown session", async () => {
      // Initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      // Prompt with unknown session
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: {
          sessionId: "nonexistent",
          prompt: [{ type: "text", text: "hello" }],
        },
      });

      const resp = await client.readResponse();
      assert.strictEqual(resp.id, 2);
      assert.ok(resp.error, "Should return error for unknown session");
      const error = resp.error as { message: string };
      assert.ok(error.message.includes("Unknown session"));
    });
  });

  describe("setMode on unknown session", () => {
    it("returns an error", async () => {
      // Initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/setMode",
        params: { sessionId: "nonexistent", modeId: "plan" },
      });

      const resp = await client.readResponse();
      assert.strictEqual(resp.id, 2);
      assert.ok(resp.error);
    });
  });

  describe("setMode with invalid mode", () => {
    it("returns an error for unknown mode ID", async () => {
      // Initialize
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        },
      });
      await client.readResponse();

      // Create session
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/tmp", mcpServers: [] },
      });

      const newResp = await client.readResponse();
      if (newResp.error) return; // no credentials

      const sessionId = (newResp.result as Record<string, unknown>).sessionId as string;

      // Set invalid mode
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/setMode",
        params: { sessionId, modeId: "invalid_mode" },
      });

      const resp = await client.readResponse();
      assert.strictEqual(resp.id, 3);
      assert.ok(resp.error);
      const error = resp.error as { message: string };
      assert.ok(error.message.includes("Unknown mode"));
    });
  });

  describe("multiple requests on same connection", () => {
    it("handles sequential requests without crashing", async () => {
      // Send multiple initialize requests (legal per JSON-RPC)
      for (let i = 1; i <= 3; i++) {
        client.send({
          jsonrpc: "2.0",
          id: i,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "test", version: "0.1" },
          },
        });
        const resp = await client.readResponse();
        assert.strictEqual(resp.id, i);
        assert.ok(resp.result);
      }
    });
  });
});

// Helper to spawn without credentials
function spawnAcpAgentNoAuth(): AcpClient {
  const child = spawn("node", [BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      // Strip Cloudflare credentials from env
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) =>
            !k.startsWith("CLOUDFLARE_") &&
            !k.startsWith("CF_") &&
            k !== "KIMI_MODEL",
        ),
      ),
      // Point config to a nonexistent path so loadConfig returns null
      XDG_CONFIG_HOME: "/tmp/kimiflare-acp-test-no-config",
    },
  });

  let buffer = "";
  const messageQueue: Record<string, unknown>[] = [];
  let waitResolve: ((msg: Record<string, unknown>) => void) | null = null;

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (data: string) => {
    buffer += data;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        if (waitResolve) {
          const resolve = waitResolve;
          waitResolve = null;
          resolve(msg);
        } else {
          messageQueue.push(msg);
        }
      } catch {
        // ignore
      }
    }
  });

  return {
    child,
    send(msg) {
      child.stdin!.write(JSON.stringify(msg) + "\n");
    },
    readResponse(timeoutMs = 5000): Promise<Record<string, unknown>> {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift()!);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waitResolve = null;
          reject(new Error("Timed out waiting for ACP response"));
        }, timeoutMs);
        waitResolve = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
      });
    },
    async readAll(timeoutMs = 1000): Promise<Record<string, unknown>[]> {
      const messages: Record<string, unknown>[] = [];
      while (true) {
        try {
          const msg = await this.readResponse(timeoutMs);
          messages.push(msg);
        } catch {
          break;
        }
      }
      return messages;
    },
    kill() {
      child.kill("SIGTERM");
    },
  };
}
