import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { fetchEmbeddings, cosineSimilarity } from "./embeddings.js";

function assertClose(actual: Float32Array, expected: number[], epsilon = 1e-6): void {
  assert.strictEqual(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      Math.abs(actual[i]! - expected[i]!) < epsilon,
      `expected ${actual[i]} to be close to ${expected[i]} at index ${i}`,
    );
  }
}

describe("fetchEmbeddings", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = new Request(input, init);
      return new Response(JSON.stringify({ result: { data: [[0.1, 0.2, 0.3]] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the direct Workers AI path when no gateway is configured", async () => {
    const vectors = await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      model: "@cf/baai/bge-base-en-v1.5",
      texts: ["hello world"],
    });
    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.url,
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/%40cf%2Fbaai%2Fbge-base-en-v1.5",
    );
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer token");
    const body = await lastRequest!.clone().json();
    assert.deepStrictEqual(body, { text: ["hello world"] });
    assert.strictEqual(vectors.length, 1);
    assertClose(vectors[0]!, [0.1, 0.2, 0.3]);
  });

  it("batches multiple texts through the direct Workers AI path", async () => {
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response(
        JSON.stringify({ result: { shape: [2, 3], data: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const vectors = await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      texts: ["first", "second"],
    });
    assert.strictEqual(vectors.length, 2);
    assertClose(vectors[0]!, [0.1, 0.2, 0.3]);
    assertClose(vectors[1]!, [0.4, 0.5, 0.6]);
    const body = await lastRequest!.clone().json();
    assert.deepStrictEqual(body, { text: ["first", "second"] });
  });

  it("uses AI Gateway /compat/embeddings with a workers-ai/ model prefix", async () => {
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3], index: 0 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const vectors = await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      model: "@cf/baai/bge-base-en-v1.5",
      texts: ["hello gateway"],
      gateway: { id: "my-gateway" },
    });
    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.url,
      "https://gateway.ai.cloudflare.com/v1/acct/my-gateway/compat/embeddings",
    );
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer token");
    const body = await lastRequest!.clone().json();
    assert.strictEqual(body.model, "workers-ai/@cf/baai/bge-base-en-v1.5");
    assert.deepStrictEqual(body.input, ["hello gateway"]);
    assert.strictEqual(vectors.length, 1);
    assertClose(vectors[0]!, [0.1, 0.2, 0.3]);
  });

  it("batches multiple texts through AI Gateway and preserves order", async () => {
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.4, 0.5, 0.6], index: 1 },
            { embedding: [0.1, 0.2, 0.3], index: 0 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const vectors = await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      texts: ["first", "second"],
      gateway: { id: "my-gateway" },
    });
    assert.strictEqual(vectors.length, 2);
    assertClose(vectors[0]!, [0.1, 0.2, 0.3]);
    assertClose(vectors[1]!, [0.4, 0.5, 0.6]);
    const body = await lastRequest!.clone().json();
    assert.deepStrictEqual(body.input, ["first", "second"]);
  });

  it("forwards gateway cache and metadata headers", async () => {
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1], index: 0 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      texts: ["hi"],
      gateway: {
        id: "my-gateway",
        cacheTtl: 3600,
        skipCache: true,
        metadata: { team: "cli", test: true },
      },
    });
    assert.strictEqual(lastRequest!.headers.get("cf-aig-cache-ttl"), "3600");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-skip-cache"), "true");
    const metadata = lastRequest!.headers.get("cf-aig-metadata");
    assert.ok(metadata);
    const parsed = JSON.parse(metadata!);
    assert.strictEqual(parsed.team, "cli");
    assert.strictEqual(parsed.test, true);
    assert.strictEqual(parsed.feature, "embedding");
  });

  it("returns an empty array for empty input", async () => {
    const vectors = await fetchEmbeddings({
      accountId: "acct",
      apiToken: "token",
      texts: [],
    });
    assert.deepStrictEqual(vectors, []);
  });

  it("throws when the response contains no vectors", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      fetchEmbeddings({
        accountId: "acct",
        apiToken: "token",
        texts: ["hi"],
        gateway: { id: "my-gateway" },
      }),
      /no vectors/,
    );
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    assert.strictEqual(cosineSimilarity(a, a), 1);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });

  it("returns 0 for mismatched dimensions", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });
});
