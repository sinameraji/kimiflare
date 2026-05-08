import type React from "react";
import type { ChatMessage } from "../agent/messages.js";
import {
  type SessionState,
  ArtifactStore as ArtifactStoreClass,
  serializeArtifactStore,
  deserializeArtifactStore,
} from "../agent/session-state.js";
import type { ArtifactStore } from "../agent/session-state.js";
import {
  saveSession,
  loadSession,
  loadSessionFromCheckpoint,
  listSessions,
  makeSessionId,
} from "../sessions.js";
import type { SessionSummary, Checkpoint } from "../sessions.js";
import { getCostReport } from "../usage-tracker.js";
import type { DailyUsage } from "../usage-tracker.js";
import type { Usage } from "../agent/messages.js";
import type { GatewayMeta } from "../agent/client.js";
import type { MemoryManager } from "../memory/manager.js";
import type { ChatEvent } from "../ui/chat.js";
import type { Cfg } from "../app.js";

export interface SessionIdCtx {
  sessionIdRef: React.MutableRefObject<string | null>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
}

export function ensureSessionId(ctx: SessionIdCtx): string {
  const { sessionIdRef, messagesRef } = ctx;
  if (sessionIdRef.current) return sessionIdRef.current;
  const firstUser = messagesRef.current.find((m) => m.role === "user");
  let firstText = "session";
  if (typeof firstUser?.content === "string") {
    firstText = firstUser.content;
  } else if (Array.isArray(firstUser?.content)) {
    const textPart = firstUser.content.find((p) => p.type === "text");
    if (textPart?.text) firstText = textPart.text;
  }
  sessionIdRef.current = makeSessionId(firstText);
  return sessionIdRef.current;
}

export interface SaveSessionCtx extends SessionIdCtx {
  cfg: Cfg | null;
  sessionCreatedAtRef: React.MutableRefObject<string | null>;
  sessionTitleRef: React.MutableRefObject<string | null>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  compiledContextRef: React.MutableRefObject<boolean>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  mkKey: () => string;
}

export async function saveSessionSafe(ctx: SaveSessionCtx): Promise<void> {
  const {
    cfg,
    sessionCreatedAtRef,
    sessionTitleRef,
    sessionStateRef,
    compiledContextRef,
    artifactStoreRef,
    setEvents,
    mkKey,
  } = ctx;
  if (!cfg) return;
  ensureSessionId(ctx);
  const now = new Date().toISOString();
  if (!sessionCreatedAtRef.current) {
    sessionCreatedAtRef.current = now;
  }
  try {
    await saveSession({
      id: ctx.sessionIdRef.current!,
      cwd: process.cwd(),
      model: cfg.model,
      createdAt: sessionCreatedAtRef.current,
      updatedAt: now,
      title: sessionTitleRef.current ?? undefined,
      messages: ctx.messagesRef.current,
      sessionState: compiledContextRef.current
        ? sessionStateRef.current
        : undefined,
      artifactStore: serializeArtifactStore(artifactStoreRef.current),
    });
  } catch (e) {
    setEvents((es) => [
      ...es,
      {
        kind: "error",
        key: mkKey(),
        text: `session save failed: ${(e as Error).message}`,
      },
    ]);
  }
}

export interface ResumeSessionCtx {
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  sessionIdRef: React.MutableRefObject<string | null>;
  sessionCreatedAtRef: React.MutableRefObject<string | null>;
  sessionStateRef: React.MutableRefObject<SessionState>;
  compiledContextRef: React.MutableRefObject<boolean>;
  artifactStoreRef: React.MutableRefObject<ArtifactStore>;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  gatewayMetaRef: React.MutableRefObject<GatewayMeta | null>;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  setHistory: (updater: React.SetStateAction<string[]>) => void;
  setUsage: (updater: React.SetStateAction<Usage | null>) => void;
  setSessionUsage: (updater: React.SetStateAction<DailyUsage | null>) => void;
  setGatewayMeta: (updater: React.SetStateAction<GatewayMeta | null>) => void;
  mkKey: () => string;
}

