import { render, type Instance } from "ink-testing-library";
import { Box, Text } from "ink";
import React from "react";
import stripAnsi from "strip-ansi";

export interface RenderOptions {
  /**
   * Terminal width in columns. Default: 80
   */
  columns?: number;
  /**
   * Height in rows. Default: 24
   */
  rows?: number;
  /**
   * Whether to wait for a stable frame (no pending state updates).
   * Default: true
   */
  waitForStable?: boolean;
}

/**
 * Render an Ink component to a plain string, stripping ANSI codes.
 * Sets up a fake TTY environment so components that read
 * process.stdout.columns / process.stdin.isTTY work correctly.
 */
export function renderToString(
  tree: React.ReactElement,
  options: RenderOptions = {},
): string {
  const columns = options.columns ?? 80;
  const rows = options.rows ?? 24;

  const originalColumns = process.stdout.columns;
  const originalIsTTY = process.stdin.isTTY;

  try {
    // Fake TTY
    Object.defineProperty(process.stdout, "columns", {
      value: columns,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "rows", {
      value: rows,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    const instance: Instance = render(tree);
    const frame = instance.lastFrame();
    instance.unmount();

    if (!frame) return "";
    return stripAnsi(frame);
  } finally {
    // Restore
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Count how many lines a rendered string occupies.
 */
export function lineCount(text: string): number {
  return text.split("\n").length;
}

/**
 * Assert that a string contains a substring (with helpful message).
 */
export function assertContains(
  text: string,
  substring: string,
  message?: string,
): void {
  if (!text.includes(substring)) {
    throw new Error(
      message ??
        `Expected text to contain "${substring}".\n\nGot:\n${text}`,
    );
  }
}

/**
 * Assert that a string does NOT contain a substring.
 */
export function assertNotContains(
  text: string,
  substring: string,
  message?: string,
): void {
  if (text.includes(substring)) {
    throw new Error(
      message ??
        `Expected text NOT to contain "${substring}".\n\nGot:\n${text}`,
    );
  }
}

/**
 * Assert that every line in the text is within the given width.
 */
export function assertMaxLineWidth(
  text: string,
  maxWidth: number,
  message?: string,
): void {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.length > maxWidth) {
      throw new Error(
        message ??
          `Line exceeds ${maxWidth} chars (${line.length}): "${line}"`,
      );
    }
  }
}

/**
 * Assert that a line count matches an expected value.
 */
export function assertLineCount(
  text: string,
  expected: number,
  message?: string,
): void {
  const actual = lineCount(text);
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${expected} lines, got ${actual}.\n\nGot:\n${text}`,
    );
  }
}

/**
 * A tiny smoke component we can always render to verify the harness itself.
 */
export function SmokeComponent(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>hello</Text>
      <Text>world</Text>
    </Box>
  );
}
