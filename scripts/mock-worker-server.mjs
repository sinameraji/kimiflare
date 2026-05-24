#!/usr/bin/env node
/**
 * Mock standalone worker server for local testing.
 * Run alongside `npm run dev`:
 *   node scripts/mock-worker-server.mjs
 *
 * Then in the TUI, ask:
 *   "Spawn a worker to research OAuth2 best practices for TypeScript CLI tools"
 */
import { createServer } from "node:http";

const PORT = 9999;

function makeFakeResult(task) {
  const id = `worker-${Math.random().toString(36).slice(2, 10)}`;
  return {
    workerId: id,
    status: "completed",
    task,
    findings: [
      {
        topic: "PKCE Flow",
        summary:
          "PKCE is mandatory for public clients and recommended for all OAuth2 flows per RFC 7636.",
        confidence: "high",
        sources: ["RFC 7636", "auth0.com/docs"],
        relevance: "critical",
      },
      {
        topic: "Refresh Token Rotation",
        summary:
          "Rotating refresh tokens on every use limits the window of compromise.",
        confidence: "high",
        sources: ["OAuth 2.0 Best Current Practice"],
        relevance: "high",
      },
    ],
    recommendations: [
      "Use @octokit/auth-oauth-app for GitHub OAuth",
      "Implement refresh token rotation with 30-day expiry",
      "Store tokens in ~/.config/kimiflare/ not in repo",
    ],
    filesRead: ["src/auth.ts", "src/config.ts"],
    webSources: [
      "https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-proof-key-for-code-exchange-pkce",
    ],
    costUsd: 0.34,
    tokensUsed: 45200,
    reasoning:
      "Analyzed current auth patterns and compared against OAuth2 BCP. PKCE is the right fit for a CLI tool because it cannot keep a client secret confidential.",
  };
}

const server = createServer((req, res) => {
  // CORS + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Worker-Api-Key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/worker") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body);
      console.log("[mock-worker] received:", payload.mode, payload.task.slice(0, 60));

      // Simulate a little delay so the UI spinner is visible
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(makeFakeResult(payload.task)));
      }, 1500);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad json" }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Mock worker server listening on http://localhost:${PORT}`);
  console.log(`Test prompt (in TUI):`);
  console.log(`  spawn_worker mode=plan task="Research OAuth2 best practices for TypeScript CLI tools"`);
});
