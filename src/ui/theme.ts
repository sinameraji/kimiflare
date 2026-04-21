export type ColorName = string;

export interface DimColor {
  color: ColorName;
  dim: boolean;
}

export interface Theme {
  name: string;
  label: string;
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

const dark: Theme = {
  name: "dark",
  label: "dark (default — for dark terminals)",
  user: "cyan",
  assistant: undefined,
  reasoning: { color: "gray", dim: true },
  info: { color: "gray", dim: true },
  error: "red",
  warn: "yellow",
  tool: "magenta",
  spinner: "yellow",
  permission: "yellow",
  queue: { color: "gray", dim: true },
  accent: "cyan",
  modeBadge: { plan: "blue", auto: "green", edit: "cyan" },
};

const light: Theme = {
  name: "light",
  label: "light (for bright terminal backgrounds)",
  user: "blue",
  assistant: undefined,
  reasoning: { color: "blackBright", dim: false },
  info: { color: "blackBright", dim: false },
  error: "red",
  warn: "magenta",
  tool: "magenta",
  spinner: "blue",
  permission: "magenta",
  queue: { color: "blackBright", dim: false },
  accent: "blue",
  modeBadge: { plan: "blue", auto: "green", edit: "magenta" },
};

const highContrast: Theme = {
  name: "high-contrast",
  label: "high-contrast (bold, bright colors for low-vision)",
  user: "cyanBright",
  assistant: "whiteBright",
  reasoning: { color: "whiteBright", dim: false },
  info: { color: "whiteBright", dim: false },
  error: "redBright",
  warn: "yellowBright",
  tool: "magentaBright",
  spinner: "yellowBright",
  permission: "yellowBright",
  queue: { color: "whiteBright", dim: false },
  accent: "cyanBright",
  modeBadge: { plan: "blueBright", auto: "greenBright", edit: "cyanBright" },
};

export const THEMES: Record<string, Theme> = {
  dark,
  light,
  "high-contrast": highContrast,
};

export const DEFAULT_THEME_NAME = "dark";

export function resolveTheme(name: string | undefined): Theme {
  if (!name) return THEMES[DEFAULT_THEME_NAME]!;
  return THEMES[name] ?? THEMES[DEFAULT_THEME_NAME]!;
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}
