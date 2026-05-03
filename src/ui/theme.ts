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

export const DEFAULT_THEME: Theme = {
  name: "everforest-dark",
  label: "everforest-dark (nature — moss & bark)",
  palette: {
    primary: "#a7c080",
    secondary: "#d699b6",
    success: "#a7c080",
    error: "#e67e80",
    warning: "#dbbc7f",
    info: "#7a8478",
    muted: "#7a8478",
  },
  user: "#a7c080",
  assistant: "#d3c6aa",
  tool: "#7fbbb3",
  spinner: "#a7c080",
  accent: "#d699b6",
  error: "#e67e80",
  warn: "#dbbc7f",
  info: { color: "#7a8478", dim: false },
  reasoning: { color: "#7a8478", dim: true },
  permission: "#dbbc7f",
  queue: { color: "#7a8478", dim: true },
  modeBadge: { plan: "#7fbbb3", auto: "#a7c080", edit: "#e67e80" },
};
