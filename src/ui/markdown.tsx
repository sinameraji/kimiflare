import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "./theme.js";

interface Props {
  text: string;
  theme: Theme;
}

interface InlineSegment {
  kind: "plain" | "bold" | "italic" | "code";
  text: string;
}

export function MD({ text, theme }: Props) {
  const blocks = parseBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <Block key={i} block={b} theme={theme} />
      ))}
    </Box>
  );
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang?: string; text: string }
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
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "bullet", items });
      continue;
    }
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!) &&
      !/^```/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    out.push({ kind: "paragraph", text: paraLines.join("\n") });
  }
  return out;
}

function Block({ block, theme }: { block: Block; theme: Theme }) {
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
  if (block.kind === "quote") {
    return (
      <Box marginLeft={2}>
        <Text color={theme.info.color} dimColor={theme.info.dim} italic>
          {renderInline(block.text, theme)}
        </Text>
      </Box>
    );
  }
  if (block.kind === "code") {
    return (
      <Box flexDirection="column" marginLeft={2}>
        {block.text.split("\n").map((l, i) => (
          <Text key={i} color={theme.tool}>
            {l}
          </Text>
        ))}
      </Box>
    );
  }
  return <Text>{renderInline(block.text, theme)}</Text>;
}

function renderInline(src: string, theme: Theme): React.ReactNode {
  const segments = parseInline(src);
  return segments.map((seg, i) => {
    if (seg.kind === "bold") return <Text key={i} bold>{seg.text}</Text>;
    if (seg.kind === "italic") return <Text key={i} italic>{seg.text}</Text>;
    if (seg.kind === "code") return <Text key={i} color={theme.tool}>{seg.text}</Text>;
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
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "bold", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "_" && src[i + 1] === "_") {
      const end = src.indexOf("__", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "bold", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "italic", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
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
