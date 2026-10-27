// Duplicate groups of a run (docs/ki-upload-konzept.md 6.1 stage 0 and 6.2,
// "Dubletten"). Pure function over the files of a run, no database, no clock.
//
//   exact copies   files with the same SHA-256 are one file: the first by path is
//                  the primary, the others are merged into it. The decision is
//                  made on the primary.
//   versions       files with the same content key (quiz:1a:low, scenario:1a,
//                  global-quiz:06.1, pdf:...) are versions of one document. The
//                  suggestion is the newest: the highest version in the file name
//                  or folder, then the latest change. When the versions are equal
//                  and the changes lie within 24 hours of each other (the
//                  duplicates window of kfbm-decisions.json, "<=" like selectFiles
//                  in apply/plan.ts) nothing is suggested, and nothing is
//                  suggested for a use case next to its variant without a solution
//                  (as use-cases/plan.ts). The decision is always the user's.
//   archives       files in an archive folder are left out of every group.
//   similar files  files with a different hash and almost the same text, with
//                  another key or none (similarity.ts). A pair inside one version
//                  group is not repeated here, the group shows how alike the texts
//                  are instead.
//   originals      a PDF is bound to the Word file of the same content key.
//
// The time of change of the browser is not trustworthy: it is client controlled.
// An unknown time, and a time far in the future when the caller passes the time of
// now, leave the group without a suggestion instead of letting a file win by its
// date. The module reads no clock, the caller passes `now`.
//
// The order of the input does not matter, the answer is sorted.

import { contentKeyOf, type AssignedFields } from './assign';
import {
  findSimilarDocuments,
  fingerprintOf,
  groupSimilarPairs,
  jaccardOf,
  type Fingerprint,
  type SimilarityOptions,
} from './similarity';
import type { AssignmentFields, OriginalType, Reason } from './types';

const HOUR = 3600 * 1000;
const DEFAULT_WINDOW_HOURS = 24;
const MAX_VERSION = 999;
/** Files that one analysis takes; the function has no limit of the run itself. */
const MAX_FILES = 5000;
/** Jaccard value below which two versions of a key are different texts. */
const DIFFERENT_TEXT = 0.5;

export type DuplicateAssignment = AssignmentFields & {
  originalType?: OriginalType | null;
};

export interface DuplicateFile {
  id: string;
  /** SHA-256 as 64 hex characters, in any case. */
  sha256?: string | null;
  relPath: string;
  /** Time of change of the browser, milliseconds. Not trustworthy. */
  mtimeMs?: number | null;
  /** The assignment (proposal or decision), null when the file is unclear. */
  assignment?: DuplicateAssignment | null;
  /** The path is an archive: left out. */
  archived?: boolean;
  /** Left out for another reason (excluded component, rejected file). */
  excluded?: boolean;
  /** The file comes from a folder "Ohne Musterlösung". */
  withoutSolution?: boolean;
  /** Overrides the version read from the path. */
  version?: number | null;
  /** Text for the similarity check (never stored, never sent). */
  text?: string | null;
}

export interface DuplicateOptions {
  /** Window in hours, default 24. */
  ambiguousWithinHours?: number;
  /**
   * Time of now in milliseconds, from the caller (the module reads no clock). It
   * is needed to trust a time of change: without it, or with a time far in the
   * future, versions that are equal get no suggestion.
   */
  now?: number;
  similarity?: SimilarityOptions;
}

export interface ExactGroup {
  sha256: string;
  primaryId: string;
  memberIds: string[];
  /** The copies were assigned differently (the primary counts). */
  assignmentsDiffer?: true;
}

export interface KeyGroup {
  key: string;
  /** Best first. */
  memberIds: string[];
  suggestedId: string | null;
  ambiguous: boolean;
  reasons: Reason[];
  /** Jaccard value of each member to the first one, where texts were given. */
  similarity: Record<string, number>;
}

export interface SimilarFileGroup {
  id: string;
  memberIds: string[];
  maxJaccard: number;
}

export interface OriginalBinding {
  pdfId: string;
  wordId: string | null;
  candidateIds: string[];
  reason: 'NO_WORD_FILE' | 'AMBIGUOUS_WORD' | null;
}

