import type { ToolSpec, ToolContext, PlanOption } from "./registry.js";

interface PresentPlanOptionsArgs {
  options: PlanOption[];
}

function validatePlanOptions(input: unknown): PlanOption[] {
  if (!Array.isArray(input)) throw new Error("options must be an array");
  return input.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`options[${i}] must be an object`);
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    if (!label) throw new Error(`options[${i}].label is required`);
    const plan = typeof rec.plan === "string" ? rec.plan.trim() : "";
    if (!plan) throw new Error(`options[${i}].plan is required`);
    return { label, plan };
  });
}

export const presentPlanOptionsTool: ToolSpec<PresentPlanOptionsArgs> = {
  name: "present_plan_options",
  description: [
    "Present a list of plan options to the user and let them pick one.",
    "Use this when you have multiple viable approaches and want the user to choose",
    "which plan to pursue. Each option needs a short label and the full plan text.",
    "After the user selects an option, the session resets and starts fresh with the chosen plan.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      options: {
        type: "array",
        description: "The list of plan options to present to the user.",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Short human-readable label for this option (shown in the picker).",
            },
            plan: {
              type: "string",
              description: "The full plan text that will seed the new session if this option is chosen.",
            },
          },
          required: ["label", "plan"],
        },
      },
    },
    required: ["options"],
  },
  needsPermission: false,
  run: async (args, ctx: ToolContext) => {
    const options = validatePlanOptions(args.options);
    ctx.onPlanOptions?.(options);
    return `Presented ${options.length} plan option(s) to the user.`;
  },
};
