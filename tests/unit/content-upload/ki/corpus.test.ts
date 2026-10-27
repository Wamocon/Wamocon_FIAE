/**
 * @jest-environment node
 */
import type { Paragraph } from '@/lib/content-import/types';
import { solutionTextsOf } from '@/lib/content-upload/excerpt';
import {
  CORPUS_LIMITS,
  SolutionCorpus,
  corpusFor,
  corpusSignature,
  resetCorpusCache,
  type CorpusDeps,
} from '@/lib/content-upload/ki/corpus';
import type { FileRow } from '@/lib/content-upload/staging/types';
import {
  CANARY,
  blocksToParagraphs,
  quizBlocks,
  scenarioBlocks,
  useCaseBlocks,
  enablerBlocks,
} from '../../../helpers/uploadFixtures';

const file = (id: string, overrides: Partial<FileRow> = {}): FileRow => ({
  id,
  runId: 'r1',
  relPath: `lose/${id}.docx`,
  fileName: `${id}.docx`,
  ext: 'docx',
  sizeBytes: 10,
  sha256: id.padEnd(64, '0'),
  clientMtimeMs: null,
  storagePath: `upload/${id}`,
  status: 'proposed_rules',
  statusCode: null,
  attempts: 0,
  lockedUntil: null,
  claimId: null,
  duplicateOfId: null,
  docType: 'quiz',
  pageCount: null,
  charCount: null,
  parseSummary: null,
  dupKey: null,
  createdAt: new Date(0),
  completedAt: null,
  processedAt: null,
  ...overrides,
});

function deps(
  files: FileRow[],
  contents: Record<string, Paragraph[] | null | 'throw'>,
  extra: Partial<CorpusDeps> = {}
): CorpusDeps & { loads: string[] } {
  const loads: string[] = [];
  let now = 0;
  return {
    loads,
    listFiles: async () => files,
    loadBytes: async f => {
      loads.push(f.id);
      return new TextEncoder().encode(f.id);
    },
    readParagraphs: async bytes => {
      const id = new TextDecoder().decode(bytes);
      const value = contents[id];
      if (value === 'throw') throw new Error('boom');
      return value ?? null;
    },
    solutionsOf: solutionTextsOf,
    existing: async () => [],
    clock: () => (now += 1),
    ...extra,
  };
}

const quiz = blocksToParagraphs(quizBlocks({ code: '1a', questions: 2 }));
const scenario = blocksToParagraphs(scenarioBlocks({ code: '1a' }));

describe('solutionTextsOf', () => {
  it('names the solution texts of a quiz, a scenario and a use case, and nothing else', () => {
    const quizTexts = solutionTextsOf(quiz);
    expect(quizTexts.join('\n')).toContain('ZEBRAKANAL');
    expect(quizTexts.join('\n')).toContain('QUOKKA');
    const scenarioTexts = solutionTextsOf(scenario);
    expect(scenarioTexts).toEqual(
      expect.arrayContaining([CANARY.scenarioSolution, CANARY.knowledge])
    );
    const useCase = solutionTextsOf(blocksToParagraphs(useCaseBlocks()));
    expect(useCase.join('\n')).toContain('OKAPI');
    expect(solutionTextsOf(blocksToParagraphs(enablerBlocks()))).toEqual([]);
    expect(solutionTextsOf([])).toEqual([]);
  });
});