export async function doResumeSession(
  ctx: ResumeSessionCtx,
  filePath: string,
  checkpointId?: string,
): Promise<void> {
  const {
    messagesRef,
    sessionIdRef,
    sessionCreatedAtRef,
    sessionStateRef,
    compiledContextRef,
    artifactStoreRef,
    memoryManagerRef,
    gatewayMetaRef,
    setEvents,
    setHistory,
    setUsage,
    setSessionUsage,
    setGatewayMeta,
    mkKey,
  } = ctx;
  try {
    const file = checkpointId
      ? (await loadSessionFromCheckpoint(filePath, checkpointId)).file
      : await loadSession(filePath);
    messagesRef.current = file.messages;
    sessionIdRef.current = file.id;
    sessionCreatedAtRef.current = file.createdAt;
    if (file.sessionState && compiledContextRef.current) {
      sessionStateRef.current = file.sessionState;
    }
    if (file.artifactStore) {
      artifactStoreRef.current = deserializeArtifactStore(file.artifactStore);
    } else {
      artifactStoreRef.current = new ArtifactStoreClass();
    }
    const manager = memoryManagerRef.current;
    if (manager) {
      try {
        const cwd = process.cwd();
        const results = await manager.recall({
          text: cwd,
          repoPath: cwd,
          limit: 5,
        });
        if (results.length > 0) {
          const text = await manager.synthesizeRecalled(results);
          const lastSystemIdx = messagesRef.current.findLastIndex(
            (m) => m.role === "system",
          );
          const insertIdx =
            lastSystemIdx >= 0 ? lastSystemIdx + 1 : messagesRef.current.length;
          messagesRef.current.splice(insertIdx, 0, {
            role: "system",
            content: text,
          });
        }
      } catch {
        // Non-fatal
      }
    }

    const msg = checkpointId
      ? `resumed session ${file.id} from checkpoint`
      : `resumed session ${file.id} (${file.messages.filter((m) => m.role !== "system").length} msgs)`;
    setEvents([{ kind: "info", key: mkKey(), text: msg }]);
    const userMsgs = file.messages
      .filter((m) => m.role === "user" && m.content)
      .map((m) => {
        if (!m.content) return "";
        if (typeof m.content === "string") return m.content;
        const textPart = m.content.find((p) => p.type === "text");
        return textPart?.text ?? "";
      })
      .filter((text) => text.length > 0);
    if (userMsgs.length > 0) setHistory(userMsgs);
    setUsage(null);
    setSessionUsage(null);
    gatewayMetaRef.current = null;
    setGatewayMeta(null);
    void getCostReport(file.id).then((report) =>
      setSessionUsage(report.session),
    );
  } catch (e) {
    setEvents((es) => [
      ...es,
      {
        kind: "error",
        key: mkKey(),
        text: `failed to load session: ${(e as Error).message}`,
      },
    ]);
  }
}

export interface ResumePickCtx extends ResumeSessionCtx {
  setResumeSessions: (
    updater: React.SetStateAction<SessionSummary[] | null>,
  ) => void;
  setCheckpointList: (updater: React.SetStateAction<Checkpoint[]>) => void;
  setCheckpointSession: (
    updater: React.SetStateAction<SessionSummary | null>,
  ) => void;
}

export async function handleResumePick(
  ctx: ResumePickCtx,
  picked: SessionSummary | null,
): Promise<void> {
  const { setResumeSessions, setCheckpointList, setCheckpointSession } = ctx;
  setResumeSessions(null);
  if (!picked) return;
  if (picked.checkpointCount > 0) {
    try {
      const file = await loadSession(picked.filePath);
      setCheckpointList(file.checkpoints ?? []);
      setCheckpointSession(picked);
    } catch (e) {
      ctx.setEvents((es) => [
        ...es,
        {
          kind: "error",
          key: ctx.mkKey(),
          text: `failed to load checkpoints: ${(e as Error).message}`,
        },
      ]);
      await doResumeSession(ctx, picked.filePath);
    }
    return;
  }
  await doResumeSession(ctx, picked.filePath);
}

export async function handleCheckpointPick(
  ctx: ResumePickCtx,
  checkpointSession: SessionSummary | null,
  checkpointId: string | null,
): Promise<void> {
  const { setCheckpointSession, setCheckpointList, setResumeSessions } = ctx;
  setCheckpointSession(null);
  setCheckpointList([]);
  if (!checkpointSession || !checkpointId) {
    if (checkpointSession) {
      setResumeSessions(await listSessions(200, process.cwd()));
    }
    return;
  }
  if (checkpointId === "__start__") {
    await doResumeSession(ctx, checkpointSession.filePath);
    return;
  }
  await doResumeSession(ctx, checkpointSession.filePath, checkpointId);
}
