export type CleanedMatch = { lender_id: string; match_score: number };

/**
 * Tolerant parser for lender matches returned by webhook.
 * Accepts various shapes:
 * - { output: stringifiedJson }
 * - { output: { matches: [...] } }
 * - { matches: [...] } or nested under data/result/payload
 * - A raw JSON string (top-level) or an array of matches
 * Returns [] instead of throwing when structure is not found.
 */
export function extractLenderMatches(webhookResponse: unknown): CleanedMatch[] {
  const tryParseJson = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      // Try to extract first JSON object/array substring
      const m = s.match(/(?:\{|\[)[\s\S]*(?:\}|\])/);
      if (m) {
        try { return JSON.parse(m[0]); } catch { void 0; }
      }
      return null;
    }
  };

  const asObject = (v: unknown): Record<string, unknown> | null => {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  };

  // Normalize top-level
  let top: unknown = webhookResponse;
  if (typeof top === 'string') {
    const parsed = tryParseJson(top);
    top = parsed ?? {};
  }
  const topObj = asObject(top) ?? {};

  // Derive candidate containers where matches could live
  let container: unknown = topObj;
  const output = (topObj as Record<string, unknown>).output;
  if (typeof output === 'string') {
    const parsed = tryParseJson(output);
    if (parsed) container = parsed;
  } else if (output && typeof output === 'object') {
    container = output;
  }

  const cands: unknown[] = [
    container,
    (container as Record<string, unknown> | undefined)?.data,
    (container as Record<string, unknown> | undefined)?.result,
    (container as Record<string, unknown> | undefined)?.payload,
    topObj,
    topObj.data as unknown,
    topObj.result as unknown,
    topObj.payload as unknown,
    (topObj as Record<string, unknown>).matches as unknown,
  ].filter((x) => x !== undefined);

  // If any candidate is already an array, assume it's the matches array
  let matches: unknown = cands.find((x) => Array.isArray(x));
  // Special case: top-level is an array wrapper like [{ ranked_matches: [...] }]
  if (Array.isArray(matches) && matches.length === 1 && typeof matches[0] === 'object' && matches[0] !== null) {
    const inner = (matches[0] as Record<string, unknown>).ranked_matches;
    if (Array.isArray(inner)) {
      matches = inner as unknown;
    }
  }
  // Otherwise look for a .matches array on any object candidate
  if (!matches) {
    for (const cand of cands) {
      const obj = asObject(cand);
      if (obj && Array.isArray(obj.matches as unknown)) {
        matches = obj.matches as unknown;
        break;
      }
      // Also support ranked_matches
      if (obj && Array.isArray((obj as Record<string, unknown>).ranked_matches as unknown)) {
        matches = (obj as Record<string, unknown>).ranked_matches as unknown;
        break;
      }
    }
  }

  if (!Array.isArray(matches)) {
    return [];
  }

  const cleaned: CleanedMatch[] = (matches as Array<Record<string, unknown>>)
    .map((m) => {
      const lender_id =
        (m?.lender_id as string | undefined) ||
        (m?.id as string | undefined) ||
        (m?.lenderId as string | undefined) ||
        (m?.lenderID as string | undefined) ||
        null;
      const rawScore =
        (m?.match_score as unknown) ||
        (m?.score as unknown) ||
        (m?.matchScore as unknown) ||
        (m?.qualification_score as unknown);

      const match_score = typeof rawScore === 'number' ? rawScore : Number(rawScore);

      if (typeof lender_id === 'string' && Number.isFinite(match_score)) {
        return { lender_id, match_score };
      }
      return null;
    })
    .filter((x): x is CleanedMatch => x !== null);

  return cleaned;
}
