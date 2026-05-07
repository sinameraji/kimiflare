import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

interface Props {
  text: string;
}

interface InlineSegment {
  kind: "plain" | "bold" | "italic" | "code" | "strikethrough" | "link";
  text: string;
  url?: string;
}

export function MD({ text }: Props) {
  const theme = useTheme();
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </Box>
  );
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "numbered"; items: { text: string; num: number }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "blank" };

function parseBlocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      out.push({ kind: "blank" });
      i++;
      continue;
    }
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const start = i + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(lines[end]!)) end++;
      out.push({ kind: "code", lang, text: lines.slice(start, end).join("\n") });
      i = end + 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      out.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: { text: string; num: number }[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        const m = lines[i]!.match(/^\s*(\d+)\.\s+(.*)$/);
        if (m) {
          items.push({ num: Number(m[1]), text: m[2]! });
        }
        i++;
      }
      out.push({ kind: "numbered", items });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "bullet", items });
      continue;
    }
    // Table
    if (i + 1 < lines.length && /^\|/.test(line) && /^\|[\s\-:|]+\|$/.test(lines[i + 1]!)) {
      const headerLine = line;
      const headers = headerLine
        .split("|")
        .slice(1, -1)
        .map((h) => h.trim());
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(
          lines[i]!
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim()),
        );
        i++;
      }
      out.push({ kind: "table", headers, rows });
      continue;
    }
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!) &&
      !/^```/.test(lines[i]!) &&
      !/^\|/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    out.push({ kind: "paragraph", text: paraLines.join("\n") });
  }
  return out;
}

const Block = React.memo(function Block({ block }: { block: Block }) {
  const theme = useTheme();
  if (block.kind === "blank") return <Text> </Text>;
  if (block.kind === "heading") {
    return (
      <Box marginTop={block.level === 1 ? 1 : 0}>
        <Text bold color={theme.accent}>
          {renderInline(block.text, theme)}
        </Text>
      </Box>
    );
  }
  if (block.kind === "bullet") {
    return (
      <Box flexDirection="column">
        {block.items.map((item, i) => (
          <Box key={i}>
            <Text color={theme.accent}>  • </Text>
            <Text>{renderInline(item, theme)}</Text>
          </Box>
        ))}
      </Box>
    );
  }
  if (block.kind === "numbered") {
    const allOnes = block.items.every((it) => it.num === 1);
    return (
      <Box flexDirection="column">
        {block.items.map((item, idx) => (
          <Box key={idx}>
            <Text color={theme.accent}>  {allOnes ? idx + 1 : item.num}. </Text>
            <Text>{renderInline(item.text, theme)}</Text>
          </Box>
        ))}
      </Box>
    );
  }
  if (block.kind === "quote") {
    const quoteColor = theme.blockquote?.color ?? theme.info.color;
    const dim = theme.blockquote?.dim ?? false;
    return (
      <Box marginLeft={2}>
        <Text color={quoteColor} dimColor={dim} italic>
          {renderInline(block.text, theme)}
        </Text>
      </Box>
    );
  }
  if (block.kind === "code") {
    const codeColor = theme.codeBlock ?? theme.tool;
    return (
      <Box flexDirection="column" marginLeft={2}>
        {block.text.split("\n").map((l, i) => (
          <Text key={i} color={codeColor}>
            {l}
          </Text>
        ))}
      </Box>
    );
  }
  if (block.kind === "table") {
    const borderColor = theme.tableBorder ?? theme.accent;
    const headerColor = theme.tableHeader ?? theme.accent;
    const cellColor = theme.tableCell ?? theme.palette.foreground;
    const colCount = block.headers.length;
    return (
      <Box flexDirection="column" marginLeft={2}>
        {/* Header row */}
        <Box>
          <Text color={borderColor}>│ </Text>
          {block.headers.map((h, ci) => (
            <React.Fragment key={ci}>
              <Text bold color={headerColor}>{h}</Text>
              {ci < colCount - 1 && <Text color={borderColor}> │ </Text>}
            </React.Fragment>
          ))}
          <Text color={borderColor}> │</Text>
        </Box>
        {/* Separator */}
        <Box>
          <Text color={borderColor}>├{Array(colCount).fill("─".repeat(8)).join("┼")}┤</Text>
        </Box>
        {/* Data rows */}
        {block.rows.map((row, ri) => (
          <Box key={ri}>
            <Text color={borderColor}>│ </Text>
            {row.map((cell, ci) => (
              <React.Fragment key={ci}>
                <Text color={cellColor}>{cell}</Text>
                {ci < colCount - 1 && <Text color={borderColor}> │ </Text>}
              </React.Fragment>
            ))}
            <Text color={borderColor}> │</Text>
          </Box>
        ))}
      </Box>
    );
  }
  return <Text>{renderInline(block.text, theme)}</Text>;
});

function renderInline(src: string, theme: Theme): React.ReactNode {
  const segments = parseInline(src);
  return segments.map((seg, i) => {
    if (seg.kind === "bold") return <Text key={i} bold>{seg.text}</Text>;
    if (seg.kind === "italic") return <Text key={i} italic>{seg.text}</Text>;
    if (seg.kind === "code") {
      const color = theme.codeInline ?? theme.tool;
      return <Text key={i} color={color}>{seg.text}</Text>;
    }
    if (seg.kind === "strikethrough") {
      const color = theme.strikethrough ?? theme.muted?.color ?? theme.palette.secondary;
      return <Text key={i} strikethrough color={color}>{seg.text}</Text>;
    }
    if (seg.kind === "link") {
      const color = theme.link ?? theme.accent;
      return <Text key={i} underline color={color}>{seg.text}</Text>;
    }
    return <Text key={i}>{seg.text}</Text>;
  });
}

function parseInline(src: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ kind: "plain", text: buf });
      buf = "";
    }
  };
  while (i < src.length) {
    const ch = src[i]!;
    // Code: `text`
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Strikethrough: ~~text~~
    if (ch === "~" && src[i + 1] === "~") {
      const end = src.indexOf("~~", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "strikethrough", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Link: [text](url)
    if (ch === "[") {
      const closeBracket = src.indexOf("]", i + 1);
      const openParen = closeBracket >= 0 ? src.indexOf("(", closeBracket) : -1;
      const closeParen = openParen >= 0 ? src.indexOf(")", openParen) : -1;
      if (closeParen > openParen && openParen === closeBracket + 1) {
        flush();
        out.push({
          kind: "link",
          text: src.slice(i + 1, closeBracket),
          url: src.slice(openParen + 1, closeParen),
        });
        i = closeParen + 1;
        continue;
      }
    }
    // Bold: **text**
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "bold", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Bold: __text__
    if (ch === "_" && src[i + 1] === "_") {
      const end = src.indexOf("__", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "bold", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Italic: *text*
    if (ch === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "italic", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Italic: _text_
    if (ch === "_" && !/\w/.test(src[i - 1] ?? "") && src[i + 1] !== "_") {
      const end = src.indexOf("_", i + 1);
      if (end > i && !/\w/.test(src[end + 1] ?? "")) {
        flush();
        out.push({ kind: "italic", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}
