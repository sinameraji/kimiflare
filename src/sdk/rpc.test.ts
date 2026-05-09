import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { Readable, Writable } from "node:stream";
import { startRpcServer } from "./rpc.js";

describe("SDK RPC", () => {
  let originalAccount: string | undefined;
  let originalToken: string | undefined;

  before(() => {
    originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    originalToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_ACCOUNT_ID = "test_account";
    process.env.CLOUDFLARE_API_TOKEN = "test_token";
  });

  after(() => {
    process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount;
    process.env.CLOUDFLARE_API_TOKEN = originalToken;
  });

  async function withRpcServer(
    commands: string[],
    handler: (lines: string[]) => void,
  ): Promise<void> {
    const allCommands = [...commands, JSON.stringify({ type: "dispose" })];
    const input = Readable.from(allCommands.map((c) => c + "\n"));
    const outputLines: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        outputLines.push(chunk.toString().trim());
        callback();
      },
    });

    // Start RPC server; it will process all commands and exit on dispose
    await startRpcServer(input, output);

    // Filter out the dispose ok response
    const filtered = outputLines.filter((l) => {
      try {
        const parsed = JSON.parse(l);
        // Remove only the dispose ok response (no id, type ok)
        return !(parsed.type === "ok" && parsed.id === undefined);
      } catch {
        return true;
      }
    });

    handler(filtered);
  }

  it("responds to new_session command", async () => {
    await withRpcServer(
      [JSON.stringify({ id: "1", type: "new_session" })],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.id === "1");
        assert.ok(response);
        assert.strictEqual(response.type, "ok");
        assert.ok(response.sessionId);
      },
    );
  });

  it("responds to get_state command", async () => {
    await withRpcServer(
      [
        JSON.stringify({ id: "1", type: "new_session" }),
        JSON.stringify({ id: "2", type: "get_state" }),
      ],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.id === "2");
        assert.ok(response);
        assert.strictEqual(response.type, "state");
        assert.strictEqual(typeof response.isStreaming, "boolean");
      },
    );
  });

  it("responds to set_model command", async () => {
    await withRpcServer(
      [
        JSON.stringify({ id: "1", type: "new_session" }),
        JSON.stringify({ id: "2", type: "set_model", modelId: "@cf/moonshotai/kimi-k2.6" }),
      ],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.id === "2");
        assert.ok(response);
        assert.strictEqual(response.type, "ok");
      },
    );
  });

  it("responds to set_mode command", async () => {
    await withRpcServer(
      [
        JSON.stringify({ id: "1", type: "new_session" }),
        JSON.stringify({ id: "2", type: "set_mode", mode: "auto" }),
      ],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.id === "2");
        assert.ok(response);
        assert.strictEqual(response.type, "ok");
      },
    );
  });

  it("responds with error for unknown command", async () => {
    await withRpcServer(
      [JSON.stringify({ id: "1", type: "unknown_command" })],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.id === "1");
        assert.ok(response);
        assert.strictEqual(response.type, "error");
        assert.ok(response.error.includes("Unknown command"));
      },
    );
  });

  it("responds with error for invalid JSON", async () => {
    await withRpcServer(
      ["not valid json"],
      (lines) => {
        const response = lines.map((l) => JSON.parse(l)).find((r) => r.type === "error");
        assert.ok(response);
        assert.strictEqual(response.error, "Invalid JSON");
      },
    );
  });
});
