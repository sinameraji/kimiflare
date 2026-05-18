import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { ThemeProvider } from "./theme-context.js";
import { LimitModal } from "./limit-modal.js";
import { CommandWizard } from "./command-wizard.js";
import { CommandPicker } from "./command-picker.js";
import { CommandList } from "./command-list.js";
import { LspWizard } from "./lsp-wizard.js";
import { ThemePicker } from "./theme-picker.js";
import { ModelPicker } from "./model-picker.js";
import { KeyEntryModal, type KeyResult } from "./key-entry-modal.js";
import { BillingChooser, type BillingChoice } from "./billing-chooser.js";
import { UnifiedBillingStatus } from "./unified-billing-status.js";
import type { ModelEntry } from "../models/registry.js";
import { RemoteDashboard, RemoteSessionDetail } from "./remote-dashboard.js";
import { InboxModal } from "./inbox-modal.js";
import { HooksDashboard } from "./hooks-dashboard.js";
import type { Theme } from "./theme.js";
import type { ModalHostController } from "./use-modal-host.js";
import type { CustomCommand } from "../commands/types.js";
import type { SaveCustomCommandOptions } from "../commands/save.js";
import type { RemoteSession } from "../remote/session-store.js";
import type { HookConfig, HookEvent } from "../hooks/types.js";

interface LspServersConfig {
  [key: string]: {
    command: string[];
    env?: Record<string, string>;
    enabled?: boolean;
    rootPatterns?: string[];
  };
}

export interface ModalHostProps {
  modals: ModalHostController;
  theme: Theme;
  // Command modals
  customCommands: CustomCommand[];
  builtinNames: Set<string>;
  onCommandSave: (opts: SaveCustomCommandOptions) => Promise<void> | void;
  onCommandDelete: (cmd: CustomCommand) => Promise<void> | void;
  // LSP wizard
  lspServers: LspServersConfig;
  lspScope: "project" | "global";
  hasProjectDir: boolean;
  onLspSave: (
    servers: LspServersConfig,
    enabled: boolean,
    scope: "project" | "global",
  ) => void;
  // Theme picker
  themes: Theme[];
  onPickTheme: (theme: Theme | null) => void;
  // Model picker
  currentModel: string;
  onPickModel: (model: ModelEntry | null) => void;
  // Key entry modal (opens after a byok model is picked without a stored key)
  onSaveProviderKey: (model: ModelEntry, result: KeyResult) => void;
  onCancelKeyEntry: () => void;
  // Billing chooser (Unified Billing vs BYOK) for Unified-eligible providers
  onPickBilling: (model: ModelEntry, choice: BillingChoice | null) => void;
  // Unified Billing probe — result is one of "enabled" | "fallback-byok" | "cancelled"
  onUnifiedProbeResolve: (model: ModelEntry, r: "enabled" | "fallback-byok" | "cancelled") => void;
  // Cloudflare credentials needed by the key entry and probe flows
  accountId: string;
  apiToken: string;
  secretsStoreId?: string;
  aiGatewayId?: string;
  // Remote dashboard
  selectedRemoteSession: RemoteSession | null;
  onSelectRemoteSession: (s: RemoteSession | null) => void;
  onCancelRemoteSession: (session: RemoteSession) => void | Promise<void>;
  // Inbox
  onInboxOpen: (url: string) => void;
  // M6.1: hooks dashboard. Pass `getConfiguredHooks` rather than a
  // static array so the dashboard re-reads after every mutation
  // without needing a re-render in the parent.
  getConfiguredHooks: () => { event: HookEvent; hook: HookConfig }[];
  cwd: string;
  onHooksMutate: () => void;
}

/**
 * Renders whichever fullscreen modal is currently active, wrapped in the
 * shared `ThemeProvider`. Returns null when no fullscreen modal is open
 * — callers should check `modals.hasFullscreenModal` and skip the main
 * conversation render if true.
 */
