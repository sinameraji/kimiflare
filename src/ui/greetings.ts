/**
 * Smart Welcome Greetings — contextual, rotating messages that adapt to
 * time of day, git branch, and the user's last session topic.
 */

export interface GreetingContext {
  gitBranch: string | null;
  lastSessionTopic: string | null;
  hour: number;
  day: number; // 0 = Sunday
}

export interface WelcomeMessage {
  headline: string;
  suggestions: string[];
}

function timeOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function dayName(day: number): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[day] ?? "day";
}

function cleanTopic(topic: string | null): string | null {
  if (!topic) return null;
  return topic
    .replace(/^\/\w+\s*/, "") // strip slash commands
    .replace(/`([^`]+)`/g, "$1") // unwrap backticks
    .replace(/\b(src\/|\.?\.\/)[\w/.-]+/g, (m) => m.split("/").pop() ?? m) // basename paths
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function branchContext(branch: string | null): { type: "feature" | "fix" | "other"; clean: string } | null {
  if (!branch) return null;
  const clean = branch.replace(/^(feature|fix|bugfix|hotfix)\//, "").replace(/-/g, " ");
  if (branch.startsWith("feature/")) return { type: "feature", clean };
  if (branch.startsWith("fix/") || branch.startsWith("bugfix/") || branch.startsWith("hotfix/")) return { type: "fix", clean };
  return { type: "other", clean: branch };
}

export function buildWelcome(ctx: GreetingContext): WelcomeMessage {
  const tod = timeOfDay(ctx.hour);
  const topic = cleanTopic(ctx.lastSessionTopic);
  const branch = branchContext(ctx.gitBranch);

  // ── Headlines (priority: branch > topic > time fallback)
  const headlines: string[] = [];

  if (branch?.type === "feature") {
    headlines.push(`Working on ${branch.clean}?`);
    headlines.push(`Back to ${branch.clean}?`);
  } else if (branch?.type === "fix") {
    headlines.push(`Fixing ${branch.clean}?`);
    headlines.push(`Squashing ${branch.clean}?`);
  } else if (branch) {
    headlines.push(`On branch \`${branch.clean}\`.`);
  }

  if (topic) {
    headlines.push(`Back for more? You were working on "${topic}."`);
    headlines.push(`Last time: ${topic}. Picking up where you left off?`);
  }

  // Time-based fallbacks
  const timeGreetings: { [K in "morning" | "afternoon" | "evening" | "night"]: string[] } = {
    morning: ["Good morning. What's the plan?", "Morning. Ready to ship something?"],
    afternoon: ["Good afternoon. What's next?", "Afternoon. What are we building?"],
    evening: ["Good evening. One more feature before dinner?", "Evening. Wrapping up or starting fresh?"],
    night: ["Up late? Let's make it count.", "Night owl mode. What are we hacking on?"],
  };

  // Day-specific quirks
  if (ctx.day === 5 && tod === "afternoon") {
    timeGreetings.afternoon.push("Friday afternoon — want me to write some tests?");
  }
  if (ctx.day === 1 && tod === "morning") {
    timeGreetings.morning.push("Monday morning. Let's ease into it.");
  }

  const timeOptions = timeGreetings[tod];
  if (timeOptions) {
    headlines.push(...timeOptions);
  }

  // Deterministic but varied: hash hour + day + branch/topic presence to pick one
  const seed = ctx.hour + ctx.day * 24 + (branch ? 100 : 0) + (topic ? 200 : 0);
  const headline = headlines[seed % headlines.length] ?? "Ready when you are.";

  // ── Suggestions (contextual)
  const suggestions: string[] = [];

  if (branch?.type === "feature") {
    suggestions.push(`Continue work on ${branch.clean}`);
    suggestions.push(`Write tests for ${branch.clean}`);
  }
  if (branch?.type === "fix") {
    suggestions.push(`Debug ${branch.clean}`);
    suggestions.push(`Add regression test for ${branch.clean}`);
  }
  if (topic) {
    suggestions.push(`Continue: ${topic}`);
  }

  // Generic fallbacks
  const generic = [
    "Explain this codebase",
    "Find and fix a bug",
    "Refactor a file",
    "Write a test",
    "Review recent changes",
  ];

  // Deduplicate and limit
  const all = [...suggestions, ...generic];
  const unique = all.filter((s, i) => all.indexOf(s) === i).slice(0, 4);

  return { headline, suggestions: unique };
}
