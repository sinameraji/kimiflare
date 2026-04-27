export type FrontmatterParse = {
  data: Record<string, string>;
  body: string;
  errors: string[];
};

const FENCE = /^---\s*\r?\n/;
const KV = /^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/;

export function parseFrontmatter(input: string): FrontmatterParse {
  const errors: string[] = [];
  if (!FENCE.test(input)) {
    return { data: {}, body: input, errors };
  }
  const afterOpen = input.replace(FENCE, "");
  const closeIdx = afterOpen.search(/\r?\n---\s*(\r?\n|$)/);
  if (closeIdx === -1) {
    errors.push("frontmatter not closed with ---");
    return { data: {}, body: input, errors };
  }
  const yaml = afterOpen.slice(0, closeIdx);
  const closeMatch = afterOpen.slice(closeIdx).match(/\r?\n---\s*(\r?\n|$)/);
  const body = closeMatch ? afterOpen.slice(closeIdx + closeMatch[0].length) : "";

  const data: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const m = line.match(KV);
    if (!m) {
      errors.push(`unparseable line: ${line.trim()}`);
      continue;
    }
    const key = m[1]!;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body, errors };
}
