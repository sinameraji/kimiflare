import { describe, it } from "node:test";
import assert from "node:assert";
import { readSSE } from "./sse.js";

describe("readSSE", () => {
  it("exits gracefully when signal aborts during pending read", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Abort before enqueueing any data so reader.read() is pending.
        setTimeout(() => controller.abort(), 10);
      },
    });
    const gen = readSSE(stream, controller.signal);
    const result = await gen.next();
    assert.strictEqual(result.done, true);
  });

  it("yields events when stream completes normally", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: hello\n\n"));
        c.close();
      },
    });
    const gen = readSSE(stream);
    const results: string[] = [];
    for await (const ev of gen) {
      results.push(ev);
    }
    assert.deepStrictEqual(results, ["hello"]);
  });
});
