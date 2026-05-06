import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { checkContrast, type ContrastIssue } from "./wcag.js";
import { setThemes, THEMES, type Theme, type LoadedTheme } from "./theme.js";

const USER_THEMES_DIR = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "kimiflare",
  "themes",
);

function projectThemesDir(cwd = process.cwd()): string {
  return join(cwd, ".kimiflare", "themes");
}

function isHexColor(c: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(c);
}

function validateHex(field: string, value: string | undefined, errors: string[]): void {
  if (value === undefined) return;
  if (!isHexColor(value)) {
    errors.push(`${field}: "${value}" is not a valid #RRGGBB hex color`);
  }
}

function validatePalette(p: unknown, errors: string[]): Theme["palette"] | null {
  if (!p || typeof p !== "object") {
    errors.push("palette must be an object");
    return null;
  }
  const palette = p as Record<string, unknown>;
  const required = ["background", "foreground", "primary", "secondary", "success", "error"];
  for (const key of required) {
    if (typeof palette[key] !== "string") {
      errors.push(`palette.${key} is required and must be a string`);
    } else {
      validateHex(`palette.${key}`, palette[key] as string, errors);
    }
  }
  if (errors.length > 0) return null;
  return {
    background: palette.background as string,
    foreground: palette.foreground as string,
    primary: palette.primary as string,
    secondary: palette.secondary as string,
    success: palette.success as string,
    error: palette.error as string,
  };
}

function validateDimColor(
  field: string,
  value: unknown,
  errors: string[],
): Theme["reasoning"] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    validateHex(field, value, errors);
    return { color: value, dim: false };
  }
  if (!value || typeof value !== "object") {
    errors.push(`${field} must be a string or { color, dim } object`);
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.color !== "string") {
    errors.push(`${field}.color is required`);
    return undefined;
  }
  validateHex(`${field}.color`, obj.color, errors);
  return {
    color: obj.color,
    dim: obj.dim === true,
  };
}

function validateModeBadge(
  value: unknown,
  errors: string[],
): Theme["modeBadge"] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    errors.push("modeBadge must be an object");
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ["plan", "auto", "edit"]) {
    if (typeof obj[key] !== "string") {
      errors.push(`modeBadge.${key} is required`);
    } else {
      validateHex(`modeBadge.${key}`, obj[key] as string, errors);
      result[key] = obj[key] as string;
    }
  }
  return result as Theme["modeBadge"];
}

function normalizeColor(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  const d = v as Record<string, unknown>;
  return typeof d.color === "string" ? d.color : undefined;
}

export interface LoadResult {
  themes: Record<string, LoadedTheme>;
  errors: string[];
}

