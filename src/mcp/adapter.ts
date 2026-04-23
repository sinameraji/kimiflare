import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolSpec } from "../tools/registry.js";

export interface McpToolEntry {
  spec: ToolSpec;
  originalName: string;
  serverName: string;
}

export function mcpToolToSpec(
  serverName: string,
  mcpTool: {
    name: string;
    description?: string;
    inputSchema: {
      type: "object";
      properties?: Record<string, object>;
      required?: string[];
    };
  },
  client: Client,
): McpToolEntry {
  const prefix = `mcp_${sanitizeName(serverName)}_`;
  const prefixedName = `${prefix}${sanitizeName(mcpTool.name)}`;

  const spec: ToolSpec = {
    name: prefixedName,
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${serverName}`,
    parameters: mcpTool.inputSchema as Record<string, unknown>,
    needsPermission: true,
    render: () => ({ title: `${prefixedName}` }),
    async run(args) {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: args as Record<string, unknown>,
      });

      // Handle both standard and compatibility result shapes
      if ("content" in result && Array.isArray(result.content)) {
        const texts: string[] = [];
        for (const item of result.content) {
          if (typeof item === "object" && item !== null && "type" in item) {
            if (item.type === "text" && "text" in item && typeof item.text === "string") {
              texts.push(item.text);
            }
          }
        }
        return texts.join("\n");
      }

      if ("toolResult" in result) {
        return String(result.toolResult ?? "");
      }

      return "";
    },
  };

  return { spec, originalName: mcpTool.name, serverName };
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
