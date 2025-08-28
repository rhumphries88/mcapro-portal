export type CleanedMatch = { lender_id: string; match_score: number };

/**
 * Takes the webhook JSON (which includes `output` as a stringified JSON),
 * parses it, and returns only [{ lender_id, match_score }, ...] in order.
 */
export function extractLenderMatches(webhookResponse: unknown): CleanedMatch[] {
  const topLevel =
    typeof webhookResponse === 'string'
      ? JSON.parse(webhookResponse)
      : (webhookResponse as Record<string, unknown>);

  const outputStr: unknown = topLevel?.output;
  if (typeof outputStr !== 'string') {
    throw new Error("Invalid webhook response: 'output' must be a string.");
  }

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(outputStr);
  } catch {
    throw new Error("Invalid 'output': not valid JSON.");
  }

  const po = parsedOutput as Record<string, unknown> | undefined;
  const maybeMatches =
    (po?.matches as unknown) ??
    ((po?.data as Record<string, unknown> | undefined)?.matches as unknown) ??
    ((po?.result as Record<string, unknown> | undefined)?.matches as unknown);

  if (!Array.isArray(maybeMatches)) {
    throw new Error("Parsed 'output' does not contain a valid 'matches' array.");
  }

  const cleaned: CleanedMatch[] = (maybeMatches as Array<Record<string, unknown>>)
    .map((m) => {
      const lender_id =
        (m?.lender_id as string | undefined) ??
        (m?.id as string | undefined) ??
        (m?.lenderId as string | undefined) ??
        (m?.lenderID as string | undefined) ??
        null;
      const rawScore =
        (m?.match_score as unknown) ??
        (m?.score as unknown) ??
        (m?.matchScore as unknown) ??
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
