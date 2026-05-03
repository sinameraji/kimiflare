/**
 * Theme system for kimiflare.
 *
 * Creating a new theme:
 * 1. Pick 6-7 colors for the palette (primary, secondary, success, error,
 *    warning, info, muted).
 * 2. Call buildTheme(name, label, palette, overrides?) with any custom
 *    semantic mappings.
 *
 * Guidelines for diverse themes:
 * - primary and secondary should contrast (e.g. blue + orange, purple + green).
 * - success/error/warning should be clearly distinct (green/red/yellow).
 * - muted should be a neutral gray so it doesn't compete with accent colors.
 * - assistant should be a readable neutral so AI text has its own identity.
 */

export type ColorName = string;

export interface DimColor {
  color: ColorName;
  dim: boolean;
}

/** The raw palette an author provides — only 6-7 colors. */
export interface ColorPalette {
  primary: string;
  secondary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  muted: string;
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
}

/** Optional overrides for any semantic slot beyond the palette defaults. */
export type ThemeOverrides = Partial<
  Omit<Theme, "name" | "label" | "palette">
>;

/** Build a full Theme from a concise ColorPalette. */
export function buildTheme(
  name: string,
  label: string,
  palette: ColorPalette,
  overrides?: ThemeOverrides,
): Theme {
  const base: Theme = {
    name,
    label,
    palette,
    user: palette.primary,
    tool: palette.secondary,
    spinner: palette.primary,
    accent: palette.secondary,
    error: palette.error,
    warn: palette.warning,
    info: { color: palette.info, dim: false },
    reasoning: { color: palette.muted, dim: true },
    permission: palette.warning,
    queue: { color: palette.muted, dim: true },
    assistant: undefined,
    modeBadge: {
      plan: palette.primary,
      auto: palette.success,
      edit: palette.secondary,
    },
  };
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    modeBadge: overrides.modeBadge ?? base.modeBadge,
    info: overrides.info ?? base.info,
    reasoning: overrides.reasoning ?? base.reasoning,
    queue: overrides.queue ?? base.queue,
  };
}

// ─── Palette 1: Everforest (Nature / Muted / Warm) ───

const everforestDark = buildTheme(
  "everforest-dark",
  "everforest-dark (nature — moss & bark)",
  {
    primary: "#a7c080",
    secondary: "#d699b6",
    success: "#a7c080",
    error: "#e67e80",
    warning: "#dbbc7f",
    info: "#7a8478",
    muted: "#7a8478",
  },
  {
    assistant: "#d3c6aa",
    tool: "#7fbbb3",
    spinner: "#a7c080",
    accent: "#d699b6",
    modeBadge: { plan: "#7fbbb3", auto: "#a7c080", edit: "#e67e80" },
  },
);

const everforestLight = buildTheme(
  "everforest-light",
  "everforest-light (nature — moss & bark)",
  {
    primary: "#3a5a1f",
    secondary: "#8a4a6a",
    success: "#3a5a1f",
    error: "#a03030",
    warning: "#8a6a20",
    info: "#6a7068",
    muted: "#6a7068",
  },
  {
    assistant: "#4a4a3a",
    tool: "#2a5a55",
    spinner: "#3a5a1f",
    accent: "#8a4a6a",
    info: { color: "#6a7068", dim: false },
    reasoning: { color: "#6a7068", dim: false },
    queue: { color: "#6a7068", dim: false },
    modeBadge: { plan: "#2a5a55", auto: "#3a5a1f", edit: "#a03030" },
  },
);

// ─── Palette 2: Kanagawa (Japanese Art / Rich / Deep) ───

const kanagawaDark = buildTheme(
  "kanagawa-dark",
  "kanagawa-dark (Japanese ink — wave blue & fuji gold)",
  {
    primary: "#7e9cd8",
    secondary: "#957fb8",
    success: "#98bb6c",
    error: "#ff5d62",
    warning: "#e6c384",
    info: "#54546d",
    muted: "#54546d",
  },
  {
    assistant: "#c8c093",
    tool: "#7fb4ca",
    spinner: "#7e9cd8",
    accent: "#957fb8",
    modeBadge: { plan: "#7fb4ca", auto: "#98bb6c", edit: "#ff5d62" },
  },
);

const kanagawaLight = buildTheme(
  "kanagawa-light",
  "kanagawa-light (Japanese ink — wave blue & fuji gold)",
  {
    primary: "#3a5a8c",
    secondary: "#5a3a7a",
    success: "#3a5a2a",
    error: "#b83030",
    warning: "#8a6a20",
    info: "#6a6a7a",
    muted: "#6a6a7a",
  },
  {
    assistant: "#5a5a3a",
    tool: "#2a5a6a",
    spinner: "#3a5a8c",
    accent: "#5a3a7a",
    info: { color: "#6a6a7a", dim: false },
    reasoning: { color: "#6a6a7a", dim: false },
    queue: { color: "#6a6a7a", dim: false },
    modeBadge: { plan: "#2a5a6a", auto: "#3a5a2a", edit: "#b83030" },
  },
);

// ─── Palette 3: Flexoki (Accessible / Warm / Editorial) ───

