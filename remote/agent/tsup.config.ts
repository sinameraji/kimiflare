import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/remote-agent.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [],
});
