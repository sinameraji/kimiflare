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

export type TurnPhase = "idle" | "streaming" | "error";

export interface SupervisorCallbacks {
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export class TurnSupervisor {
  private currentTurn: Promise<void> | null = null;
  private _isRunning = false;

  get isRunning(): boolean {
    return this._isRunning;
  }

  startTurn(opts: AgentTurnOpts, callbacks?: SupervisorCallbacks): void {
    if (this._isRunning) {
      throw new Error("TurnSupervisor: turn already in progress");
    }
    this._isRunning = true;
    logger.debug("supervisor:turn_start", { sessionId: opts.sessionId });

    this.currentTurn = runAgentTurn(opts)
      .then(async () => {
        logger.debug("supervisor:turn_done", { sessionId: opts.sessionId });
        await callbacks?.onDone?.();
      })
      .catch(async (error) => {
        logger.warn("supervisor:turn_error", {
          sessionId: opts.sessionId,
          error: (error as Error).message ?? String(error),
        });
        await callbacks?.onError?.(error as Error);
      })
      .finally(() => {
        this._isRunning = false;
        this.currentTurn = null;
      });
  }
}
