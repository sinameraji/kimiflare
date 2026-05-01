export type ColorName = string;

export interface DimColor {
  color: ColorName;
  dim: boolean;
}

export interface Theme {
  name: string;
  label: string;

  // Primary text roles
  user: ColorName;
  assistant: ColorName;

  // Status & feedback
  error: ColorName;
  warn: ColorName;
  success: ColorName;

  // Tool & code
  tool: ColorName;
  muted: DimColor;

  // Decorative / structural
  accent: ColorName;
  border: ColorName;

  // Diff
  diffAdded: ColorName;
  diffRemoved: ColorName;
  diffMeta: ColorName;

  // Process states
  reasoning: DimColor;
  info: DimColor;
  spinner: ColorName;
  permission: ColorName;
  queue: DimColor;

  modeBadge: { plan: ColorName; auto: ColorName; edit: ColorName };
}

const everforestDark: Theme = {
  name: "everforest-dark",
  label: "everforest-dark (nature — moss & sage)",
  user: "#a7c080",
  assistant: "#d3c6aa",
  error: "#e67e80",
  warn: "#dbbc7f",
  success: "#a7c080",
  tool: "#7fbbb3",
  muted: { color: "#7a8478", dim: true },
  accent: "#a7c080",
  border: "#7a8478",
  diffAdded: "#a7c080",
  diffRemoved: "#e67e80",
  diffMeta: "#7fbbb3",
  reasoning: { color: "#7a8478", dim: true },
  info: { color: "#7a8478", dim: true },
  spinner: "#a7c080",
  permission: "#dbbc7f",
  queue: { color: "#7a8478", dim: true },
  modeBadge: { plan: "#7fbbb3", auto: "#a7c080", edit: "#e67e80" },
};

const everforestLight: Theme = {
  name: "everforest-light",
  label: "everforest-light (nature — moss & sage, light)",
  user: "#3a5a1f",
  assistant: "#4a4a3a",
  error: "#a03030",
  warn: "#8a6a20",
  success: "#3a5a1f",
  tool: "#2a5a55",
  muted: { color: "#6a7068", dim: false },
  accent: "#3a5a1f",
  border: "#6a7068",
  diffAdded: "#3a5a1f",
  diffRemoved: "#a03030",
  diffMeta: "#2a5a55",
  reasoning: { color: "#6a7068", dim: false },
  info: { color: "#6a7068", dim: false },
  spinner: "#3a5a1f",
  permission: "#8a6a20",
  queue: { color: "#6a7068", dim: false },
  modeBadge: { plan: "#2a5a55", auto: "#3a5a1f", edit: "#a03030" },
};

const kanagawaDark: Theme = {
  name: "kanagawa-dark",
  label: "kanagawa-dark (Japanese art — wave blue & fuji gold)",
  user: "#7e9cd8",
  assistant: "#c8c093",
  error: "#ff5d62",
  warn: "#e6c384",
  success: "#98bb6c",
  tool: "#7fb4ca",
  muted: { color: "#54546d", dim: true },
  accent: "#7e9cd8",
  border: "#54546d",
  diffAdded: "#98bb6c",
  diffRemoved: "#ff5d62",
  diffMeta: "#7fb4ca",
  reasoning: { color: "#54546d", dim: true },
  info: { color: "#54546d", dim: true },
  spinner: "#7e9cd8",
  permission: "#e6c384",
  queue: { color: "#54546d", dim: true },
  modeBadge: { plan: "#7fb4ca", auto: "#98bb6c", edit: "#ff5d62" },
};

const kanagawaLight: Theme = {
  name: "kanagawa-light",
  label: "kanagawa-light (Japanese art — wave blue & fuji gold, light)",
  user: "#3a5a8c",
  assistant: "#5a5a3a",
  error: "#b83030",
  warn: "#8a6a20",
  success: "#3a5a2a",
  tool: "#2a5a6a",
  muted: { color: "#6a6a7a", dim: false },
  accent: "#3a5a8c",
  border: "#6a6a7a",
  diffAdded: "#3a5a2a",
  diffRemoved: "#b83030",
  diffMeta: "#2a5a6a",
  reasoning: { color: "#6a6a7a", dim: false },
  info: { color: "#6a6a7a", dim: false },
  spinner: "#3a5a8c",
  permission: "#8a6a20",
  queue: { color: "#6a6a7a", dim: false },
  modeBadge: { plan: "#2a5a6a", auto: "#3a5a2a", edit: "#b83030" },
};

