import type { ToolSpec } from "./registry.js";
import { ToolArtifactStore } from "./artifact-store.js";

interface Args {
  artifact_id: string;
}

export function makeExpandArtifactTool(store: ToolArtifactStore): ToolSpec<Args> {
  return {
    name: "expand_artifact",
    description:
      "Retrieve the full raw content of a previously reduced tool output by its artifact ID. Use this when the compact summary is insufficient and you need the complete original output.",
    parameters: {
      type: "object",
      properties: {
        artifact_id: {
          type: "string",
          description: "The artifact ID from a reduced tool output footer, e.g. art_42.",
        },
      },
      required: ["artifact_id"],
      additionalProperties: false,
    },
    needsPermission: false,
    render: (args) => ({ title: `expand ${args.artifact_id ?? ""}` }),
    run: async (args): Promise<string> => {
      const raw = store.retrieve(args.artifact_id);
      if (!raw) {
        return `Artifact "${args.artifact_id}" not found. It may have been evicted from memory. Re-run the original tool to regenerate the output.`;
      }
      const MAX_EXPAND_CHARS = 20_000;
      if (raw.length <= MAX_EXPAND_CHARS) {
        return raw;
      }
      return (
        raw.slice(0, MAX_EXPAND_CHARS) +
        `\n\n[truncated: ${raw.length - MAX_EXPAND_CHARS} chars omitted. The artifact is very large; consider using a more specific tool query instead of expanding the full content.]`
      );
    },
  };
}
