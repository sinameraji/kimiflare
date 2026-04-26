import type { ToolSpec, ToolContext } from "../tools/registry.js";
import type { ToolExecutor, PermissionAsker, ToolResult } from "../tools/executor.js";

export interface SandboxResult {
  /** console.log output joined by newlines */
  output: string;
  /** Individual log lines */
  logs: string[];
  /** Error message if execution failed */
  error?: string;
  /** Tool calls made during execution */
  toolCalls: SandboxToolCall[];
}

export interface SandboxToolCall {
  name: string;
  args: unknown;
  result: string;
}

export interface SandboxOptions {
  code: string;
  tools: ToolSpec[];
  executor: ToolExecutor;
  askPermission: PermissionAsker;
  ctx: ToolContext;
  timeoutMs?: number;
  memoryLimitMB?: number;
}

/** Lightweight TypeScript-to-JavaScript type stripper for LLM-generated code. */
export function stripTypescript(code: string): string {
  let js = code;

  // Remove interface declarations
  js = js.replace(/interface\s+\w+\s*\{[\s\S]*?\n\}/g, "");

  // Remove type alias declarations
  js = js.replace(/type\s+\w+\s*=\s*[^;]+;/g, "");

  // Remove generic type parameters: foo<T>(...) -> foo(...)
  js = js.replace(/(\w+)<[^>]+>(\s*\()/g, "$1$2");

  // Remove variable type annotations: const x: string = ...
  js = js.replace(/(\b(?:const|let|var)\s+\w+)\s*:\s*[^=;]+/g, "$1");

  // Remove function parameter types: function foo(x: string, y: number)
  js = js.replace(/(\(|,\s*)(\w+)\s*:\s*[^,)=]+/g, "$1$2");

  // Remove function return types: function foo(): string {
  js = js.replace(/(\)[\s]*)\s*:\s*[^{]+(\s*\{)/g, "$1$2");

  // Remove async return type annotations: async function foo(): Promise<string>
  js = js.replace(/(\)[\s]*)\s*:\s*Promise<[^>]+>(\s*\{)/g, "$1$2");

  // Remove type assertions: expr as Type
  js = js.replace(/\s+as\s+\w+(?:\[\])?/g, "");

  // Remove non-null assertions: expr!
  js = js.replace(/(\w+)(\??)!/g, "$1$2");

  // Remove import type statements
  js = js.replace(/import\s+type\s+[^;]+;/g, "");

  // Remove declare statements
  js = js.replace(/declare\s+[^;]+;/g, "");

  // Clean up extra blank lines
  js = js.replace(/\n{3,}/g, "\n\n");

  return js.trim();
}

async function runWithIsolatedVm(opts: SandboxOptions): Promise<SandboxResult> {
  const { Isolate } = await import("isolated-vm");
  const isolate = new Isolate({ memoryLimit: opts.memoryLimitMB ?? 128 });
  const context = await isolate.createContext();
  const jail = context.global;
  await jail.set("global", jail.derefInto());

  const logs: string[] = [];
  const toolCalls: SandboxToolCall[] = [];

  // Set up console.log capture
  await context.evalClosure(
    `globalThis._log = function(...args) {
      $0.applySync(undefined, [args.map(String).join(" ")], { arguments: { copy: true } });
    };`,
    [(msg: string) => logs.push(msg)],
    { arguments: { reference: true } },
  );
  await context.eval(`var console = { log: function(...args) { _log(args.map(String).join(" ")); } };`);

  // Build API bindings for each tool
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));

  for (const tool of opts.tools) {
    const ref = new (await import("isolated-vm")).Reference(
      async (argsJson: string): Promise<string> => {
        const args = JSON.parse(argsJson);
        const toolCallId = `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const result = await opts.executor.run(
          { id: toolCallId, name: tool.name, arguments: JSON.stringify(args) },
          opts.askPermission,
          opts.ctx,
        );

        toolCalls.push({
          name: tool.name,
          args,
          result: result.content,
        });

        return result.content;
      },
    );

    await context.evalClosure(
      `globalThis["_api_${tool.name}"] = function(argsJson) {
        return $0.applySyncPromise(undefined, [argsJson], { arguments: { copy: true } });
      };`,
      [ref],
      { arguments: { reference: true } },
    );
  }

  // Build api object
  const apiMethods = opts.tools.map((t) => `  ${t.name}: function(input) { return _api_${t.name}(JSON.stringify(input ?? {})); }`).join(",\n");
  await context.eval(`var api = {\n${apiMethods}\n};`);

  // Compile TS to JS
  const jsCode = stripTypescript(opts.code);

  // Wrap in async IIFE to support top-level await
  const wrapped = `(async function() {\n${jsCode}\n})();`;

  try {
    const timeout = opts.timeoutMs ?? 30000;
    const script = await isolate.compileScript(wrapped);
    await script.run(context, { timeout, release: true });
    // Wait a tick for any pending promises to settle
    await new Promise((r) => setTimeout(r, 10));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: "", logs, error: message, toolCalls };
  } finally {
    isolate.dispose();
  }

  return { output: logs.join("\n"), logs, toolCalls };
}

async function runWithNodeVm(opts: SandboxOptions): Promise<SandboxResult> {
  const { runInNewContext } = await import("node:vm");

  const logs: string[] = [];
  const toolCalls: SandboxToolCall[] = [];

  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      },
    },
    api: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    Infinity,
    NaN,
    undefined,
  };

  // Build API bindings
  for (const tool of opts.tools) {
    (sandbox.api as Record<string, unknown>)[tool.name] = async (input?: unknown): Promise<string> => {
      const args = input ?? {};
      const toolCallId = `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const result = await opts.executor.run(
        { id: toolCallId, name: tool.name, arguments: JSON.stringify(args) },
        opts.askPermission,
        opts.ctx,
      );

      toolCalls.push({
        name: tool.name,
        args,
        result: result.content,
      });

      return result.content;
    };
  }

  const jsCode = stripTypescript(opts.code);
  const wrapped = `"use strict";\n(async function() {\n${jsCode}\n})();`;

  try {
    const timeout = opts.timeoutMs ?? 30000;
    await runInNewContext(wrapped, sandbox, { timeout, displayErrors: true });
    // Wait a tick for pending promises
    await new Promise((r) => setTimeout(r, 10));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: "", logs, error: message, toolCalls };
  }

  return { output: logs.join("\n"), logs, toolCalls };
}

export async function runInSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  try {
    return await runWithIsolatedVm(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If isolated-vm fails (e.g., not compiled), fall back to node:vm
    if (message.includes("isolated-vm") || message.includes("Cannot find module") || message.includes("bindings")) {
      return runWithNodeVm(opts);
    }
    // For other errors, also try fallback
    return runWithNodeVm(opts);
  }
}
