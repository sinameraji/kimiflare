import type { ContrastIssue } from "./wcag.js";

// Built-in themes — imported as JSON so tsup bundles them.
import everforestDarkJson from "./themes/everforest-dark.json" with { type: "json" };
import everforestLightJson from "./themes/everforest-light.json" with { type: "json" };
import kanagawaDarkJson from "./themes/kanagawa-dark.json" with { type: "json" };
import draculaDarkJson from "./themes/dracula-dark.json" with { type: "json" };
import tokyoNightJson from "./themes/tokyo-night.json" with { type: "json" };
import catppuccinMochaJson from "./themes/catppuccin-mocha.json" with { type: "json" };
import catppuccinLatteJson from "./themes/catppuccin-latte.json" with { type: "json" };
import solarizedDarkJson from "./themes/solarized-dark.json" with { type: "json" };
import solarizedLightJson from "./themes/solarized-light.json" with { type: "json" };
import nordJson from "./themes/nord.json" with { type: "json" };
import gruvboxDarkJson from "./themes/gruvbox-dark.json" with { type: "json" };
import gruvboxLightJson from "./themes/gruvbox-light.json" with { type: "json" };
import oneDarkJson from "./themes/one-dark.json" with { type: "json" };

export type ColorName = string;

export interface DimColor {
  color: ColorName;
  dim: boolean;
}

/** Raw palette — now includes background and foreground for WCAG validation. */
export interface ColorPalette {
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  success: string;
  error: string;
}

/** Full theme shape consumed by components. */
export interface Theme {
  name: string;
  label: string;
  palette: ColorPalette;
  user: ColorName;
  assistant: ColorName | undefined;
  reasoning: DimColor;
  info: DimColor;
  error: ColorName;
  warn: ColorName;
  tool: ColorName;
  spinner: ColorName;
  permission: ColorName;
  queue: DimColor;
  accent: ColorName;
  modeBadge: { plan: ColorName; auto: ColorName; edit: ColorName };
  /** Blockquote text color. */
  blockquote?: DimColor;
  /** Inline code color. */
  codeInline?: ColorName;
  /** Fenced code block color. */
  codeBlock?: ColorName;
  /** Hyperlink color. */
  link?: ColorName;
  /** Strikethrough text color. */
  strikethrough?: ColorName;
  /** Table border color. */
  tableBorder?: ColorName;
  /** Table header text color. */
  tableHeader?: ColorName;
  /** Table cell text color. */
  tableCell?: ColorName;
  /** Muted / secondary text. */
  muted?: DimColor;
  /** Input prompt / cursor indicator color. */
  prompt?: ColorName;
}

function normalizeTheme(json: unknown): Theme {
  const obj = json as Record<string, unknown>;
  const palette = obj.palette as ColorPalette;

  const normalizeDim = (v: unknown): DimColor | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "string") return { color: v, dim: false };
    const d = v as Record<string, unknown>;
    return { color: String(d.color), dim: d.dim === true };
  };

  const normalizeColor = (v: unknown): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "string") return v;
    const d = v as Record<string, unknown>;
    return String(d.color);
  };

  return {
    name: String(obj.name),
    label: String(obj.label),
    palette,
    user: String(obj.user ?? palette.primary),
    assistant: obj.assistant === null ? undefined : (typeof obj.assistant === "string" ? obj.assistant : undefined),
    reasoning: normalizeDim(obj.reasoning) ?? { color: palette.secondary, dim: false },
    info: normalizeDim(obj.info) ?? { color: palette.secondary, dim: false },
    error: String(obj.error ?? palette.error),
    warn: String(obj.warn ?? palette.error),
    tool: String(obj.tool ?? palette.secondary),
    spinner: String(obj.spinner ?? palette.primary),
    permission: String(obj.permission ?? palette.error),
    queue: normalizeDim(obj.queue) ?? { color: palette.secondary, dim: false },
    accent: String(obj.accent ?? palette.primary),
    modeBadge: (obj.modeBadge as Theme["modeBadge"]) ?? {
      plan: palette.primary,
      auto: palette.success,
      edit: palette.error,
    },
    blockquote: normalizeDim(obj.blockquote),
    codeInline: normalizeColor(obj.codeInline),
    codeBlock: normalizeColor(obj.codeBlock),
    link: normalizeColor(obj.link),
    strikethrough: normalizeColor(obj.strikethrough),
    tableBorder: normalizeColor(obj.tableBorder),
    tableHeader: normalizeColor(obj.tableHeader),
    tableCell: normalizeColor(obj.tableCell),
    muted: normalizeDim(obj.muted),
    prompt: normalizeColor(obj.prompt),
  };
}

export const BUILT_IN_THEMES: Record<string, Theme> = {
  "everforest-dark": normalizeTheme(everforestDarkJson),
  "everforest-light": normalizeTheme(everforestLightJson),
  "kanagawa-dark": normalizeTheme(kanagawaDarkJson),
  "dracula-dark": normalizeTheme(draculaDarkJson),
  "tokyo-night": normalizeTheme(tokyoNightJson),
  "catppuccin-mocha": normalizeTheme(catppuccinMochaJson),
  "catppuccin-latte": normalizeTheme(catppuccinLatteJson),
  "solarized-dark": normalizeTheme(solarizedDarkJson),
  "solarized-light": normalizeTheme(solarizedLightJson),
  "nord": normalizeTheme(nordJson),
  "gruvbox-dark": normalizeTheme(gruvboxDarkJson),
  "gruvbox-light": normalizeTheme(gruvboxLightJson),
  "one-dark": normalizeTheme(oneDarkJson),
};

/** Mutable theme registry — built-in themes plus any user/project themes loaded at runtime. */
export let THEMES: Record<string, Theme> = { ...BUILT_IN_THEMES };

export const DEFAULT_THEME_NAME = "everforest-dark";

/** Replace the active theme registry (used after loading user/project themes). */
export function setThemes(themes: Record<string, Theme>): void {
  THEMES = themes;
}

export function resolveTheme(name?: string): Theme {
  if (!name) return THEMES[DEFAULT_THEME_NAME]!;
  return THEMES[name] ?? THEMES[DEFAULT_THEME_NAME]!;
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

export function themeList(): Theme[] {
  return Object.values(THEMES);
}

export interface LoadedTheme {
  theme: Theme;
  source: "built-in" | "user" | "project";
  path: string;
  wcagIssues: ContrastIssue[];
}
