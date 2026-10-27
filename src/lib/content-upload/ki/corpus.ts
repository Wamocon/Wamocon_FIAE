// The solution texts that an excerpt must not repeat (docs/ki-upload-konzept.md
// 5.3 step 4). An excerpt of one file is checked against the solutions of ALL files
// of the run and against the solutions that already stand in the database, so a
// solution that a teaching text repeats, or a question that contains its own answer,
// is cut out before anything leaves the platform.
//
// Because that list depends on every file of the run, no excerpt is sent before the
// list is complete. Building it means reading the Word files that carry solutions
// (every Word file of the run), so it is done in small steps with a time
// budget, and a finished list is kept for a short time per run, keyed by the files
// of the run: a new or changed file means a new list.
//
// Nothing here is written anywhere. The texts live in memory for the run of the
// process and are only searched for, never sent and never logged.

import { createHash } from 'crypto';
import type { Paragraph } from '@/lib/content-import/types';
import {
  OBJECT_DELETED_KEY,
  type FileRow,
} from '@/lib/content-upload/staging/types';

/** Hard limits against a hostile run. */
export const CORPUS_LIMITS = Object.freeze({
  /** Texts of one file. */
  perFile: 2000,
  /** Texts of the whole list. */
  total: 40_000,
  /** Characters of one text (a longer one is cut: the first characters are what is searched for). */
  textChars: 3000,
});

const MAX_READ_TRIES = 3;
/** A file that could not be read waits this long before its next try. */
const RETRY_GAP_MS = 5000;

export interface CorpusDeps {
  /** The files of the run. */
  listFiles(): Promise<FileRow[]>;
  /** The bytes of a file, or null when the object is gone. */
  loadBytes(file: FileRow): Promise<Uint8Array | null>;
  /** The paragraphs of a Word file, or null when it cannot be read. */
  readParagraphs(bytes: Uint8Array): Promise<Paragraph[] | null>;
  /** The solution texts a document names (excerpt.ts solutionTextsOf). */
  solutionsOf(paragraphs: readonly Paragraph[]): string[];
  /** Solutions that already stand in the database. */
  existing(limit: number): Promise<string[]>;
  clock(): number;
}

export interface CorpusOptions {
  concurrency?: number;
  /** Wait between two tries to read one file (default 5 s). */
  retryGapMs?: number;
}

/**
 * The files that count, as a stable key: a change of any of them is a new list.
 * Only what decides the solution texts goes in (the file and its hash), so the
 * list survives the states a file passes through while the run is worked.
 */
export function corpusSignature(files: readonly FileRow[]): string {
  const hash = createHash('sha256');
  const ids = files
    .filter(relevant)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const f of ids) hash.update(`${f.id}:${f.sha256}
`);
  return hash.digest('hex');
}

function relevant(file: FileRow): boolean {
  return (
    // Every Word file, whatever type the rules gave it: a quiz that stands in an
    // enabler folder still holds solutions. (A PDF is only an original of a Word
    // file, and its solutions stand in that file too.)
    file.ext === 'docx' &&
    // a file whose object is gone cannot be read, and is not an error of the run
    file.parseSummary?.[OBJECT_DELETED_KEY] !== true &&
    // a file that never got read or was left out carries nothing to search for
    file.status !== 'failed' &&
    file.status !== 'rejected' &&
    file.status !== 'expired' &&
    file.status !== 'merged'
  );
}

export class SolutionCorpus {
  /** One array for the life of the list: the excerpt module indexes it by identity. */
  readonly texts: string[] = [];
  private done = new Set<string>();
  private pending: FileRow[] | null = null;
  private existingLoaded = false;
  private unreadable = 0;
  private attempts = new Map<string, number>();
  private lastTry = new Map<string, number>();
  /** A text was dropped because of a limit: the list is not complete. */
  private overflowed = false;

  constructor(
    private readonly deps: CorpusDeps,
    private readonly options: CorpusOptions = {}
  ) {}

  /** Files that could not be read (their solutions are not in the list). */
  get unreadableFiles(): number {
    return this.unreadable;
  }

