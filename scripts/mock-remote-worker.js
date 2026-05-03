#!/usr/bin/env node
/**
 * Mock remote Worker for local development.
 * Simulates the orchestrator endpoints without needing Cloudflare infra.
 *
 * Usage:
 *   node scripts/mock-remote-worker.js
 *
 * Then configure the CLI:
 *   kimiflare config remoteWorkerUrl http://localhost:8787
 *   kimiflare config remoteAuthSecret dev-secret
 */

import { createServer } from "node:http";

const PORT = 8787;
const AUTH_SECRET = "dev-secret";

const sessions = new Map();

function requireAuth(req, res) {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${AUTH_SECRET}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }
  return true;
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mock: true }));
    return;
  }

  // Start session
  if (path === "/remote/start" && req.method === "POST") {
    if (!requireAuth(req, res)) return;

    const body = await readBody(req);
    const sessionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    sessions.set(sessionId, {
      sessionId,
      status: "running",
      prompt: body.prompt,
      repo: body.repo,
      branch: `kimiflare/remote/${sessionId}`,
      progressEvents: [],
      maxTurns: body.maxTurns ?? 50,
      currentTurn: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: Date.now(),
    });

    // Simulate progress in background
    simulateSession(sessionId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        sessionId,
        streamUrl: `/remote/stream/${sessionId}`,
        status: "running",
      }),
    );
    return;
  }

  // Stream progress (SSE)
  if (path.startsWith("/remote/stream/") && req.method === "GET") {
    const sessionId = path.split("/").pop();
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send existing events
    for (const ev of session.progressEvents) {
      sendSSE(res, ev);
    }

    // Keep connection alive and send new events
    const interval = setInterval(() => {
      const s = sessions.get(sessionId);
      if (!s || s.status === "done" || s.status === "error") {
        clearInterval(interval);
        if (s?.status === "done") {
          sendSSE(res, { type: "done", prUrl: s.prUrl });
        } else if (s?.status === "error") {
          sendSSE(res, { type: "error", message: s.errorMessage });
        }
        res.end();
        return;
      }

      // Send heartbeat
      sendSSE(res, { type: "heartbeat" });
    }, 5000);

    req.on("close", () => {
      clearInterval(interval);
    });

    return;
  }

  // Cancel session
  if (path.startsWith("/remote/cancel/") && req.method === "POST") {
    if (!requireAuth(req, res)) return;

    const sessionId = path.split("/").pop();
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    session.status = "cancelled";
    session.finishedAt = Date.now();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "cancelled" }));
    return;
  }

  // Get session status
  if (path.startsWith("/remote/status/") && req.method === "GET") {
    const sessionId = path.split("/").pop();
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const { githubToken, apiToken, ...safe } = session;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(safe));
    return;
  }

  // Receive progress from Sandbox
  if (path.startsWith("/progress/") && req.method === "POST") {
    const sessionId = path.split("/").pop();
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const body = await readBody(req);
    for (const ev of body.events ?? []) {
      session.progressEvents.push(ev);
      if (ev.type === "turn_start" && typeof ev.turn === "number") {
        session.currentTurn = ev.turn;
      }
    }
    session.updatedAt = Date.now();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Finalize session
  if (path.startsWith("/finalize/") && req.method === "POST") {
    const sessionId = path.split("/").pop();
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const body = await readBody(req);
    session.status = "done";
    session.finishedAt = Date.now();
    session.prUrl = `https://github.com/${session.repo.owner}/${session.repo.name}/pull/1`;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "done", prUrl: session.prUrl }));
    return;
  }

  // LLM relay
  if (path === "/relay" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Mock relay: LLM calls are not supported in mock mode",
      }),
    );
    return;
  }

  // Web status page
  if (path.startsWith("/remote/web/") && req.method === "GET") {
    const sessionId = path.split("/").pop();
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>kimiflare remote (MOCK) — ${sessionId}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #c9d1d9; }
    h1 { font-size: 1.25rem; color: #58a6ff; }
    .mock-banner { background: #f0883e; color: #000; padding: 0.5rem; border-radius: 6px; margin-bottom: 1rem; font-weight: bold; }
  </style>
</head>
<body>
  <div class="mock-banner">⚠️ MOCK MODE — This is a local development server</div>
  <h1>kimiflare remote</h1>
  <p>Session: ${sessionId}</p>
  <p>Status: Mock session</p>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

async function simulateSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const events = [
    { type: "turn_start", turn: 1 },
    { type: "text_delta", text: "I'll help you with that. Let me start by examining the codebase..." },
    { type: "tool_call_start", index: 0, id: "call_1", name: "read" },
    { type: "tool_call_args", index: 0, delta: '{"path": "README.md"}' },
    { type: "tool_call_finalized", call: { id: "call_1", name: "read", arguments: { path: "README.md" } } },
    { type: "tool_result", result: { ok: true, value: "# Project\n\nA sample project." } },
    { type: "text_delta", text: "I see the project structure. Now I'll make the changes..." },
    { type: "turn_end", turn: 1 },
    { type: "turn_start", turn: 2 },
    { type: "tool_call_start", index: 0, id: "call_2", name: "write" },
    { type: "tool_call_finalized", call: { id: "call_2", name: "write", arguments: { path: "README.md", content: "# Updated Project\n\nNow with more features!" } } },
    { type: "tool_result", result: { ok: true } },
    { type: "turn_end", turn: 2 },
  ];

  for (const ev of events) {
    await sleep(500 + Math.random() * 1000);
    session.progressEvents.push(ev);
    if (ev.type === "turn_start" && typeof ev.turn === "number") {
      session.currentTurn = ev.turn;
    }
  }

  await sleep(1000);
  session.status = "done";
  session.finishedAt = Date.now();
  session.prUrl = `https://github.com/${session.repo.owner}/${session.repo.name}/pull/1`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(PORT, () => {
  console.log(`🧪 Mock remote Worker running at http://localhost:${PORT}`);
  console.log(`   Auth secret: ${AUTH_SECRET}`);
  console.log("");
  console.log("Configure the CLI:");
  console.log(`  kimiflare config remoteWorkerUrl http://localhost:${PORT}`);
  console.log(`  kimiflare config remoteAuthSecret ${AUTH_SECRET}`);
  console.log("");
  console.log("Then start a session:");
  console.log("  kimiflare");
  console.log('  /remote "Do something useful"');
});