export interface DuplicateAnalysis {
  exactGroups: ExactGroup[];
  /** Copy to primary. */
  mergedInto: Record<string, string>;
  keyGroups: KeyGroup[];
  similarGroups: SimilarFileGroup[];
  originals: OriginalBinding[];
  excluded: Array<{ id: string; reason: 'ARCHIVE' | 'EXCLUDED' }>;
  /** A limit cut the work (files, texts, pairs): the result may be incomplete. */
  truncated: boolean;
}

const TOKEN_V = /(?:^|[\s_.\-([])v(\d{1,3})(?![A-Za-z0-9])/i;

/**
 * Version of a file from its path: a suffix like _v2 in the file name, otherwise
 * the nearest folder with such a token (Quiz v3, Fassung (v5)). Words that only
 * contain a v are no version.
 */
export function versionOfPath(relPath: string): number | null {
  if (typeof relPath !== 'string' || relPath.length === 0) return null;
  const parts = relPath.split(/[\\/]+/).filter(part => part.length > 0);
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1].replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const candidates = [name, ...parts.slice(0, -1).reverse()];
  for (const candidate of candidates) {
    const m = TOKEN_V.exec(candidate);
    if (m) {
      const value = Number(m[1]);
      if (value <= MAX_VERSION) return value;
    }
  }
  return null;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
/** A version is a whole number from 0 to 999, anything else is no version. */
const validVersion = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_VERSION
    ? value
    : null;
const validSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);

interface Item {
  file: DuplicateFile;
  id: string;
  relPath: string;
  sha: string | null;
  key: string | null;
  version: number;
  mtime: number | null;
}

const keyOf = (assignment: DuplicateAssignment | null | undefined) =>
  assignment
    ? contentKeyOf({
        docType: assignment.docType ?? null,
        componentCode: assignment.componentCode ?? null,
        enablerCode: assignment.enablerCode ?? null,
        quizLevel: assignment.quizLevel ?? null,
        originalType: assignment.originalType ?? null,
      } as AssignedFields)
    : null;

const reason = (code: string, text: string): Reason => ({ code, text });

/** Newest first: version, then change, then path and id as a fixed tie break. */
function newestFirst(a: Item, b: Item): number {
  if (a.version !== b.version) return b.version - a.version;
  if (a.mtime !== b.mtime) {
    if (a.mtime === null) return 1;
    if (b.mtime === null) return -1;
    return b.mtime - a.mtime;
  }
  return byText(a.relPath, b.relPath) || byText(a.id, b.id);
}

function judgeGroup(
  members: Item[],
  windowMs: number,
  windowHours: number,
  now: number | undefined
): { suggestedId: string | null; ambiguous: boolean; reasons: Reason[] } {
  const [best, second] = members;
  if (members.some(m => m.file.withoutSolution === true)) {
    return {
      suggestedId: null,
      ambiguous: true,
      reasons: [
        reason(
          'SOLUTION_VARIANT',
          'Eine der Dateien kommt aus einem Ordner ohne Musterlösung, welche gilt, entscheidet der Nutzer.'
        ),
      ],
    };
  }
  if (best.version !== second.version) {
    return {
      suggestedId: best.id,
      ambiguous: false,
      reasons: [
        reason(
          'NEWEST_VERSION',
          'Vorschlag: die Fassung mit der höchsten Version.'
        ),
      ],
    };
  }
  if (best.mtime === null || second.mtime === null) {
    return {
      suggestedId: null,
      ambiguous: true,
      reasons: [
        reason(
          'MTIME_UNKNOWN',
          'Gleiche Version und die Änderungszeit ist unbekannt, es gibt keinen Vorschlag.'
        ),
      ],
    };
  }
  // Without the time of now a date cannot be checked: fail closed.
  if (now === undefined) {
    return {
      suggestedId: null,
      ambiguous: true,
      reasons: [
        reason(
          'MTIME_UNVERIFIED',
          'Gleiche Version und die Änderungszeit lässt sich nicht prüfen, es gibt keinen Vorschlag.'
        ),
      ],
    };
  }
  if (best.mtime > now + windowMs || second.mtime > now + windowMs) {
    return {
      suggestedId: null,
      ambiguous: true,
      reasons: [
        reason(
          'MTIME_IN_FUTURE',
          'Eine Änderungszeit liegt in der Zukunft und ist nicht vertrauenswürdig, es gibt keinen Vorschlag.'
        ),
      ],
    };
  }
  if (best.mtime - second.mtime <= windowMs) {
    return {
      suggestedId: null,
      ambiguous: true,
      reasons: [
        reason(
          'AMBIGUOUS_WITHIN_WINDOW',
          `Gleiche Version und Änderungen innerhalb von ${windowHours} Stunden, es gibt keinen Vorschlag.`
        ),
      ],
    };
  }
  return {
    suggestedId: best.id,
    ambiguous: false,
    reasons: [
      reason(
        'NEWEST_CHANGE',
        'Vorschlag: die Fassung mit der jüngsten Änderung.'
      ),
    ],
  };
}

/** Groups the files of a run. Never throws. */
export function analyzeDuplicates(
  files: ReadonlyArray<DuplicateFile>,
  options: DuplicateOptions = {}
): DuplicateAnalysis {
  const hours =
    typeof options.ambiguousWithinHours === 'number' &&
    Number.isFinite(options.ambiguousWithinHours) &&
    options.ambiguousWithinHours >= 0
      ? options.ambiguousWithinHours
      : DEFAULT_WINDOW_HOURS;
  const windowMs = hours * HOUR;
  const now = validTime(options.now) ? options.now : undefined;

  // clean input: objects with an id. Sorted first, then a repeated id keeps the
  // first by path, so the answer does not depend on the order of the input.
  const valid: Item[] = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file !== 'object' || typeof file.id !== 'string')
      continue;
    const relPath = typeof file.relPath === 'string' ? file.relPath : '';
    valid.push({
      file,
      id: file.id,
      relPath,
      sha: validSha(file.sha256) ? file.sha256.toLowerCase() : null,
      key: keyOf(file.assignment),
      version: validVersion(file.version) ?? versionOfPath(relPath) ?? 0,
      mtime: validTime(file.mtimeMs) ? file.mtimeMs : null,
    });
  }
  valid.sort((a, b) => byText(a.id, b.id) || byText(a.relPath, b.relPath));
  const seen = new Set<string>();
  let items: Item[] = [];
  for (const item of valid) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  let truncated = false;
  if (items.length > MAX_FILES) {
    items = items.slice(0, MAX_FILES);
    truncated = true;
  }

  const excluded: DuplicateAnalysis['excluded'] = [];
  const active: Item[] = [];
  for (const item of items) {
    if (item.file.archived === true)
      excluded.push({ id: item.id, reason: 'ARCHIVE' });
    else if (item.file.excluded === true)
      excluded.push({ id: item.id, reason: 'EXCLUDED' });
    else active.push(item);
  }

  // exact copies
  const bySha = new Map<string, Item[]>();
  for (const item of active) {
    if (!item.sha) continue;
    const list = bySha.get(item.sha);
    if (list) list.push(item);
    else bySha.set(item.sha, [item]);
  }
  const exactGroups: ExactGroup[] = [];
  // no prototype: an id like __proto__ is a key like any other
  const mergedInto: Record<string, string> = Object.create(null);
  const merged = new Set<string>();
  for (const [sha, group] of [...bySha.entries()].sort((a, b) =>
    byText(a[0], b[0])
  )) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) => byText(a.relPath, b.relPath) || byText(a.id, b.id)
    );
    const primary = ordered[0];
    for (const copy of ordered.slice(1)) {
      mergedInto[copy.id] = primary.id;
      merged.add(copy.id);
    }
    // an assignment without a key (incomplete) counts by its fields
    const same = (item: Item) =>
      item.key !== null && primary.key !== null
        ? item.key === primary.key
        : JSON.stringify(item.file.assignment ?? null) ===
          JSON.stringify(primary.file.assignment ?? null);
    const differ = ordered.some(item => !same(item));
    exactGroups.push({
      sha256: sha,
      primaryId: primary.id,
      memberIds: ordered.map(item => item.id),
      ...(differ ? { assignmentsDiffer: true as const } : {}),
    });
  }
  const representatives = active.filter(item => !merged.has(item.id));

  // fingerprints of the texts, built once for the groups and the similarity
  const prints = new Map<string, Fingerprint>();
  for (const item of representatives) {
    const text = item.file.text;
    if (typeof text === 'string' && text.length > 0) {
      const print = fingerprintOf(text, options.similarity);
      if (print) {
        prints.set(item.id, print);
        if (print.truncated) truncated = true;
      }
    }
  }

  // versions of one content key
  const byKey = new Map<string, Item[]>();
  for (const item of representatives) {
    if (!item.key) continue;
    const list = byKey.get(item.key);
    if (list) list.push(item);
    else byKey.set(item.key, [item]);
  }
  const keyGroups: KeyGroup[] = [];
  const groupOfKey = new Map<string, KeyGroup>();
  for (const [key, group] of [...byKey.entries()].sort((a, b) =>
    byText(a[0], b[0])
  )) {
    if (group.length < 2) continue;
    const members = [...group].sort(newestFirst);
    const judged = judgeGroup(members, windowMs, hours, now);
    const first = prints.get(members[0].id);
    const similarity: Record<string, number> = Object.create(null);
    if (first) {
      for (const member of members) {
        const print = prints.get(member.id);
        if (print) similarity[member.id] = jaccardOf(first, print);
      }
    }
    // the newest version of a text that has little to do with the older one
    // is a hint that the key is shared by two different documents
    const reasons = [...judged.reasons];
    if (
      judged.suggestedId &&
      Object.values(similarity).some(value => value < DIFFERENT_TEXT)
    ) {
      reasons.push(
        reason(
          'TEXT_DIFFERS',
          'Die Texte der Fassungen sind sehr verschieden, bitte vor der Wahl vergleichen.'
        )
      );
    }
    const built: KeyGroup = {
      key,
      memberIds: members.map(m => m.id),
      suggestedId: judged.suggestedId,
      ambiguous: judged.ambiguous,
      reasons,
      similarity,
    };
    keyGroups.push(built);
    groupOfKey.set(key, built);
  }

  // PDF originals
  const originals: OriginalBinding[] = [];
  for (const item of representatives) {
    if (!item.key || !item.key.startsWith('pdf:')) continue;
    const wordKey = item.key.slice(4);
    const group = groupOfKey.get(wordKey);
    const candidates = group
      ? group.memberIds
      : (byKey.get(wordKey) ?? []).map(r => r.id);
    let wordId: string | null = null;
    let why: OriginalBinding['reason'] = null;
    if (candidates.length === 0) why = 'NO_WORD_FILE';
    else if (candidates.length === 1) wordId = candidates[0];
    else if (group?.suggestedId) wordId = group.suggestedId;
    else why = 'AMBIGUOUS_WORD';
    originals.push({
      pdfId: item.id,
      wordId,
      candidateIds: candidates,
      reason: why,
    });
  }
  originals.sort((a, b) => byText(a.pdfId, b.pdfId));

  // similar files with another key (or none)
  const textual = representatives
    .filter(item => prints.has(item.id))
    .map(item => ({
      id: item.id,
      text: '',
      print: prints.get(item.id) ?? null,
    }));
  const keyOfId = new Map(representatives.map(item => [item.id, item.key]));
  const similar = findSimilarDocuments(textual, options.similarity);
  if (similar.truncated) truncated = true;
  // a PDF and the Word file it is the original of are the same text on purpose
  const boundTo = new Map<string, Set<string>>();
  for (const original of originals) {
    boundTo.set(original.pdfId, new Set(original.candidateIds));
  }
  const isBound = (pdf: string, word: string) =>
    boundTo.get(pdf)?.has(word) === true;
  const crossPairs = similar.pairs.filter(pair => {
    const ka = keyOfId.get(pair.a);
    const kb = keyOfId.get(pair.b);
    if (ka && ka === kb && groupOfKey.has(ka)) return false;
    return !isBound(pair.a, pair.b) && !isBound(pair.b, pair.a);
  });
  const similarGroups: SimilarFileGroup[] = groupSimilarPairs(crossPairs).map(
    g => ({
      id: g.id,
      memberIds: g.members,
      maxJaccard: g.maxJaccard,
    })
  );

  return {
    exactGroups,
    mergedInto,
    keyGroups,
    similarGroups,
    originals,
    excluded,
    truncated,
  };
}
