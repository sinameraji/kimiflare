import React, { createContext, useContext } from "react";
import type { Theme } from "./theme.js";
import { toThemeView, type ThemeView } from "./theme-view.js";

const ThemeContext = createContext<ThemeView | null>(null);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  const view = toThemeView(theme);
  return <ThemeContext.Provider value={view}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeView {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
