/**
 * Fuzzy matching utilities (trimmed port of pi-mono's fuzzy.ts).
 * Match if all query characters appear in `text` in order (not necessarily
 * consecutive). Lower score = better match.
 */

export interface FuzzyMatch {
  matches: boolean;
  score: number;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (q.length === 0) return { matches: true, score: 0 };
  if (q.length > t.length) return { matches: false, score: 0 };

  let qi = 0;
  let score = 0;
  let lastMatch = -1;
  let consecutive = 0;

  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;

    const isWordBoundary = i === 0 || /[\s\-_./:]/.test(t[i - 1]!);

    if (lastMatch === i - 1) {
      consecutive++;
      score -= consecutive * 5;
    } else {
      consecutive = 0;
      if (lastMatch >= 0) score += (i - lastMatch - 1) * 2;
    }

    if (isWordBoundary) score -= 10;
    score += i * 0.1;

    lastMatch = i;
    qi++;
  }

  if (qi < q.length) return { matches: false, score: 0 };
  return { matches: true, score };
}

/**
 * Filter and sort items by fuzzy match quality (best matches first).
 * Empty / whitespace-only query returns the input unchanged.
 * Space-separated tokens must all match.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return items;

  const tokens = trimmed.split(/\s+/);
  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const text = getText(item);
    let total = 0;
    let allMatch = true;
    for (const token of tokens) {
      const m = fuzzyMatch(token, text);
      if (!m.matches) {
        allMatch = false;
        break;
      }
      total += m.score;
    }
    if (allMatch) scored.push({ item, score: total });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}
