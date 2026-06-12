/**
 * Config-based permission rule evaluator for headless/CI mode.
 *
 * Rules are defined in ~/.config/kimiflare/config.json as:
 * {
 *   "permissions": {
 *     "bash": { "**\/test\/\*\*": "allow", "**": "ask" },
 *     "write": { "**": "deny" },
 *     "edit": { "~/trusted/**": "allow", "**": "ask" }
 *   }
 * }
 *
 * Evaluation order:
 * 1. Match the most specific pattern first.
 * 2. If no rule matches, return "ask" (fallback to interactive behavior).
 * 3. In headless mode, "ask" becomes "deny" unless --dangerously-allow-all is set.
 */

import { resolve, relative } from "node:path";
import { homedir } from "node:os";
import type { PermissionRule, PermissionRules } from "./config.js";

export interface PermissionEvalRequest {
  tool: string;
  args: Record<string, unknown>;
  cwd: string;
}

/**
 * Evaluate permission rules for a tool call.
 * Returns the decision: "allow", "deny", or "ask".
 */
export function evaluatePermissionRules(
  req: PermissionEvalRequest,
  rules: Record<string, PermissionRules>,
): PermissionRule {
  const toolRules = rules[req.tool];
  if (!toolRules) return "ask";

  // Extract the target path or command from args
  const target = extractTarget(req.tool, req.args, req.cwd);
  if (!target) return "ask";

  // Find matching rules, sorted by specificity (longest pattern first)
  const entries = Object.entries(toolRules).sort((a, b) => b[0].length - a[0].length);

  for (const [pattern, rule] of entries) {
    if (matchPattern(target, pattern, req.cwd)) {
      return rule;
    }
  }

  return "ask";
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function extractTarget(tool: string, args: Record<string, unknown>, cwd: string): string | null {
  switch (tool) {
    case "write":
    case "edit":
    case "read":
    case "glob":
    case "grep":
      return typeof args.path === "string" ? resolve(cwd, expandHome(args.path)) : null;
    case "bash":
      return typeof args.command === "string" ? args.command : null;
    case "browser_fetch":
    case "web_fetch":
      return typeof args.url === "string" ? args.url : null;
    case "search_web":
      return typeof args.query === "string" ? args.query : null;
    default:
      // For unknown tools, try common arg names
      return (
        (typeof args.path === "string" ? resolve(cwd, expandHome(args.path)) : null) ??
        (typeof args.url === "string" ? args.url : null) ??
        (typeof args.command === "string" ? args.command : null)
      );
  }
}

function matchPattern(target: string, pattern: string, cwd: string): boolean {
  // Expand home directory
  let expandedPattern = pattern;
  if (pattern.startsWith("~/")) {
    expandedPattern = resolve(homedir(), pattern.slice(2));
  }

  // Absolute path match
  if (target.startsWith(expandedPattern)) {
    return true;
  }

  // Glob-style matching using simple rules
  const regex = globToRegex(expandedPattern);
  if (regex.test(target)) {
    return true;
  }

  // Try relative to cwd
  try {
    const relTarget = relative(cwd, target);
    if (regex.test(relTarget)) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function globToRegex(pattern: string): RegExp {
  // Simple glob to regex conversion
  let regex = pattern
    .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<DOUBLESTAR>>>/g, ".*")
    .replace(/\?/g, ".");

  // If pattern doesn't start with / or ., make it match anywhere
  if (!regex.startsWith("/") && !regex.startsWith(".*")) {
    regex = ".*/" + regex;
  }

  return new RegExp(`^${regex}$`);
}
