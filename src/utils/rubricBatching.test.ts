import { describe, expect, it } from 'vitest';
import { alignByTitle, chunk } from './rubricBatching';

const r = (title: string) => ({ title, csv: `csv for ${title}` });

describe('chunk', () => {
  it('splits into consecutive groups of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('returns one group when everything fits', () => {
    expect(chunk([1, 2, 3], 8)).toEqual([[1, 2, 3]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 8)).toEqual([]);
  });

  /**
   * The number that drives this comes from a shared constant, and a zero or negative value would
   * otherwise loop forever. One group is the safe reading: it is what the caller gets today for
   * any document at or under the limit.
   */
  it('does not spin on a non-positive size', () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
    expect(chunk([1, 2], -1)).toEqual([[1, 2]]);
  });

  /** 26 rubrics at 8 per call is the document that prompted all of this: 4 calls, not 26. */
  it('turns the 26-rubric document into four groups', () => {
    const groups = chunk(Array.from({ length: 26 }, (_, i) => i), 8);
    expect(groups.map((g) => g.length)).toEqual([8, 8, 8, 2]);
  });
});

describe('alignByTitle', () => {
  it('matches each requested name to its own rubric', () => {
    const out = alignByTitle(['Essay', 'Presentation'], [r('Presentation'), r('Essay')]);
    expect(out.map((x) => x?.title)).toEqual(['Essay', 'Presentation']);
  });

  it('ignores case and surrounding whitespace', () => {
    const out = alignByTitle(['  Bird Count Rubric '], [r('bird count rubric')]);
    expect(out[0]?.title).toBe('bird count rubric');
  });

  it('does not hand the same rubric to two identically named slots', () => {
    const out = alignByTitle(['Essay', 'Essay'], [r('Essay')]);
    expect(out[0]?.title).toBe('Essay');
    expect(out[1]).toBeNull();
  });

  /**
   * The model returned the right rubrics but retitled them. Both passes read one document in one
   * order, so position is trustworthy here — and only here.
   */
  it('falls back to document order when no title matches and the counts agree', () => {
    const out = alignByTitle(['One', 'Two'], [r('Rubric A'), r('Rubric B')]);
    expect(out.map((x) => x?.title)).toEqual(['Rubric A', 'Rubric B']);
  });

  /**
   * The regression that matters. A partial match means the two lists disagree about their
   * contents, so lining the remainder up by position would attach a real CSV to the wrong rubric
   * — a rubric that deploys cleanly and grades against the wrong criteria. A null instead sends
   * the caller back for that one rubric on its own.
   */
  it('refuses to guess the rest when only some names matched', () => {
    const out = alignByTitle(['Essay', 'Presentation'], [r('Essay'), r('Something Else')]);
    expect(out[0]?.title).toBe('Essay');
    expect(out[1]).toBeNull();
  });

  it('leaves slots null when fewer rubrics came back than were asked for', () => {
    const out = alignByTitle(['A', 'B', 'C'], [r('A'), r('C')]);
    expect(out.map((x) => x?.title ?? null)).toEqual(['A', null, 'C']);
  });

  it('leaves every slot null when nothing came back', () => {
    expect(alignByTitle(['A', 'B'], [])).toEqual([null, null]);
  });
});
