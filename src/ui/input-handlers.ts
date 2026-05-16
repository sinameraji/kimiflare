import React from "react";
import type { TurnSupervisor } from "../agent/supervisor.js";
import type { AbortScope } from "../util/abort-scope.js";
import type { LspManager } from "../lsp/manager.js";
import type { LimitDecision, LoopDecision } from "./limit-modal.js";
import type { ChatEvent } from "./chat.js";

// ── Shared dep shape ─────────────────────────────────────────────────────

export interface InterruptDeps {
  // Turn-state refs
  busyRef: React.MutableRefObject<boolean>;
  activeScopeRef: React.MutableRefObject<AbortScope | null>;
  isAbortingRef: React.MutableRefObject<boolean>;
  supervisorRef: React.MutableRefObject<TurnSupervisor>;
  // Resolver refs (limit / loop modals that block the agent loop)
  limitResolveRef: React.MutableRefObject<((d: LimitDecision) => void) | null>;
  loopResolveRef: React.MutableRefObject<((d: LoopDecision) => void) | null>;
  setLimitModal: (v: { limit: number; resolve: (d: LimitDecision) => void } | null) => void;
  setLoopModal: (v: { resolve: (d: LoopDecision) => void } | null) => void;
  // Permission controller
  hasPendingPermission: () => boolean;
  denyPendingPermission: () => boolean;
  // In-flight tool calls (so we can mark them cancelled on abort)
  pendingToolCallsRef: React.MutableRefObject<Map<string, string>>;
  updateTool: (id: string, patch: Partial<Extract<ChatEvent, { kind: "tool" }>>) => void;
  // Event stream
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  mkKey: () => string;
  // Side-effects on interrupt
  saveSessionSafe: () => Promise<void> | void;
  clearTaskTracking: () => void;
  // App exit (Ctrl+C / SIGINT idle path)
  lspManagerRef: React.MutableRefObject<LspManager>;
  exit: () => void;
  /**
   * If true, do not iterate `pendingToolCallsRef` to mark in-flight
   * tool events as cancelled. Preserves the pre-refactor asymmetry
   * where the SIGINT handler (process-level signal, not Ink-level
   * keystroke) skipped this cleanup. Defaults to false.
   */
  skipPendingToolCleanup?: boolean;
}

// ── Outcome reporting ────────────────────────────────────────────────────

export interface InterruptOutcome {
  hadPermission: boolean;
  hadLimit: boolean;
  hadLoop: boolean;
  /** True when the busy turn was actually interrupted (i.e. all guards
   *  passed: busy + active scope + not already aborting). */
  didInterruptTurn: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve any pending limit / loop modals with `"stop"` and close them.
 * Returns flags so the caller can decide whether to also exit (the
 * "Ctrl+C while nothing's happening → quit app" branch).
 */
export function clearLimitLoopResolvers(deps: InterruptDeps): { hadLimit: boolean; hadLoop: boolean } {
  const hadLimit = deps.limitResolveRef.current !== null;
  const hadLoop = deps.loopResolveRef.current !== null;
  if (hadLimit) {
    deps.limitResolveRef.current!("stop");
    deps.limitResolveRef.current = null;
    deps.setLimitModal(null);
  }
  if (hadLoop) {
    deps.loopResolveRef.current!("stop");
    deps.loopResolveRef.current = null;
    deps.setLoopModal(null);
  }
  return { hadLimit, hadLoop };
}

/**
 * Common interrupt sequence used by Ctrl+C, Esc, and SIGINT. Denies any
 * pending permission, clears limit/loop resolvers, and (if a turn is
 * actually running) kills the turn, aborts the scope, marks in-flight
 * tools cancelled, emits an "(interrupted)" event, and triggers a
 * session save + task-list clear. Returns flags so the caller can take
 * follow-up action (e.g. exit the app when nothing was interrupted).
 *
 * NOTE: this does NOT exit the app on its own — that's left to
 * `exitAppIfIdle`, which checks the returned flags.
 */
export function interruptTurn(deps: InterruptDeps): InterruptOutcome {
  const hadPermission = deps.denyPendingPermission();
  const { hadLimit, hadLoop } = clearLimitLoopResolvers(deps);

  if (
    deps.busyRef.current &&
    deps.activeScopeRef.current &&
    !deps.isAbortingRef.current
  ) {
    deps.isAbortingRef.current = true;
    deps.supervisorRef.current.killTurn();
    deps.activeScopeRef.current.abort("user_stopped");
    deps.setEvents((e) => [
      ...e,
      { kind: "info", key: deps.mkKey(), text: "(interrupted)" },
    ]);
    if (!deps.skipPendingToolCleanup) {
      for (const [toolId] of deps.pendingToolCallsRef.current) {
        deps.updateTool(toolId, { status: "cancelled" });
      }
      deps.pendingToolCallsRef.current.clear();
    }
    void deps.saveSessionSafe();
    deps.clearTaskTracking();
    return { hadPermission, hadLimit, hadLoop, didInterruptTurn: true };
  }
  return { hadPermission, hadLimit, hadLoop, didInterruptTurn: false };
}

/**
 * Exit the app cleanly via the LSP manager's stopAll(). Used by Ctrl+C
 * and SIGINT when there was nothing to interrupt — the user wants to
 * quit.
 */
export function exitApp(deps: InterruptDeps): void {
  void deps.lspManagerRef.current.stopAll().finally(() => deps.exit());
}

/**
 * Convenience: run `interruptTurn`, then exit the app if nothing was
 * actually pending (no permission, no limit modal, no loop modal,
 * nothing to interrupt). Mirrors the Ctrl+C / SIGINT decision tree.
 */
export function interruptOrExit(deps: InterruptDeps): InterruptOutcome {
  const outcome = interruptTurn(deps);
  if (
    !outcome.didInterruptTurn &&
    !outcome.hadPermission &&
    !outcome.hadLimit &&
    !outcome.hadLoop
  ) {
    exitApp(deps);
  }
  return outcome;
}
