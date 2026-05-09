import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { Readable, Writable } from "node:stream";
import { startRpcServer } from "./rpc.js";

describe("SDK RPC", () => {
  let originalStdin: NodeJS.ReadableStream;
  let originalStdout: NodeJS.WritableStream;

  before(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
  });

  after(() => {
    process.stdin = originalStdin as NodeJS.ReadStream;
    process.stdout = originalStdout as NodeJS.WriteStream;
  });

  async function withRpcServer(
    commands: string[],
    handler: (lines: string[]) => void,
  ): Promise<void> {
    const input = Readable.from(commands.map((c) => c + "\n"));
    const outputLines: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        outputLines.push(chunk.toString().trim());
        callback();
      },
    });

    process.stdin = input as unknown as NodeJS.ReadStream;
    process.stdout = output as unknown as NodeJS.WriteStream;

    // Start RPC server in background; it will read from our mocked stdin
    const serverPromise = startRpcServer();

    // Wait for input to be consumed
    await new Promise<void>((resolve) => {
      input.on("end", resolve);
      input.on("close", resolve);
    });

    // Give server a tick to process
    await new Promise((r) => setTimeout(r, 50));

    handler(outputLines);

    // Clean up: send dispose to shut down server
    try {
      process.stdin = Readable.from([JSON.stringify({ type: "dispose" }) + "\n"]) as unknown as NodeJS.ReadStream;
      await serverPromise;
    } catch {
      // ignore
    }
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
