import React, { useCallback, useRef, useState } from "react";
import {
  listSessions,
  loadSession,
  loadSessionFromCheckpoint,
  makeSessionId,
  saveSession,
  type Checkpoint,
  type SessionSummary,
} from "../sessions.js";
import {
  ArtifactStore,
  deserializeArtifactStore,
  emptySessionState,
  serializeArtifactStore,
  type SessionState,
} from "../agent/session-state.js";
import type { ChatMessage, Usage } from "../agent/messages.js";
import type { GatewayMeta } from "../agent/client.js";
import type { MemoryManager } from "../memory/manager.js";
import { getCostReport } from "../usage-tracker.js";
import type { DailyUsage } from "../usage-tracker.js";
import type { ChatEvent } from "./chat.js";

/**
 * Pull the first chunk of user text out of a message list — used to
 * derive a stable session id on the first turn. Returns `"session"` if
 * no user message has any text content, mirroring the pre-extraction
 * fallback in `app.tsx`.
 */
export function extractFirstUserText(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "session";
  if (typeof firstUser.content === "string") {
    return firstUser.content || "session";
  }
  if (Array.isArray(firstUser.content)) {
    const textPart = firstUser.content.find((p) => p.type === "text");
    if (textPart?.text) return textPart.text;
  }
  return "session";
}

export interface SessionManagerDeps {
  /** Model name + other config needed at save time. Null while booting. */
  cfg: { model: string } | null;
  // Refs the hook needs to read/write at save and resume time. These
  // belong to the wider app (the agent loop mutates them too), so they're
  // injected rather than owned.
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
  compiledContextRef: React.MutableRefObject<boolean>;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  // State setters the resume flow needs to reach into.
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  setHistory: (h: string[]) => void;
  setUsage: (u: Usage | null) => void;
  setSessionUsage: (s: DailyUsage | null) => void;
  setGatewayMeta: (g: GatewayMeta | null) => void;
  /** Stable key generator for event-list items. */
  mkKey: () => string;
}

export interface SessionManager {
  // Identity refs (kept here, but returned so other code can keep
  // calling `sessionIdRef.current` unchanged).
  sessionIdRef: React.MutableRefObject<string | null>;
  sessionCreatedAtRef: React.MutableRefObject<string | null>;
  sessionTitleRef: React.MutableRefObject<string | null>;

  // Picker state (powers the resume + checkpoint modals).
  resumeSessions: SessionSummary[] | null;
  setResumeSessions: (s: SessionSummary[] | null) => void;
  checkpointSession: SessionSummary | null;
  setCheckpointSession: (s: SessionSummary | null) => void;
  checkpointList: Checkpoint[];
  setCheckpointList: (c: Checkpoint[]) => void;
  hasPickerOpen: boolean;

  // Operations.
  ensureSessionId: () => string;
  saveSessionSafe: () => Promise<void>;
  openResumePicker: () => Promise<void>;
  doResumeSession: (filePath: string, checkpointId?: string) => Promise<void>;
  handleResumePick: (picked: SessionSummary | null) => Promise<void>;
  handleCheckpointPick: (checkpointId: string | null) => Promise<void>;
  /** Clears the identity refs. Used by /clear. */
  resetSession: () => void;
}

