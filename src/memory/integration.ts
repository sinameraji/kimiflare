import type { ChatMessage } from "../agent/messages.js";
import type { AiGatewayOptions } from "../agent/client.js";
import { extractMemories } from "./extraction.js";
import { MemoryManager } from "./manager.js";

export interface MemoryCompactionOpts {
  manager: MemoryManager;
  messages: ChatMessage[];
  removedCount: number;
  sessionId: string;
  repoPath: string;
  accountId: string;
  apiToken: string;
  model: string;
  signal?: AbortSignal;
  gateway?: AiGatewayOptions;
}

export async function extractAndStoreMemories(opts: MemoryCompactionOpts): Promise<number> {
  if (!opts.manager.isOpen()) return 0;
  if (opts.removedCount <= 0) return 0;

  // The removed messages are the first N messages after any system prefix
  let prefixEnd = 0;
  while (prefixEnd < opts.messages.length && opts.messages[prefixEnd]!.role === "system") {
    prefixEnd++;
  }

  const removedMessages = opts.messages.slice(prefixEnd, prefixEnd + opts.removedCount);
  if (removedMessages.length === 0) return 0;

  try {
    const memories = await extractMemories({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages: removedMessages,
      sessionId: opts.sessionId,
      repoPath: opts.repoPath,
      signal: opts.signal,
      gateway: opts.gateway,
    });

    if (memories.length > 0) {
      return await opts.manager.storeMemories(memories);
    }
  } catch {
    // Memory extraction is best-effort; don't fail compaction
  }

  return 0;
}
