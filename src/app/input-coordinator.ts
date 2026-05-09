import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FilePickerItem } from "../ui/file-picker.js";
import type { SlashItem } from "../commands/types.js";
import {
  buildFilePickerIgnoreList,
  filterPickerItems,
  shouldOpenMentionPicker,
  shouldOpenSlashPicker,
  insertSlashCommand,
  trackRecentFile,
} from "../util/file-picker.js";
import { fuzzyFilter } from "../util/fuzzy.js";
import fg from "fast-glob";
import {
  BUILTIN_COMMANDS,
  BUILTIN_COMMAND_NAMES,
} from "../commands/builtins.js";
import type { CustomCommand } from "../commands/types.js";
import type React from "react";

type ActivePicker =
  | { kind: "file"; anchor: number; selected: number }
  | { kind: "slash"; anchor: number; selected: number };

// Re-export Key type from ink to avoid direct dependency in consuming modules
export type InkKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  super: boolean;
  hyper: boolean;
  capsLock: boolean;
  numLock: boolean;
  eventType?: "press" | "repeat" | "release";
};

export interface InputCoordinatorCtx {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  cursorOffset: number;
  setCursorOffset: React.Dispatch<React.SetStateAction<number>>;
  filePickerEnabled: boolean;
  recentFilesRef: React.MutableRefObject<Map<string, number>>;
  maxRecentFiles: number;
  customCommandsRef: React.MutableRefObject<CustomCommand[]>;
  customCommandsVersion: number;
  submitRef: React.MutableRefObject<(full: string, display?: string) => void>;
  setEvents: React.Dispatch<
    React.SetStateAction<import("../ui/chat.js").ChatEvent[]>
  >;
  mkKey: () => string;
  permResolveRef: React.MutableRefObject<
    ((d: import("../tools/executor.js").PermissionDecision) => void) | null
  >;
  limitResolveRef: React.MutableRefObject<
    ((d: import("../ui/limit-modal.js").LimitDecision) => void) | null
  >;
  busyRef: React.MutableRefObject<boolean>;
  activeScopeRef: React.MutableRefObject<
    import("../util/abort-scope.js").AbortScope | null
  >;
  isAbortingRef: React.MutableRefObject<boolean>;
  supervisorRef: React.MutableRefObject<
    import("../agent/supervisor.js").TurnSupervisor
  >;
  setQueue: React.Dispatch<
    React.SetStateAction<Array<{ full: string; display: string; key: string }>>
  >;
  saveSessionSafe: () => Promise<void>;
  setTasks: React.Dispatch<
    React.SetStateAction<import("../tasks-state.js").Task[]>
  >;
  setTasksStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setTasksStartTokens: React.Dispatch<React.SetStateAction<number>>;
  tasksRef: React.MutableRefObject<import("../tasks-state.js").Task[]>;
  lspManagerRef: React.MutableRefObject<import("../lsp/manager.js").LspManager>;
  setOverlay: React.Dispatch<React.SetStateAction<any>>;
  overlay: any;
  showLspWizard: boolean;
  commandWizard: { mode: "create" | "edit"; initial?: CustomCommand } | null;
  resumeSessions: import("../sessions.js").SessionSummary[] | null;
  checkpointSession: import("../sessions.js").SessionSummary | null;
  lastEscapeAtRef: React.MutableRefObject<number>;
  setShowReasoning: React.Dispatch<React.SetStateAction<boolean>>;
  setMode: React.Dispatch<React.SetStateAction<import("../mode.js").Mode>>;
  nextMode: (m: import("../mode.js").Mode) => import("../mode.js").Mode;
  setVerbose: React.Dispatch<React.SetStateAction<boolean>>;
  exit: () => void;
}

