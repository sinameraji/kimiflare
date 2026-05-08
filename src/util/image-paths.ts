import { existsSync } from "node:fs";
import { isImagePath } from "./image.js";

export function findImagePaths(text: string): string[] {
  const paths: string[] = [];

  // Extract quoted paths first (e.g. "/path/to/my image.png")
  const quotedRegex = /"([^"]+)"|'([^']+)'/g;
  let match;
  while ((match = quotedRegex.exec(text)) !== null) {
    const path = match[1] ?? match[2];
    if (path && isImagePath(path) && existsSync(path)) {
      paths.push(path);
    }
  }

  // Process remaining text, handling backslash-escaped spaces
  const remaining = text.replace(/"[^"]+"|'[^']+'/g, "");
  const ESCAPED_SPACE = "\u0000";
  const processed = remaining.replace(/\\ /g, ESCAPED_SPACE);

  for (const token of processed.split(/\s+/)) {
    const clean = token
      .replace(new RegExp(ESCAPED_SPACE, "g"), " ")
      .replace(/^["']|["',;:!?]$/g, "")
      .replace(/[.,;:!?]$/, "");
    if (
      clean &&
      isImagePath(clean) &&
      existsSync(clean) &&
      !paths.includes(clean)
    ) {
      paths.push(clean);
    }
  }

  return paths;
}
