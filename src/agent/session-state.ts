import type { ChatMessage } from "./messages.js";

export type ArtifactType =
  | "read_slice"
  | "bash_log"
  | "grep_result"
  | "web_fetch"
  | "assistant_decision"
  | "tool_result";

export interface Artifact {
  id: string;
  type: ArtifactType;
  /** Short summary (1-2 sentences) for the artifact index. */
  summary: string;
  /** Full raw payload, stored outside default prompt context. */
  raw: string;
  /** Tool name or source that produced this artifact. */
  source: string;
  /** Optional file path if the artifact relates to a file. */
  path?: string;
  /** Optional line range if applicable. */
  lineRange?: { start: number; end: number };
  /** Timestamp when the artifact was created. */
  ts: string;
}

export interface SessionState {
  /** Current task description. */
  task: string;
  /** Constraints or preferences stated by the user. */
  user_constraints: string[];
  /** Key facts about the repo discovered so far. */
  repo_facts: string[];
  /** Files that have been read or touched (not necessarily modified). */
  files_touched: string[];
  /** Files that have been modified (write, edit, bash git commit). */
  files_modified: string[];
  /** Confirmed findings from tool outputs. */
  confirmed_findings: string[];
  /** Open questions that haven't been resolved. */
  open_questions: string[];
  /** Recent failures (tool errors, test failures, build failures). */
  recent_failures: string[];
  /** Key decisions made by the assistant. */
  decisions: string[];
  /** Next actions the assistant planned but hasn't executed. */
  next_actions: string[];
  /** Index of archived artifacts by ID. */
  artifact_index: Record<string, { type: ArtifactType; summary: string; source: string; path?: string }>;
}

export function emptySessionState(task = ""): SessionState {
  return {
    task,
    user_constraints: [],
    repo_facts: [],
    files_touched: [],
    files_modified: [],
    confirmed_findings: [],
    open_questions: [],
    recent_failures: [],
    decisions: [],
    next_actions: [],
    artifact_index: {},
  };
}

