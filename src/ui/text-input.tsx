import React, { useState, useEffect, useRef } from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string, display?: string) => void;
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
  onClearQueueItem?: (text: string) => void;
  focus?: boolean;
  mask?: string;
  enablePaste?: boolean;
  cursorOffset?: number;
  onCursorChange?: (offset: number) => void;
  pickerActive?: boolean;
  onPickerUp?: () => void;
  onPickerDown?: () => void;
  onPickerSelect?: () => void;
  onPickerCancel?: () => void;
}

const PASTE_CHAR_THRESHOLD = 200;
const PASTE_NEWLINE_THRESHOLD = 1;

function shouldTreatAsPaste(input: string): boolean {
  if (input.length >= PASTE_CHAR_THRESHOLD) return true;
  const newlines = (input.match(/\n/g) ?? []).length;
  return newlines >= PASTE_NEWLINE_THRESHOLD;
}

function newPasteId(): string {
  return Math.random().toString(36).slice(2, 7);
}

function countLines(s: string): number {
  return s.split("\n").length;
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
  enablePaste = false,
  cursorOffset: controlledCursor,
  onCursorChange,
  pickerActive = false,
  onPickerUp,
  onPickerDown,
  onPickerSelect,
  onPickerCancel,
}: Props) {
  const [internalCursor, setInternalCursor] = useState(value.length);
  const cursorOffset = controlledCursor ?? internalCursor;
  const setCursorOffset = (offset: number) => {
    setInternalCursor(offset);
    onCursorChange?.(offset);
  };
  const pastesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!focus) return;
    const next = cursorOffset > value.length ? value.length : cursorOffset;
    if (next !== cursorOffset) {
      setCursorOffset(next);
    }
  }, [value, focus, cursorOffset]);

  useInput(
    (input, key) => {
      if (!focus) return;

      if (key.ctrl && input === "c") return;
      if (key.ctrl && input === "r") return;
      if (key.ctrl && input === "o") return;
      if (key.tab) return;

      if (pickerActive) {
        if (key.upArrow) {
          onPickerUp?.();
          return;
        }
        if (key.downArrow) {
          onPickerDown?.();
          return;
        }
        if (key.return) {
          onPickerSelect?.();
          return;
        }
        if (key.escape) {
          onPickerCancel?.();
          return;
        }
      }

      if (key.return) {
        let full = value;
        let hasPastes = false;
        if (enablePaste && pastesRef.current.size > 0) {
          for (const [placeholder, fullText] of pastesRef.current) {
            if (full.includes(placeholder)) {
              full = full.split(placeholder).join(fullText);
              hasPastes = true;
            }
          }
        }
        onSubmit(full, hasPastes ? value : undefined);
        pastesRef.current.clear();
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
      } else if (key.meta && input === "b") {
        nextCursor = findWordBoundaryBackward(value, cursorOffset);
      } else if (key.meta && input === "f") {
        nextCursor = findWordBoundaryForward(value, cursorOffset);
      } else if (key.meta && input === "d") {
        didDelete = true;
        const boundary = findWordBoundaryForward(value, cursorOffset);
        nextValue = value.slice(0, cursorOffset) + value.slice(boundary);
      } else if (key.home || (key.ctrl && input === "a")) {
        nextCursor = 0;
      } else if (key.end || (key.ctrl && input === "e")) {
        nextCursor = value.length;
      } else if (key.backspace) {
        didDelete = true;
        const tokenBoundary = enablePaste
          ? findPasteTokenEndingAt(value, cursorOffset, pastesRef.current)
          : -1;
        if (tokenBoundary >= 0) {
          const token = value.slice(tokenBoundary, cursorOffset);
          pastesRef.current.delete(token);
          nextValue = value.slice(0, tokenBoundary) + value.slice(cursorOffset);
          nextCursor = tokenBoundary;
        } else if (key.meta || (key.ctrl && input === "w")) {
          const boundary = findWordBoundaryBackward(value, cursorOffset);
          nextValue = value.slice(0, boundary) + value.slice(cursorOffset);
          nextCursor = boundary;
        } else if (key.ctrl) {
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
        let toInsert = input;
        if (enablePaste && shouldTreatAsPaste(input)) {
          const lines = countLines(input);
          const id = newPasteId();
          const placeholder = `[pasted ${lines} line${lines === 1 ? "" : "s"} #${id}]`;
          pastesRef.current.set(placeholder, input);
          toInsert = placeholder;
        }
        nextValue = value.slice(0, cursorOffset) + toInsert + value.slice(cursorOffset);
        nextCursor = cursorOffset + toInsert.length;
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

function findPasteTokenEndingAt(
  value: string,
  pos: number,
  pastes: Map<string, string>,
): number {
  if (pos <= 0 || value[pos - 1] !== "]") return -1;
  for (const placeholder of pastes.keys()) {
    if (placeholder.length > pos) continue;
    const start = pos - placeholder.length;
    if (value.slice(start, pos) === placeholder) return start;
  }
  return -1;
}
