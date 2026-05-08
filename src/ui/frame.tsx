import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import { useTerminal } from "./layout.js";

interface FrameProps {
  children: React.ReactNode;
  title?: string;
  width?: number;
  padX?: number;
  padY?: number;
  borderColor?: string;
}

/**
 * Opinionated rounded-border frame.
 *
 * Wraps content in ╭─╮│╰╯ borders using Ink's borderStyle="round",
 * which renders rounded box-drawing characters on modern terminals.
 *
 * Frame is the SSOT for rounded borders — no component should draw
 * its own borders. Use Frame, or use no border at all.
 */
const ROUNDED_CORNER = "╭";
const SHARP_CORNERS = /[┌┐└┘]/;

/**
 * Verify that a rendered frame uses rounded borders exclusively.
 * Throws if sharp corners are detected or the top-left corner is missing.
 */
export function assertRoundedBorders(frame: string): void {
  const lines = frame.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;

  const firstLine = lines[0]!.trimStart();
  if (!firstLine.startsWith(ROUNDED_CORNER)) {
    throw new Error(
      `Frame border integrity failed: expected top-left corner '╭', got '${firstLine[0]}'. ` +
        `Terminal may not support rounded box-drawing characters.`
    );
  }

  if (SHARP_CORNERS.test(frame)) {
    const match = frame.match(SHARP_CORNERS);
    throw new Error(
      `Frame border integrity failed: sharp corner '${match![0]}' found in output. ` +
        `All borders must use rounded characters (╭─╮│╰╯).`
    );
  }
}

export function Frame({
  children,
  title,
  width: explicitWidth,
  padX = 1,
  padY = 0,
  borderColor: explicitBorderColor,
}: FrameProps): React.ReactElement {
  const theme = useTheme();
  const { cols, preferredOverlayWidth } = useTerminal();
  const borderColor = explicitBorderColor ?? (typeof theme.info === "object" ? theme.info.color : theme.info);
  // Use backgroundRaised if the theme provides it (kimiflare themes do)
  const bg = theme.palette.backgroundRaised;

  const width = explicitWidth ?? preferredOverlayWidth();
  const marginLeft = Math.max(0, Math.floor((cols - width) / 2));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      backgroundColor={bg}
      paddingX={padX}
      paddingY={padY}
      width={width}
      marginLeft={marginLeft}
    >
      {title ? (
        <Text color={theme.accent} bold>
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}
