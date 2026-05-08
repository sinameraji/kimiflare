import type React from "react";
import { compactMessages } from "../agent/compact.js";
import {
  compactMessages as compactCompiled,
  shouldCompact,
} from "../agent/compaction.js";
import type { ChatMessage } from "../agent/messages.js";
import type { SessionState } from "../agent/session-state.js";
import type { ArtifactStore } from "../agent/session-state.js";
import { gatewayFromConfig } from "../app.js";
import type { Cfg } from "../app.js";
import { AbortScope } from "../util/abort-scope.js";
import type { ChatEvent } from "../ui/chat.js";
import { compactEventsVisual } from "../util/event-helpers.js";

export interface RunCompactCtx {
  cfg: Cfg | null;
  busy: boolean;
  saveSessionSafe: () => Promise<void>;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  mkKey: () => string;
  setBusy: (updater: React.SetStateAction<boolean>) => void;
  busyRef: React.MutableRefObject<boolean>;
  setTurnStartedAt: (updater: React.SetStateAction<number | null>) => void;
  setTurnPhase: (
    updater: React.SetStateAction<import("../ui/status.js").TurnPhase>,
  ) => void;
  setCurrentToolName: (updater: React.SetStateAction<string | null>) => void;
  setLastActivityAt: (updater: React.SetStateAction<number | null>) => void;
  sessionScopeRef: React.MutableRefObject<AbortScope>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  permResolveRef: React.MutableRefObject<
    ((d: import("../tools/executor.js").PermissionDecision) => void) | null
  >;
  limitResolveRef: React.MutableRefObject<
    ((d: import("../ui/limit-modal.js").LimitDecision) => void) | null
  >;
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  compiledContextRef: React.MutableRefObject<boolean>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
}

export async function runCompact(ctx: RunCompactCtx): Promise<void> {
  const {
    cfg,
    busy,
    saveSessionSafe,
    setEvents,
    mkKey,
    setBusy,
    busyRef,
    setTurnStartedAt,
    setTurnPhase,
    setCurrentToolName,
    setLastActivityAt,
    sessionScopeRef,
    activeScopeRef,
    permResolveRef,
    limitResolveRef,
    pendingToolCallsRef,
    messagesRef,
    sessionStateRef,
    compiledContextRef,
    artifactStoreRef,
  } = ctx;

  if (!cfg) return;
  if (busy) {
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: "can't compact while model is running",
      },
    ]);
    return;
  }
  setBusy(true);
  busyRef.current = true;
  setTurnStartedAt(Date.now());
  const turnScope = sessionScopeRef.current.createChild();
  activeScopeRef.current = turnScope;
  try {
    if (compiledContextRef.current) {
      const store = artifactStoreRef.current;
      const result = compactCompiled({
        messages: messagesRef.current,
        state: sessionStateRef.current,
        store,
      });
      if (result.metrics.rawTurnsRemoved === 0) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "nothing to compact yet" },
        ]);
      } else {
        messagesRef.current = result.newMessages;
        sessionStateRef.current = result.newState;
        setEvents((e) =>
          compactEventsVisual(
            [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: `compacted ${result.metrics.rawTurnsRemoved} turns → ${result.metrics.estimatedTokensBefore} → ${result.metrics.estimatedTokensAfter} tokens, ${result.metrics.archivedArtifacts} artifacts`,
              },
            ],
            4,
          ),
        );
        await saveSessionSafe();
      }
    } else {
      const result = await compactMessages({
        accountId: cfg.accountId,
        apiToken: cfg.apiToken,
        model: cfg.model,
        messages: messagesRef.current,
        signal: turnScope.signal,
        gateway: gatewayFromConfig(cfg),
      });
      if (result.replacedCount === 0) {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: "nothing to compact yet" },
        ]);
      } else {
        messagesRef.current = result.newMessages;
        setEvents((e) =>
          compactEventsVisual(
            [
              ...e,
              {
                kind: "info",
                key: mkKey(),
                text: `compacted ${result.replacedCount} messages into a summary`,
              },
            ],
            4,
          ),
        );
        await saveSessionSafe();
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      setEvents((es) => [
        ...es,
        {
          kind: "error",
          key: mkKey(),
          text: `compact failed: ${(e as Error).message}`,
        },
      ]);
    }
  } finally {
    setBusy(false);
    busyRef.current = false;
    setTurnStartedAt(null);
    setTurnPhase("waiting");
    setCurrentToolName(null);
    setLastActivityAt(null);
    activeScopeRef.current = null;
    permResolveRef.current = null;
    limitResolveRef.current = null;
    pendingToolCallsRef.current.clear();
  }
}
