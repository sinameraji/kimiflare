import { describe, it } from "node:test";
import assert from "node:assert";
import { getModel, inferProvider, isUnifiedEligible } from "./registry.js";

describe("registry: Moonshot K3", () => {
  it("infers moonshotai provider from moonshotai/kimi-k3", () => {
    assert.strictEqual(inferProvider("moonshotai/kimi-k3"), "moonshotai");
  });

  it("seeds moonshotai/kimi-k3 as BYOK-only (Unified Billing not available)", () => {
    const model = getModel("moonshotai/kimi-k3");
    assert.ok(model, "expected moonshotai/kimi-k3 to be seeded");
    assert.strictEqual(model!.provider, "moonshotai");
    assert.strictEqual(model!.billingMode, "byok");
    assert.strictEqual(isUnifiedEligible(model!), false);
  });

  it("keeps Workers AI Kimi models on the workers-ai provider", () => {
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.7-code"), "workers-ai");
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.6"), "workers-ai");
    assert.strictEqual(inferProvider("@cf/moonshotai/kimi-k2.5"), "workers-ai");
  });
});
