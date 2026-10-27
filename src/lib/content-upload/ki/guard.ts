// The last check before a request leaves the platform (docs/ki-upload-konzept.md
// 5.3 step 7): the exact string that would be sent is checked once more, whatever
// the module that built it believed. buildExcerpt already ends with such a check;
// this one stands between the prompt and the client, so a change in either cannot
// open a way around it.
//
// A request is refused when
//   - the user message is not exactly "open marker, excerpt, close marker"
//   - the excerpt is longer than the limit
//   - a line of it holds a marker word of a solution, or a text that stands in a
//     solution of any file of the run or of the database (also across two lines)
//   - it holds wording that speaks to a model
//   - it still holds a pattern of personal data (a placeholder is fine, a real
//     pattern means the replacement missed something)

import { EXCERPT_MAX_CHARS } from '../limits';
import { findInstructionText, redactPersonalData } from '../patterns';
import { protectExcerptLines } from '../excerpt';

export type RequestRefusal =
  | 'SHAPE'
  | 'TOO_LONG'
  | 'MARKER'
  | 'LEAK'
  | 'INSTRUCTION'
  | 'PERSONAL_DATA';

export interface RequestCheckInput {
  /** The user message as it would be sent. */
  user: string;
  /** The excerpt the user message was built from. */
  excerpt: string;
  /** Solution texts of the run and of the database. */
  known: readonly string[];
  /** The id of the markers of this request. */
  nonce: string;
}

export function checkRequest(input: RequestCheckInput): RequestRefusal | null {
  const { user, excerpt, known, nonce } = input;
  if (excerpt.length === 0) return 'SHAPE';
  if (user !== `<<<AUSZUG-${nonce}\n${excerpt}\nAUSZUG-${nonce}>>>`) {
    return 'SHAPE';
  }
  if (excerpt.length > EXCERPT_MAX_CHARS) return 'TOO_LONG';

  const lines = excerpt.split('\n').filter(line => line.trim().length > 0);
  const checked = protectExcerptLines(lines, { solutions: [], known });
  if (checked.markerHits > 0) return 'MARKER';
  if (checked.leakHits > 0 || checked.crossHit) return 'LEAK';
  if (findInstructionText(excerpt).length > 0) return 'INSTRUCTION';
  // The excerpt was cleaned before, so a second pass finds nothing: anything it
  // still replaces is a pattern that the first pass missed
  const again = redactPersonalData(excerpt);
  if (again.personal + again.other > 0) return 'PERSONAL_DATA';
  return null;
}