export function ModalHost(props: ModalHostProps): React.ReactElement | null {
  const {
    modals,
    theme,
    customCommands,
    builtinNames,
    onCommandSave,
    onCommandDelete,
    lspServers,
    lspScope,
    hasProjectDir,
    onLspSave,
    themes,
    onPickTheme,
    currentModel,
    onPickModel,
    onSaveProviderKey,
    onCancelKeyEntry,
    onPickBilling,
    onUnifiedProbeResolve,
    accountId,
    apiToken,
    secretsStoreId,
    aiGatewayId,
    selectedRemoteSession,
    onSelectRemoteSession,
    onCancelRemoteSession,
    onInboxOpen,
  } = props;

  if (modals.showRemoteDashboard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          {selectedRemoteSession ? (
            <RemoteSessionDetail
              session={selectedRemoteSession}
              onBack={() => onSelectRemoteSession(null)}
              onCancel={(session) => {
                void onCancelRemoteSession(session);
              }}
            />
          ) : (
            <RemoteDashboard
              onSelect={(session) => onSelectRemoteSession(session)}
              onCancel={() => modals.setShowRemoteDashboard(false)}
            />
          )}
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showInboxModal) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <InboxModal
            onDone={() => modals.setShowInboxModal(false)}
            onOpen={onInboxOpen}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showHooksDashboard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <HooksDashboard
            getConfigured={props.getConfiguredHooks}
            cwd={props.cwd}
            onMutate={props.onHooksMutate}
            onDone={() => modals.setShowHooksDashboard(false)}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showLspWizard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <LspWizard
            servers={lspServers}
            currentScope={lspScope}
            hasProjectDir={hasProjectDir}
            onDone={() => modals.setShowLspWizard(false)}
            onSave={onLspSave}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.commandWizard) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <CommandWizard
            mode={modals.commandWizard.mode}
            initial={modals.commandWizard.initial}
            existingNames={customCommands.map((c) => c.name)}
            builtinNames={builtinNames}
            onDone={() => modals.setCommandWizard(null)}
            onSave={onCommandSave}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.commandPicker) {
    const pickerMode = modals.commandPicker.mode;
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <CommandPicker
            commands={customCommands}
            title={pickerMode === "edit" ? "Edit custom command" : "Delete custom command"}
            onPick={(cmd) => {
              modals.setCommandPicker(null);
              if (!cmd) return;
              if (pickerMode === "edit") {
                modals.setCommandWizard({ mode: "edit", initial: cmd });
              } else {
                modals.setCommandToDelete(cmd);
              }
            }}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.commandToDelete) {
    const cmd = modals.commandToDelete;
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
          <Text color={theme.accent} bold>
            Delete /{cmd.name}?
          </Text>
          <Text color={theme.info.color}>
            {cmd.filepath}
          </Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: "Yes, delete", value: "yes", key: "yes" },
                { label: "Cancel", value: "cancel", key: "cancel" },
              ]}
              onSelect={(item) => {
                if (item.value === "yes") {
                  void onCommandDelete(cmd);
                } else {
                  modals.setCommandToDelete(null);
                }
              }}
            />
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showCommandList) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <CommandList
            commands={customCommands}
            onDone={() => modals.setShowCommandList(false)}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showThemePicker) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <ThemePicker themes={themes} onPick={onPickTheme} />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.showModelPicker) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <ModelPicker current={currentModel} onPick={onPickModel} />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.billingChooserFor) {
    const model = modals.billingChooserFor;
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <BillingChooser model={model} onPick={(choice) => onPickBilling(model, choice)} />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.unifiedProbeFor) {
    const model = modals.unifiedProbeFor;
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <UnifiedBillingStatus
            model={model}
            accountId={accountId}
            apiToken={apiToken}
            gatewayId={aiGatewayId ?? ""}
            onResolve={(r) => onUnifiedProbeResolve(model, r)}
          />
        </Box>
      </ThemeProvider>
    );
  }

  if (modals.keyEntryFor) {
    const model = modals.keyEntryFor;
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column">
          <KeyEntryModal
            model={model}
            accountId={accountId}
            apiToken={apiToken}
            secretsStoreId={secretsStoreId}
            onSave={(result) => onSaveProviderKey(model, result)}
            onCancel={onCancelKeyEntry}
          />
        </Box>
      </ThemeProvider>
    );
  }

  return null;
}

/**
 * Renders the active resolver-style overlay (limit or loop). Sits inline
 * inside the main conversation view, gating the input/queue/statusbar
 * region. Returns null when no overlay is active.
 */
export interface ModalOverlayProps {
  modals: ModalHostController;
  /**
   * Called after the limit modal resolves and before the modal is closed.
   * Used by `app.tsx` to also clear its `limitResolveRef` bookkeeping —
   * the agent loop reads that ref to fire `"stop"` on Ctrl+C / abort.
   */
  onLimitResolved?: () => void;
  /** Mirror of `onLimitResolved` for the loop modal. */
  onLoopResolved?: () => void;
}

export function ModalOverlay({
  modals,
  onLimitResolved,
  onLoopResolved,
}: ModalOverlayProps): React.ReactElement | null {
  if (modals.limitModal) {
    const m = modals.limitModal;
    return (
      <LimitModal
        limit={m.limit}
        onDecide={(d) => {
          m.resolve(d);
          onLimitResolved?.();
          modals.setLimitModal(null);
        }}
      />
    );
  }
  if (modals.loopModal) {
    const m = modals.loopModal;
    return (
      <LimitModal
        limit={50}
        title="Agent stuck in a loop"
        description="The agent kept calling the same tools with identical arguments. What would you like to do?"
        items={[
          { label: "Continue", value: "continue" },
          { label: "Synthesize", value: "synthesize" },
        ]}
        onDecide={(d) => {
          m.resolve(d);
          onLoopResolved?.();
          modals.setLoopModal(null);
        }}
      />
    );
  }
  return null;
}
