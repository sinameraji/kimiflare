// Minimal SSE reader that yields the payload of each `data:` event.
// Handles:
//  - line splits across chunk boundaries
//  - multi-line data (rfc says concatenate with \n)
//  - CRLF or LF line endings
//  - events that don't start with `data:` (ignored)
// Does NOT handle retry / event-id / named events — we don't need them.

export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const onAbort = () => {
    try {
      reader.cancel(new DOMException("aborted", "AbortError"));
    } catch {
      /* reader may already be closed */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = extractData(event);
        if (data !== null) yield data;
      }
    }
    // Flush any final event without a trailing blank line.
    buffer += decoder.decode();
    const tail = extractData(buffer.trim());
    if (tail !== null) yield tail;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function extractData(event: string): string | null {
  if (!event) return null;
  const parts: string[] = [];
  for (const raw of event.split("\n")) {
    if (!raw.startsWith("data:")) continue;
    // SSE allows an optional single space after the colon.
    parts.push(raw.slice(5).replace(/^ /, ""));
  }
  return parts.length ? parts.join("\n") : null;
}
