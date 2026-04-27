import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import fg from "fast-glob";
import { MODES, type Mode } from "../mode.js";
import { EFFORTS, type ReasoningEffort } from "../config.js";
import { isPathOutside } from "../util/paths.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { CommandSource, CustomCommand, LoadResult } from "./types.js";

const MAX_COMMAND_FILE_BYTES = 256 * 1024;

export function projectCommandsDir(cwd: string = process.cwd()): string {
  return join(cwd, ".kimiflare", "commands");
}

export function globalCommandsDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "commands");
}

export async function loadCustomCommands(
  cwd: string = process.cwd(),
): Promise<LoadResult> {
  const warnings: string[] = [];
  const byName = new Map<string, CustomCommand>();

  const sources: Array<{ dir: string; source: CommandSource }> = [
    { dir: globalCommandsDir(), source: "global" },
    { dir: projectCommandsDir(cwd), source: "project" },
  ];

  const perSource = await Promise.all(
    sources.map(async ({ dir, source }) => {
      const safeDir = await resolveSafeDir(dir, source, cwd, warnings);
      if (safeDir === null) return [] as Array<CustomCommand | null>;
      const files = await fg("**/*.md", {
        cwd: safeDir,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        suppressErrors: true,
      });
      return Promise.all(files.map((file) => loadOne(file, safeDir, source, warnings)));
    }),
  );
  for (const loaded of perSource) {
    for (const cmd of loaded) {
      if (cmd) byName.set(cmd.name, cmd);
    }
  }

  return {
    commands: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

async function resolveSafeDir(
  dir: string,
  source: CommandSource,
  cwd: string,
  warnings: string[],
): Promise<string | null> {
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      warnings.push(`commands dir ${dir} unreadable: ${(err as Error).message}`);
    }
    return null;
  }
  if (source === "project") {
    let realCwd: string;
    try {
      realCwd = await realpath(cwd);
    } catch {
      return null;
    }
    const rel = relative(realCwd, realDir);
    if (rel !== "" && isPathOutside(rel)) {
      warnings.push(`commands dir ${dir} escapes workspace via symlink — skipped`);
      return null;
    }
  }
  return realDir;
}

async function loadOne(
  file: string,
  rootDir: string,
  source: CommandSource,
  warnings: string[],
): Promise<CustomCommand | null> {
  let content: string;
  try {
    const handle = await open(file, "r");
    try {
      const stats = await handle.stat();
      if (stats.size > MAX_COMMAND_FILE_BYTES) {
        warnings.push(`command file ${file} exceeds ${MAX_COMMAND_FILE_BYTES} bytes — skipped`);
        return null;
      }
      content = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (e) {
    warnings.push(`failed to read command file ${file}: ${(e as Error).message}`);
    return null;
  }

  const name = filenameToCommandName(file, rootDir);
  if (!name) {
    warnings.push(`invalid command name from ${file}`);
    return null;
  }

  const { data, body, errors } = parseFrontmatter(content);
  if (errors.length > 0) {
    warnings.push(`frontmatter errors in ${file}: ${errors.join("; ")} — skipped`);
    return null;
  }

  const cmd: CustomCommand = {
    name,
    template: body,
    source,
    filepath: file,
  };
  if (data.description) cmd.description = data.description;

  const modeRaw = data.mode ?? data.agent;
  if (modeRaw !== undefined) {
    const normalized = modeRaw === "build" ? "edit" : modeRaw;
    if ((MODES as readonly string[]).includes(normalized)) {
      cmd.mode = normalized as Mode;
    } else {
      warnings.push(`unknown mode "${modeRaw}" in ${file} — ignored`);
    }
  }

  if (data.model !== undefined && data.model !== "") {
    cmd.model = data.model;
  }

  if (data.effort !== undefined) {
    if ((EFFORTS as readonly string[]).includes(data.effort)) {
      cmd.effort = data.effort as ReasoningEffort;
    } else {
      warnings.push(`unknown effort "${data.effort}" in ${file} — ignored`);
    }
  }

  return cmd;
}

export function filenameToCommandName(file: string, rootDir: string): string | null {
  const rel = relative(rootDir, file);
  if (!rel || isPathOutside(rel)) return null;
  const noExt = rel.replace(/\.md$/i, "");
  const parts = noExt.split(sep).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((p) => !/^[\w.-]+$/.test(p))) return null;
  return parts.join("/");
}
