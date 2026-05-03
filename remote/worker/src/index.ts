import { Hono } from "hono";
import type { Env } from "./types.js";
import { SessionDO } from "./session-do.js";

const app = new Hono<{ Bindings: Env }>();

// Auth middleware — only for CLI-facing endpoints
app.use("/remote/start", async (c, next) => {
  const auth = c.req.header("Authorization");
  const expected = `Bearer ${c.env.REMOTE_AUTH_SECRET}`;
  if (auth !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/remote/cancel/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  const expected = `Bearer ${c.env.REMOTE_AUTH_SECRET}`;
  if (auth !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// Start a remote session
app.post("/remote/start", async (c) => {
  const body = await c.req.json();
  const sessionId = crypto.randomUUID();
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const res = await doStub.fetch(new Request("http://internal/start", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }));

  const data = await res.json();
  return c.json({ ...data, sessionId });
});

// Stream progress (SSE)
app.get("/remote/stream/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const res = await doStub.fetch(new Request("http://internal/stream", {
    method: "GET",
  }));

  return res;
});

// Cancel session
app.post("/remote/cancel/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const res = await doStub.fetch(new Request("http://internal/cancel", {
    method: "POST",
  }));

  return res;
});

// Get session status
app.get("/remote/status/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const res = await doStub.fetch(new Request("http://internal/status", {
    method: "GET",
  }));

  return res;
});

// Receive progress from Sandbox
app.post("/progress/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const body = await c.req.json();
  const res = await doStub.fetch(new Request("http://internal/progress", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }));

  return res;
});

// Finalize session (from Sandbox)
app.post("/finalize/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const body = await c.req.json();
  const res = await doStub.fetch(new Request("http://internal/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }));

  return res;
});

// LLM relay (from Sandbox)
app.post("/relay", async (c) => {
  const sessionId = c.req.header("X-Session-Id");
  if (!sessionId) {
    return c.json({ error: "Missing X-Session-Id header" }, 400);
  }

  const id = c.env.SESSION_DO.idFromName(sessionId);
  const doStub = c.env.SESSION_DO.get(id);

  const body = await c.req.json();
  const res = await doStub.fetch(new Request("http://internal/relay", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }));

  return res;
});

// CORS for web status page and SSE streams
app.use("/remote/stream/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  await next();
});
app.use("/remote/web/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  await next();
});

// Web status page
app.get("/remote/web/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const streamUrl = `/remote/stream/${sessionId}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>kimiflare remote — ${sessionId}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #c9d1d9; }
    h1 { font-size: 1.25rem; color: #58a6ff; }
    .event { padding: 0.5rem; margin: 0.25rem 0; border-radius: 6px; background: #161b22; font-family: monospace; font-size: 0.875rem; }
    .event.turn_start { border-left: 3px solid #58a6ff; }
    .event.tool_call { border-left: 3px solid #f0883e; }
    .event.tool_result { border-left: 3px solid #3fb950; }
    .event.error { border-left: 3px solid #f85149; }
    .event.done { border-left: 3px solid #3fb950; background: #23863620; }
    .status { padding: 1rem; background: #161b22; border-radius: 8px; margin-bottom: 1rem; }
    .status.running { border: 1px solid #58a6ff; }
    .status.done { border: 1px solid #3fb950; }
    .status.error { border: 1px solid #f85149; }
  </style>
</head>
<body>
  <h1>🔥 kimiflare remote</h1>
  <div id="status" class="status running">Connecting...</div>
  <div id="events"></div>
  <script>
    const sessionId = "${sessionId}";
    const streamUrl = "${streamUrl}";
    const eventsDiv = document.getElementById("events");
    const statusDiv = document.getElementById("status");
    const evtSource = new EventSource(streamUrl);

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const div = document.createElement("div");
      div.className = "event " + data.type;
      div.textContent = JSON.stringify(data);
      eventsDiv.appendChild(div);
      window.scrollTo(0, document.body.scrollHeight);

      if (data.type === "done") {
        statusDiv.textContent = "✅ Done" + (data.prUrl ? " — PR: " + data.prUrl : "");
        statusDiv.className = "status done";
        evtSource.close();
      } else if (data.type === "error") {
        statusDiv.textContent = "❌ Error: " + data.message;
        statusDiv.className = "status error";
      } else if (data.type === "cancelled") {
        statusDiv.textContent = "🛑 Cancelled";
        statusDiv.className = "status error";
      }
    };

    evtSource.onerror = () => {
      statusDiv.textContent = "⚠️ Connection lost — reconnecting...";
    };
  </script>
</body>
</html>`;

  return c.html(html);
});

// Health check
app.get("/health", (c) => c.json({ ok: true }));

export default app;
export { SessionDO };
