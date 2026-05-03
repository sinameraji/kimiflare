export type ColorName = string;

export interface DimColor {
  color: ColorName;
  dim: boolean;
}

/** Raw palette — only 4 colors. Everything else derives from these. */
export interface ColorPalette {
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
}

/** Optional overrides for any semantic slot beyond the palette defaults. */
export type ThemeOverrides = Partial<
  Omit<Theme, "name" | "label" | "palette">
>;

/** Build a full Theme from a 4-color palette. */
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
    accent: palette.primary,
    error: palette.error,
    warn: palette.error,
    info: { color: palette.secondary, dim: false },
    reasoning: { color: palette.secondary, dim: false },
    permission: palette.error,
    queue: { color: palette.secondary, dim: false },
    assistant: undefined,
    modeBadge: {
      plan: palette.primary,
      auto: palette.success,
      edit: palette.error,
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

const everforestDark = buildTheme("everforest-dark", "everforest-dark", {
  primary: "#a7c080",
  secondary: "#d3c6aa",
  success: "#a7c080",
  error: "#e67e80",
});

const everforestLight = buildTheme("everforest-light", "everforest-light", {
  primary: "#c5e49a",
  secondary: "#f0e6c8",
  success: "#c5e49a",
  error: "#e07070",
});

const kanagawaDark = buildTheme("kanagawa-dark", "kanagawa-dark", {
  primary: "#8aadf4",
  secondary: "#f0e6c8",
  success: "#a6e3a1",
  error: "#f38ba8",
});

const draculaDark = buildTheme("dracula-dark", "dracula-dark", {
  primary: "#ff79c6",
  secondary: "#f8f8f2",
  success: "#50fa7b",
  error: "#ff5555",
});

export const THEMES: Record<string, Theme> = {
  "everforest-dark": everforestDark,
  "everforest-light": everforestLight,
  "kanagawa-dark": kanagawaDark,
  "dracula-dark": draculaDark,
};

export const DEFAULT_THEME_NAME = "everforest-dark";

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
