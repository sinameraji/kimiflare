export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/** Replace lone UTF-16 surrogates with the replacement character (U+FFFD).
 *  JSON.stringify preserves lone surrogates as \uD800..\uDFFF escapes, which
 *  JavaScript accepts but many strict parsers (Cloudflare AI Gateway, Python,
 *  Rust serde_json) reject. Stripping them at the boundary prevents a single
 *  bad model token from permanently poisoning the conversation history. */
export function sanitizeString(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

/** Recursively sanitize every string value in an object/array. */
export function sanitizeForJson<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeForJson(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** JSON.stringify replacer that sanitizes strings in-place without a deep copy. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  return value;
}

/** Deterministic JSON.stringify that sorts object keys recursively.
 *  Guarantees byte-for-byte identical output for semantically identical objects,
 *  eliminating V8 insertion-order jitter and conditional-key non-determinism. */
export function stableStringify(value: unknown, replacer?: (key: string, val: unknown) => unknown, space?: string | number): string {
  function sortKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sortKeys);
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      sorted[k] = sortKeys((obj as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  const sorted = sortKeys(value);
  return JSON.stringify(sorted, replacer, space);
}
