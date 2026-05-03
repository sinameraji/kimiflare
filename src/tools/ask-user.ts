import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";

export const askUserTool: ToolSpec<{
  question: string;
  options?: string[];
  reason?: string;
}> = {
  name: "ask_user",
  needsPermission: false,
  description:
    "Ask the user a question when you need a decision you can't make alone, when a specialist returned status 'blocked', when you've used 35+ tool calls and want to check in, or when you've hit the 50-tool limit. This is the ONLY way to pause for user input. The turn ends here and resumes with the user's response.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user. Be direct and specific.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of choices for the user. If provided, the user can pick one.",
      },
      reason: {
        type: "string",
        description: "Why you're asking (for logs). Example: 'tool iteration budget exhausted' or 'specialist blocked on missing API key'.",
      },
    },
    required: ["question"],
  },
  async run(args, ctx: ToolContext): Promise<ToolOutput> {
    // This tool is handled specially by the app layer.
    // The executor should never actually call this — app.tsx intercepts it.
    return {
      content: `ask_user intercepted: ${args.question}`,
      rawBytes: 0,
      reducedBytes: 0,
    };
  },
};
