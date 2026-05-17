export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

const OPEN_FENCE = /^---\s*(?:\r?\n)/;
const CLOSE_FENCE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();

  // Empty
  if (trimmed === "") {
    throw new Error(`Unsupported empty value in frontmatter`);
  }

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }

  // Inline array [a, b, c]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    const items = splitArrayItems(inner);
    const result: string[] = [];
    for (const item of items) {
      const parsed = parseYamlValue(item);
      if (typeof parsed !== "string") {
        throw new Error(
          `Unsupported array element type in frontmatter: only strings are allowed in arrays, got ${typeof parsed}`
        );
      }
      result.push(parsed);
    }
    return result;
  }

  // String (unquoted, single-quoted, double-quoted)
  return parseString(trimmed);
}

function splitArrayItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === "," && !inDouble && !inSingle) {
      items.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim() !== "") {
    items.push(current.trim());
  }

  return items;
}

function parseString(trimmed: string): string {
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBlockArray(lines: string[], startIdx: number): { value: string[]; nextIdx: number } {
  const result: string[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (!trimmed.startsWith("- ")) {
      break;
    }

    const itemRaw = trimmed.slice(2).trim();
    const itemValue = parseYamlValue(itemRaw);
    if (typeof itemValue !== "string") {
      throw new Error(
        `Unsupported array element type in frontmatter: only strings are allowed in arrays, got ${typeof itemValue}`
      );
    }
    result.push(itemValue);
    i++;
  }

  return { value: result, nextIdx: i };
}

function parseYamlBlock(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    // Simple key: value
    const kvMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kvMatch) {
      throw new Error(`Unparseable frontmatter line: ${trimmed}`);
    }

    const key = kvMatch[1]!;
    const valueRaw = kvMatch[2]!.trim();

    // Check if next line starts a block array
    if (valueRaw === "" && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!.trim();
      if (nextLine.startsWith("- ")) {
        const { value, nextIdx } = parseBlockArray(lines, i + 1);
        data[key] = value;
        i = nextIdx;
        continue;
      }
    }

    data[key] = parseYamlValue(valueRaw);
    i++;
  }

  return data;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  // Empty input
  if (raw === "") {
    return { data: {}, content: "" };
  }

  // No opening fence
  if (!OPEN_FENCE.test(raw)) {
    return { data: {}, content: raw };
  }

  // Strip opening fence
  const afterOpen = raw.replace(OPEN_FENCE, "");

  // Find closing fence
  const closeMatch = afterOpen.match(CLOSE_FENCE);
  if (!closeMatch) {
    throw new Error("Frontmatter not closed with ---");
  }

  const closeIndex = closeMatch.index!;
  const yamlBlock = afterOpen.slice(0, closeIndex);
  const closeMatchLength = closeMatch[0].length;
  let content = afterOpen.slice(closeIndex + closeMatchLength);

  // Strip one leading \r and one leading \n (matches gray-matter behavior)
  if (content.startsWith("\r")) {
    content = content.slice(1);
  }
  if (content.startsWith("\n")) {
    content = content.slice(1);
  }

  // Empty frontmatter block
  if (yamlBlock.trim() === "") {
    return { data: {}, content };
  }

  const data = parseYamlBlock(yamlBlock);
  return { data, content };
}
