import React from "react";
import { Text } from "ink";
import { useTheme } from "./theme-context.js";

interface Props {
  isSelected?: boolean;
  label: string;
}

/**
 * Custom SelectInput item with two-tone filled background.
 *
 * Selected items get a filled background (selectedBg) with contrasting
 * text (onSelected). Unselected items are bare — no background, no
 * bold gimmicks. This is the "filled-vs-bare" affordance from the
 * opinionated design system.
 */
export function FilledItem({ isSelected, label }: Props) {
  const theme = useTheme();
  return (
    <Text
      backgroundColor={isSelected ? theme.selectedBg : undefined}
      color={isSelected ? theme.onSelected : undefined}
    >
      {label}
    </Text>
  );
}
