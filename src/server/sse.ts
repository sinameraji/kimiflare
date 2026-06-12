/**
 * Server-Sent Events (SSE) stream handler.
 */

import type { ServerResponse } from "node:http";

export interface SseClient {
  send(event: string, data: Record<string, unknown>): void;
  close(): void;
}

export function createSseStream(res: ServerResponse): SseClient {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(":heartbeat\n\n");
  }, 30000);

  res.on("close", () => {
    clearInterval(heartbeat);
  });

  return {
    send(event: string, data: Record<string, unknown>) {
      const payload = JSON.stringify(data);
      res.write(`event: ${event}\n`);
      res.write(`data: ${payload}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      res.end();
    },
  };
}
