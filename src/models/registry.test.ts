import { describe, it } from "node:test";
import assert from "node:assert";
import { getModel, getModelOrInfer, inferProvider, isUnifiedEligible, routeFor } from "./registry.js";
import { decideNextStep } from "./next-step.js";

describe("registry: Moonshot K3", () => {
  it("infers moonshotai provider from moonshotai/kimi-k3", () => {
    assert.strictEqual(inferProvider("moonshotai/kimi-k3"), "moonshotai");
  });

  it("seeds moonshotai/kimi-k3 as a Cloudflare-catalog model paid via Unified Billing", () => {
    const model = getModel("moonshotai/kimi-k3");
    assert.ok(model, "expected moonshotai/kimi-k3 to be seeded");
    assert.strictEqual(model!.provider, "moonshotai");
    assert.strictEqual(model!.billingMode, "unified");
    assert.strictEqual(routeFor(model!), "cf-catalog");
    assert.strictEqual(isUnifiedEligible(model!), true);
    // K3 rejects any temperature other than 1.0 — the client must omit it.
    assert.strictEqual(model!.supports.temperature, false);
    assert.strictEqual(model!.contextWindow, 1_048_576);
    assert.deepStrictEqual(model!.pricing, { inputPerMtok: 3.0, cachedInputPerMtok: 0.3, outputPerMtok: 15.0 });
  });

  it("K3 needs no provider key and no gateway: next step is ready", () => {
    const model = getModel("moonshotai/kimi-k3")!;
    assert.deepStrictEqual(decideNextStep(null, model), { kind: "ready" });
    assert.deepStrictEqual(
      decideNextStep({ accountId: "a", apiToken: "t", model: model.id }, model),
      { kind: "ready" },
    );
  });

  it("unknown moonshotai/* ids infer the cf-catalog route with unified billing", () => {
    const inferred = getModelOrInfer("moonshotai/kimi-k3-future");
    assert.strictEqual(inferred.provider, "moonshotai");
    assert.strictEqual(inferred.billingMode, "unified");
    assert.strictEqual(routeFor(inferred), "cf-catalog");
  });

  it("keeps Workers AI Kimi models on the workers-ai provider", () => {
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.7-code"), "workers-ai");
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.6"), "workers-ai");
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.5"), "workers-ai");
  });
});
