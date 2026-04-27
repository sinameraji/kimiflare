import type { Mode } from "../mode.js";
import type { ReasoningEffort } from "../config.js";

export type CommandSource = "project" | "global";

export type CustomCommand = {
  name: string;
  description?: string;
  template: string;
  source: CommandSource;
  filepath: string;
  mode?: Mode;
  model?: string;
  effort?: ReasoningEffort;
};

export type RenderResult = {
  prompt: string;
  warnings: string[];
};

export type LoadResult = {
  commands: CustomCommand[];
  warnings: string[];
};