const flexokiDark: Theme = {
  name: "flexoki-dark",
  label: "flexoki-dark (accessible — warm paper & ink)",
  user: "#4385be",
  assistant: "#b7b5ac",
  error: "#d14d41",
  warn: "#d0a215",
  success: "#879a39",
  tool: "#3aa99f",
  muted: { color: "#6f6e69", dim: true },
  accent: "#4385be",
  border: "#6f6e69",
  diffAdded: "#879a39",
  diffRemoved: "#d14d41",
  diffMeta: "#3aa99f",
  reasoning: { color: "#6f6e69", dim: true },
  info: { color: "#6f6e69", dim: true },
  spinner: "#4385be",
  permission: "#d0a215",
  queue: { color: "#6f6e69", dim: true },
  modeBadge: { plan: "#3aa99f", auto: "#879a39", edit: "#d14d41" },
};

const flexokiLight: Theme = {
  name: "flexoki-light",
  label: "flexoki-light (accessible — warm paper & ink, light)",
  user: "#205ea6",
  assistant: "#3a3a3a",
  error: "#af3029",
  warn: "#8a6a00",
  success: "#4a5a08",
  tool: "#1a605a",
  muted: { color: "#b7b5ac", dim: false },
  accent: "#205ea6",
  border: "#b7b5ac",
  diffAdded: "#4a5a08",
  diffRemoved: "#af3029",
  diffMeta: "#1a605a",
  reasoning: { color: "#b7b5ac", dim: false },
  info: { color: "#b7b5ac", dim: false },
  spinner: "#205ea6",
  permission: "#8a6a00",
  queue: { color: "#b7b5ac", dim: false },
  modeBadge: { plan: "#1a605a", auto: "#4a5a08", edit: "#af3029" },
};

const oxocarbonDark: Theme = {
  name: "oxocarbon-dark",
  label: "oxocarbon-dark (professional — IBM Carbon sleek)",
  user: "#33b1ff",
  assistant: "#c6c6c6",
  error: "#fa4d56",
  warn: "#f1c21b",
  success: "#42be65",
  tool: "#08bdba",
  muted: { color: "#6f6f6f", dim: true },
  accent: "#33b1ff",
  border: "#6f6f6f",
  diffAdded: "#42be65",
  diffRemoved: "#fa4d56",
  diffMeta: "#08bdba",
  reasoning: { color: "#6f6f6f", dim: true },
  info: { color: "#6f6f6f", dim: true },
  spinner: "#33b1ff",
  permission: "#f1c21b",
  queue: { color: "#6f6f6f", dim: true },
  modeBadge: { plan: "#4589ff", auto: "#42be65", edit: "#fa4d56" },
};

const oxocarbonLight: Theme = {
  name: "oxocarbon-light",
  label: "oxocarbon-light (professional — IBM Carbon sleek, light)",
  user: "#0072c3",
  assistant: "#3a3a3a",
  error: "#b01018",
  warn: "#8a6a00",
  success: "#198038",
  tool: "#007d79",
  muted: { color: "#8d8d8d", dim: false },
  accent: "#0072c3",
  border: "#8d8d8d",
  diffAdded: "#198038",
  diffRemoved: "#b01018",
  diffMeta: "#007d79",
  reasoning: { color: "#8d8d8d", dim: false },
  info: { color: "#8d8d8d", dim: false },
  spinner: "#0072c3",
  permission: "#8a6a00",
  queue: { color: "#8d8d8d", dim: false },
  modeBadge: { plan: "#0043ce", auto: "#198038", edit: "#b01018" },
};

const auroraDark: Theme = {
  name: "aurora-dark",
  label: "aurora-dark (vibrant — northern lights)",
  user: "#88d498",
  assistant: "#c8d6e5",
  error: "#e84855",
  warn: "#f9dc5c",
  success: "#96e6a1",
  tool: "#5bc0be",
  muted: { color: "#7a8599", dim: true },
  accent: "#88d498",
  border: "#7a8599",
  diffAdded: "#96e6a1",
  diffRemoved: "#e84855",
  diffMeta: "#5bc0be",
  reasoning: { color: "#7a8599", dim: true },
  info: { color: "#7a8599", dim: true },
  spinner: "#88d498",
  permission: "#f9dc5c",
  queue: { color: "#7a8599", dim: true },
  modeBadge: { plan: "#5bc0be", auto: "#96e6a1", edit: "#e84855" },
};

const auroraLight: Theme = {
  name: "aurora-light",
  label: "aurora-light (vibrant — northern lights, light)",
  user: "#2d6a4f",
  assistant: "#3a4a5a",
  error: "#9e2a2b",
  warn: "#8a6a00",
  success: "#40916c",
  tool: "#1b7a79",
  muted: { color: "#7d8597", dim: false },
  accent: "#2d6a4f",
  border: "#7d8597",
  diffAdded: "#40916c",
  diffRemoved: "#9e2a2b",
  diffMeta: "#1b7a79",
  reasoning: { color: "#7d8597", dim: false },
  info: { color: "#7d8597", dim: false },
  spinner: "#2d6a4f",
  permission: "#8a6a00",
  queue: { color: "#7d8597", dim: false },
  modeBadge: { plan: "#1b7a79", auto: "#40916c", edit: "#9e2a2b" },
};

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