/** In-memory artifact store with size caps. Artifacts are NOT persisted to disk. */
export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private maxArtifacts: number;
  private maxTotalChars: number;

  constructor(opts?: { maxArtifacts?: number; maxTotalChars?: number }) {
    this.maxArtifacts = opts?.maxArtifacts ?? 200;
    this.maxTotalChars = opts?.maxTotalChars ?? 500_000;
  }

  add(a: Artifact): void {
    // Enforce total char cap with size-weighted LRU: from the oldest quartile,
    // evict the largest artifact first. One 200KB eviction beats five 5KB ones.
    while (this.totalChars() + a.raw.length > this.maxTotalChars && this.artifacts.size > 0) {
      this.evictSizeWeighted();
    }
    // Enforce count cap (age-only is fine here — sizes don't matter for count)
    while (this.artifacts.size >= this.maxArtifacts) {
      this.evictOldest();
    }
    this.artifacts.set(a.id, a);
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  has(id: string): boolean {
    return this.artifacts.has(id);
  }

  list(): Artifact[] {
    return [...this.artifacts.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }

  recall(ids: string[]): { id: string; artifact: Artifact }[] {
    const out: { id: string; artifact: Artifact }[] = [];
    for (const id of ids) {
      const a = this.artifacts.get(id);
      if (a) out.push({ id, artifact: a });
    }
    return out;
  }

  size(): number {
    return this.artifacts.size;
  }

  private totalChars(): number {
    let sum = 0;
    for (const a of this.artifacts.values()) {
      sum += a.raw.length;
    }
    return sum;
  }

  private evictOldest(): void {
    let oldest: Artifact | undefined;
    for (const a of this.artifacts.values()) {
      if (!oldest || a.ts < oldest.ts) oldest = a;
    }
    if (oldest) this.artifacts.delete(oldest.id);
  }

  /** Evict the largest artifact among the oldest quartile (by timestamp).
   *  Bounded by the oldest quartile so we never evict freshly-added artifacts;
   *  size-weighted within that window so one big artifact gets dropped instead
   *  of many small ones. */
  private evictSizeWeighted(): void {
    const sorted = [...this.artifacts.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (sorted.length === 0) return;
    const quartile = Math.max(1, Math.ceil(sorted.length / 4));
    const candidates = sorted.slice(0, quartile);
    let pick: Artifact = candidates[0]!;
    for (const a of candidates) {
      if (a.raw.length > pick.raw.length) pick = a;
    }
    this.artifacts.delete(pick.id);
  }
}

/** Serialized form of an Artifact for session persistence. */
export interface SerializedArtifact {
  id: string;
  type: ArtifactType;
  summary: string;
  raw: string;
  source: string;
  path?: string;
  lineRange?: { start: number; end: number };
  ts: string;
}

/** Serialize an ArtifactStore to a plain array, respecting size caps. */
export function serializeArtifactStore(store: ArtifactStore): SerializedArtifact[] {
  const MAX_ARTIFACT_CHARS = 50_000;
  const out: SerializedArtifact[] = [];
  for (const a of store.list()) {
    out.push({
      id: a.id,
      type: a.type,
      summary: a.summary,
      raw: a.raw.slice(0, MAX_ARTIFACT_CHARS),
      source: a.source,
      path: a.path,
      lineRange: a.lineRange,
      ts: a.ts,
    });
  }
  return out;
}

/** Deserialize a plain array back into an ArtifactStore, respecting limits. */
export function deserializeArtifactStore(data: SerializedArtifact[]): ArtifactStore {
  const store = new ArtifactStore();
  for (const a of data) {
    store.add({
      id: a.id,
      type: a.type,
      summary: a.summary,
      raw: a.raw,
      source: a.source,
      path: a.path,
      lineRange: a.lineRange,
      ts: a.ts,
    });
  }
  return store;
}

/** Format recalled artifacts as a compact context block for injection into messages. */
export function formatRecalledArtifacts(recalled: { id: string; artifact: Artifact }[]): string {
  if (recalled.length === 0) return "";
  const lines: string[] = ["[recalled artifacts]"];
  for (const { id, artifact } of recalled) {
    lines.push(`--- artifact:${id} (${artifact.type} from ${artifact.source}) ---`);
    lines.push(artifact.raw);
  }
  return lines.join("\n");
}

/** Serialize SessionState into a compact system-friendly string. */
export function serializeSessionState(state: SessionState): string {
  const lines: string[] = [];
  lines.push(`task: ${state.task || "(none)"}`);
  if (state.user_constraints.length) lines.push(`constraints:\n${state.user_constraints.map((c) => "  - " + c).join("\n")}`);
  if (state.repo_facts.length) lines.push(`repo_facts:\n${state.repo_facts.map((f) => "  - " + f).join("\n")}`);
  if (state.files_touched.length) lines.push(`files_touched: ${state.files_touched.join(", ")}`);
  if (state.files_modified.length) lines.push(`files_modified: ${state.files_modified.join(", ")}`);
  if (state.confirmed_findings.length) lines.push(`findings:\n${state.confirmed_findings.map((f) => "  - " + f).join("\n")}`);
  if (state.open_questions.length) lines.push(`open_questions:\n${state.open_questions.map((q) => "  - " + q).join("\n")}`);
  if (state.recent_failures.length) lines.push(`recent_failures:\n${state.recent_failures.map((f) => "  - " + f).join("\n")}`);
  if (state.decisions.length) lines.push(`decisions:\n${state.decisions.map((d) => "  - " + d).join("\n")}`);
  if (state.next_actions.length) lines.push(`next_actions:\n${state.next_actions.map((a) => "  - " + a).join("\n")}`);
  if (Object.keys(state.artifact_index).length) {
    lines.push("artifact_index:");
    for (const [id, meta] of Object.entries(state.artifact_index)) {
      lines.push(`  ${id}: [${meta.type}] ${meta.summary}`);
    }
  }
  return lines.join("\n");
}

/** Build a system message containing the compiled session state. */
export function buildSessionStateMessage(state: SessionState): ChatMessage {
  return {
    role: "system",
    content: `[compiled session state]\n${serializeSessionState(state)}`,
  };
}
