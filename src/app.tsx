// Ink TUI entry point — will be fleshed out next. Minimal stub so that
// `kimi` (without -p) doesn't crash while the TUI is still being built.

export async function renderApp(_cfg: { accountId: string; apiToken: string; model: string }) {
  console.error("kimi-code: interactive TUI not yet wired in this build. Use `kimi -p \"...\"` for now.");
  process.exit(1);
}
