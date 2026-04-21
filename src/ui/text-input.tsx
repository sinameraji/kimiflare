import React, { useState, useEffect } from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
  onClearQueueItem?: (text: string) => void;
  focus?: boolean;
  mask?: string;
}

function findWordBoundaryForward(text: string, pos: number): number {
  while (pos < text.length && /\w/.test(text[pos]!)) pos++;
  while (pos < text.length && !/\w/.test(text[pos]!)) pos++;
  return pos;
}

function findWordBoundaryBackward(text: string, pos: number): number {
  while (pos > 0 && !/\w/.test(text[pos - 1]!)) pos--;
  while (pos > 0 && /\w/.test(text[pos - 1]!)) pos--;
  return pos;
}

export function CustomTextInput({
  value,
  onChange,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
  onClearQueueItem,
  focus = true,
  mask,
}: Props) {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    if (!focus) return;
    setCursorOffset((prev) => (prev > value.length ? value.length : prev));
  }, [value, focus]);

  useInput(
    (input, key) => {
      if (!focus) return;

      // Let app-level handlers process these
      if (key.ctrl && input === "c") return;
      if (key.ctrl && input === "r") return;
      if (key.tab) return;

      if (key.return) {
        onSubmit(value);
        setCursorOffset(0);
        return;
      }

      if (key.upArrow) {
        onHistoryUp?.();
        return;
      }

      if (key.downArrow) {
        onHistoryDown?.();
        return;
      }

      let nextCursor = cursorOffset;
      let nextValue = value;
      let didDelete = false;

      if (key.leftArrow) {
        if (key.meta) {
          nextCursor = findWordBoundaryBackward(value, cursorOffset);
        } else {
          nextCursor = cursorOffset - 1;
        }
      } else if (key.rightArrow) {
        if (key.meta) {
          nextCursor = findWordBoundaryForward(value, cursorOffset);
        } else {
          nextCursor = cursorOffset + 1;
        }
      } else if (key.home || (key.ctrl && input === "a")) {
        nextCursor = 0;
      } else if (key.end || (key.ctrl && input === "e")) {
        nextCursor = value.length;
      } else if (key.backspace) {
        didDelete = true;
        if (key.meta || (key.ctrl && input === "w")) {
          const boundary = findWordBoundaryBackward(value, cursorOffset);
          nextValue = value.slice(0, boundary) + value.slice(cursorOffset);
          nextCursor = boundary;
        } else if (key.ctrl) {
          // Ctrl+Backspace -> delete word backward
          const boundary = findWordBoundaryBackward(value, cursorOffset);
          nextValue = value.slice(0, boundary) + value.slice(cursorOffset);
          nextCursor = boundary;
        } else {
          if (cursorOffset > 0) {
            nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
            nextCursor = cursorOffset - 1;
          }
        }
      } else if (key.delete) {
        didDelete = true;
        if (key.meta || key.ctrl) {
          const boundary = findWordBoundaryForward(value, cursorOffset);
          nextValue = value.slice(0, cursorOffset) + value.slice(boundary);
        } else {
          nextValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1);
        }
      } else if (key.ctrl && input === "w") {
        didDelete = true;
        const boundary = findWordBoundaryBackward(value, cursorOffset);
        nextValue = value.slice(0, boundary) + value.slice(cursorOffset);
        nextCursor = boundary;
      } else if (key.ctrl && input === "u") {
        didDelete = true;
        nextValue = value.slice(cursorOffset);
        nextCursor = 0;
      } else if (key.ctrl && input === "k") {
        didDelete = true;
        nextValue = value.slice(0, cursorOffset);
      } else if (input.length > 0 && !key.ctrl && !key.meta) {
        nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        nextCursor = cursorOffset + input.length;
      }

      if (nextCursor < 0) nextCursor = 0;
      if (nextCursor > nextValue.length) nextCursor = nextValue.length;

      if (didDelete && nextValue === "" && value !== "") {
        onClearQueueItem?.(value);
      }

      if (nextCursor !== cursorOffset) {
        setCursorOffset(nextCursor);
      }
      if (nextValue !== value) {
        onChange(nextValue);
      }
    },
    { isActive: focus },
  );

  const displayValue = mask ? mask.repeat(value.length) : value;

  let renderedValue = "";
  let i = 0;
  for (const char of displayValue) {
    renderedValue += i === cursorOffset ? chalk.inverse(char) : char;
    i++;
  }
  if (displayValue.length === 0) {
    renderedValue = chalk.inverse(" ");
  } else if (cursorOffset === displayValue.length) {
    renderedValue += chalk.inverse(" ");
  }

  return <Text>{renderedValue}</Text>;
}
