import type { Theme, ColorName, DimColor } from "./theme.js";

/**
 * Semantic theme view for opinionated TUI components.
 *
 * Extends the raw Theme with computed semantic tokens that map
 * palette roles to layout concepts (surface, on-surface, border, etc).
 *
 * Raw Theme properties are still accessible for gradual migration.
 */
export interface ThemeView extends Theme {
  /** Text color for primary content (headings, user messages) */
  surface: ColorName;
  /** Elevated surface — overlays, cards */
  surfaceRaised: ColorName;
  /** Text on surface — primary readable text */
  onSurface: ColorName;
  /** Dimmed text on surface — hints, metadata */
  onSurfaceDim: ColorName;
  /** Primary accent — actions, active states, user prefix */
  primary: ColorName;
  /** Text rendered on top of primary-filled backgrounds */
  onPrimary: ColorName;
  /** Secondary accent — tools, secondary actions */
  secondary: ColorName;
  /** Error states */
  error: ColorName;
  /** Warning states */
  warn: ColorName;
  /** Success states */
  success: ColorName;
  /** General accent — spinners, highlights */
  accent: ColorName;
  /** Thin borders */
  border: ColorName;
  /** Very faint borders, separators */
  borderSubtle: ColorName;
  /** Muted / disabled text */
  muted: DimColor;
}

/**
 * Convert a raw Theme into a ThemeView by adding semantic mappings.
 * Raw properties are preserved so existing components keep working.
 */
export function toThemeView(theme: Theme): ThemeView {
  const palette = theme.palette;

  return {
    ...theme,
    // Semantic mappings
    surface: palette.foreground,
    surfaceRaised: palette.foreground,
    onSurface:
      typeof theme.info === "object" ? theme.info.color : theme.info ?? palette.foreground,
    onSurfaceDim:
      typeof theme.muted === "object"
        ? theme.muted.color
        : theme.muted ?? palette.secondary,
    primary: theme.user ?? palette.primary,
    onPrimary: palette.foreground,
    secondary: theme.assistant ?? palette.secondary,
    error: theme.error ?? palette.error,
    warn: theme.warn ?? palette.error,
    success: palette.success,
    accent: theme.accent ?? palette.primary,
    border: palette.secondary,
    borderSubtle: palette.secondary,
    muted:
      typeof theme.muted === "object"
        ? theme.muted
        : { color: palette.secondary, dim: true },
  };
}
