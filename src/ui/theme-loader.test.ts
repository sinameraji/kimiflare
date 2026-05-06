import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadThemesFromDir, clearThemeCache } from "./theme-loader.js";

describe("loadThemesFromDir", () => {
  it("loads valid theme JSON", async () => {
    const dir = join(tmpdir(), `kf-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "test-theme.json"),
      JSON.stringify({
        name: "test-theme",
        label: "Test Theme",
        palette: {
          background: "#1a1b26",
          foreground: "#a9b1d6",
          primary: "#7aa2f7",
          secondary: "#565f89",
          success: "#9ece6a",
          error: "#f7768e",
        },
        user: "#7aa2f7",
      }),
    );

    const { themes, errors } = await loadThemesFromDir(dir, "user");
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(themes.length, 1);
    assert.strictEqual(themes[0]!.theme.name, "test-theme");
    assert.strictEqual(themes[0]!.theme.palette.background, "#1a1b26");

    await rm(dir, { recursive: true });
  });

  it("reports invalid hex colors", async () => {
    const dir = join(tmpdir(), `kf-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "bad-theme.json"),
      JSON.stringify({
        name: "bad-theme",
        label: "Bad Theme",
        palette: {
          background: "not-a-color",
          foreground: "#a9b1d6",
          primary: "#7aa2f7",
          secondary: "#565f89",
          success: "#9ece6a",
          error: "#f7768e",
        },
      }),
    );

    const { themes, errors } = await loadThemesFromDir(dir, "user");
    assert.strictEqual(themes.length, 0);
    assert.ok(errors.some((e) => e.includes("not-a-color")));

    await rm(dir, { recursive: true });
  });

  it("reports WCAG issues for low contrast", async () => {
    const dir = join(tmpdir(), `kf-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "low-contrast.json"),
      JSON.stringify({
        name: "low-contrast",
        label: "Low Contrast",
        palette: {
          background: "#ffffff",
          foreground: "#eeeeee",
          primary: "#dddddd",
          secondary: "#cccccc",
          success: "#bbbbbb",
          error: "#aaaaaa",
        },
      }),
    );

    const { themes, errors } = await loadThemesFromDir(dir, "user");
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(themes.length, 1);
    assert.ok(themes[0]!.wcagIssues.length > 0, "expected WCAG issues for low contrast theme");

    await rm(dir, { recursive: true });
  });
});
