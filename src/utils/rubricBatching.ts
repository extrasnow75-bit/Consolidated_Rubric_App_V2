/**
 * Splitting a document's rubrics into batches, and putting the answers back in order.
 *
 * Pure on purpose. The orchestration that uses these (geminiService.generateCsvsChunked) cannot
 * be tested without a live Gemini key and an Electron bridge, but the two decisions that can
 * actually go wrong — how rubrics are grouped, and which extracted rubric belongs to which
 * requested name — are decisions about arrays, so they live here where a test can reach them.
 *
 * Getting the second one wrong is the serious case: a rubric's CSV attached to the wrong title
 * deploys cleanly and grades students against the wrong criteria. That is the same class of
 * silent, plausible-looking corruption as the unquoted-comma bug in rubricCsv.ts, so the
 * matching below refuses to guess — see `alignByTitle`.
 */

/** Split `items` into consecutive groups of at most `size`. A non-positive size means one group. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return items.length > 0 ? [items.slice()] : [];
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

const normalise = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Line up what the model returned against what was asked for.
 *
 * Returns one slot per requested name, holding the extracted rubric for that name or null when
 * there is no confident answer for it. A null is a signal to the caller to fetch that one rubric
 * on its own, which is slower and always correct.
 *
 * Three strategies, in descending order of confidence:
 *
 *   1. **By title.** Every requested name finds its own distinct entry. The normal case, and the
 *      only one that is certain, since the names came from a discovery pass over the same file.
 *   2. **By position**, but only when the counts match exactly and no name matched by title at
 *      all. That is the shape of a model that returned the right rubrics with reworded titles —
 *      both passes read one document in one order, so slot *i* is rubric *i*.
 *   3. **Neither.** Anything else — a partial title match, a count that disagrees — leaves the
 *      unmatched slots null rather than pairing things up on a hunch.
 *
 * Strategy 2 is deliberately not applied when *some* names matched by title: a partial match
 * means the model's list and the requested list disagree about their contents, and lining the
 * rest up by position would attach real CSVs to the wrong rubrics.
 */
export function alignByTitle<T extends { title: string }>(
  names: string[],
  extracted: T[],
): (T | null)[] {
  const taken = new Set<number>();
  const byTitle = names.map((name) => {
    const wanted = normalise(name);
    const at = extracted.findIndex((e, i) => !taken.has(i) && normalise(e.title) === wanted);
    if (at === -1) return null;
    taken.add(at);
    return extracted[at];
  });

  if (byTitle.every((r) => r !== null)) return byTitle;

  const noneMatched = byTitle.every((r) => r === null);
  if (noneMatched && extracted.length === names.length) return names.map((_, i) => extracted[i]);

  return byTitle;
}