  /** True when a limit cut the list: a solution may be missing, nothing is sent. */
  get isOverflowed(): boolean {
    return this.overflowed;
  }

  private add(texts: readonly string[], limit: number) {
    const seen = new Set<string>();
    for (const text of texts) {
      const t = text.slice(0, CORPUS_LIMITS.textChars);
      if (t.trim().length === 0 || seen.has(t)) continue;
      if (this.texts.length >= CORPUS_LIMITS.total || seen.size >= limit) {
        // fail closed: a text that does not fit is a text the guard cannot look for
        this.overflowed = true;
        return;
      }
      seen.add(t);
      this.texts.push(t);
    }
  }

  /**
   * Works for at most `budgetMs`. Returns true when the list is complete. A file
   * that cannot be read fails closed: the list is then NOT complete (an unreadable
   * file may hold a solution that the other files repeat), the caller sends
   * nothing.
   */
  async advance(budgetMs: number): Promise<boolean> {
    const started = this.deps.clock();
    if (!this.existingLoaded) {
      // one more than fits: seeing it means that the database holds more than the list
      const existing = await this.deps.existing(CORPUS_LIMITS.total + 1);
      if (existing.length > CORPUS_LIMITS.total) this.overflowed = true;
      this.add(existing, CORPUS_LIMITS.total);
      this.existingLoaded = true;
    }
    this.pending ??= (await this.deps.listFiles()).filter(relevant);
    const concurrency = Math.max(1, this.options.concurrency ?? 4);
    const gap = this.options.retryGapMs ?? RETRY_GAP_MS;
    const tried = new Set<string>();
    for (;;) {
      const open = this.pending.filter(f => !this.done.has(f.id));
      if (open.length === 0) return this.unreadable === 0 && !this.overflowed;
      // a file that failed a moment ago waits (one glitch is one try, not three)
      for (const f of open) {
        const last = this.lastTry.get(f.id);
        if (last !== undefined && this.deps.clock() - last < gap) tried.add(f.id);
      }
      const batch = open.filter(f => !tried.has(f.id)).slice(0, concurrency);
      // nothing left that this call may try, or no time: the list is not complete
      if (batch.length === 0 || this.deps.clock() - started >= budgetMs) {
        return false;
      }
      await Promise.all(
        batch.map(async file => {
          tried.add(file.id);
          this.lastTry.set(file.id, this.deps.clock());
          let texts: string[] | null = null;
          try {
            const bytes = await this.deps.loadBytes(file);
            const paragraphs = bytes
              ? await this.deps.readParagraphs(bytes)
              : null;
            if (paragraphs) texts = this.deps.solutionsOf(paragraphs);
          } catch {
            texts = null;
          }
          if (texts) {
            this.add(texts, CORPUS_LIMITS.perFile);
            this.done.add(file.id);
            return;
          }
          // a glitch gets three tries over three calls, then the file counts as unreadable
          const attempts = (this.attempts.get(file.id) ?? 0) + 1;
          this.attempts.set(file.id, attempts);
          if (attempts >= MAX_READ_TRIES) {
            this.unreadable += 1;
            this.done.add(file.id);
          }
        })
      );
    }
  }
}

/** Finished or partial lists of a few runs, kept for a short time. */
const KEEP_MS = 10 * 60 * 1000;
const KEEP_RUNS = 6;
const cache = new Map<
  string,
  { signature: string; corpus: SolutionCorpus; at: number }
>();

/** The list of a run, new when the files of the run changed. */
export async function corpusFor(
  runId: string,
  deps: CorpusDeps,
  options?: CorpusOptions
): Promise<SolutionCorpus> {
  const now = deps.clock();
  for (const [key, entry] of cache) {
    if (now - entry.at > KEEP_MS) cache.delete(key);
  }
  const signature = corpusSignature(await deps.listFiles());
  const known = cache.get(runId);
  if (known && known.signature === signature) {
    known.at = now;
    return known.corpus;
  }
  const corpus = new SolutionCorpus(deps, options);
  cache.set(runId, { signature, corpus, at: now });
  while (cache.size > KEEP_RUNS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return corpus;
}

/** For the tests: forget every list. */
export function resetCorpusCache(): void {
  cache.clear();
}
