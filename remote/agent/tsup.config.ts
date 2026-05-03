import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/remote-agent.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: false,
  minify: false,
  bundle: true,
  external: [],
  // Include source files from the main project
  esbuildOptions(options) {
    options.resolveExtensions = [".ts", ".js", ".tsx"];
  },
});
