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

const everforestDark: Theme = {
  name: "everforest-dark",
  label: "everforest-dark (nature — moss & sage)",
  user: "#a7c080",
  assistant: "#d3c6aa",
  reasoning: { color: "#7a8478", dim: true },
  info: { color: "#7a8478", dim: true },
  error: "#e67e80",
  warn: "#dbbc7f",
  tool: "#7fbbb3",
  spinner: "#a7c080",
  permission: "#dbbc7f",
  queue: { color: "#7a8478", dim: true },
  accent: "#d699b6",
  modeBadge: { plan: "#7fbbb3", auto: "#a7c080", edit: "#e67e80" },
};

const everforestLight: Theme = {
  name: "everforest-light",
  label: "everforest-light (nature — moss & sage, light)",
  user: "#3a5a1f",
  assistant: "#4a4a3a",
  reasoning: { color: "#6a7068", dim: false },
  info: { color: "#6a7068", dim: false },
  error: "#a03030",
  warn: "#8a6a20",
  tool: "#2a5a55",
  spinner: "#3a5a1f",
  permission: "#8a6a20",
  queue: { color: "#6a7068", dim: false },
  accent: "#8a4a6a",
  modeBadge: { plan: "#2a5a55", auto: "#3a5a1f", edit: "#a03030" },
};

const kanagawaDark: Theme = {
  name: "kanagawa-dark",
  label: "kanagawa-dark (Japanese art — wave blue & fuji gold)",
  user: "#7e9cd8",
  assistant: "#c8c093",
  reasoning: { color: "#54546d", dim: true },
  info: { color: "#54546d", dim: true },
  error: "#ff5d62",
  warn: "#e6c384",
  tool: "#7fb4ca",
  spinner: "#7e9cd8",
  permission: "#e6c384",
  queue: { color: "#54546d", dim: true },
  accent: "#957fb8",
  modeBadge: { plan: "#7fb4ca", auto: "#98bb6c", edit: "#ff5d62" },
};

const kanagawaLight: Theme = {
  name: "kanagawa-light",
  label: "kanagawa-light (Japanese art — wave blue & fuji gold, light)",
  user: "#3a5a8c",
  assistant: "#5a5a3a",
  reasoning: { color: "#6a6a7a", dim: false },
  info: { color: "#6a6a7a", dim: false },
  error: "#b83030",
  warn: "#8a6a20",
  tool: "#2a5a6a",
  spinner: "#3a5a8c",
  permission: "#8a6a20",
  queue: { color: "#6a6a7a", dim: false },
  accent: "#5a3a7a",
  modeBadge: { plan: "#2a5a6a", auto: "#3a5a2a", edit: "#b83030" },
};

const flexokiDark: Theme = {
  name: "flexoki-dark",
  label: "flexoki-dark (accessible — warm paper & ink)",
  user: "#4385be",
  assistant: "#b7b5ac",
  reasoning: { color: "#6f6e69", dim: true },
  info: { color: "#6f6e69", dim: true },
  error: "#d14d41",
  warn: "#d0a215",
  tool: "#3aa99f",
  spinner: "#4385be",
  permission: "#d0a215",
  queue: { color: "#6f6e69", dim: true },
  accent: "#ce5d97",
  modeBadge: { plan: "#3aa99f", auto: "#879a39", edit: "#d14d41" },
};

const flexokiLight: Theme = {
  name: "flexoki-light",
  label: "flexoki-light (accessible — warm paper & ink, light)",
  user: "#205ea6",
  assistant: "#3a3a3a",
  reasoning: { color: "#b7b5ac", dim: false },
  info: { color: "#b7b5ac", dim: false },
  error: "#af3029",
  warn: "#8a6a00",
  tool: "#1a605a",
  spinner: "#205ea6",
  permission: "#8a6a00",
  queue: { color: "#b7b5ac", dim: false },
  accent: "#a02f6f",
  modeBadge: { plan: "#1a605a", auto: "#4a5a08", edit: "#af3029" },
};

const oxocarbonDark: Theme = {
  name: "oxocarbon-dark",
  label: "oxocarbon-dark (professional — IBM Carbon sleek)",
  user: "#33b1ff",
  assistant: "#c6c6c6",
  reasoning: { color: "#6f6f6f", dim: true },
  info: { color: "#6f6f6f", dim: true },
  error: "#fa4d56",
  warn: "#f1c21b",
  tool: "#08bdba",
  spinner: "#33b1ff",
  permission: "#f1c21b",
  queue: { color: "#6f6f6f", dim: true },
  accent: "#be95ff",
  modeBadge: { plan: "#4589ff", auto: "#42be65", edit: "#fa4d56" },
};

const oxocarbonLight: Theme = {
  name: "oxocarbon-light",
  label: "oxocarbon-light (professional — IBM Carbon sleek, light)",
  user: "#0072c3",
  assistant: "#3a3a3a",
  reasoning: { color: "#8d8d8d", dim: false },
  info: { color: "#8d8d8d", dim: false },
  error: "#b01018",
  warn: "#8a6a00",
  tool: "#007d79",
  spinner: "#0072c3",
  permission: "#8a6a00",
  queue: { color: "#8d8d8d", dim: false },
  accent: "#6a1fd0",
  modeBadge: { plan: "#0043ce", auto: "#198038", edit: "#b01018" },
};

const auroraDark: Theme = {
  name: "aurora-dark",
  label: "aurora-dark (vibrant — northern lights)",
  user: "#88d498",
  assistant: "#c8d6e5",
  reasoning: { color: "#7a8599", dim: true },
  info: { color: "#7a8599", dim: true },
  error: "#e84855",
  warn: "#f9dc5c",
  tool: "#5bc0be",
  spinner: "#88d498",
  permission: "#f9dc5c",
  queue: { color: "#7a8599", dim: true },
  accent: "#c77dff",
  modeBadge: { plan: "#5bc0be", auto: "#96e6a1", edit: "#e84855" },
};

const auroraLight: Theme = {
  name: "aurora-light",
  label: "aurora-light (vibrant — northern lights, light)",
  user: "#2d6a4f",
  assistant: "#3a4a5a",
  reasoning: { color: "#7d8597", dim: false },
  info: { color: "#7d8597", dim: false },
  error: "#9e2a2b",
  warn: "#8a6a00",
  tool: "#1b7a79",
  spinner: "#2d6a4f",
  permission: "#8a6a00",
  queue: { color: "#7d8597", dim: false },
  accent: "#7b2cbf",
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
