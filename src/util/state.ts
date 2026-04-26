import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface StateFile {
  creatorMessageSeenVersion?: string;
}

function statePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "state.json");
}

export async function readState(): Promise<StateFile> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as StateFile;
  } catch {
    return {};
  }
}

export async function writeState(state: StateFile): Promise<void> {
  const path = statePath();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function markCreatorMessageSeen(version: string): Promise<void> {
  const state = await readState();
  state.creatorMessageSeenVersion = version;
  await writeState(state);
}

export async function shouldShowCreatorMessage(version: string): Promise<boolean> {
  const state = await readState();
  return state.creatorMessageSeenVersion !== version;
}
