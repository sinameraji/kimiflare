import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
    "@agentclientprotocol/sdk",
    "@modelcontextprotocol/sdk",
    "better-sqlite3",
    "fast-glob",
    "diff",
    "turndown",
    "isolated-vm",
    "vscode-languageserver-protocol",
  ],
});
