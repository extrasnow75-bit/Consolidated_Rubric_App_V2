/**
 * Turn a rubric object straight into Canvas CSV.
 *
 * No AI involved: it is a pure formatter, so it stays in the renderer rather than making an IPC
 * round trip to do string work. It lived in geminiService.ts only because that is where the
 * rubric types were.
 */
import { RubricData } from '../types';

export function generateCsvFromRubricObject(
  rubric: RubricData,
  scoringMethod: 'ranges' | 'fixed',
): string {
  const HEADER =
    'Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points';

  const enableRange = scoringMethod === 'ranges' ? 'TRUE' : 'FALSE';

  /** Wrap a field in double-quotes if it contains commas, quotes, or newlines. */
  const q = (s: string): string => {
    const str = String(s ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  /**
   * Canvas CSV only accepts a single max point value per rating — range strings
   * like "10-8" are invalid. Extract the leading number from any range string.
   */
  const maxPoints = (pts: string): string => {
    const str = String(pts ?? '').trim();
    const dashIdx = str.indexOf('-', 1); // skip a potential leading minus sign
    return dashIdx > 0 ? str.substring(0, dashIdx).trim() : str;
  };

  const rows = rubric.criteria.map((c, i) => {
    const rubricName = i === 0 ? q(rubric.title) : '';
    const ratings: [string, { text: string; points: string }][] = [
      ['Exemplary',      c.exemplary],
      ['Proficient',     c.proficient],
      ['Developing',     c.developing],
      ['Unsatisfactory', c.unsatisfactory],
    ];
    const ratingCols = ratings.flatMap(([name, r]) => [
      q(name),
      q(r.text),
      q(scoringMethod === 'ranges' ? maxPoints(r.points) : r.points),
    ]);
    return [rubricName, q(c.category), q(c.description), enableRange, ...ratingCols].join(',');
  });

  return [HEADER, ...rows].join('\n');
}
