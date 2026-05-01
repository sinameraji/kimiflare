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
  user: "#61afef",
  assistant: undefined,
  reasoning: { color: "#5c6370", dim: true },
  info: { color: "#5c6370", dim: true },
  error: "#e06c75",
  warn: "#e5c07b",
  tool: "#61afef",
  spinner: "#e5c07b",
  permission: "#e5c07b",
  queue: { color: "#5c6370", dim: true },
  accent: "#56b6c2",
  modeBadge: { plan: "#61afef", auto: "#98c379", edit: "#56b6c2" },
};

const light: Theme = {
  name: "light",
  label: "light (for bright terminal backgrounds)",
  user: "#4078f2",
  assistant: undefined,
  reasoning: { color: "#a0a1a7", dim: false },
  info: { color: "#a0a1a7", dim: false },
  error: "#e45649",
  warn: "#986801",
  tool: "#a626a4",
  spinner: "#4078f2",
  permission: "#986801",
  queue: { color: "#a0a1a7", dim: false },
  accent: "#4078f2",
  modeBadge: { plan: "#4078f2", auto: "#50a14f", edit: "#a626a4" },
};

const highContrast: Theme = {
  name: "high-contrast",
  label: "high-contrast (bold, bright colors for low-vision)",
  user: "#00ffff",
  assistant: "#ffffff",
  reasoning: { color: "#ffffff", dim: false },
  info: { color: "#ffffff", dim: false },
  error: "#ff0000",
  warn: "#ffff00",
  tool: "#ff00ff",
  spinner: "#ffff00",
  permission: "#ffff00",
  queue: { color: "#ffffff", dim: false },
  accent: "#00ffff",
  modeBadge: { plan: "#0000ff", auto: "#00ff00", edit: "#00ffff" },
};

const dracula: Theme = {
  name: "dracula",
  label: "dracula (pink & cyan, popular dark)",
  user: "#8be9fd",
  assistant: undefined,
  reasoning: { color: "#6272a4", dim: true },
  info: { color: "#6272a4", dim: true },
  error: "#ff5555",
  warn: "#f1fa8c",
  tool: "#bd93f9",
  spinner: "#8be9fd",
  permission: "#f1fa8c",
  queue: { color: "#6272a4", dim: true },
  accent: "#ff79c6",
  modeBadge: { plan: "#8be9fd", auto: "#50fa7b", edit: "#ff79c6" },
};

const nord: Theme = {
  name: "nord",
  label: "nord (arctic blue & frost, calm dark)",
  user: "#88c0d0",
  assistant: undefined,
  reasoning: { color: "#4c566a", dim: true },
  info: { color: "#4c566a", dim: true },
  error: "#bf616a",
  warn: "#ebcb8b",
  tool: "#88c0d0",
  spinner: "#88c0d0",
  permission: "#ebcb8b",
  queue: { color: "#4c566a", dim: true },
  accent: "#88c0d0",
  modeBadge: { plan: "#5e81ac", auto: "#a3be8c", edit: "#88c0d0" },
};

const monokai: Theme = {
  name: "monokai",
  label: "monokai (vibrant pink & yellow)",
  user: "#f92672",
  assistant: undefined,
  reasoning: { color: "#75715e", dim: true },
  info: { color: "#75715e", dim: true },
  error: "#f92672",
  warn: "#e6db74",
  tool: "#66d9ef",
  spinner: "#e6db74",
  permission: "#e6db74",
  queue: { color: "#75715e", dim: true },
  accent: "#f92672",
  modeBadge: { plan: "#66d9ef", auto: "#a6e22e", edit: "#f92672" },
};

const solarizedDark: Theme = {
  name: "solarized-dark",
  label: "solarized-dark (muted blue & yellow)",
  user: "#2aa198",
  assistant: undefined,
  reasoning: { color: "#586e75", dim: true },
  info: { color: "#586e75", dim: true },
  error: "#dc322f",
  warn: "#b58900",
  tool: "#2aa198",
  spinner: "#b58900",
  permission: "#b58900",
  queue: { color: "#586e75", dim: true },
  accent: "#2aa198",
  modeBadge: { plan: "#268bd2", auto: "#859900", edit: "#2aa198" },
};

const solarizedLight: Theme = {
  name: "solarized-light",
  label: "solarized-light (light beige & cyan)",
  user: "#268bd2",
  assistant: undefined,
  reasoning: { color: "#93a1a1", dim: false },
  info: { color: "#93a1a1", dim: false },
  error: "#dc322f",
  warn: "#b58900",
  tool: "#268bd2",
  spinner: "#268bd2",
  permission: "#b58900",
  queue: { color: "#93a1a1", dim: false },
  accent: "#268bd2",
  modeBadge: { plan: "#268bd2", auto: "#859900", edit: "#268bd2" },
};

const tokyoNight: Theme = {
  name: "tokyo-night",
  label: "tokyo-night (deep blue & purple)",
  user: "#7dcfff",
  assistant: undefined,
  reasoning: { color: "#565f89", dim: true },
  info: { color: "#565f89", dim: true },
  error: "#f7768e",
  warn: "#e0af68",
  tool: "#bb9af7",
  spinner: "#7dcfff",
  permission: "#e0af68",
  queue: { color: "#565f89", dim: true },
  accent: "#bb9af7",
  modeBadge: { plan: "#7aa2f7", auto: "#9ece6a", edit: "#bb9af7" },
};