export interface InputCoordinatorResult {
  activePicker: ActivePicker | null;
  filteredFileItems: FilePickerItem[];
  filteredSlashItems: SlashItem[];
  pickerQuery: string | null;
  handlePickerUp: () => void;
  handlePickerDown: () => void;
  handlePickerSelect: () => void;
  handlePickerCancel: () => void;
  handleKeyPress: (inputChar: string, key: InkKey) => void;
}

export function useInputCoordinator(
  ctx: InputCoordinatorCtx,
): InputCoordinatorResult {
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [filePickerItems, setFilePickerItems] = useState<FilePickerItem[]>([]);
  const filePickerLoadedRef = useRef(false);
  const pickerCancelRef = useRef<number | null>(null);

  const pickerAnchor = activePicker?.anchor ?? null;
  const pickerKind = activePicker?.kind ?? null;

  const pickerQuery = useMemo(() => {
    if (pickerAnchor === null) return null;
    return ctx.input.slice(pickerAnchor + 1, ctx.cursorOffset);
  }, [ctx.input, ctx.cursorOffset, pickerAnchor]);

  const filteredFileItems = useMemo(() => {
    if (pickerKind !== "file" || pickerQuery === null) return [];
    const items = filterPickerItems(filePickerItems, pickerQuery).slice();
    return items.sort((a, b) => {
      const aRecent = ctx.recentFilesRef.current.get(a.name) ?? 0;
      const bRecent = ctx.recentFilesRef.current.get(b.name) ?? 0;
      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      if (aRecent && bRecent) return bRecent - aRecent;
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [pickerKind, filePickerItems, pickerQuery, ctx.recentFilesRef]);

  const allSlashCommands = useMemo<SlashItem[]>(() => {
    const customs: SlashItem[] = ctx.customCommandsRef.current
      .filter((c) => !BUILTIN_COMMAND_NAMES.has(c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        description: c.description ?? "",
        source: c.source,
      }));
    return [...BUILTIN_COMMANDS, ...customs];
  }, [ctx.customCommandsRef, ctx.customCommandsVersion]);

  const filteredSlashItems = useMemo(() => {
    if (pickerKind !== "slash" || pickerQuery === null) return [];
    return fuzzyFilter(allSlashCommands, pickerQuery, (c) => c.name).slice(
      0,
      50,
    );
  }, [pickerKind, allSlashCommands, pickerQuery]);

  // Open / close picker based on input changes
  useEffect(() => {
    if (activePicker !== null) {
      const trigger = activePicker.kind === "file" ? "@" : "/";
      if (ctx.cursorOffset < activePicker.anchor) {
        setActivePicker(null);
        return;
      }
      if (ctx.input[activePicker.anchor] !== trigger) {
        setActivePicker(null);
        return;
      }
      const query = ctx.input.slice(activePicker.anchor + 1, ctx.cursorOffset);
      if (/\s/.test(query)) {
        setActivePicker(null);
        return;
      }
      return;
    }

    if (pickerCancelRef.current === ctx.cursorOffset) {
      pickerCancelRef.current = null;
      return;
    }

    if (
      ctx.filePickerEnabled &&
      shouldOpenMentionPicker(
        ctx.input,
        ctx.cursorOffset,
        pickerCancelRef.current,
      )
    ) {
      setActivePicker({
        kind: "file",
        anchor: ctx.cursorOffset - 1,
        selected: 0,
      });
      if (!filePickerLoadedRef.current) {
        filePickerLoadedRef.current = true;
        const cwd = process.cwd();
        void fg("**/*", {
          cwd,
          ignore: buildFilePickerIgnoreList(cwd),
          dot: false,
          absolute: false,
          onlyFiles: false,
          markDirectories: true,
        } as fg.Options)
          .then((entries) => {
            const strings = (entries as string[]).slice(0, 300);
            const items: FilePickerItem[] = strings.map((e) => ({
              name: e.endsWith("/") ? e.slice(0, -1) : e,
              isDirectory: e.endsWith("/"),
            }));
            items.sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1;
              if (!a.isDirectory && b.isDirectory) return 1;
              return a.name.localeCompare(b.name);
            });
            setFilePickerItems(items);
          })
          .catch(() => {
            setFilePickerItems([]);
          });
      }
      return;
    }

    if (
      shouldOpenSlashPicker(
        ctx.input,
        ctx.cursorOffset,
        pickerCancelRef.current,
      )
    ) {
      setActivePicker({
        kind: "slash",
        anchor: ctx.cursorOffset - 1,
        selected: 0,
      });
      return;
    }
  }, [ctx.input, ctx.cursorOffset, activePicker, ctx.filePickerEnabled]);

  // Clamp selected index when filtered list shrinks
  useEffect(() => {
    if (activePicker?.kind !== "file") return;
    const max = Math.max(0, filteredFileItems.length - 1);
    if (activePicker.selected > max) {
      setActivePicker({ ...activePicker, selected: max });
    }
  }, [filteredFileItems.length, activePicker]);

  useEffect(() => {
    if (activePicker?.kind !== "slash") return;
    const max = Math.max(0, filteredSlashItems.length - 1);
    if (activePicker.selected > max) {
      setActivePicker({ ...activePicker, selected: max });
    }
  }, [filteredSlashItems.length, activePicker]);

  // Close picker when modal takes over input
  useEffect(() => {
    const modalActive =
      ctx.commandWizard !== null ||
      ctx.overlay.kind === "commandPicker" ||
      ctx.overlay.kind === "commandDelete" ||
      ctx.overlay.kind === "commandList" ||
      ctx.showLspWizard ||
      ctx.resumeSessions !== null ||
      ctx.checkpointSession !== null ||
      ctx.overlay.kind === "permission" ||
      ctx.overlay.kind === "limitModal";
    if (modalActive && activePicker !== null) {
      setActivePicker(null);
    }
  }, [
    ctx.commandWizard,
    ctx.overlay,
    ctx.showLspWizard,
    ctx.resumeSessions,
    ctx.checkpointSession,
    activePicker,
  ]);

  const handlePickerUp = useCallback(() => {
    setActivePicker((p) => {
      if (!p) return null;
      const next = Math.max(0, p.selected - 1);
      return next === p.selected ? p : { ...p, selected: next };
    });
  }, []);

  const handlePickerDown = useCallback(() => {
    setActivePicker((p) => {
      if (!p) return null;
      const max =
        p.kind === "file"
          ? Math.max(0, filteredFileItems.length - 1)
          : Math.max(0, filteredSlashItems.length - 1);
      const next = Math.min(max, p.selected + 1);
      return next === p.selected ? p : { ...p, selected: next };
    });
  }, [filteredFileItems.length, filteredSlashItems.length]);

  const handlePickerSelect = useCallback(() => {
    if (!activePicker) return;
    if (activePicker.kind === "file") {
      const item = filteredFileItems[activePicker.selected];
      if (!item) return;
      trackRecentFile(ctx.recentFilesRef, item.name, ctx.maxRecentFiles);
      const insert = item.name + (item.isDirectory ? "/" : " ");
      const newInput =
        ctx.input.slice(0, activePicker.anchor) +
        insert +
        ctx.input.slice(ctx.cursorOffset);
      ctx.setInput(newInput);
      ctx.setCursorOffset(activePicker.anchor + insert.length);
      setActivePicker(null);
      return;
    }
    const item = filteredSlashItems[activePicker.selected];
    if (!item) return;
    const { value } = insertSlashCommand(
      ctx.input,
      activePicker.anchor,
      item.name,
    );
    setActivePicker(null);
    ctx.submitRef.current(value);
  }, [
    activePicker,
    filteredFileItems,
    filteredSlashItems,
    ctx.input,
    ctx.cursorOffset,
    ctx.recentFilesRef,
    ctx.maxRecentFiles,
    ctx.setInput,
    ctx.setCursorOffset,
    ctx.submitRef,
  ]);

  const handlePickerCancel = useCallback(() => {
    pickerCancelRef.current = ctx.cursorOffset;
    setActivePicker(null);
  }, [ctx.cursorOffset]);

  const handleKeyPress = useCallback(
    (inputChar: string, key: InkKey) => {
      if (key.ctrl && inputChar === "c") {
        const hadPerm = ctx.permResolveRef.current !== null;
        const hadLimit = ctx.limitResolveRef.current !== null;
        if (hadPerm) {
          ctx.permResolveRef.current!("deny");
          ctx.permResolveRef.current = null;
          ctx.setOverlay({ kind: "none" });
        }
        if (hadLimit) {
          ctx.limitResolveRef.current!("stop");
          ctx.limitResolveRef.current = null;
          ctx.setOverlay({ kind: "none" });
        }
        if (
          ctx.busyRef.current &&
          ctx.activeScopeRef.current &&
          !ctx.isAbortingRef.current
        ) {
          ctx.isAbortingRef.current = true;
          ctx.supervisorRef.current.killTurn();
          ctx.activeScopeRef.current.abort("user_stopped");
          ctx.setQueue([]);
          ctx.setEvents((e) => [
            ...e,
            { kind: "info", key: ctx.mkKey(), text: "(interrupted)" },
          ]);
          void ctx.saveSessionSafe();
          ctx.setTasks([]);
          ctx.setTasksStartedAt(null);
          ctx.setTasksStartTokens(0);
          ctx.tasksRef.current = [];
        } else if (!hadPerm && !hadLimit) {
          void ctx.lspManagerRef.current.stopAll().finally(() => ctx.exit());
        }
        return;
      }

      if (key.escape) {
        const now = Date.now();
        const modalOpen =
          ctx.overlay.kind === "permission" ||
          ctx.overlay.kind === "limitModal" ||
          ctx.showLspWizard ||
          ctx.overlay.kind === "commandList" ||
          ctx.commandWizard !== null ||
          ctx.overlay.kind === "commandDelete" ||
          ctx.resumeSessions !== null ||
          ctx.checkpointSession !== null ||
          ctx.overlay.kind === "themePicker";
        if (
          !modalOpen &&
          ctx.busyRef.current &&
          ctx.activeScopeRef.current &&
          !ctx.isAbortingRef.current &&
          now - ctx.lastEscapeAtRef.current > 500
        ) {
          ctx.lastEscapeAtRef.current = now;
          ctx.isAbortingRef.current = true;
          ctx.supervisorRef.current.killTurn();
          if (ctx.permResolveRef.current) {
            ctx.permResolveRef.current("deny");
            ctx.permResolveRef.current = null;
            ctx.setOverlay({ kind: "none" });
          }
          if (ctx.limitResolveRef.current) {
            ctx.limitResolveRef.current("stop");
            ctx.limitResolveRef.current = null;
            ctx.setOverlay({ kind: "none" });
          }
          ctx.activeScopeRef.current.abort("user_stopped");
          ctx.setQueue([]);
          ctx.setEvents((e) => [
            ...e,
            { kind: "info", key: ctx.mkKey(), text: "(interrupted)" },
          ]);
          ctx.setTasks([]);
          ctx.setTasksStartedAt(null);
          ctx.setTasksStartTokens(0);
          ctx.tasksRef.current = [];
          return;
        }
      }

      if (key.ctrl && inputChar === "r") {
        ctx.setShowReasoning((s) => !s);
        return;
      }
      if (key.shift && key.tab) {
        ctx.setMode((m) => ctx.nextMode(m));
        return;
      }
      if (key.ctrl && inputChar === "o") {
        ctx.setVerbose((v) => !v);
        return;
      }
    },
    [ctx],
  );

  return {
    activePicker,
    filteredFileItems,
    filteredSlashItems,
    pickerQuery,
    handlePickerUp,
    handlePickerDown,
    handlePickerSelect,
    handlePickerCancel,
    handleKeyPress,
  };
}