export function useSessionManager(deps: SessionManagerDeps): SessionManager {
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreatedAtRef = useRef<string | null>(null);
  const sessionTitleRef = useRef<string | null>(null);

  const [resumeSessions, setResumeSessions] = useState<SessionSummary[] | null>(null);
  const [checkpointSession, setCheckpointSession] = useState<SessionSummary | null>(null);
  const [checkpointList, setCheckpointList] = useState<Checkpoint[]>([]);

  // Stash deps in a ref so the public callbacks keep stable identities.
  // Same pattern as M4.1's PermissionController and M4.2's PickerController.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const ensureSessionId = useCallback(() => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const text = extractFirstUserText(depsRef.current.messagesRef.current);
    sessionIdRef.current = makeSessionId(text);
    return sessionIdRef.current;
  }, []);

  const saveSessionSafe = useCallback(async () => {
    const d = depsRef.current;
    if (!d.cfg) return;
    ensureSessionId();
    const now = new Date().toISOString();
    if (!sessionCreatedAtRef.current) {
      sessionCreatedAtRef.current = now;
    }
    try {
      await saveSession({
        id: sessionIdRef.current!,
        cwd: process.cwd(),
        model: d.cfg.model,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: now,
        title: sessionTitleRef.current ?? undefined,
        messages: d.messagesRef.current,
        sessionState: d.compiledContextRef.current ? d.sessionStateRef.current : undefined,
        artifactStore: serializeArtifactStore(d.artifactStoreRef.current),
      });
    } catch (e) {
      d.setEvents((es) => [
        ...es,
        { kind: "error", key: d.mkKey(), text: `session save failed: ${(e as Error).message}` },
      ]);
    }
  }, [ensureSessionId]);

  const openResumePicker = useCallback(async () => {
    const sessions = await listSessions(200, process.cwd());
    setResumeSessions(sessions);
  }, []);

  const doResumeSession = useCallback(
    async (filePath: string, checkpointId?: string) => {
      const d = depsRef.current;
      try {
        const file = checkpointId
          ? (await loadSessionFromCheckpoint(filePath, checkpointId)).file
          : await loadSession(filePath);
        d.messagesRef.current = file.messages;
        sessionIdRef.current = file.id;
        sessionCreatedAtRef.current = file.createdAt;
        if (file.sessionState && d.compiledContextRef.current) {
          d.sessionStateRef.current = file.sessionState;
        }
        if (file.artifactStore) {
          d.artifactStoreRef.current = deserializeArtifactStore(file.artifactStore);
        } else {
          d.artifactStoreRef.current = new ArtifactStore();
        }
        // Recall memories for the resumed session so the model has context.
        const manager = d.memoryManagerRef.current;
        if (manager) {
          try {
            const cwd = process.cwd();
            const results = await manager.recall({ text: cwd, repoPath: cwd, limit: 5 });
            if (results.length > 0) {
              const text = await manager.synthesizeRecalled(results);
              const lastSystemIdx = d.messagesRef.current.findLastIndex((m) => m.role === "system");
              const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : d.messagesRef.current.length;
              d.messagesRef.current.splice(insertIdx, 0, { role: "system", content: text });
            }
          } catch {
            // Non-fatal
          }
        }

        const msg = checkpointId
          ? `resumed session ${file.id} from checkpoint`
          : `resumed session ${file.id} (${file.messages.filter((m) => m.role !== "system").length} msgs)`;
        d.setEvents([{ kind: "info", key: d.mkKey(), text: msg }]);
        const userMsgs = file.messages
          .filter((m) => m.role === "user" && m.content)
          .map((m) => {
            if (!m.content) return "";
            if (typeof m.content === "string") return m.content;
            const textPart = m.content.find((p) => p.type === "text");
            return textPart?.text ?? "";
          })
          .filter((text) => text.length > 0);
        if (userMsgs.length > 0) d.setHistory(userMsgs);
        d.setUsage(null);
        d.setSessionUsage(null);
        d.gatewayMetaRef.current = null;
        d.setGatewayMeta(null);
        void getCostReport(file.id).then((report) => d.setSessionUsage(report.session));
      } catch (e) {
        d.setEvents((es) => [
          ...es,
          { kind: "error", key: d.mkKey(), text: `failed to load session: ${(e as Error).message}` },
        ]);
      }
    },
    [],
  );

  const handleResumePick = useCallback(
    async (picked: SessionSummary | null) => {
      setResumeSessions(null);
      if (!picked) return;
      if (picked.checkpointCount > 0) {
        // Load checkpoints and show picker.
        try {
          const file = await loadSession(picked.filePath);
          setCheckpointList(file.checkpoints ?? []);
          setCheckpointSession(picked);
        } catch (e) {
          depsRef.current.setEvents((es) => [
            ...es,
            { kind: "error", key: depsRef.current.mkKey(), text: `failed to load checkpoints: ${(e as Error).message}` },
          ]);
          await doResumeSession(picked.filePath);
        }
        return;
      }
      await doResumeSession(picked.filePath);
    },
    [doResumeSession],
  );

  const handleCheckpointPick = useCallback(
    async (checkpointId: string | null) => {
      const session = checkpointSession;
      setCheckpointSession(null);
      setCheckpointList([]);
      if (!session || !checkpointId) {
        // User cancelled or went back — reopen the session list.
        if (session) {
          setResumeSessions(await listSessions(200, process.cwd()));
        }
        return;
      }
      if (checkpointId === "__start__") {
        await doResumeSession(session.filePath);
        return;
      }
      await doResumeSession(session.filePath, checkpointId);
    },
    [checkpointSession, doResumeSession],
  );

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    sessionCreatedAtRef.current = null;
    sessionTitleRef.current = null;
    const d = depsRef.current;
    d.sessionStateRef.current = emptySessionState();
    d.artifactStoreRef.current = new ArtifactStore();
  }, []);

  return {
    sessionIdRef,
    sessionCreatedAtRef,
    sessionTitleRef,
    resumeSessions, setResumeSessions,
    checkpointSession, setCheckpointSession,
    checkpointList, setCheckpointList,
    hasPickerOpen: resumeSessions !== null || checkpointSession !== null,
    ensureSessionId,
    saveSessionSafe,
    openResumePicker,
    doResumeSession,
    handleResumePick,
    handleCheckpointPick,
    resetSession,
  };
}