const flexokiDark = buildTheme(
  "flexoki-dark",
  "flexoki-dark (editorial — warm paper & ink)",
  {
    primary: "#4385be",
    secondary: "#ce5d97",
    success: "#879a39",
    error: "#d14d41",
    warning: "#d0a215",
    info: "#6f6e69",
    muted: "#6f6e69",
  },
  {
    assistant: "#b7b5ac",
    tool: "#3aa99f",
    spinner: "#4385be",
    accent: "#ce5d97",
    modeBadge: { plan: "#3aa99f", auto: "#879a39", edit: "#d14d41" },
  },
);

const flexokiLight = buildTheme(
  "flexoki-light",
  "flexoki-light (editorial — warm paper & ink)",
  {
    primary: "#205ea6",
    secondary: "#a02f6f",
    success: "#4a5a08",
    error: "#af3029",
    warning: "#8a6a00",
    info: "#b7b5ac",
    muted: "#b7b5ac",
  },
  {
    assistant: "#3a3a3a",
    tool: "#1a605a",
    spinner: "#205ea6",
    accent: "#a02f6f",
    info: { color: "#b7b5ac", dim: false },
    reasoning: { color: "#b7b5ac", dim: false },
    queue: { color: "#b7b5ac", dim: false },
    modeBadge: { plan: "#1a605a", auto: "#4a5a08", edit: "#af3029" },
  },
);

// ─── Palette 4: Oxocarbon (Professional / Sleek / IBM) ───

const oxocarbonDark = buildTheme(
  "oxocarbon-dark",
  "oxocarbon-dark (professional — IBM carbon)",
  {
    primary: "#33b1ff",
    secondary: "#be95ff",
    success: "#42be65",
    error: "#fa4d56",
    warning: "#f1c21b",
    info: "#6f6f6f",
    muted: "#6f6f6f",
  },
  {
    assistant: "#c6c6c6",
    tool: "#08bdba",
    spinner: "#33b1ff",
    accent: "#be95ff",
    modeBadge: { plan: "#4589ff", auto: "#42be65", edit: "#fa4d56" },
  },
);

const oxocarbonLight = buildTheme(
  "oxocarbon-light",
  "oxocarbon-light (professional — IBM carbon)",
  {
    primary: "#0072c3",
    secondary: "#6a1fd0",
    success: "#198038",
    error: "#b01018",
    warning: "#8a6a00",
    info: "#8d8d8d",
    muted: "#8d8d8d",
  },
  {
    assistant: "#3a3a3a",
    tool: "#007d79",
    spinner: "#0072c3",
    accent: "#6a1fd0",
    info: { color: "#8d8d8d", dim: false },
    reasoning: { color: "#8d8d8d", dim: false },
    queue: { color: "#8d8d8d", dim: false },
    modeBadge: { plan: "#0043ce", auto: "#198038", edit: "#b01018" },
  },
);

// ─── Palette 5: Aurora (Nature Phenomenon / Vibrant) ───

const auroraDark = buildTheme(
  "aurora-dark",
  "aurora-dark (northern lights — mint & lavender)",
  {
    primary: "#88d498",
    secondary: "#c77dff",
    success: "#96e6a1",
    error: "#e84855",
    warning: "#f9dc5c",
    info: "#7a8599",
    muted: "#7a8599",
  },
  {
    assistant: "#c8d6e5",
    tool: "#5bc0be",
    spinner: "#88d498",
    accent: "#c77dff",
    modeBadge: { plan: "#5bc0be", auto: "#96e6a1", edit: "#e84855" },
  },
);

const auroraLight = buildTheme(
  "aurora-light",
  "aurora-light (northern lights — mint & lavender)",
  {
    primary: "#2d6a4f",
    secondary: "#7b2cbf",
    success: "#40916c",
    error: "#9e2a2b",
    warning: "#8a6a00",
    info: "#7d8597",
    muted: "#7d8597",
  },
  {
    assistant: "#3a4a5a",
    tool: "#1b7a79",
    spinner: "#2d6a4f",
    accent: "#7b2cbf",
    info: { color: "#7d8597", dim: false },
    reasoning: { color: "#7d8597", dim: false },
    queue: { color: "#7d8597", dim: false },
    modeBadge: { plan: "#1b7a79", auto: "#40916c", edit: "#9e2a2b" },
  },
);

export const THEMES: Record<string, Theme> = {
  "everforest-dark": everforestDark,
  "everforest-light": everforestLight,
  "kanagawa-dark": kanagawaDark,
  "kanagawa-light": kanagawaLight,
  "flexoki-dark": flexokiDark,
  "flexoki-light": flexokiLight,
  "oxocarbon-dark": oxocarbonDark,
  "oxocarbon-light": oxocarbonLight,
  "aurora-dark": auroraDark,
  "aurora-light": auroraLight,
};

export const DEFAULT_THEME_NAME = "everforest-dark";

export function resolveTheme(name: string | undefined): Theme {
  if (!name) return THEMES[DEFAULT_THEME_NAME]!;
  return THEMES[name] ?? THEMES[DEFAULT_THEME_NAME]!;
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

export function themeList(): Theme[] {
  return Object.values(THEMES);
}