describe('the list of solution texts of a run', () => {
  beforeEach(resetCorpusCache);

  it('reads every Word file and knows the texts of the database', async () => {
    const d = deps(
      [file('a'), file('b', { docType: 'enabler' }), file('p', { ext: 'pdf' })],
      { a: quiz, b: scenario },
      { existing: async () => ['Eine erfundene Lösung aus der Datenbank'] }
    );
    const corpus = new SolutionCorpus(d);
    expect(await corpus.advance(1000)).toBe(true);
    // the quiz, a scenario in a file typed as enabler, and the database
    expect(corpus.texts).toEqual(
      expect.arrayContaining([
        CANARY.scenarioSolution,
        'Eine erfundene Lösung aus der Datenbank',
      ])
    );
    expect(corpus.texts.join('\n')).toContain('QUOKKA');
    // a PDF is only an original of a Word file
    expect(d.loads.sort()).toEqual(['a', 'b']);
  });

  it('leaves out files that failed, were rejected or are copies', async () => {
    const d = deps(
      ['failed', 'rejected', 'expired', 'merged'].map(status =>
        file(status, { status: status as FileRow['status'] })
      ),
      {}
    );
    expect(await new SolutionCorpus(d).advance(1000)).toBe(true);
    expect(d.loads).toEqual([]);
  });

  it('works in steps within its time budget and says it is not complete yet', async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`f${i}`));
    const contents = Object.fromEntries(files.map(f => [f.id, quiz]));
    let now = 0;
    const d = deps(files, contents, {
      // every read takes 10 ms of the clock
      loadBytes: async f => {
        now += 10;
        return new TextEncoder().encode(f.id);
      },
      clock: () => now,
    });
    const corpus = new SolutionCorpus(d, { concurrency: 2 });
    expect(await corpus.advance(25)).toBe(false);
    expect(await corpus.advance(25)).toBe(false);
    let rounds = 0;
    while (!(await corpus.advance(25)) && rounds < 10) rounds += 1;
    expect(rounds).toBeLessThan(10);
    expect(await corpus.advance(0)).toBe(true);
  });

  it('is not complete while a file cannot be read, and gives up on it after three tries', async () => {
    const d = deps([file('a'), file('b')], { a: quiz, b: null });
    const corpus = new SolutionCorpus(d, { retryGapMs: 0 });
    // each call tries the unreadable file once
    expect(await corpus.advance(1000)).toBe(false);
    expect(await corpus.advance(1000)).toBe(false);
    // the third try: the file counts as unreadable and the list is final but not complete
    expect(await corpus.advance(1000)).toBe(false);
    expect(corpus.unreadableFiles).toBe(1);
    expect(await corpus.advance(1000)).toBe(false);
    expect(d.loads.filter(id => id === 'b')).toHaveLength(3);
    // the good file was read once
    expect(d.loads.filter(id => id === 'a')).toHaveLength(1);
  });

  it('lets a file that failed a moment ago rest, so one glitch is one try', async () => {
    let now = 0;
    const d = deps([file('a')], { a: null }, { clock: () => now });
    const corpus = new SolutionCorpus(d, { retryGapMs: 5000 });
    expect(await corpus.advance(1000)).toBe(false);
    // asked again within the gap, in the same breath: no new try
    now += 1000;
    expect(await corpus.advance(1000)).toBe(false);
    expect(await corpus.advance(1000)).toBe(false);
    expect(d.loads).toHaveLength(1);
    now += 5000;
    expect(await corpus.advance(1000)).toBe(false);
    expect(d.loads).toHaveLength(2);
  });

  it('is not complete when a limit cut the list: a solution may be missing', async () => {
    const tooMany = Array.from(
      { length: CORPUS_LIMITS.total + 1 },
      (_, i) => `Eine erfundene Datenbanklösung Nummer ${i} mit genug Text`
    );
    const asked: number[] = [];
    const d = deps([file('a')], { a: quiz }, {
      existing: async limit => {
        asked.push(limit);
        return tooMany.slice(0, limit);
      },
    });
    const corpus = new SolutionCorpus(d);
    expect(await corpus.advance(1000)).toBe(false);
    expect(corpus.isOverflowed).toBe(true);
    // the database was asked for one more than fits, which is how the cut shows
    expect(asked).toEqual([CORPUS_LIMITS.total + 1]);
    expect(corpus.texts.length).toBeLessThanOrEqual(CORPUS_LIMITS.total);
    // and it stays incomplete
    expect(await corpus.advance(1000)).toBe(false);

    const perFile = new SolutionCorpus(
      deps([file('a')], { a: quiz }, {
        solutionsOf: () =>
          Array.from({ length: CORPUS_LIMITS.perFile + 1 }, (_, i) => `Text ${i} lang genug`),
      })
    );
    expect(await perFile.advance(1000)).toBe(false);
    expect(perFile.isOverflowed).toBe(true);
  });

  it('is complete with exactly as many texts as fit', async () => {
    const exact = Array.from(
      { length: CORPUS_LIMITS.total },
      (_, i) => `Eine erfundene Datenbanklösung Nummer ${i} mit genug Text`
    );
    const d = deps([], {}, { existing: async limit => exact.slice(0, limit) });
    const corpus = new SolutionCorpus(d);
    expect(await corpus.advance(1000)).toBe(true);
    expect(corpus.texts).toHaveLength(CORPUS_LIMITS.total);
  });

  it('leaves out a file whose object is gone: it is no error of the run', async () => {
    const d = deps(
      [
        file('a'),
        file('gone', { parseSummary: { objectDeleted: true } }),
      ],
      { a: quiz }
    );
    expect(await new SolutionCorpus(d).advance(1000)).toBe(true);
    expect(d.loads).toEqual(['a']);
  });

  it('survives a file whose reader throws', async () => {
    const d = deps([file('a')], { a: 'throw' });
    expect(await new SolutionCorpus(d).advance(1000)).toBe(false);
  });

  it('keeps one array, bounded, without duplicates and with cut texts', async () => {
    const long = 'x'.repeat(CORPUS_LIMITS.textChars + 500);
    const d = deps(
      [file('a')],
      { a: quiz },
      {
        existing: async () => [long, long, '   ', 'kurz'],
        solutionsOf: () => ['doppelt', 'doppelt'],
      }
    );
    const corpus = new SolutionCorpus(d);
    const array = corpus.texts;
    await corpus.advance(1000);
    expect(corpus.texts).toBe(array);
    expect(array.filter(t => t === 'doppelt')).toHaveLength(1);
    expect(array.find(t => t.startsWith('xxx'))!.length).toBe(
      CORPUS_LIMITS.textChars
    );
    expect(array).not.toContain('   ');
  });

  it('keeps the list for the run while its files do not change, and builds a new one when they do', async () => {
    const files = [file('a'), file('b')];
    const d = deps(files, { a: quiz, b: scenario });
    const first = await corpusFor('run-1', d);
    expect(await corpusFor('run-1', d)).toBe(first);
    // the states a file passes through are no reason for a new list
    files[0].status = 'decided';
    files[1].status = 'ki_pending';
    expect(await corpusFor('run-1', d)).toBe(first);
    // another run, or another file, is
    expect(await corpusFor('run-2', d)).not.toBe(first);
    files.push(file('c'));
    expect(await corpusFor('run-1', d)).not.toBe(first);
  });

  it('forgets a list after ten minutes and keeps only a few runs', async () => {
    let now = 0;
    const d = deps([file('a')], { a: quiz }, { clock: () => now });
    const first = await corpusFor('run-1', d);
    now += 11 * 60 * 1000;
    // an entry of another run is looked at, and the old one is dropped
    await corpusFor('run-2', d);
    expect(await corpusFor('run-1', d)).not.toBe(first);
    for (let i = 0; i < 10; i += 1) await corpusFor(`many-${i}`, d);
    expect(await corpusFor('many-0', d)).toBeDefined();
  });

  it('builds the signature from the files that count only', () => {
    const a = corpusSignature([file('a'), file('p', { ext: 'pdf' })]);
    expect(corpusSignature([file('a')])).toBe(a);
    expect(corpusSignature([file('a', { sha256: 'f'.repeat(64) })])).not.toBe(
      a
    );
    expect(corpusSignature([file('a'), file('b')])).not.toBe(a);
    expect(corpusSignature([file('b'), file('a')])).toBe(
      corpusSignature([file('a'), file('b')])
    );
  });
});
