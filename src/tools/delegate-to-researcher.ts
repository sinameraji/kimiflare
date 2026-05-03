import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";
import { runSpecialistTurn } from "../agent/specialist.js";

export const delegateToResearcherTool: ToolSpec<{
  task: string;
  sources?: string[];
  depth?: "quick" | "thorough";
}> = {
  name: "delegate_to_researcher",
  needsPermission: false,
  description:
    "Delegate a research task to the research specialist. Use this when the user needs information, comparison, evaluation, or investigation. The specialist will return structured findings.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "What the researcher should investigate. Be specific about what you need to know.",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "Optional URLs or file paths to prioritize.",
      },
      depth: {
        type: "string",
        enum: ["quick", "thorough"],
        description: "How deep the research should go. Default is quick for routine questions, thorough for complex topics.",
      },
    },
    required: ["task"],
  },
  async run(args, ctx: ToolContext): Promise<ToolOutput> {
    const result = await runSpecialistTurn({
      persona: "research",
      task: args.task,
      sources: args.sources,
      depth: args.depth,
      allTools: ctx.allTools ?? [],
      accountId: ctx.accountId ?? "",
      apiToken: ctx.apiToken ?? "",
      model: ctx.model ?? "",
      gateway: ctx.gateway,
      executor: ctx.executor!,
      cwd: ctx.cwd,
      signal: ctx.signal ?? new AbortController().signal,
      temperature: 0.2,
      callbacks: { askPermission: async () => "allow" },
    });
    return {
      content: JSON.stringify(result, null, 2),
      rawBytes: 0,
      reducedBytes: 0,
    };
  },
};
