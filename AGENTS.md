# Agent Instructions

## Memory System

The memory system uses SQLite with embeddings for persistent cross-session context.

- Memories are extracted automatically after tool executions
- Use `memory_remember` to store facts explicitly
- Use `memory_recall` to search past context
- The database lives at `.kimiflare/memory.db` by default

## Code Style

- ESM only — always use `import` / `export`
- Import paths must include `.js` even for `.ts` files
- Node built-ins must use `node:` prefix
- Prefer `async/await` over raw Promises
- Use `type` imports where possible

## Agent Loop

The agent loop in `src/agent/loop.ts` handles:
- Streaming SSE responses from Cloudflare Workers AI
- Tool call dispatch via `tools/executor.ts`
- Budget exhaustion via `BudgetExhaustedError`
- Code mode for TypeScript sandbox execution
