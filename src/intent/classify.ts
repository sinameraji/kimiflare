export interface IntentResult {
  intent: string;
  rawScore: number; // 0.0 - 1.0
  tier: "light" | "medium" | "heavy";
  confidence: number; // 0.0 - 1.0
}

const INTENT_PATTERNS: Record<string, RegExp> = {
  qa: /\b(what|how|why|explain|describe|what's|what is)\b/i,
  diagnose: /\b(broken|failing|error|bug|crash|why.*fail|not working)\b/i,
  verify: /\b(correct|right|verify|review|check|is this|does this)\b/i,
  polish: /\b(rename|refactor|extract|move|clean|lint|format)\b/i,
  small_edit: /\b(add|change|update|fix|remove|delete)\b.+\b(line|here|this|variable|function)\b/i,
  feature_bounded: /\b(add|implement|create|support)\b.+\b(flag|option|param|arg|field)\b/i,
  feature_exploratory:
    /\b(add|implement|migrate|integrate|build|investigate|analyze|audit|inspect|study)\b.+\b(module|system|auth|oauth|framework|service|codebase|architecture)\b/i,
  explore:
    /\b(how.*work|architecture|structure|where.*used|find.*all|understand|investigate|analyze|examine|inspect|audit|map(?:ping)? out|trace.*through)\b/i,
  meta: /\b(plan|design|strategy|ontology|roadmap|approach|propose)\b/i,
};

export function classifyIntent(prompt: string): IntentResult {
  let intentScore = 0;
  let matchedIntent = "other";

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matches = (prompt.match(pattern) || []).length;
    if (matches > intentScore) {
      intentScore = matches;
      matchedIntent = intent;
    }
  }

  const hasFileMentions = (prompt.match(/@\w+|\b[\w/-]+\.(ts|tsx|js|jsx|py|go|rs)\b/g) || []).length;
  const hasMutatingVerb = /\b(add|create|write|edit|delete|remove|rename|migrate|implement)\b/i.test(prompt);
  const isQuestion = prompt.trim().endsWith("?") || /\b(what|how|why|is|does|can)\b/i.test(prompt.split(" ")[0] || "");

  // Decomposition signal: numbered list ("1. ... 2. ... 3. ...") or multiple
  // sentences containing "and then" / "after that" indicates the user is
  // describing a multi-step task. These benefit strongly from orchestration.
  const numberedItems = (prompt.match(/(?:^|\n)\s*\d+\.\s/g) || []).length;
  const hasDecomposition = numberedItems >= 2 || /\band then\b|\bafter that\b|\bsynthesize\b|\bin parallel\b|\bindependent(?:ly)?\b/i.test(prompt);

  // Length signal: prompts above ~400 chars are almost always non-trivial.
  // This catches detailed research / investigation prompts that don't trip
  // any other pattern individually.
  const isLong = prompt.length > 400;

  const rawScore = Math.min(
    1.0,
    intentScore * 0.25 +
      (hasFileMentions > 2 ? 0.3 : hasFileMentions * 0.1) +
      (hasMutatingVerb ? 0.25 : 0) +
      (isQuestion ? 0 : 0.1) +
      (hasDecomposition ? 0.35 : 0) +
      (isLong ? 0.15 : 0),
  );

  const tier = rawScore < 0.3 ? "light" : rawScore < 0.65 ? "medium" : "heavy";

  return {
    intent: matchedIntent,
    rawScore,
    tier,
    confidence: 0.5 + (intentScore > 0 ? 0.3 : 0) + (hasFileMentions > 0 ? 0.1 : 0),
  };
}
