import { useMemo, useState } from "react";
import type { LimitDecision, LoopDecision } from "./limit-modal.js";
import type { CustomCommand } from "../commands/types.js";

export interface LimitModalState {
  limit: number;
  resolve: (d: LimitDecision) => void;
}

export interface LoopModalState {
  resolve: (d: LoopDecision) => void;
}

export interface CommandWizardState {
  mode: "create" | "edit";
  initial?: CustomCommand;
}

export interface CommandPickerState {
  mode: "edit" | "delete";
}

export interface ModalHostController {
  // Resolver-style overlays (replace input/queue/statusbar).
  limitModal: LimitModalState | null;
  setLimitModal: (v: LimitModalState | null) => void;
  loopModal: LoopModalState | null;
  setLoopModal: (v: LoopModalState | null) => void;

  // Fullscreen modals (replace the whole conversation view).
  commandWizard: CommandWizardState | null;
  setCommandWizard: (v: CommandWizardState | null) => void;
  commandPicker: CommandPickerState | null;
  setCommandPicker: (v: CommandPickerState | null) => void;
  commandToDelete: CustomCommand | null;
  setCommandToDelete: (v: CustomCommand | null) => void;
  showCommandList: boolean;
  setShowCommandList: (v: boolean) => void;
  showLspWizard: boolean;
  setShowLspWizard: (v: boolean) => void;
  showThemePicker: boolean;
  setShowThemePicker: (v: boolean) => void;
  showRemoteDashboard: boolean;
  setShowRemoteDashboard: (v: boolean) => void;
  showInboxModal: boolean;
  setShowInboxModal: (v: boolean) => void;

  /** Any fullscreen modal is active (would trigger an early return). */
  hasFullscreenModal: boolean;
  /** Either resolver overlay is active. */
  hasOverlayModal: boolean;
  /** Any modal of any kind is active (use to gate input / pickers). */
  hasAnyModal: boolean;
}

/**
 * Lifts the M4.3 modal state out of `app.tsx`. Owns the seven modal
 * families listed in the roadmap (limit, loop, command*, LSP, theme,
 * remote, inbox) plus the derived activity flags.
 *
 * Note on what is NOT here:
 *   - `perm` (permission modal) lives in `usePermissionController` (M4.1).
 *   - `resumeSessions` / `checkpointSession` are session-state and will
 *     move with `SessionManager` (M4.4).
 *
 * The hook returns everything destructured so call sites can keep their
 * original names (`setLimitModal`, `commandWizard`, …) and no rename
 * sweep is required — only the JSX renderer changes.
 */
export function useModalHost(): ModalHostController {
  const [limitModal, setLimitModal] = useState<LimitModalState | null>(null);
  const [loopModal, setLoopModal] = useState<LoopModalState | null>(null);
  const [commandWizard, setCommandWizard] = useState<CommandWizardState | null>(null);
  const [commandPicker, setCommandPicker] = useState<CommandPickerState | null>(null);
  const [commandToDelete, setCommandToDelete] = useState<CustomCommand | null>(null);
  const [showCommandList, setShowCommandList] = useState(false);
  const [showLspWizard, setShowLspWizard] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showRemoteDashboard, setShowRemoteDashboard] = useState(false);
  const [showInboxModal, setShowInboxModal] = useState(false);

  const flags = useMemo(() => {
    const hasFullscreenModal =
      commandWizard !== null ||
      commandPicker !== null ||
      commandToDelete !== null ||
      showCommandList ||
      showLspWizard ||
      showThemePicker ||
      showRemoteDashboard ||
      showInboxModal;
    const hasOverlayModal = limitModal !== null || loopModal !== null;
    return {
      hasFullscreenModal,
      hasOverlayModal,
      hasAnyModal: hasFullscreenModal || hasOverlayModal,
    };
  }, [
    commandWizard,
    commandPicker,
    commandToDelete,
    showCommandList,
    showLspWizard,
    showThemePicker,
    showRemoteDashboard,
    showInboxModal,
    limitModal,
    loopModal,
  ]);

  return {
    limitModal, setLimitModal,
    loopModal, setLoopModal,
    commandWizard, setCommandWizard,
    commandPicker, setCommandPicker,
    commandToDelete, setCommandToDelete,
    showCommandList, setShowCommandList,
    showLspWizard, setShowLspWizard,
    showThemePicker, setShowThemePicker,
    showRemoteDashboard, setShowRemoteDashboard,
    showInboxModal, setShowInboxModal,
    ...flags,
  };
}

// ── Pure helpers (handy for tests + downstream consumers) ────────────────

export interface ModalFlagsInput {
  limitModal: LimitModalState | null;
  loopModal: LoopModalState | null;
  commandWizard: CommandWizardState | null;
  commandPicker: CommandPickerState | null;
  commandToDelete: CustomCommand | null;
  showCommandList: boolean;
  showLspWizard: boolean;
  showThemePicker: boolean;
  showRemoteDashboard: boolean;
  showInboxModal: boolean;
}

export interface ModalFlags {
  hasFullscreenModal: boolean;
  hasOverlayModal: boolean;
  hasAnyModal: boolean;
}

export function computeModalFlags(s: ModalFlagsInput): ModalFlags {
  const hasFullscreenModal =
    s.commandWizard !== null ||
    s.commandPicker !== null ||
    s.commandToDelete !== null ||
    s.showCommandList ||
    s.showLspWizard ||
    s.showThemePicker ||
    s.showRemoteDashboard ||
    s.showInboxModal;
  const hasOverlayModal = s.limitModal !== null || s.loopModal !== null;
  return {
    hasFullscreenModal,
    hasOverlayModal,
    hasAnyModal: hasFullscreenModal || hasOverlayModal,
  };
}

export const EMPTY_MODAL_STATE: ModalFlagsInput = {
  limitModal: null,
  loopModal: null,
  commandWizard: null,
  commandPicker: null,
  commandToDelete: null,
  showCommandList: false,
  showLspWizard: false,
  showThemePicker: false,
  showRemoteDashboard: false,
  showInboxModal: false,
};
