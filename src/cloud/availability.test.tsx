/**
 * KimiFlare Cloud is temporarily hidden. These tests pin the user-journey
 * guarantees: no Cloud option in onboarding or the billing chooser, and no
 * way for a persisted/env cloudMode to put the user on the managed service.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCloudModeAvailable, CLOUD_UNAVAILABLE_NOTICE } from "./availability.js";
import { Onboarding } from "../ui/onboarding.js";
import { BillingChooser } from "../ui/billing-chooser.js";
import { ThemeProvider } from "../ui/theme-context.js";
import { resolveTheme } from "../ui/theme.js";
import { getModel } from "../models/registry.js";
import { loadConfig } from "../config.js";

const theme = resolveTheme();

describe("KimiFlare Cloud is hidden (BYOK-only)", () => {
  it("the gate is off and the notice points at Log in with Cloudflare", () => {
    assert.strictEqual(isCloudModeAvailable(), false);
    assert.match(CLOUD_UNAVAILABLE_NOTICE, /Log in with Cloudflare/);
  });

  it("onboarding starts at 'Connect your Cloudflare account' and never offers KimiFlare Cloud", () => {
    const out = renderToString(
      <ThemeProvider theme={theme}>
        <Onboarding onDone={() => {}} />
      </ThemeProvider>,
    );
    assert.match(out, /Connect your Cloudflare account/);
    assert.match(out, /Log in with Cloudflare/);
    assert.match(out, /Paste an API token/);
    assert.doesNotMatch(out, /KimiFlare Cloud/i);
    assert.doesNotMatch(out, /5,000,000 tokens free/);
    assert.match(out, /Step 1 of 4/);
  });

  it("the billing chooser no longer offers 'Start free with Kimiflare Cloud'", () => {
    const model = getModel("@cf/moonshotai/kimi-k2.6")!;
    const out = renderToString(
      <ThemeProvider theme={theme}>
        <BillingChooser model={model} onPick={() => {}} />
      </ThemeProvider>,
    );
    assert.doesNotMatch(out, /Kimiflare Cloud/i);
    assert.match(out, /Use Cloudflare credits/);
  });

  it("a persisted cloudMode:true config with no BYOK creds is ignored → onboarding (loadConfig returns null)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-cloudgate-"));
    const prev = { xdg: process.env.XDG_CONFIG_HOME, cloud: process.env.KIMIFLARE_CLOUD, acct: process.env.CLOUDFLARE_ACCOUNT_ID, tok: process.env.CLOUDFLARE_API_TOKEN };
    try {
      process.env.XDG_CONFIG_HOME = dir;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CF_ACCOUNT_ID;
      delete process.env.CF_API_TOKEN;
      await mkdir(join(dir, "kimiflare"), { recursive: true });
      await writeFile(join(dir, "kimiflare", "config.json"), JSON.stringify({ accountId: "", apiToken: "", model: "moonshotai/kimi-k3", cloudMode: true }));
      assert.strictEqual(await loadConfig(), null);

      // KIMIFLARE_CLOUD=1 is ignored as well.
      process.env.KIMIFLARE_CLOUD = "1";
      assert.strictEqual(await loadConfig(), null);

      // A BYOK config that also carries cloudMode:true loads as plain BYOK.
      await writeFile(join(dir, "kimiflare", "config.json"), JSON.stringify({ accountId: "acct", apiToken: "tok", model: "@cf/moonshotai/kimi-k2.6", cloudMode: true }));
      const cfg = await loadConfig();
      assert.ok(cfg);
      assert.strictEqual(cfg.cloudMode, undefined);
      assert.strictEqual(cfg.accountId, "acct");
    } finally {
      if (prev.xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev.xdg;
      if (prev.cloud === undefined) delete process.env.KIMIFLARE_CLOUD; else process.env.KIMIFLARE_CLOUD = prev.cloud;
      if (prev.acct !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = prev.acct;
      if (prev.tok !== undefined) process.env.CLOUDFLARE_API_TOKEN = prev.tok;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
