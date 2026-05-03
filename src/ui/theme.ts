/**
 * Theme system for kimiflare.
 *
 * Creating a new theme:
 * 1. Pick 6-7 colors for the palette (primary, secondary, success, error,
 *    warning, info, muted).
 * 2. Call buildTheme(name, label, palette).
 * 3. The mapping function distributes your palette across UI roles
 *    automatically.
 *
 * Guidelines for diverse themes:
 * - primary and secondary should contrast (e.g. blue + orange, purple + green).
 * - success/error/warning should be clearly distinct (green/red/yellow).
 * - muted should be a neutral gray so it doesn't compete with accent colors.
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

/** Build a full Theme from a concise ColorPalette. */
export function buildTheme(
  name: string,
  label: string,
  palette: ColorPalette,
): Theme {
  return {
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
}

const dark = buildTheme("dark", "dark (default — for dark terminals)", {
  primary: "#61afef",
  secondary: "#56b6c2",
  success: "#98c379",
  error: "#e06c75",
  warning: "#e5c07b",
  info: "#5c6370",
  muted: "#5c6370",
});

const light = buildTheme("light", "light (for bright terminal backgrounds)", {
  primary: "#4078f2",
  secondary: "#a626a4",
  success: "#50a14f",
  error: "#e45649",
  warning: "#986801",
  info: "#a0a1a7",
  muted: "#a0a1a7",
});

const highContrast = buildTheme(
  "high-contrast",
  "high-contrast (bold, bright colors for low-vision)",
  {
    primary: "#00ffff",
    secondary: "#ff00ff",
    success: "#00ff00",
    error: "#ff0000",
    warning: "#ffff00",
    info: "#ffffff",
    muted: "#ffffff",
  },
);

const dracula = buildTheme("dracula", "dracula (pink & cyan, popular dark)", {
  primary: "#8be9fd",
  secondary: "#ff79c6",
  success: "#50fa7b",
  error: "#ff5555",
  warning: "#f1fa8c",
  info: "#6272a4",
  muted: "#6272a4",
});

const nord = buildTheme("nord", "nord (arctic blue & frost, calm dark)", {
  primary: "#88c0d0",
  secondary: "#5e81ac",
  success: "#a3be8c",
  error: "#bf616a",
  warning: "#ebcb8b",
  info: "#4c566a",
  muted: "#4c566a",
});

const monokai = buildTheme("monokai", "monokai (vibrant pink & yellow)", {
  primary: "#f92672",
  secondary: "#66d9ef",
  success: "#a6e22e",
  error: "#f92672",
  warning: "#e6db74",
  info: "#75715e",
  muted: "#75715e",
});

const solarizedDark = buildTheme(
  "solarized-dark",
  "solarized-dark (muted blue & yellow)",
  {
    primary: "#2aa198",
    secondary: "#268bd2",
    success: "#859900",
    error: "#dc322f",
    warning: "#b58900",
    info: "#586e75",
    muted: "#586e75",
  },
);

const solarizedLight = buildTheme(
  "solarized-light",
  "solarized-light (light beige & cyan)",
  {
    primary: "#268bd2",
    secondary: "#2aa198",
    success: "#859900",
    error: "#dc322f",
    warning: "#b58900",
    info: "#93a1a1",
    muted: "#93a1a1",
  },
);

const tokyoNight = buildTheme(
  "tokyo-night",
  "tokyo-night (deep blue & purple)",
  {
    primary: "#7dcfff",
    secondary: "#bb9af7",
    success: "#9ece6a",
    error: "#f7768e",
    warning: "#e0af68",
    info: "#565f89",
    muted: "#565f89",
  },
);

const gruvboxDark = buildTheme(
  "gruvbox-dark",
  "gruvbox-dark (warm retro dark)",
  {
    primary: "#fabd2f",
    secondary: "#83a598",
    success: "#b8bb26",
    error: "#fb4934",
    warning: "#fe8019",
    info: "#928374",
    muted: "#928374",
  },
);

const catppuccinMocha = buildTheme(
  "catppuccin-mocha",
  "catppuccin-mocha (pastel pink & lavender)",
  {
    primary: "#f5c2e7",
    secondary: "#cba6f7",
    success: "#a6e3a1",
    error: "#f38ba8",
    warning: "#f9e2af",
    info: "#6c7086",
    muted: "#6c7086",
  },
);

const rosePine = buildTheme("rose-pine", "rose-pine (soft rose & foam)", {
  primary: "#ebbcba",
  secondary: "#9ccfd8",
  success: "#9ccfd8",
  error: "#eb6f92",
  warning: "#f6c177",
  info: "#6e6a86",
  muted: "#6e6a86",
});

const oneDark = buildTheme(
  "one-dark",
  "one-dark (Atom's iconic dark — blue & purple)",
  {
    primary: "#61afef",
    secondary: "#c678dd",
    success: "#98c379",
    error: "#e06c75",
    warning: "#e5c07b",
    info: "#5c6370",
    muted: "#5c6370",
  },
);

const ayu = buildTheme("ayu", "ayu (clean modern — orange & cyan)", {
  primary: "#39bae6",
  secondary: "#ffb454",
  success: "#7ee787",
  error: "#f07178",
  warning: "#ffb454",
  info: "#4d5566",
  muted: "#4d5566",
});

const nightOwl = buildTheme(
  "night-owl",
  "night-owl (deep navy — cyan & red)",
  {
    primary: "#82aaff",
    secondary: "#c792ea",
    success: "#7ee787",
    error: "#ef5350",
    warning: "#ffca28",
    info: "#4d6885",
    muted: "#4d6885",
  },
);

const palenight = buildTheme(
  "palenight",
  "palenight (Material pale — purple & cyan)",
  {
    primary: "#82b1ff",
    secondary: "#c792ea",
    success: "#c3e88d",
    error: "#f07178",
    warning: "#ffcb6b",
    info: "#4c566a",
    muted: "#4c566a",
  },
);

const rainbow = buildTheme("rainbow", "rainbow (high diversity)", {
  primary: "#ff6b6b",
  secondary: "#4ecdc4",
  success: "#2ecc71",
  error: "#e74c3c",
  warning: "#f1c40f",
  info: "#9b59b6",
  muted: "#7f8c8d",
});

const neon = buildTheme("neon", "neon (cyberpunk)", {
  primary: "#ff00ff",
  secondary: "#00ffff",
  success: "#00ff00",
  error: "#ff0000",
  warning: "#ffff00",
  info: "#bd00ff",
  muted: "#555555",
});

const forest = buildTheme("forest", "forest (green & amber)", {
  primary: "#a3be8c",
  secondary: "#d08770",
  success: "#88c0d0",
  error: "#bf616a",
  warning: "#ebcb8b",
  info: "#4c566a",
  muted: "#4c566a",
});

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
  rainbow,
  neon,
  forest,
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
