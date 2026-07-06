/** Levenshtein distance; returns null when distance exceeds `max`. */
export function levenshteinWithin(
  a: string,
  b: string,
  max: number
): number | null {
  if (a === b) return 0;
  if (max < 0) return null;

  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return null;
  if (la === 0) return lb <= max ? lb : null;
  if (lb === 0) return la <= max ? la : null;

  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);

    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    if (rowMin > max) return null;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  const dist = prev[lb];
  return dist <= max ? dist : null;
}

export function maxEditDistanceForToken(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 5) return 1;
  return 2;
}

export function tokenizeForFuzzy(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/)
    .filter((t) => t.length >= 2);
}

export function fuzzyTokenMatch(queryToken: string, candidateToken: string): boolean {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    return true;
  }
  const max = maxEditDistanceForToken(queryToken);
  if (max === 0) return false;
  return levenshteinWithin(queryToken, candidateToken, max) !== null;
}

/** Score a free-text blob against a query (MCP tool discovery). */
export function scoreFuzzyQuery(
  query: string,
  fields: string[],
  weights: number[] = []
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const tokens = q.split(/\s+/).filter((t) => t.length >= 1);
  let score = 0;

  fields.forEach((field, i) => {
    const blob = (field || "").toLowerCase();
    if (!blob) return;
    const weight = weights[i] ?? 1;

    if (blob.includes(q)) {
      score += 80 * weight;
      return;
    }

    for (const token of tokens) {
      if (token.length < 2) continue;
      if (blob.includes(token)) {
        score += 24 * weight;
        continue;
      }
      const blobTokens = tokenizeForFuzzy(blob);
      if (blobTokens.some((bt) => fuzzyTokenMatch(token, bt))) {
        score += 18 * weight;
      }
    }
  });

  return score;
}
