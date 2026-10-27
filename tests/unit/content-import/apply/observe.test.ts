// The findings of the engines for a supply of content (docs/ki-upload-konzept.md 8.9):
// observe() names every item as new, unchanged, extended, differs or conflict, and
// updateFilter() restricts an update to the rows a person chose. Invented content,
// memory database.
import { executePlan } from '@/lib/content-import/apply/engine';
import type { RunOptions } from '@/lib/content-import/apply/engine';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import type { ItemEvent } from '@/lib/content-import/apply/types';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import {
  DIR,
  completeEnabler,
  enablerContent,
  file,
  loadDecisions,
  quizContent,
} from './fixtures';

const NOW = new Date('2026-10-27T12:00:00Z');
const decisions = loadDecisions();

const plan = (files: ReturnType<typeof completeEnabler>) =>
  buildImportPlan(files, decisions, { now: NOW });

function run(
  db: MemoryImportDb,
  files: ReturnType<typeof completeEnabler>,
  patch: Partial<RunOptions> = {}
) {
  const events: ItemEvent[] = [];
  const promise = executePlan(db, plan(files), {
    createdBy: CREATOR_ID,
    updateExisting: false,
    write: true,
    activate: false,
    scenarioSolutions: false,
    extendQuizzes: true,
    observe: e => events.push(e),
    ...patch,
  });
  return promise.then(report => ({ report, events }));
}

const status = (events: ItemEvent[], table: string, key: string) =>
  events.filter(e => e.table === table && e.key === key).map(e => e.status);

describe('observe', () => {
  const k1a = () => completeEnabler(DIR.k1, '1', 'a');

  it('says new for what is inserted and unchanged for the second run', async () => {
    const db = new MemoryImportDb();
    const first = await run(db, k1a());
    expect(status(first.events, 'enablers', 'K1-a')).toEqual(['new']);
    expect(status(first.events, 'quizzes', 'K1-a-low')).toEqual(['new']);
    expect(
      first.events.filter(
        e => e.table === 'content_documents' && e.status === 'new'
      )
    ).toHaveLength(1);

    const second = await run(db, k1a());
    expect(status(second.events, 'enablers', 'K1-a')).toEqual(['unchanged']);
    expect(status(second.events, 'quizzes', 'K1-a-low')).toContain('unchanged');
    expect(second.events.some(e => e.status === 'new')).toBe(false);
    // idempotent: the second run wrote nothing
    expect(
      Object.values(second.report.tables).reduce((n, c) => n + c.insert, 0)
    ).toBe(0);
  });

  it('says extended for a quiz that gets its missing questions, with the numbers', async () => {
    const db = new MemoryImportDb();
    const short = k1a().map(f =>
      f.rel.endsWith('Quiz_Low.docx')
        ? file(
            f.rel,
            quizContent({
              heading: '1a) Erfundenes Enabler-Thema',
              level: 'leicht',
              tag: '1aLow',
              count: 8,
            })
          )
        : f
    );
    await run(db, short);
    const second = await run(db, k1a());
    expect(second.report.conflicts).toEqual([]);
    const extended = second.events.filter(e => e.status === 'extended');
    expect(extended).toEqual([
      {
        table: 'quizzes',
        key: 'K1-a-low',
        status: 'extended',
        added: 2,
        moved: 0,
      },
    ]);
    expect(second.report.extended).toEqual([
      { quiz: 'K1-a-low', added: 2, moved: 0 },
    ]);
    // a third run has nothing left to add
    const third = await run(db, k1a());
    expect(third.events.some(e => e.status === 'extended')).toBe(false);
  });

  it('says differs for another text, and writes it only for a row the filter allows', async () => {
    const db = new MemoryImportDb();
    await run(db, k1a());
    const changed = k1a().map(f =>
      f.rel.endsWith('1a.docx')
        ? file(
            f.rel,
            enablerContent('1a) Erfundenes Enabler-Thema', ['Ganz neuer Text.'])
          )
        : f
    );
    const textOf = () => db.tables.enablers[0].description_text;
    const before = textOf();

    const refused = await run(db, changed, {
      updateExisting: true,
      updateFilter: () => false,
    });
    expect(status(refused.events, 'enablers', 'K1-a')).toEqual(['differs']);
    expect(refused.report.differences).toEqual([
      { table: 'enablers', key: 'K1-a', columns: ['description_text'] },
    ]);
    expect(textOf()).toBe(before);

    const plain = await run(db, changed);
    expect(status(plain.events, 'enablers', 'K1-a')).toEqual(['differs']);
    expect(textOf()).toBe(before);

    const allowed = await run(db, changed, {
      updateExisting: true,
      updateFilter: (table, key) => table === 'enablers' && key === 'K1-a',
    });
    expect(allowed.report.tables.enablers.update).toBe(1);
    expect(textOf()).toContain('Ganz neuer Text.');
  });

  it('says conflict for a key that means something else', async () => {
    const db = new MemoryImportDb();
    await run(db, k1a());
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    quiz.quiz_type = 'GLOBAL';
    const result = await run(db, k1a(), { write: false });
    expect(status(result.events, 'quizzes', 'K1-a-low')).toEqual(['conflict']);
    expect(result.report.conflicts).toHaveLength(1);
  });

  it('adds a scenario that is missing for an existing enabler', async () => {
    const db = new MemoryImportDb();
    const withoutScenario = k1a().filter(f => !f.rel.includes('Szenario'));
    await run(db, withoutScenario);
    expect(db.tables.content_documents).toHaveLength(0);
    const second = await run(db, k1a());
    expect(
      second.events.filter(
        e => e.table === 'content_documents' && e.status === 'new'
      )
    ).toHaveLength(1);
    expect(db.tables.content_documents).toHaveLength(1);
    const third = await run(db, k1a());
    expect(third.events.some(e => e.status === 'new')).toBe(false);
  });
});
