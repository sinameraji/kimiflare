import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";
import { runSpecialistTurn } from "../agent/specialist.js";

export const delegateToCoderTool: ToolSpec<{
  task: string;
  files?: string[];
  constraints?: string;
}> = {
  name: "delegate_to_coder",
  needsPermission: false,
  description:
    "Delegate a coding task to the coding specialist. Use this when the user needs code written, modified, debugged, or reviewed. The specialist will return the implementation summary and any artifacts.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "What the coder should implement. Be specific about the expected outcome.",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Optional file paths the coder should read or modify.",
      },
      constraints: {
        type: "string",
        description: "Optional constraints like 'don't touch the public API' or 'keep backward compatibility'.",
      },
    },
    required: ["task"],
  },
  async run(args, ctx: ToolContext): Promise<ToolOutput> {
    const result = await runSpecialistTurn({
      persona: "coding",
      task: args.task,
      files: args.files,
      constraints: args.constraints,
      allTools: ctx.allTools ?? [],
      accountId: ctx.accountId ?? "",
      apiToken: ctx.apiToken ?? "",
      model: ctx.model ?? "",
      gateway: ctx.gateway,
      executor: ctx.executor!,
      cwd: ctx.cwd,
      signal: ctx.signal ?? new AbortController().signal,
      temperature: 0.2,
      codeMode: ctx.codeMode,
      onFileChange: ctx.onFileChange,
      callbacks: { askPermission: async () => "allow" },
    });
    return {
      content: JSON.stringify(result, null, 2),
      rawBytes: 0,
      reducedBytes: 0,
    };
  },
};
