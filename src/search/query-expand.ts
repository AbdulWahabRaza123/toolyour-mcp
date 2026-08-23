/**
 * Cheap query expansions for MCP discover_tools recall.
 * Keeps the set small — used only to widen fuzzy scoring.
 */

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function adjacentSwaps(token: string): string[] {
  const chars = token.split("");
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const swapped = chars.slice();
    const tmp = swapped[i]!;
    swapped[i] = swapped[i + 1]!;
    swapped[i + 1] = tmp;
    out.push(swapped.join(""));
  }
  return out;
}

/**
 * Returns original query plus a few 1-edit token variants (esp. transpositions).
 * Example: "converetr" → also scores as "converter".
 */
export function expandQueryForDiscovery(query: string): string[] {
  const base = query.trim().toLowerCase();
  if (!base) return [];

  const out = [base];
  const tokens = base.split(/\s+/).filter((t) => /^[a-z]{4,16}$/.test(t));

  for (const token of tokens.slice(0, 2)) {
    for (const swap of adjacentSwaps(token).slice(0, 8)) {
      out.push(base.split(/\s+/).map((t) => (t === token ? swap : t)).join(" "));
    }
    // Missing-letter: insert "a" at each position (metatgs → metatags).
    const chars = token.split("");
    for (let pos = 0; pos <= chars.length; pos += 1) {
      const next = chars.slice(0, pos).concat("a", chars.slice(pos)).join("");
      out.push(base.split(/\s+/).map((t) => (t === token ? next : t)).join(" "));
    }
  }

  return unique(out).slice(0, 16);
}