export async function loadThemesFromDir(
  dir: string,
  source: LoadedTheme["source"],
): Promise<{ themes: LoadedTheme[]; errors: string[] }> {
  const themes: LoadedTheme[] = [];
  const errors: string[] = [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return { themes, errors };
  }

  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const path = join(dir, file);
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      errors.push(`${path}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (!json || typeof json !== "object") {
      errors.push(`${path}: root must be an object`);
      continue;
    }

    const obj = json as Record<string, unknown>;
    const fileErrors: string[] = [];

    if (typeof obj.name !== "string" || obj.name.length === 0) {
      fileErrors.push("name is required");
    }
    if (typeof obj.label !== "string" || obj.label.length === 0) {
      fileErrors.push("label is required");
    }

    const palette = validatePalette(obj.palette, fileErrors);

    if (fileErrors.length > 0) {
      errors.push(...fileErrors.map((e) => `${path}: ${e}`));
      continue;
    }

    if (!palette) continue;

    const theme: Theme = {
      name: obj.name as string,
      label: obj.label as string,
      palette,
      user: (typeof obj.user === "string" ? obj.user : palette.primary) as string,
      assistant: obj.assistant === null ? undefined : (typeof obj.assistant === "string" ? obj.assistant : undefined),
      reasoning: validateDimColor("reasoning", obj.reasoning, fileErrors) ?? { color: palette.secondary, dim: false },
      info: validateDimColor("info", obj.info, fileErrors) ?? { color: palette.secondary, dim: false },
      error: (typeof obj.error === "string" ? obj.error : palette.error) as string,
      warn: (typeof obj.warn === "string" ? obj.warn : palette.error) as string,
      tool: (typeof obj.tool === "string" ? obj.tool : palette.secondary) as string,
      spinner: (typeof obj.spinner === "string" ? obj.spinner : palette.primary) as string,
      permission: (typeof obj.permission === "string" ? obj.permission : palette.error) as string,
      queue: validateDimColor("queue", obj.queue, fileErrors) ?? { color: palette.secondary, dim: false },
      accent: (typeof obj.accent === "string" ? obj.accent : palette.primary) as string,
      modeBadge: validateModeBadge(obj.modeBadge, fileErrors) ?? {
        plan: palette.primary,
        auto: palette.success,
        edit: palette.error,
      },
      blockquote: validateDimColor("blockquote", obj.blockquote, fileErrors),
      codeInline: normalizeColor(obj.codeInline),
      codeBlock: normalizeColor(obj.codeBlock),
      link: normalizeColor(obj.link),
      strikethrough: normalizeColor(obj.strikethrough),
      tableBorder: normalizeColor(obj.tableBorder),
      tableHeader: normalizeColor(obj.tableHeader),
      tableCell: normalizeColor(obj.tableCell),
      muted: validateDimColor("muted", obj.muted, fileErrors),
    };

    if (fileErrors.length > 0) {
      errors.push(...fileErrors.map((e) => `${path}: ${e}`));
      continue;
    }

    // WCAG contrast checks
    const wcagIssues: ContrastIssue[] = [];
    const bg = palette.background;

    const check = (label: string, color: string | undefined) => {
      if (!color) return;
      const issue = checkContrast(color, bg);
      if (issue) wcagIssues.push({ ...issue, pair: `${label} (${issue.pair})` });
    };

    check("foreground", palette.foreground);
    check("user", theme.user);
    check("assistant", theme.assistant);
    check("reasoning", theme.reasoning.color);
    check("info", theme.info.color);
    check("error", theme.error);
    check("warn", theme.warn);
    check("tool", theme.tool);
    check("accent", theme.accent);
    check("link", theme.link);
    check("codeInline", theme.codeInline);
    check("codeBlock", theme.codeBlock);
    check("tableHeader", theme.tableHeader);
    check("tableCell", theme.tableCell);

    themes.push({ theme, source, path, wcagIssues });
  }

  return { themes, errors };
}

let cachedResult: LoadResult | null = null;

export async function loadAllThemes(cwd = process.cwd()): Promise<LoadResult> {
  if (cachedResult) return cachedResult;

  const themes: Record<string, LoadedTheme> = {};
  const errors: string[] = [];

  // Start with built-in themes
  for (const [name, theme] of Object.entries(THEMES)) {
    themes[name] = {
      theme,
      source: "built-in",
      path: "<built-in>",
      wcagIssues: [],
    };
  }

  // 1. User themes (override built-in)
  const user = await loadThemesFromDir(USER_THEMES_DIR, "user");
  for (const t of user.themes) {
    themes[t.theme.name] = t;
  }
  errors.push(...user.errors);

  // 2. Project-local themes (override user)
  const project = await loadThemesFromDir(projectThemesDir(cwd), "project");
  for (const t of project.themes) {
    themes[t.theme.name] = t;
  }
  errors.push(...project.errors);

  cachedResult = { themes, errors };
  return cachedResult;
}

export function clearThemeCache(): void {
  cachedResult = null;
}

/** Load user and project themes and merge them into the global THEMES registry. */
export async function loadAndMergeThemes(cwd = process.cwd()): Promise<{ errors: string[]; wcagWarnings: string[] }> {
  clearThemeCache();
  const { themes, errors } = await loadAllThemes(cwd);

  const merged: Record<string, Theme> = {};
  for (const [name, t] of Object.entries(THEMES)) {
    merged[name] = t;
  }
  for (const t of Object.values(themes)) {
    merged[t.theme.name] = t.theme;
  }
  setThemes(merged);

  const wcagWarnings: string[] = [];
  for (const t of Object.values(themes)) {
    if (t.wcagIssues.length > 0 && t.source !== "built-in") {
      wcagWarnings.push(
        `Theme "${t.theme.label}" has WCAG contrast issues:\n` +
          t.wcagIssues.map((i) => `  ${i.pair}: ${i.ratio}:1 (needs ${i.required}:1)`).join("\n"),
      );
    }
  }

  return { errors, wcagWarnings };
}

export async function getThemeWcagIssues(name: string, cwd?: string): Promise<ContrastIssue[]> {
  const { themes } = await loadAllThemes(cwd);
  return themes[name]?.wcagIssues ?? [];
}
