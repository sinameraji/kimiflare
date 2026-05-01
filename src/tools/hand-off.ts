import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";

export const handOffTool: ToolSpec<{ target: string; reason?: string }> = {
  name: "hand_off",
  needsPermission: false,
  description:
    `Signal that your work is complete and request a hand-off to another agent. ` +
    `Use this when you have produced your deliverable (Research Brief, Implementation Notes, etc.) ` +
    `and the next agent should take over.\n\n` +
    `Parameters:\n` +
    `- target: the agent to hand off to (e.g., "coding", "generalist")\n` +
    `- reason: optional one-sentence summary of what was completed`,
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: 'Agent to hand off to: "coding", "generalist", or another agent role',
      },
      reason: {
        type: "string",
        description: "One-sentence summary of what was completed and why hand-off is appropriate",
      },
    },
    required: ["target"],
    additionalProperties: false,
  },
  async run(args, _ctx): Promise<ToolOutput> {
    const target = args.target;
    const reason = args.reason ?? "";
    return {
      content: `Hand-off requested to ${target} agent.${reason ? ` Reason: ${reason}` : ""}`,
      rawBytes: 0,
      reducedBytes: 0,
    };
  },
};
