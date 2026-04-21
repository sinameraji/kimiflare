import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: false,
  minify: false,
  banner: { js: "" },
  external: [
    // keep runtime deps out of the bundle so they resolve from node_modules
    "ink",
    "ink-text-input",
    "ink-spinner",
    "ink-select-input",
    "react",
    "commander",
    "fast-glob",
    "diff",
    "turndown",
  ],
});
