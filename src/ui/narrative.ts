/**
 * Narrative layer: turns dry tool calls and system events into
 * short stage-direction prose so the UI feels intentional rather
 * than a raw syscall trace.
 */

export interface ToolBatchItem {
  name: string;
  args?: Record<string, unknown>;
}

export interface ActivityContext {
  mode?: "edit" | "plan" | "auto";
  tier?: "light" | "medium" | "heavy";
  codeMode?: boolean;
}

const READING_TOOLS = new Set(["read", "glob", "grep", "lsp_hover", "lsp_definition", "lsp_references", "lsp_implementation", "lsp_typeDefinition", "lsp_documentSymbols", "lsp_workspaceSymbol"]);
const WRITING_TOOLS = new Set(["write", "edit", "lsp_rename", "lsp_codeAction"]);
const SHELL_TOOLS = new Set(["bash"]);
const WEB_TOOLS = new Set(["web_fetch"]);
const MEMORY_TOOLS = new Set(["memory_remember", "memory_recall", "memory_forget"]);

function countByCategory(items: ToolBatchItem[]) {
  let reads = 0;
  let writes = 0;
  let shells = 0;
  let webs = 0;
  let memories = 0;
  let others = 0;
  for (const t of items) {
    if (READING_TOOLS.has(t.name)) reads++;
    else if (WRITING_TOOLS.has(t.name)) writes++;
    else if (SHELL_TOOLS.has(t.name)) shells++;
    else if (WEB_TOOLS.has(t.name)) webs++;
    else if (MEMORY_TOOLS.has(t.name)) memories++;
    else others++;
  }
  return { reads, writes, shells, webs, memories, others };
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Generate a narrative line for a batch of tools that arrived close together. */
export function generateActivityText(items: ToolBatchItem[], _ctx?: ActivityContext): string | null {
  if (items.length === 0) return null;

  const { reads, writes, shells, webs, memories } = countByCategory(items);
  const total = items.length;

  // Single-tool narratives
  if (total === 1) {
    const t = items[0]!;
    if (t.name === "read") {
      const path = typeof t.args?.path === "string" ? t.args.path : "a file";
      return pickOne([`Reading ${path}…`, `Opening ${path}…`, `Taking a look at ${path}…`]);
    }
    if (t.name === "grep") {
      const pattern = typeof t.args?.pattern === "string" ? `"${t.args.pattern}"` : "for patterns";
      return pickOne([`Searching for ${pattern}…`, `Hunting for ${pattern}…`]);
    }
    if (t.name === "glob") {
      const pattern = typeof t.args?.pattern === "string" ? t.args.pattern : "files";
      return pickOne([`Finding ${pattern}…`, `Gathering ${pattern}…`]);
    }
    if (t.name === "write") {
      const path = typeof t.args?.path === "string" ? t.args.path : "a file";
      return pickOne([`Creating ${path}…`, `Writing ${path}…`]);
    }
    if (t.name === "edit") {
      const path = typeof t.args?.path === "string" ? t.args.path : "a file";
      return pickOne([`Patching ${path}…`, `Editing ${path}…`]);
    }
    if (t.name === "bash") {
      return pickOne([`Running a shell command…`, `Executing something in the terminal…`]);
    }
    if (t.name === "web_fetch") {
      return pickOne([`Fetching docs…`, `Checking a reference…`, `Looking something up…`]);
    }
    if (t.name === "memory_remember") {
      return pickOne([`Taking notes for next time…`, `Committing that to memory…`]);
    }
    if (t.name === "memory_recall") {
      return pickOne([`Recalling what we know…`, `Searching past notes…`]);
    }
    return null; // fall back to individual tool card
  }

  // Multi-tool narratives
  if (webs >= 2) {
    return pickOne([`Digging through documentation…`, `Cross-referencing sources…`, `Reading up on this…`]);
  }
  if (reads >= 2 && writes === 0 && shells === 0) {
    return pickOne([`Surveying the landscape…`, `Getting the lay of the land…`, `Mapping out the files…`]);
  }
  if (reads >= 1 && (writes >= 1 || shells >= 1)) {
    return pickOne([`Reading, then making changes…`, `Exploring and editing…`, `Survey and patch…`]);
  }
  if (writes >= 1 && shells >= 1) {
    return pickOne([`Committing the changes…`, `Writing and verifying…`, `Editing and checking…`]);
  }
  if (reads >= 1 && webs >= 1) {
    return pickOne([`Exploring the codebase and docs…`, `Cross-referencing code with references…`]);
  }
  if (memories >= 1) {
    return pickOne([`Jogging the memory…`, `Checking past notes…`]);
  }
  if (shells >= 1) {
    return pickOne([`Running some commands…`, `Working in the shell…`]);
  }

  return null;
}

/** Turn a dry info string into an activity line when we recognise the event. */
export function narrativizeInfo(text: string, ctx?: ActivityContext): { kind: "activity"; text: string; feature?: ActivityContext["mode"] extends string ? never : "memory" | "code" | "triage" | "compact" | "explore" } | null {
  // Triage / intent classification
  if (ctx?.tier === "heavy") {
    return { kind: "activity", text: "Sizing this up… feels like a deep one.", feature: "triage" };
  }
  if (ctx?.tier === "light") {
    return { kind: "activity", text: "Quick check — this looks light.", feature: "triage" };
  }
  if (ctx?.tier === "medium") {
    return { kind: "activity", text: "This one feels medium weight.", feature: "triage" };
  }

  // Code mode
  if (ctx?.codeMode) {
    return { kind: "activity", text: "The toolbox feels right for this. Switching to code mode…", feature: "code" };
  }

  // Compaction
  if (text.includes("auto-compacted") || text.includes("compacted")) {
    return { kind: "activity", text: "Making room by summarizing older turns…", feature: "compact" };
  }

  // Memory recall
  if (text.includes("recalled") && text.includes("memory")) {
    return { kind: "activity", text: "Remembering what we learned before…", feature: "memory" };
  }

  // Memory extraction (silent in current UI, but if it ever logs)
  if (text.includes("memory cleanup") || text.includes("memory backfill")) {
    return null; // keep these as literal info — they're background maintenance
  }

  // LSP
  if (text.startsWith("LSP ready")) {
    return { kind: "activity", text: "Waking up the language servers…" };
  }
  if (text.startsWith("LSP reload complete")) {
    return null; // too noisy
  }

  // MCP
  if (text.startsWith("MCP connected")) {
    return { kind: "activity", text: "Plugging in external tools…" };
  }

  // Exploration / research
  if (text.includes("research budget") || text.includes("web request")) {
    return { kind: "activity", text: "Researching… gathering what we can from the web.", feature: "explore" };
  }

  return null;
}

/** Human-readable title for a single tool call (used by ToolView fallback). */
export function humanizeToolTitle(name: string, args?: Record<string, unknown>): string {
  const path = typeof args?.path === "string" ? args.path : undefined;
  const pattern = typeof args?.pattern === "string" ? args.pattern : undefined;
  const command = typeof args?.command === "string" ? args.command : undefined;
  const url = typeof args?.url === "string" ? args.url : undefined;

  switch (name) {
    case "read":
      return path ? `Reading ${path}` : "Reading a file…";
    case "grep":
      return pattern ? `Searching for "${pattern}"` : "Searching…";
    case "glob":
      return pattern ? `Finding ${pattern}` : "Finding files…";
    case "write":
      return path ? `Creating ${path}` : "Creating a file…";
    case "edit":
      return path ? `Patching ${path}` : "Patching a file…";
    case "bash":
      return command ? `Running: ${command.split(/\s+/).slice(0, 4).join(" ")}${command.split(/\s+/).length > 4 ? "…" : ""}` : "Running shell command…";
    case "web_fetch":
      return url ? `Fetching ${url.replace(/^https?:\/\//, "").split("/")[0]}` : "Fetching docs…";
    case "memory_remember":
      return "Committing to memory…";
    case "memory_recall":
      return "Recalling memories…";
    case "memory_forget":
      return "Forgetting a memory…";
    case "lsp_hover":
      return "Inspecting symbol…";
    case "lsp_definition":
      return "Jumping to definition…";
    case "lsp_references":
      return "Finding references…";
    case "lsp_implementation":
      return "Finding implementations…";
    case "lsp_typeDefinition":
      return "Finding type definition…";
    case "lsp_documentSymbols":
      return "Listing symbols…";
    case "lsp_workspaceSymbol":
      return "Searching workspace symbols…";
    case "lsp_rename":
      return "Renaming symbol…";
    case "lsp_codeAction":
      return "Applying quick fix…";
    default:
      return name;
  }
}