const gruvboxDark: Theme = {
  name: "gruvbox-dark",
  label: "gruvbox-dark (warm retro dark)",
  user: "#fabd2f",
  assistant: undefined,
  reasoning: { color: "#928374", dim: true },
  info: { color: "#928374", dim: true },
  error: "#fb4934",
  warn: "#fe8019",
  tool: "#83a598",
  spinner: "#fabd2f",
  permission: "#fe8019",
  queue: { color: "#928374", dim: true },
  accent: "#fabd2f",
  modeBadge: { plan: "#83a598", auto: "#b8bb26", edit: "#fabd2f" },
};

const catppuccinMocha: Theme = {
  name: "catppuccin-mocha",
  label: "catppuccin-mocha (pastel pink & lavender)",
  user: "#f5c2e7",
  assistant: undefined,
  reasoning: { color: "#6c7086", dim: true },
  info: { color: "#6c7086", dim: true },
  error: "#f38ba8",
  warn: "#f9e2af",
  tool: "#89dceb",
  spinner: "#89dceb",
  permission: "#f9e2af",
  queue: { color: "#6c7086", dim: true },
  accent: "#cba6f7",
  modeBadge: { plan: "#89b4fa", auto: "#a6e3a1", edit: "#f5c2e7" },
};

const rosePine: Theme = {
  name: "rose-pine",
  label: "rose-pine (soft rose & foam)",
  user: "#ebbcba",
  assistant: undefined,
  reasoning: { color: "#6e6a86", dim: true },
  info: { color: "#6e6a86", dim: true },
  error: "#eb6f92",
  warn: "#f6c177",
  tool: "#9ccfd8",
  spinner: "#ebbcba",
  permission: "#f6c177",
  queue: { color: "#6e6a86", dim: true },
  accent: "#ebbcba",
  modeBadge: { plan: "#31748f", auto: "#9ccfd8", edit: "#ebbcba" },
};

const oneDark: Theme = {
  name: "one-dark",
  label: "one-dark (Atom's iconic dark — blue & purple)",
  user: "#61afef",
  assistant: undefined,
  reasoning: { color: "#5c6370", dim: true },
  info: { color: "#5c6370", dim: true },
  error: "#e06c75",
  warn: "#e5c07b",
  tool: "#c678dd",
  spinner: "#61afef",
  permission: "#e5c07b",
  queue: { color: "#5c6370", dim: true },
  accent: "#c678dd",
  modeBadge: { plan: "#61afef", auto: "#98c379", edit: "#c678dd" },
};

const ayu: Theme = {
  name: "ayu",
  label: "ayu (clean modern — orange & cyan)",
  user: "#39bae6",
  assistant: undefined,
  reasoning: { color: "#4d5566", dim: true },
  info: { color: "#4d5566", dim: true },
  error: "#f07178",
  warn: "#ffb454",
  tool: "#73b8ff",
  spinner: "#39bae6",
  permission: "#ffb454",
  queue: { color: "#4d5566", dim: true },
  accent: "#39bae6",
  modeBadge: { plan: "#39bae6", auto: "#7ee787", edit: "#ffb454" },
};

const nightOwl: Theme = {
  name: "night-owl",
  label: "night-owl (deep navy — cyan & red)",
  user: "#82aaff",
  assistant: undefined,
  reasoning: { color: "#4d6885", dim: true },
  info: { color: "#4d6885", dim: true },
  error: "#ef5350",
  warn: "#ffca28",
  tool: "#c792ea",
  spinner: "#82aaff",
  permission: "#ffca28",
  queue: { color: "#4d6885", dim: true },
  accent: "#c792ea",
  modeBadge: { plan: "#82aaff", auto: "#7ee787", edit: "#c792ea" },
};

const palenight: Theme = {
  name: "palenight",
  label: "palenight (Material pale — purple & cyan)",
  user: "#82b1ff",
  assistant: undefined,
  reasoning: { color: "#4c566a", dim: true },
  info: { color: "#4c566a", dim: true },
  error: "#f07178",
  warn: "#ffcb6b",
  tool: "#c792ea",
  spinner: "#82b1ff",
  permission: "#ffcb6b",
  queue: { color: "#4c566a", dim: true },
  accent: "#c792ea",
  modeBadge: { plan: "#82b1ff", auto: "#c3e88d", edit: "#c792ea" },
};

export const THEMES: Record<string, Theme> = {
  dark,
  light,
  "high-contrast": highContrast,
  dracula,
  nord,
  monokai,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  "tokyo-night": tokyoNight,
  "gruvbox-dark": gruvboxDark,
  "catppuccin-mocha": catppuccinMocha,
  "rose-pine": rosePine,
  "one-dark": oneDark,
  ayu,
  "night-owl": nightOwl,
  palenight,
};

export const DEFAULT_THEME_NAME = "dark";

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
