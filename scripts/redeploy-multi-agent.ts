#!/usr/bin/env tsx
/**
 * Headless redeploy of the kimiflare-multi-agent worker.
 * Runs the same deployCommute() generator the TUI uses, streaming each step
 * to stdout. Picks up whatever is on kimiflare-commute `main` (clones fresh).
 *
 * Usage: npx tsx scripts/redeploy-multi-agent.ts [workerName]
 */
import { deployCommute } from "../src/remote/deploy-commute.js";

async function main() {
  const workerName = process.argv[2];
  const opts = workerName ? { workerName } : {};
  console.log(`▶ Redeploying multi-agent worker${workerName ? ` (${workerName})` : " (default: kimiflare-multi-agent)"}…\n`);

  const gen = deployCommute(opts);
  let result: unknown;
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      result = value;
      break;
    }
    const step = value as { message: string; ok?: boolean; error?: boolean };
    const prefix = step.error ? "✗" : step.ok ? "✓" : "·";
    console.log(`${prefix} ${step.message}`);
  }
  console.log("\n✅ Deploy finished:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("\n✗ Deploy failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
