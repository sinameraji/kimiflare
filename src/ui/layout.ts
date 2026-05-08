import { useState, useEffect } from "react";

export interface TerminalLayout {
  /** Current terminal width in columns */
  cols: number;
  /** Current terminal height in rows */
  rows: number;
  /** Truncate text to max length, adding ellipsis */
  truncate(text: string, max: number): string;
  /** Center content within a given width */
  center(content: string, width: number): string;
  /** Recommended overlay width based on terminal size */
  preferredOverlayWidth(): number;
}

function getTerminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return text.slice(0, max - 1) + "…";
}

function centerText(content: string, width: number): string {
  const pad = Math.max(0, width - content.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + content + " ".repeat(right);
}

function preferredWidth(cols: number): number {
  // Comfortable reading width with margin
  return Math.min(64, Math.max(32, cols - 8));
}

/**
 * Hook that provides terminal dimensions and layout helpers.
 * Listens for SIGWINCH to detect terminal resize.
 */
export function useTerminal(): TerminalLayout {
  const [size, setSize] = useState(getTerminalSize);

  useEffect(() => {
    const handleResize = () => setSize(getTerminalSize());

    process.stdout.on("resize", handleResize);
    process.on("SIGWINCH", handleResize);

    return () => {
      process.stdout.off("resize", handleResize);
      process.removeListener("SIGWINCH", handleResize);
    };
  }, []);

  return {
    cols: size.cols,
    rows: size.rows,
    truncate: truncateText,
    center: centerText,
    preferredOverlayWidth: () => preferredWidth(size.cols),
  };
}
