import { Hono } from "hono";
import { VIEWER_HTML } from "./viewer-html.js";

export interface Env {
  SHARE_BUCKET: R2Bucket;
  SHARE_AUTH_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  await next();
  // Attach CORS to all responses
  const res = c.res;
  if (res) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.headers.set(k, v);
    }
  }
});

function makeId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// Health / landing
app.get("/", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>KimiFlare Share</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.container{max-width:480px;padding:24px}
h1{margin:0 0 8px;font-size:24px}
p{color:#8b949e;margin:0 0 16px}
a{color:#58a6ff;text-decoration:none}
</style></head>
<body><div class="container"><h1>KimiFlare Share</h1>
<p>Session sharing is enabled.</p>
<p><a href="https://github.com/sinameraji/kimiflare">github.com/sinameraji/kimiflare</a></p>
</div></body></html>`);
});

// Upload endpoint
app.post("/api/upload", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const expected = `Bearer ${c.env.SHARE_AUTH_SECRET}`;
  if (!crypto.subtle) {
    // Fallback for environments without subtle
    if (auth !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  } else {
    const enc = new TextEncoder();
    const a = enc.encode(auth);
    const b = enc.encode(expected);
    if (a.byteLength !== b.byteLength) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const same = await crypto.subtle.timingSafeEqual(a, b);
    if (!same) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  const body = await c.req.text();
  if (!body || body.length > 50 * 1024 * 1024) {
    return c.json({ error: "Body too large or empty" }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Basic validation: must be an object with messages array
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).messages)) {
    return c.json({ error: "Invalid session format" }, 400);
  }

  const id = makeId();
  const key = `shares/${id}.json`;
  await c.env.SHARE_BUCKET.put(key, body, {
    httpMetadata: { contentType: "application/json" },
  });

  const url = new URL(c.req.url);
  const shareUrl = `${url.protocol}//${url.host}/s/${id}`;
  return c.json({ id, url: shareUrl });
});

// Serve session JSON
app.get("/api/session/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9]+$/.test(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }
  const obj = await c.env.SHARE_BUCKET.get(`shares/${id}.json`);
  if (!obj) {
    return c.json({ error: "Not found" }, 404);
  }
  const body = await obj.text();
  return new Response(body, {
    headers: { "Content-Type": "application/json" },
  });
});

// Viewer page
app.get("/s/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-zA-Z0-9]+$/.test(id)) {
    return c.text("Invalid ID", 400);
  }
  // Verify the object exists before serving the viewer
  const obj = await c.env.SHARE_BUCKET.head(`shares/${id}.json`);
  if (!obj) {
    return c.html(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Not Found</title>
<style>body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body><div>Session not found.</div></body></html>`, 404);
  }
  const html = VIEWER_HTML.replace(
    '<main id="main"><div class="loading">Loading session…</div></main>',
    `<main id="main"><div class="loading">Loading session…</div></main><script>window.__SESSION_ID__=${JSON.stringify(id)};</script>`
  );
  return c.html(html);
});

export default app;
