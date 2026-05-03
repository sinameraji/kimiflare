/**
 * Headless permission handler — auto-approves all tool calls in remote mode.
 */
export function createHeadlessPermissionHandler() {
  return async (_toolName: string, _args: Record<string, unknown>): Promise<boolean> => {
    // In remote mode, we auto-approve everything. The user explicitly
    // chose to run remotely and can cancel via the TUI dashboard.
    return true;
  };
}
