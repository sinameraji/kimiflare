/**
 * TurnSupervisor — fire-and-forget wrapper around runAgentTurn.
 *
 * Decouples turn execution from UI control flow so that:
 * 1. The UI never blocks waiting for a turn to complete
 * 2. A watchdog can enforce maximum turn duration
 * 3. Preemption can kill a running turn and start a new one
 */

import { runAgentTurn } from "./loop.js";
import type { AgentTurnOpts } from "./loop.js";
import { logger } from "../util/logger.js";

export type TurnPhase = "idle" | "streaming" | "executing" | "compacting" | "error";

export interface SupervisorCallbacks {
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export class TurnSupervisor {
  private currentTurn: Promise<void> | null = null;
  private _phase: TurnPhase = "idle";
  private _killRequested = false;

  get phase(): TurnPhase {
    return this._phase;
  }

  get isRunning(): boolean {
    return this._phase !== "idle";
  }

  get killRequested(): boolean {
    return this._killRequested;
  }

  startTurn(opts: AgentTurnOpts, callbacks?: SupervisorCallbacks): void {
    if (this.isRunning) {
      logger.warn("supervisor:start_rejected", { reason: "turn_already_running", phase: this._phase });
      throw new Error("TurnSupervisor: turn already in progress");
    }
    this._phase = "streaming";
    this._killRequested = false;
    logger.debug("supervisor:turn_start", { sessionId: opts.sessionId });

    this.currentTurn = runAgentTurn(opts)
      .then(async () => {
        this._phase = "idle";
        if (this._killRequested) {
          logger.debug("supervisor:turn_killed", { sessionId: opts.sessionId });
        } else {
          logger.debug("supervisor:turn_done", { sessionId: opts.sessionId });
        }
        await callbacks?.onDone?.();
      })
      .catch(async (error) => {
        this._phase = "idle";
        const err = error as Error;
        logger.warn("supervisor:turn_error", {
          sessionId: opts.sessionId,
          error: err.message ?? String(err),
          name: err.name,
        });
        await callbacks?.onError?.(err);
      })
      .finally(() => {
        this.currentTurn = null;
        this._killRequested = false;
      });
  }

  /** Request that the current turn be killed. This does NOT directly abort
   *  the turn — the caller must abort the AbortScope that was passed to
   *  `startTurn`. This method only records the intent so the supervisor
   *  knows the turn was intentionally killed rather than failing. */
  killTurn(): void {
    if (!this.isRunning) return;
    this._killRequested = true;
    logger.debug("supervisor:kill_requested", { phase: this._phase });
  }
}
