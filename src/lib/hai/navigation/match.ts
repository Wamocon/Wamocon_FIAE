/**
 * Finding the enabler or the use case a person named, among the records the
 * person may see. Pure functions, the candidates come from the database layer
 * (data.ts) already limited to the occupation, the courses and the release of
 * the person, so nothing outside is ever compared.
 *
 * @module lib/hai/navigation/match
 */

import { foldText } from './fold';
import type { ContentReference } from './intent';
import { escapeRegExp } from '@/lib/regex-escape';

/** A record of the person (enabler or use case) as the matching needs it. */
export interface ContentCandidate {
  id: string;
  title: string;
  /** Stable code of the record ("3", "1a"), if it has one. */
  code: string | null;
  courseId: string;
  courseTitle: string;
}

export type MatchResult =
  | { status: 'one'; item: ContentCandidate }
  | { status: 'many'; items: ContentCandidate[] }
  | { status: 'none' };

/** "007" and "7" are the same number, "1a" stays as it is. */
function normalizeNumber(value: string): string {
  const lower = value.toLowerCase();
  return /^\d+$/.test(lower)
    ? String(Number(lower))
    : lower.replace(/^0+(?=\d)/, '');
}

/**
 * The number of a record matches when its code is that number, or its title
 * starts with it ("Enabler 3: ...", "3. Netzwerke", "Use Case 4a ..."). The
 * number "3" does not match "3.6" or "3a": a longer number is another record.
 */
function matchesNumber(candidate: ContentCandidate, number: string): boolean {
  const wanted = normalizeNumber(number);
  if (candidate.code && normalizeNumber(foldText(candidate.code)) === wanted) {
    return true;
  }
  const title = foldText(candidate.title);
  const pattern = new RegExp(
    `^(?:enabler\\s*|use[ -]?case\\s*|uc\\s*)?0*${escapeRegExp(wanted)}(?![0-9a-z]|\\.[0-9])`
  );
  return pattern.test(title);
}

/** Letters and digits only: "K14-i", "k14 i" and "K14i" are one code. */
function compact(value: string): string {
  return foldText(value).replace(/[^a-z0-9]/g, '');
}

/** The name is the stable code of the record (at least three characters). */
function matchesCode(candidate: ContentCandidate, name: string): boolean {
  if (!candidate.code) return false;
  const wanted = compact(name);
  return wanted.length >= 3 && compact(candidate.code) === wanted;
}

/** The name (folded words) is part of the title, or equals it. */
function matchesName(
  candidate: ContentCandidate,
  name: string
): 'exact' | 'part' | null {
  const title = foldText(candidate.title);
  if (title === name) return 'exact';
  // the title without a leading "Enabler 3:" counts as the name too
  const bare = title.replace(
    /^(?:enabler\s*|use[ -]?case\s*|uc\s*)?[0-9]+[a-z]?(?:\.[0-9]+)*\s*/,
    ''
  );
  if (bare === name) return 'exact';
  return title.includes(name) ? 'part' : null;
}

/**
 * The record the reference names. One result, several (the caller asks for
 * the exact name) or none. A number decides before a name.
 */
export function matchContent(
  ref: ContentReference,
  candidates: readonly ContentCandidate[]
): MatchResult {
  let found: ContentCandidate[] = [];

  if (ref.number) {
    const number = ref.number;
    found = candidates.filter(c => matchesNumber(c, number));
  } else if (ref.name) {
    const name = foldText(ref.name);
    if (name.length < 3) return { status: 'none' };
    const exact: ContentCandidate[] = [];
    const part: ContentCandidate[] = [];
    for (const candidate of candidates) {
      // the code of the record said as a name ("K14-i", "HB C1") is exact
      const kind = matchesCode(candidate, name)
        ? 'exact'
        : matchesName(candidate, name);
      if (kind === 'exact') exact.push(candidate);
      else if (kind === 'part') part.push(candidate);
    }
    found = exact.length > 0 ? exact : part;
  }

  if (found.length === 0) return { status: 'none' };
  if (found.length === 1) return { status: 'one', item: found[0] };
  return { status: 'many', items: found };
}
