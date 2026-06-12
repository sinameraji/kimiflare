/**
 * OpenAPI 3.1 specification for the KimiFlare headless server.
 */

export function getOpenApiSpec(): string {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "KimiFlare Headless Server API",
      version: "1.0.0",
      description: "HTTP API for running KimiFlare agent sessions headlessly.",
    },
    servers: [{ url: "/", description: "Local server" }],
    paths: {
      "/": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Server is running",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { status: { type: "string" }, version: { type: "string" } } },
                },
              },
            },
          },
        },
      },
      "/prompt": {
        post: {
          summary: "Start a new agent session with a prompt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: { type: "string", description: "The user prompt" },
                    model: { type: "string", description: "Model ID to use" },
                    cwd: { type: "string", description: "Working directory" },
                    title: { type: "string", description: "Session title" },
                    files: { type: "array", items: { type: "string" }, description: "File paths or globs to attach" },
                    allowAll: { type: "boolean", description: "Auto-approve all tool calls" },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Session started",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sessionId: { type: "string" },
                      status: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/session": {
        get: {
          summary: "List sessions",
          parameters: [
            {
              name: "cwd",
              in: "query",
              schema: { type: "string" },
              description: "Filter by working directory",
            },
          ],
          responses: {
            "200": {
              description: "List of sessions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sessions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            cwd: { type: "string" },
                            firstPrompt: { type: "string" },
                            title: { type: "string" },
                            messageCount: { type: "number" },
                            updatedAt: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/session/{id}": {
        get: {
          summary: "Get session state",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Session state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      cwd: { type: "string" },
                      model: { type: "string" },
                      messages: { type: "array" },
                      title: { type: "string" },
                      updatedAt: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": { description: "Session not found" },
          },
        },
        delete: {
          summary: "Delete a session",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Session deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { deleted: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
      "/session/{id}/prompt": {
        post: {
          summary: "Send a follow-up prompt to a session",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: { type: "string" },
                    files: { type: "array", items: { type: "string" } },
                    allowAll: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Follow-up started",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sessionId: { type: "string" },
                      status: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": { description: "Session not found" },
          },
        },
      },
      "/event": {
        get: {
          summary: "Server-Sent Events stream",
          responses: {
            "200": {
              description: "SSE stream of session events",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "object",
                    description: "Stream of events: server.connected, assistant.delta, tool.call, tool.result, usage.update, session.completed, error",
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KimiFlare Headless Server API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { margin-top: 32px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>KimiFlare Headless Server API</h1>
  <p>OpenAPI 3.1 specification for the local HTTP server.</p>
  <h2>Spec</h2>
  <pre>${JSON.stringify(spec, null, 2)}</pre>
</body>
</html>`;
}
