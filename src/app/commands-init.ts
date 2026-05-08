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
