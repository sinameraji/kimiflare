# Product & Engineering Plan: Skills + Session Tree

**Branch:** `plan/skills-and-session-tree`  
**Date:** 2026-05-06  
**Author:** kimiflare (AI agent)  
**Status:** Planning / Not Yet Executed  
**Scope:** Two major features for KimiFlare — **Skills** (markdown-based prompt customization) and **Session Tree** (fork/clone/branch navigation).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Part A: Skills System](#part-a-skills-system)
   - [A.1 Market Research](#a1-market-research)
   - [A.2 How KimiFlare Works Today](#a2-how-kimiflare-works-today)
   - [A.3 Proposed Design](#a3-proposed-design)
   - [A.4 Engineering Plan](#a4-engineering-plan)
   - [A.5 Milestones](#a5-milestones)
3. [Part B: Session Tree / Branching](#part-b-session-tree--branching)
   - [B.1 Market Research](#b1-market-research)
   - [B.2 How KimiFlare Works Today](#b2-how-kimiflare-works-today)
   - [B.3 Proposed Design](#b3-proposed-design)
   - [B.4 Engineering Plan](#b4-engineering-plan)
   - [B.5 Milestones](#b5-milestones)
4. [Cross-Cutting Concerns](#4-cross-cutting-concerns)
5. [Risks & Mitigations](#5-risks--mitigations)
6. [Appendix: Research Notes](#6-appendix-research-notes)

---

## 1. Executive Summary

This plan proposes two major features for KimiFlare, inspired by deep research into Pi (badlogic/pi-mono), Claude Code, Aider, Cursor, and our own codebase:

| Feature | What It Is | Why It Matters | Effort |
|---------|-----------|----------------|--------|
| **Skills** | Markdown files with frontmatter that inject domain-specific instructions into the system prompt | Users can customize behavior per-project or per-task without forking KimiFlare. Creates a sharing mechanism. | Medium |
| **Session Tree** | Fork/clone/branch navigation for conversations. Users can explore multiple approaches from any point in history. | No other coding agent does this well. Transforms linear chat into an exploratory tool. | Large |

**Strategic thesis:** Pi proves that users want customization (Skills) and exploratory workflows (Session Tree). KimiFlare can adopt these concepts but implement them with its characteristic depth — integrating them with existing features like semantic memory, cost attribution, and LSP/MCP.

---

## Part A: Skills System

### A.1 Market Research

#### A.1.1 Pi (badlogic/pi-mono) — The Reference Implementation

Pi's Skills system is the most mature in the terminal coding agent space.

**File Format:**
```markdown
---
name: react-testing
description: Guidelines for writing React component tests
---

When writing React tests:
- Prefer React Testing Library over Enzyme
- Use `screen.getByRole` for accessibility-first queries
- Mock `fetch` with `msw`, not jest.mock
- Each test should verify one behavior
```

**Storage Locations:**
- Global: `~/.config/pi/skills/`
- Project-local: `.pi/skills/` (or `.pi/skills/<name>/SKILL.md`)
- Pi Packages: installed packages can export skills

**Frontmatter Schema (from `src/core/skills.ts`):**
```typescript
interface SkillFrontmatter {
  name: string;           // Unique identifier
  description: string;    // Shown to user and model
  disableModelInvocation?: boolean; // If true, not shown in prompt
}
```

**Loading Strategy:**
1. `ResourceLoader` discovers skills from all sources (global, project, packages)
2. Collision detection: same name from multiple sources → diagnostic warning
3. Skills are loaded at session start and on `/reload`
4. Only skills with `disableModelInvocation !== true` are injected into the prompt

**Prompt Injection (from `formatSkillsForPrompt`):**
```xml
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
  <skill>
    <name>react-testing</name>
    <description>Guidelines for writing React component tests</description>
    <location>/Users/alice/.config/pi/skills/react-testing/SKILL.md</location>
  </skill>
</available_skills>
```

**Key Insight:** Pi treats skills as *available resources* that the model can choose to load via the `read` tool, rather than unconditionally injecting all content. This saves context window space.

#### A.1.2 Claude Code (Anthropic)

Claude Code does not have a formal "skills" system, but it supports:
- `.claude-code/` directory for project-specific instructions
- `CLAUDE.md` file for context (similar to KimiFlare's `KIMI.md`)
- No frontmatter-based skill loading

**Gap:** Claude Code's approach is simpler but less structured. Users can't have multiple, conditionally-active instruction sets.

#### A.1.3 Aider (paul-gauthier/aider)

Aider supports:
- `.aider.conf.yml` for configuration
- `.aider.chat.history.md` for conversation history
- No skill/instruction injection system beyond the config file

**Gap:** Aider is focused on git-integrated pair programming, not customizable domain expertise.

#### A.1.4 Cursor

Cursor supports:
- `.cursorrules` file for project-specific rules
- No frontmatter, no multiple skills, no conditional activation

**Gap:** Single-file approach is limiting for complex projects with multiple domains.

#### A.1.5 GitHub Copilot

Copilot supports:
- `.github/copilot-instructions.md`
- No structured skill system

#### A.1.6 Market Synthesis

| Tool | Skill System | Multi-Skill | Conditional Activation | Shareable |
|------|-------------|-------------|----------------------|-----------|
| **Pi** | ✅ Markdown + frontmatter | ✅ | ✅ via `disableModelInvocation` | ✅ via Pi Packages |
| **Claude Code** | ❌ (only `CLAUDE.md`) | ❌ | ❌ | ❌ |
| **Aider** | ❌ | ❌ | ❌ | ❌ |
| **Cursor** | ✅ `.cursorrules` | ❌ | ❌ | ❌ |
| **Copilot** | ✅ `copilot-instructions.md` | ❌ | ❌ | ❌ |
| **KimiFlare** | ✅ `KIMI.md` | ❌ | ❌ | ❌ |

**Opportunity:** KimiFlare can leapfrog everyone by combining Pi's multi-skill approach with its existing deep integrations (memory, LSP, MCP). No tool currently offers structured skills + semantic memory + code intelligence.

---

### A.2 How KimiFlare Works Today

#### A.2.1 Current Context File System

KimiFlare already has a primitive form of project-specific instructions via `KIMI.md`:

```typescript
// src/agent/system-prompt.ts
const CONTEXT_FILENAMES = ["KIMI.md", "KIMIFLARE.md", "AGENT.md"];
const MAX_CONTEXT_BYTES = 20 * 1024;

export function loadContextFile(cwd: string): ContextFile | null {
  for (const name of CONTEXT_FILENAMES) {
    const path = join(cwd, name);
    try {
      const s = statSync(path);
      if (s.isFile() && s.size <= MAX_CONTEXT_BYTES) {
        const content = readFileSync(path, "utf8");
        return { name, path, content, lineCount: content.split("\n").length };
      }
    } catch { /* ignore */ }
  }
  return null;
}
```

The context file content is injected into the system prompt under a `# Project Context` section.

#### A.2.2 Current Custom Commands

KimiFlare has a custom slash command system (`src/commands/`):
- Commands are defined in `~/.config/kimiflare/commands/` or `.kimiflare/commands/`
- Each command is a JSON file with `name`, `description`, `template`
- Templates support variable substitution (`{{arg}}`, `{{files}}`)
- Commands can set `mode`, `model`, `effort`, `shell`, `files`

This is *not* the same as skills. Commands are user-triggered shortcuts; skills are model-facing instructions.

#### A.2.3 Current System Prompt Architecture

```
[Static Prefix]     → buildStaticPrefix()  → model info, tool schemas, rules
[Session Prefix]    → buildSessionPrefix() → cwd, date, context file, mode rules
[User Messages]     → ChatMessage[]        → conversation history
```

Skills would fit naturally into the Session Prefix, alongside or replacing the current `KIMI.md` injection.

---

### A.3 Proposed Design

#### A.3.1 Design Principles

1. **Backward Compatible:** Existing `KIMI.md` files continue to work unchanged.
2. **Progressive Enhancement:** Users can start with a single skill and graduate to multiple.
3. **Model-First:** Skills are primarily for the model, not the user. The user sees them in `/skills` and pickers, but the value is in prompt injection.
4. **Integrated:** Skills work with existing KimiFlare features — memory, LSP, cost attribution.
5. **Shareable:** Skills can be shared via git, npm, or a future KimiFlare registry.

#### A.3.2 File Format

```markdown
---
name: react-testing
description: Guidelines for writing React component tests
match:
  - "*.test.tsx"
  - "*.test.ts"
  - "vitest.config.*"
priority: 10
---

# React Testing Guidelines

When writing React component tests:

1. **Use React Testing Library** — Query by role, not by test-id:
   ```tsx
   // Good
   screen.getByRole("button", { name: /submit/i });
   // Bad
   screen.getByTestId("submit-btn");
   ```

2. **Mock external APIs with MSW**, not jest.mock:
   ```ts
   // Good
   server.use(http.get('/api/user', () => HttpResponse.json(mockUser)));
   // Bad
   jest.mock('./api', () => ({ ... }));
   ```

3. **One behavior per test** — If you need "and" in the test name, split it.
```

**Frontmatter Schema:**
```typescript
interface SkillFrontmatter {
  /** Unique identifier. Defaults to parent directory name. */
  name: string;
  /** Shown in pickers and to the model. 1-2 sentences. */
  description: string;
  /** File patterns that auto-activate this skill. Optional. */
  match?: string[];
  /** Higher priority skills are listed first. Default: 0. */
  priority?: number;
  /** If true, skill is loaded but not injected into prompt. Model must explicitly request it. */
  lazy?: boolean;
  /** If true, skill is disabled. */
  disabled?: boolean;
}
```

#### A.3.3 Storage Locations

| Scope | Path | Use Case |
|-------|------|----------|
| **Global** | `~/.config/kimiflare/skills/` | Personal skills shared across all projects |
| **Project** | `.kimiflare/skills/` | Team-shared skills for this repo |
| **Package** | `node_modules/*/kimiflare-skills/` | Published skill packages (future) |

**Directory Structure:**
```
.kimiflare/skills/
├── react-testing/
│   └── SKILL.md
├── api-design/
│   └── SKILL.md
└── rust-memory/
    └── SKILL.md
```

#### A.3.4 Activation Strategy

**Auto-Activation (Default):**
1. On session start, scan all skill sources
2. For each skill with `match` patterns, check if any matched files exist in the working tree
3. Active skills = matched skills + skills explicitly enabled by user
4. Sort by priority (descending), then name

**Lazy Loading (Alternative):**
1. All non-lazy skills are injected into the prompt immediately
2. Lazy skills are listed in `<available_skills>` but content is not loaded
3. The model can "load" a lazy skill by reading its file path
4. This saves context window for skills that may not be needed

**User Override:**
- `/skills` — list all discovered skills, show which are active
- `/skills enable <name>` — force-enable a skill
- `/skills disable <name>` — force-disable a skill
- `/skills reload` — rescan and re-evaluate

#### A.3.5 Prompt Injection

Skills are injected into the Session Prefix, after the static prefix and before user messages:

```
[Static Prefix]
[Session Prefix]
  [Context File]     ← existing KIMI.md
  [Active Skills]    ← NEW
    [Skill: react-testing]
    [Skill: api-design]
[User Messages]
```

**Format (XML-style, like Pi):**
```xml
# Active Skills

The following skills provide specialized instructions. They are automatically
activated based on the files in your project. You can view all skills with
`/skills` and toggle them with `/skills enable|disable <name>`.

<skill name="react-testing" priority="10">
When writing React component tests:
- Prefer React Testing Library over Enzyme
- Use `screen.getByRole` for accessibility-first queries
- Mock `fetch` with `msw`, not jest.mock
</skill>

<skill name="api-design" priority="5">
When designing REST APIs:
- Use nouns for resources, not verbs
- Version in the URL path, not header
- Return 201 for created, 409 for conflicts
</skill>
```

**Token Budget:**
- Each skill content is capped at 4,000 tokens (configurable)
- Total skills budget: 12,000 tokens (configurable)
- If exceeded, lower-priority skills are truncated or dropped

#### A.3.6 Integration with Existing Features

| Feature | Integration |
|---------|------------|
| **Memory** | Skills can reference memory topics. E.g., a "team-conventions" skill could say "See memory:team-conventions for current patterns." |
| **LSP** | Skills can include language-specific rules that complement LSP diagnostics. |
| **Cost Attribution** | Skill activation is logged as a signal in cost-debug entries. |
| **Custom Commands** | A skill and a command can share a name. The skill provides model instructions; the command provides a user shortcut. |
| **KIMI.md** | If both KIMI.md and skills exist, KIMI.md is treated as an implicit skill with `name: project-context`, `priority: 100`. |

#### A.3.7 UI/UX

**Theme Picker-Style Skill Selector:**
- Triggered by `/skills` or Ctrl+K (if unbound)
- Shows all discovered skills with active/inactive state
- Preview shows description and matched files
- Toggle with Enter

**Status Bar Integration (Future):**
- Show active skill count in footer (when footer is implemented)
- e.g., "3 skills active"

---

### A.4 Engineering Plan

#### A.4.1 New Files

```
src/skills/
├── schema.ts           # SkillFrontmatter, Skill interfaces
├── loader.ts           # Discover skills from all sources
├── resolver.ts         # Determine active skills for current project
├── injector.ts         # Format skills for system prompt injection
├── picker.tsx          # Ink component for skill selection
└── index.ts            # Public API
```

#### A.4.2 Modified Files

```
src/agent/system-prompt.ts    # Inject active skills into session prefix
src/config.ts                 # Add skillsEnabled, skillsMaxTokens config
src/commands/builtins.ts      # Add /skills slash command
src/app.tsx                   # Handle /skills, render skill picker
src/sessions.ts               # Save/load active skill set with session
```

#### A.4.3 Data Flow

```
1. Session Start
   → loader.discoverSkills(cwd) → Skill[]
   → resolver.resolveActive(skills, cwd) → ActiveSkill[]
   → injector.formatForPrompt(activeSkills) → string
   → system-prompt.ts injects into Session Prefix

2. User types /skills
   → app.tsx opens SkillPicker
   → User toggles skills
   → resolver.updateUserOverrides(changes)
   → Rebuild system prompt with new active set
   → Info message: "skills updated: react-testing enabled"

3. File changes in project
   → (Future) File watcher detects new matched files
   → resolver re-evaluates auto-activation
   → If changes, info message: "auto-activated skill: rust-memory"
```

#### A.4.4 Key Implementation Details

**Frontmatter Parsing:**
- Use `gray-matter` (already used by some markdown tooling) or a lightweight parser
- Validate against schema with zod
- Report diagnostics for invalid skills (like Pi does)

**Pattern Matching:**
- Use `micromatch` or `minimatch` for `match` glob patterns
- Match against files in `cwd` (use existing `fast-glob` dependency)

**Token Budgeting:**
- Use existing `approxTokens` function from `compaction.ts`
- Truncate skill content from the bottom (least important part)

**Persistence:**
- User overrides (enable/disable) stored in `~/.config/kimiflare/skill-overrides.json`
- Per-project overrides stored in `.kimiflare/skill-overrides.json`
- Session file includes `activeSkills: string[]` for resume

---

### A.5 Milestones

#### Milestone A1: Foundation (Week 1)
- [ ] Create `src/skills/schema.ts` with interfaces
- [ ] Create `src/skills/loader.ts` that discovers skills from global + project dirs
- [ ] Add `gray-matter` dependency (or write lightweight frontmatter parser)
- [ ] Unit tests for loader

#### Milestone A2: Resolution & Injection (Week 2)
- [ ] Create `src/skills/resolver.ts` with auto-activation logic
- [ ] Create `src/skills/injector.ts` with XML formatting
- [ ] Modify `system-prompt.ts` to inject skills
- [ ] Add `skillsEnabled` to `KimiConfig`
- [ ] Unit tests for resolver and injector

#### Milestone A3: UI & Commands (Week 3)
- [ ] Add `/skills` to `BUILTIN_COMMANDS`
- [ ] Implement `handleSlash` cases for `/skills`, `/skills enable`, `/skills disable`
- [ ] Create `SkillPicker` Ink component
- [ ] Wire picker into `app.tsx`
- [ ] Add skill info to session save/load

#### Milestone A4: Polish & Integration (Week 4)
- [ ] Token budgeting (truncate skills that exceed budget)
- [ ] Diagnostics for invalid skills (warnings in TUI)
- [ ] Integration with cost-debug (log active skills per turn)
- [ ] Documentation: `docs/skills.md` with examples
- [ ] Update `KIMI.md` to mention skills

#### Milestone A5: Sharing (Future)
- [ ] `kimiflare skills publish` (publish to npm with `kimiflare-skills` keyword)
- [ ] `kimiflare skills install <package>`
- [ ] Skill registry on kimiflare.com

---

## Part B: Session Tree / Branching

### B.1 Market Research

#### B.1.1 Pi (badlogic/pi-mono) — The Reference Implementation

Pi's session tree is the most sophisticated in any coding agent.

**Data Model (from `src/core/messages.ts` and `src/core/session-manager.ts`):**

```typescript
// Each session is a JSONL file where each line is a FileEntry
type FileEntry =
  | { type: "header"; version: number; timestamp: string }
  | { type: "message"; id: string; parentId: string | null; timestamp: string; message: Message }
  | { type: "thinkingLevelChange"; id: string; parentId: string | null; timestamp: string; thinkingLevel: string }
  | { type: "compactionSummary"; id: string; parentId: string | null; timestamp: string; summary: string }
  | { type: "branchSummary"; id: string; parentId: string | null; timestamp: string; summary: string }
  | { type: "modelChange"; id: string; parentId: string | null; timestamp: string; model: string }
  | { type: "custom"; id: string; parentId: string | null; timestamp: string; entry: unknown };
```

**Key Insight:** Every entry has an `id` and `parentId`. This forms a directed acyclic graph (DAG). The "leaf" is the current position.

**SessionManager API:**
```typescript
class SessionManager {
  appendMessage(message: Message): string;        // Add entry, advance leaf
  appendThinkingLevelChange(level: string): string;
  appendCompactionSummary(summary: string): string;
  
  // Branching
  fork(fromEntryId: string): string;               // Create new branch from any entry
  clone(): string;                                 // Duplicate current session at current position
  
  // Navigation
  getPathToLeaf(): SessionEntry[];                 // Get all entries from root to leaf
  getTree(): TreeNode[];                           // Get full tree for display
  switchBranch(entryId: string): void;             // Move leaf to different branch
  
  // Persistence
  save(): void;                                    // Write JSONL to disk
  load(filePath: string): void;                    // Read JSONL from disk
}
```

**User Commands:**
- `/fork` — Creates a new branch from the current (or selected) user message
- `/clone` — Duplicates the current session at the current position
- `/tree` — Opens an interactive tree navigator
- `/resume` — Lists sessions; selecting one loads it

**Tree Visualization (from `tree-selector.ts`):**
- ASCII tree rendering with branch connectors (`├──`, `└──`, `│`)
- Each node shows: message preview, timestamp, model name
- Navigate with arrow keys, select with Enter
- Visual distinction for current branch vs. other branches

**Compaction with Branches:**
- Pi's compaction preserves branch structure
- Each branch gets its own compaction summary
- The `branchSummary` entry type stores per-branch context

#### B.1.2 Claude Code (Anthropic)

Claude Code has **no session tree**. Sessions are linear:
- Conversations are stored in `.claude-code/chat-history/` as markdown files
- No forking, no branching, no cloning
- Users can start a new session, but can't explore alternatives within a session

**Gap:** This is a major limitation for exploratory coding. Users often want to try "what if I approach this differently?"

#### B.1.3 Aider (paul-gauthier/aider)

Aider has **no session tree**. It focuses on git-integrated pair programming:
- Uses git commits as checkpoints
- Users can `git checkout` to previous states, but this is git, not session branching
- No conversation branching

**Gap:** Git commits are code checkpoints, not conversation checkpoints.

#### B.1.4 Cursor

Cursor has **no session tree** in the traditional sense:
- Chat history is linear
- "Composer" mode has some branching for multi-file edits, but not for conversations
- No fork/clone/tree navigation

#### B.1.5 ChatGPT / Claude.ai (Web)

Web chat interfaces have **no session tree**:
- Linear conversations
- Users can edit previous messages, which creates a *new* linear branch (the old branch is discarded)
- No way to compare branches or switch between them

#### B.1.6 Harness (paul-gauthier/harness)

Harness is a newer terminal agent. It has:
- Linear sessions
- No branching

#### B.1.7 Market Synthesis

| Tool | Session Tree | Fork | Clone | Tree Navigator | Branch Compaction |
|------|-------------|------|-------|---------------|-------------------|
| **Pi** | ✅ DAG | ✅ | ✅ | ✅ ASCII tree | ✅ |
| **Claude Code** | ❌ Linear | ❌ | ❌ | ❌ | ❌ |
| **Aider** | ❌ Linear | ❌ | ❌ | ❌ | ❌ |
| **Cursor** | ❌ Linear | ❌ | ❌ | ❌ | ❌ |
| **ChatGPT** | ❌ Linear (edit = replace) | ❌ | ❌ | ❌ | ❌ |
| **Harness** | ❌ Linear | ❌ | ❌ | ❌ | ❌ |
| **KimiFlare** | ❌ Linear | ❌ | ❌ | ❌ | ❌ |

**Opportunity:** Session tree is a genuinely unique feature. Only Pi has it. If KimiFlare implements this, it would be the only agent with both session tree AND deep integrations (memory, LSP, MCP, cost attribution).

---

### B.2 How KimiFlare Works Today

#### B.2.1 Current Session Data Model

```typescript
// src/sessions.ts
interface SessionFile {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  sessionState?: SessionState;
  artifactStore?: SerializedArtifact[];
}

// src/agent/messages.ts
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
}
```

**Storage:**
- Sessions saved to `~/.local/share/kimiflare/sessions/<id>.json`
- Each session is a single JSON file
- No parent/child relationships

#### B.2.2 Current Session Lifecycle

```
1. User starts KimiFlare
   → New session: messages = [system], sessionId = null
   
2. User sends first message
   → sessionId = generateId(firstPrompt)
   → messages.push(userMsg, assistantMsg, toolMsgs...)
   
3. Auto-save after each turn
   → saveSession({ id, cwd, model, messages, sessionState, artifactStore })
   
4. User types /clear
   → Reset to [system], new sessionId = null
   
5. User types /resume
   → listSessions() → show picker
   → loadSession(filePath) → restore messages, state, artifacts
```

#### B.2.3 Current Compaction

```typescript
// src/agent/compaction.ts
interface CompactionOpts {
  messages: ChatMessage[];
  state: SessionState;
  store: ArtifactStore;
  keepLastTurns?: number;
  tokenThreshold?: number;
  turnThreshold?: number;
}

interface CompactionResult {
  newMessages: ChatMessage[];
  newState: SessionState;
  metrics: CompactionMetrics;
}
```

Compaction replaces old turns with a summary message. This is linear — it doesn't account for branches.

#### B.2.4 Current TUI State

```typescript
// src/app.tsx
const [events, setEvents] = useState<ChatEvent[]>([]);
const messagesRef = useRef<ChatMessage[]>([]);
const sessionIdRef = useRef<string | null>(null);
const sessionStateRef = useRef<SessionState>(emptySessionState());
const artifactStoreRef = useRef<ArtifactStore>(new ArtifactStore());
```

All state is linear. There is no concept of "current branch" or "leaf position."

---

### B.3 Proposed Design

#### B.3.1 Design Principles

1. **Backward Compatible:** Existing session files continue to work. Linear sessions are a degenerate case of a tree (single branch).
2. **Lazy Migration:** Don't force-migrate old sessions. New sessions use the tree format; old sessions load as single-branch trees.
3. **Git-Inspired:** Use git terminology where possible (branch, fork, checkout) for familiarity.
4. **Non-Destructive:** Forking never modifies the original branch. Users can always go back.
5. **Context-Aware:** Each branch has its own session state, artifact store, and memory context.

#### B.3.2 Data Model

**New Entry Types (inspired by Pi, adapted for KimiFlare):**

```typescript
// src/sessions.ts (extended)

/** A node in the session tree. Each node represents one turn (user + assistant + tools). */
interface SessionNode {
  /** Unique node ID */
  id: string;
  /** Parent node ID. Null for root. */
  parentId: string | null;
  /** Child node IDs */
  children: string[];
  /** Timestamp */
  timestamp: string;
  
  // Turn content
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  toolMessages: ChatMessage[];
  
  // Metadata
  model: string;
  mode: Mode;
  usage?: Usage;
  
  // KimiFlare-specific state snapshot
  sessionStateSnapshot?: SessionState;
  artifactStoreSnapshot?: SerializedArtifact[];
  
  // Optional: user-provided label
  label?: string;
}

/** The session tree file format */
interface SessionTreeFile {
  version: 2;  // bumped from 1
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  
  // All nodes indexed by ID
  nodes: Record<string, SessionNode>;
  
  // The current "leaf" — where new messages are appended
  leafId: string | null;
  
  // The "root" node ID (usually a system message placeholder)
  rootId: string;
  
  // Active skills at session start
  activeSkills?: string[];
}
```

**Migration from v1:**
```typescript
function migrateV1ToV2(file: SessionFile): SessionTreeFile {
  // Create a root node
  const rootId = `root_${file.id}`;
  const nodes: Record<string, SessionNode> = {};
  
  // Group v1 messages into turns
  const { prefix, turns } = groupIntoTurns(file.messages);
  
  // Create nodes from turns
  let parentId: string | null = rootId;
  for (const turn of turns) {
    const nodeId = `node_${generateId()}`;
    nodes[nodeId] = {
      id: nodeId,
      parentId,
      children: [],
      timestamp: turn.user.timestamp ?? new Date().toISOString(),
      userMessage: turn.user,
      assistantMessage: turn.assistant,
      toolMessages: turn.tools,
      model: file.model,
      mode: "edit", // default for migrated sessions
      sessionStateSnapshot: file.sessionState,
      artifactStoreSnapshot: file.artifactStore,
    };
    if (parentId) {
      nodes[parentId]!.children.push(nodeId);
    }
    parentId = nodeId;
  }
  
  return {
    version: 2,
    id: file.id,
    cwd: file.cwd,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    nodes,
    leafId: parentId,
    rootId,
  };
}
```

#### B.3.3 Operations

**Append (Normal Turn):**
```
1. Create new node N
2. N.parentId = currentLeafId
3. nodes[currentLeafId].children.push(N.id)
4. currentLeafId = N.id
5. Save tree
```

**Fork (from any node):**
```
1. User selects node F (via /fork or tree navigator)
2. Create new branch root B
3. B.parentId = F.id
4. nodes[F.id].children.push(B.id)
5. currentLeafId = B.id
6. Copy session state from F's snapshot
7. Info message: "forked from turn 3: 'write tests for auth'"
```

**Clone (duplicate current position):**
```
1. currentLeafId = L
2. Create new node C with same content as L
3. C.parentId = L.parentId
4. nodes[L.parentId!].children.push(C.id)
5. currentLeafId = C.id
6. Info message: "cloned current turn"
```

**Switch Branch (checkout):**
```
1. User selects node S in tree navigator
2. currentLeafId = S.id
3. Rebuild messages array from root → S path
4. Restore session state from S's snapshot
5. Restore artifact store from S's snapshot
6. Re-render events from messages
7. Info message: "switched to branch: 'try redux instead'"
```

**Label (name a node):**
```
1. User types /label "try redux approach"
2. nodes[currentLeafId].label = "try redux approach"
3. Label shown in tree navigator
```

#### B.3.4 Tree Navigator UI

**Ink Component: `TreeNavigator`**

Inspired by Pi's `tree-selector.ts` but adapted for KimiFlare's React/Ink architecture:

```tsx
// src/ui/tree-navigator.tsx
interface TreeNavigatorProps {
  tree: SessionTreeFile;
  currentLeafId: string;
  onSelect: (nodeId: string) => void;
  onCancel: () => void;
}

// Renders:
// ┌─ Session Tree ─────────────────────────┐
// │                                        │
// │  ◆ add user auth to login page         │
// │  ├── ○ write tests for auth            │
// │  │   └── ◆ try jest mocks              │
// │  └── ○ use MSW instead                 │
// │      └── ◆ [current] refactor API      │
// │                                        │
// │  ↑↓ navigate  Enter: switch  q: cancel │
// └────────────────────────────────────────┘
```

**Rendering Algorithm:**
1. Build tree structure from `nodes` map
2. Compute display indent for each node
3. Draw ASCII connectors (`├──`, `└──`, `│`)
4. Highlight current leaf
5. Show labels if present, otherwise message preview

#### B.3.5 Compaction with Branches

**Challenge:** Compaction must preserve branch structure.

**Solution:**
```
1. Identify the "trunk" — the path from root to current leaf
2. Compact trunk turns that are old enough
3. For each branch off the trunk:
   a. If branch is inactive (not visited recently), compact it aggressively
   b. If branch is active, preserve more context
4. Store compaction summary as a special node type
5. Branch-specific compaction summaries are stored per-branch
```

**New Compaction Result:**
```typescript
interface TreeCompactionResult {
  // Nodes that were compacted (replaced with summary nodes)
  compactedNodeIds: string[];
  // New summary nodes
  summaryNodes: SessionNode[];
  // Metrics
  metrics: CompactionMetrics;
}
```

#### B.3.6 Integration with Existing Features

| Feature | Integration |
|---------|------------|
| **Memory** | Each branch has its own memory context. Switching branches recalls memories relevant to that branch's topic. |
| **Cost Attribution** | Cost is tracked per-branch. Users can compare cost of different approaches. |
| **LSP** | LSP state is global (file changes affect all branches), but diagnostics are shown in context of current branch. |
| **Skills** | Skills active at fork time are inherited by the new branch. |
| **Remote Sessions** | Remote sessions are linear (for now). Tree branching is a local feature. |

---

### B.4 Engineering Plan

#### B.4.1 New Files

```
src/sessions/
├── tree.ts              # SessionTree class: DAG operations
├── tree-navigator.tsx   # Ink component for tree visualization
├── tree-compaction.ts   # Branch-aware compaction
└── index.ts             # Public API

src/ui/
├── tree-navigator.tsx   # (moved from src/sessions/ for consistency)
└── tree-node.tsx        # Individual tree node rendering
```

#### B.4.2 Modified Files

```
src/sessions.ts          # Extend SessionFile to SessionTreeFile, add migration
src/app.tsx              # Replace linear refs with tree refs, add /fork /clone /tree /label
src/agent/loop.ts        # Pass tree node ID through turn lifecycle
src/agent/compaction.ts  # Support branch-aware compaction
src/commands/builtins.ts # Add fork, clone, tree, label commands
src/storage-limits.ts    # Update retention for tree files
```

#### B.4.3 Data Flow

```
1. Normal Turn
   → User submits message
   → app.tsx creates SessionNode
   → tree.append(node) → updates leafId
   → runAgentTurn with messages from root→leaf path
   → After turn: snapshot state + artifacts into node
   → saveTree()

2. Fork
   → User types /fork [turnNumber]
   → If no arg, fork from current leaf
   → tree.fork(fromNodeId) → creates new branch
   → Copy state snapshot to new branch
   → Info message + saveTree()

3. Switch Branch
   → User types /tree → opens TreeNavigator
   → User selects node
   → tree.checkout(nodeId) → rebuilds messages, state, artifacts
   → setEvents from rebuilt messages
   → Info message

4. Compaction
   → Triggered by /compact or auto
   → treeCompaction.compact(tree, options)
   → Compacts trunk first, then branches
   → Replaces old nodes with summary nodes
   → Preserves branch structure
   → saveTree()
```

#### B.4.4 Key Implementation Details

**SessionTree Class:**
```typescript
class SessionTree {
  private file: SessionTreeFile;
  
  constructor(file: SessionTreeFile);
  
  // Navigation
  getPathToLeaf(): SessionNode[];
  getMessages(): ChatMessage[]; // flattened from path
  getNode(id: string): SessionNode | undefined;
  
  // Mutation
  appendTurn(turn: Turn): string; // returns new node ID
  fork(fromNodeId: string): string; // returns new branch root ID
  clone(nodeId: string): string;
  checkout(nodeId: string): void;
  label(nodeId: string, label: string): void;
  
  // Queries
  getTreeDisplay(): TreeDisplayNode[];
  getBranches(): BranchInfo[];
  
  // Persistence
  toFile(): SessionTreeFile;
  static fromFile(file: SessionTreeFile): SessionTree;
  static fromV1(file: SessionFile): SessionTree;
}
```

**Message Reconstruction:**
```typescript
function rebuildMessages(tree: SessionTree): ChatMessage[] {
  const path = tree.getPathToLeaf();
  const messages: ChatMessage[] = [];
  
  for (const node of path) {
    messages.push(node.userMessage);
    messages.push(node.assistantMessage);
    messages.push(...node.toolMessages);
  }
  
  return messages;
}
```

**State Snapshotting:**
- After each turn, serialize `SessionState` and `ArtifactStore` into the node
- This enables perfect restoration when switching branches
- Snapshots are optional (configurable) to save disk space

---

### B.5 Milestones

#### Milestone B1: Tree Data Model (Week 1-2)
- [ ] Define `SessionTreeFile` v2 schema
- [ ] Create `SessionTree` class with DAG operations
- [ ] Implement v1 → v2 migration
- [ ] Unit tests for all tree operations

#### Milestone B2: Core Integration (Week 3-4)
- [ ] Modify `sessions.ts` to use tree format
- [ ] Update `app.tsx` to use `SessionTree` instead of linear refs
- [ ] Ensure backward compatibility (v1 sessions load correctly)
- [ ] Update auto-save to persist tree

#### Milestone B3: Branching Commands (Week 5)
- [ ] Add `/fork`, `/clone`, `/tree`, `/label` to `BUILTIN_COMMANDS`
- [ ] Implement `handleSlash` cases
- [ ] Create `TreeNavigator` Ink component
- [ ] Wire navigator into `app.tsx`

#### Milestone B4: Tree-Aware Compaction (Week 6)
- [ ] Extend `compaction.ts` to work with trees
- [ ] Implement branch-aware compaction strategy
- [ ] Preserve branch structure during compaction
- [ ] Unit tests for tree compaction

#### Milestone B5: Polish & Integration (Week 7)
- [ ] State snapshotting (SessionState + ArtifactStore per node)
- [ ] Memory integration (recall per-branch)
- [ ] Cost attribution per-branch
- [ ] Keyboard shortcuts (Ctrl+B for tree, etc.)
- [ ] Documentation: `docs/session-tree.md`

#### Milestone B6: Advanced Features (Future)
- [ ] Merge branches (combine two approaches)
- [ ] Diff branches (compare two approaches)
- [ ] Export branch as standalone session
- [ ] Branch-specific memory isolation

---

## 4. Cross-Cutting Concerns

### 4.1 Configuration

New config fields in `KimiConfig`:

```typescript
interface KimiConfig {
  // ... existing fields ...
  
  // Skills
  skillsEnabled?: boolean;           // default: true
  skillsMaxTokens?: number;          // default: 12000
  skillsLazyLoading?: boolean;       // default: false
  
  // Session Tree
  sessionTreeEnabled?: boolean;      // default: true
  sessionTreeMaxNodes?: number;      // default: 1000
  sessionTreeSnapshotState?: boolean; // default: true
}
```

### 4.2 Storage

| Data | Current Location | New Location | Notes |
|------|-----------------|--------------|-------|
| Sessions | `~/.local/share/kimiflare/sessions/*.json` | Same | Format changes from v1 to v2 |
| Skills (global) | N/A | `~/.config/kimiflare/skills/` | New |
| Skills (project) | N/A | `.kimiflare/skills/` | New |
| Skill overrides | N/A | `~/.config/kimiflare/skill-overrides.json` | New |

### 4.3 Performance

| Concern | Mitigation |
|---------|-----------|
| Tree files growing large | Prune old branches; compact aggressively |
| State snapshots consuming memory | Optional; can be disabled |
| Tree navigator rendering | Virtualize if >100 nodes |
| Skill scanning on startup | Cache skill list; watch for changes |

### 4.4 Testing Strategy

| Component | Test Type |
|-----------|-----------|
| `SkillLoader` | Unit tests with mock filesystem |
| `SkillResolver` | Unit tests with various match patterns |
| `SessionTree` | Unit tests for all DAG operations |
| `TreeNavigator` | Snapshot tests for rendering |
| `TreeCompaction` | Unit tests with complex branch structures |
| Integration | End-to-end: fork → continue → switch → compact |

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Session file corruption on migration** | Medium | High | Keep v1 backup; validate v2 after migration; rollback path |
| **Tree UI is confusing to users** | Medium | Medium | Default to linear view; tree is opt-in via /tree; good documentation |
| **Skills bloat system prompt** | Medium | Medium | Token budgeting; lazy loading; user can disable |
| **Performance degradation with large trees** | Medium | Medium | Pruning; compaction; optional state snapshots |
| **Breaking change to session format** | Low | High | v1 → v2 migration is one-way but v1 files are preserved; gradual rollout |
| **Users don't adopt skills** | Medium | Low | Ship with built-in skills for common stacks; make discovery easy |
| **Complexity increases maintenance burden** | High | Medium | Clean abstractions; comprehensive tests; feature flags |

---

## 6. Appendix: Research Notes

### A. Pi Skills Implementation Details

**Source:** `packages/coding-agent/src/core/skills.ts`

- Skills are loaded by `ResourceLoader` which scans directories
- Frontmatter is parsed with a custom parser (not gray-matter)
- Validation includes: name format, description length, directory structure
- Diagnostics are collected and shown to the user
- Skills are formatted as XML in the prompt
- The model is instructed to use the `read` tool to load skill files when needed

### B. Pi Session Tree Implementation Details

**Source:** `packages/coding-agent/src/core/session-manager.ts`, `packages/coding-agent/src/core/messages.ts`

- Sessions are JSONL files (one JSON object per line)
- Each entry has `id`, `parentId`, `timestamp`, and type-specific fields
- The `SessionManager` maintains:
  - `fileEntries: FileEntry[]` — all entries in order
  - `byId: Map<string, SessionEntry>` — index by ID
  - `leafId: string | null` — current position
- Forking creates a new entry with `parentId` pointing to the fork point
- The tree is rendered with recursive ASCII art
- Session files are stored in `~/.pi/agent/sessions/<encoded-cwd>/<id>.jsonl`

### C. KimiFlare Current Architecture Notes

**Source:** `src/app.tsx`, `src/sessions.ts`, `src/agent/session-state.ts`, `src/agent/compaction.ts`

- Sessions are single JSON files (`SessionFile` interface)
- Messages are stored as a flat array (`ChatMessage[]`)
- `sessionStateRef` and `artifactStoreRef` are mutable refs
- Auto-save happens after each turn via `saveSessionSafe()`
- Compaction groups messages into turns, extracts artifacts, creates summary
- The TUI uses React + Ink with `useState` for events and refs for messages

### D. Claude Code Session Model

**Source:** Documentation and observed behavior

- Sessions are stored as markdown files in `.claude-code/chat-history/`
- No structured data model — just rendered markdown
- No branching, forking, or tree navigation
- History is purely linear

### E. Aider Session Model

**Source:** Documentation and observed behavior

- Aider doesn't really have "sessions" in the traditional sense
- It operates on git commits
- Users can undo with `/undo` (git reset)
- No conversation branching

---

*Plan compiled by kimiflare. No code was executed. This is a planning document only.*
