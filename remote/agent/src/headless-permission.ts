import type { PermissionAsker, PermissionDecision } from "../../../src/tools/executor.js";

/**
 * Headless permission handler that auto-approves all tool calls.
 * Used inside the Sandbox where there is no interactive user.
 */
export const headlessPermissionAsker: PermissionAsker = async () => "allow";
