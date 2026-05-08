import { compactMessages } from "../agent/compact.js";
import {
  compactMessages as compactCompiled,
  shouldCompact,
} from "../agent/compaction.js";
import { gatewayFromConfig } from "../app.js";
import type { Cfg } from "../app.js";
import type { ChatMessage } from "../agent/messages.js";
import {
  type SessionState,
  type ArtifactStore,
} from "../agent/session-state.js";
import type { MemoryManager } from "../memory/manager.js";
import type { ChatEvent } from "../ui/chat.js";
import { mkKey } from "../util/event-helpers.js";

export async function onIterationEnd(
  messages: ChatMessage[],
  signal: AbortSignal,
  cfg: Cfg | null,
  compiledContextRef: React.MutableRefObject<boolean>,
  artifactStoreRef: React.MutableRefObject<ArtifactStore>,
  sessionStateRef: React.MutableRefObject<SessionState>,
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>,
  appendEvent: (ev: ChatEvent) => void,
  saveSessionSafe: () => Promise<void>,
): Promise<ChatMessage[]> {
  if (signal.aborted) return messages;
  if (!shouldCompact({ messages })) return messages;

  if (compiledContextRef.current) {
    const store = artifactStoreRef.current;
    const result = compactCompiled({
      messages,
      state: sessionStateRef.current,
      store,
    });
    if (result.metrics.rawTurnsRemoved > 0) {
      sessionStateRef.current = result.newState;
      appendEvent({
        kind: "info",
        key: mkKey(),
        text: `auto-compacted: ${result.metrics.estimatedTokensBefore} → ${result.metrics.estimatedTokensAfter} tokens (${result.metrics.archivedArtifacts} artifacts)`,
      });
      await saveSessionSafe();
    }
    // After compaction, recall memories so the model retains durable anchors
    const manager = memoryManagerRef.current;
    if (manager && !signal.aborted) {
      try {
        const cwd = process.cwd();
        const queryText = sessionStateRef.current.task || cwd;
        const results = await manager.recall({
          text: queryText,
          repoPath: cwd,
          limit: 5,
        });
        if (results.length > 0 && !signal.aborted) {
          const text = await manager.synthesizeRecalled(results);
          const lastSystemIdx = result.newMessages.findLastIndex(
            (m) => m.role === "system",
          );
          const insertIdx =
            lastSystemIdx >= 0 ? lastSystemIdx + 1 : result.newMessages.length;
          result.newMessages.splice(insertIdx, 0, {
            role: "system",
            content: text,
          });
          appendEvent({
            kind: "memory",
            key: mkKey(),
            text: `recalled ${results.length} memory${results.length === 1 ? "" : "ies"} after compaction`,
          });
          await saveSessionSafe();
        }
      } catch {
        // Non-fatal
      }
    }
    return result.newMessages;
  }

  // Non-compiled context: fall back to LLM summarizer
  if (cfg && !signal.aborted) {
    try {
      const result = await compactMessages({
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        messages,
        signal,
        gateway: gatewayFromConfig(cfg),
      });
      if (result.replacedCount > 0) {
        appendEvent({
          kind: "info",
          key: mkKey(),
          text: `auto-compacted: ${result.replacedCount} messages summarized`,
        });
        await saveSessionSafe();
      }
      return result.newMessages;
    } catch {
      // Non-fatal: if compaction fails, continue with original messages
    }
  }
  return messages;
}
