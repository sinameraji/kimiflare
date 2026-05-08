import { loadCustomCommands } from "../commands/loader.js";
import { BUILTIN_COMMAND_NAMES } from "../commands/builtins.js";
import type { CustomCommand } from "../commands/types.js";
import type { ChatEvent } from "../ui/chat.js";
import { mkKey } from "../util/event-helpers.js";

export async function reloadCustomCommands(
  customCommandsRef: React.MutableRefObject<CustomCommand[]>,
  setCustomCommandsVersion: React.Dispatch<React.SetStateAction<number>>,
  appendEvent: (ev: ChatEvent) => void,
): Promise<void> {
  const { commands, warnings } = await loadCustomCommands(process.cwd());
  customCommandsRef.current = commands;
  setCustomCommandsVersion((v) => v + 1);
  for (const w of warnings) {
    appendEvent({
      kind: "info",
      key: mkKey(),
      text: `commands: ${w}`,
    });
  }
  const shadowed = commands.filter((c) =>
    BUILTIN_COMMAND_NAMES.has(c.name.toLowerCase()),
  );
  for (const c of shadowed) {
    appendEvent({
      kind: "info",
      key: mkKey(),
      text: `commands: /${c.name} (${c.filepath}) shadowed by built-in — will not run`,
    });
  }
}

export interface SaveCommandCtx {
  commandWizard: { mode: "edit" | "create"; initial?: CustomCommand } | null;
  setCommandWizard: React.Dispatch<
    React.SetStateAction<{
      mode: "edit" | "create";
      initial?: CustomCommand;
    } | null>
  >;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  mkKey: () => string;
  reloadCustomCommands: () => Promise<void>;
}

export async function handleCommandSave(
  ctx: SaveCommandCtx,
  opts: import("../commands/save.js").SaveCustomCommandOptions,
): Promise<void> {
  const {
    commandWizard,
    setCommandWizard,
    setEvents,
    mkKey,
    reloadCustomCommands,
  } = ctx;
  setCommandWizard(null);
  try {
    // If editing and name changed, delete the old file first
    if (
      commandWizard?.mode === "edit" &&
      commandWizard.initial &&
      commandWizard.initial.name !== opts.name
    ) {
      const { deleteCustomCommand } = await import("../commands/save.js");
      await deleteCustomCommand(commandWizard.initial);
    }
    const { saveCustomCommand } = await import("../commands/save.js");
    const result = await saveCustomCommand(opts);
    await reloadCustomCommands();
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `saved /${opts.name} → ${result.filepath}`,
      },
    ]);
  } catch (err) {
    setEvents((e) => [
      ...e,
      {
        kind: "error",
        key: mkKey(),
        text: `failed to save /${opts.name}: ${(err as Error).message}`,
      },
    ]);
  }
}

export interface DeleteCommandCtx {
  setOverlay: (v: { kind: "none" }) => void;
  setEvents: (updater: React.SetStateAction<ChatEvent[]>) => void;
  mkKey: () => string;
  reloadCustomCommands: () => Promise<void>;
}

export async function handleCommandDelete(
  ctx: DeleteCommandCtx,
  cmd: CustomCommand,
): Promise<void> {
  const { setOverlay, setEvents, mkKey, reloadCustomCommands } = ctx;
  setOverlay({ kind: "none" });
  try {
    const { deleteCustomCommand } = await import("../commands/save.js");
    await deleteCustomCommand(cmd);
    await reloadCustomCommands();
    setEvents((e) => [
      ...e,
      {
        kind: "info",
        key: mkKey(),
        text: `deleted /${cmd.name} (${cmd.filepath})`,
      },
    ]);
  } catch (err) {
    setEvents((e) => [
      ...e,
      {
        kind: "error",
        key: mkKey(),
        text: `failed to delete /${cmd.name}: ${(err as Error).message}`,
      },
    ]);
  }
}
