/**
 * @jest-environment node
 */
// The pieces of the learning field transfer and of the JSON kinds that are pure
// functions (package UP2): the status events of the Excel file, the hash of the plan, the
// attribution of rows to the file, text arrays in the rollback text, and the check of an
// assignment of a JSON or Excel file.
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { PositiveList } from '@/lib/content-upload/classify/positive-list';
import {
  decisionsHash,
  canonicalPlan,
} from '@/lib/content-upload/transfer/canonical';
import { planAttribution } from '@/lib/content-upload/transfer/attribution';
import {
  buildRollbackSql,
  RollbackSqlError,
} from '@/lib/content-upload/transfer/rollback';
import {
  learningEvents,
  stockOfFiles,
} from '@/lib/content-upload/transfer/stock';
import { learningTables } from '@/lib/content-upload/transfer/run';
import { checkAssignment } from '@/lib/content-upload/review/validate';
import type { ImportPlan } from '@/lib/content-import/apply/types';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';

import {
  sampleIndex,
  sampleSheet,
} from '../../content-import/learning-fields/fixtures';

const zero = { insert: 0, update: 0, unchanged: 0 };
const NOW = new Date('2026-10-27T10:00:00Z');
const LATER = new Date('2026-10-27T11:00:00Z');
const FILE = 'ffffffff-0000-4000-8000-000000000001';

const report = (over: Record<string, unknown> = {}) => ({
  skipped: [] as Array<{ code: string }>,
  tables: {
    training_catalog_learning_fields: zero,
    training_catalog_content_mappings: zero,
  },
  useCaseMappings: zero,
  useCaseCodes: zero,
  conflicts: [] as Array<{ table: string; key: string }>,
  ...over,
});

describe('learningEvents', () => {
  const statusOf = (r: ReturnType<typeof report>) =>
    stockOfFiles({
      events: learningEvents(r),
      importPlan: {
        enablers: [],
        scenarios: [],
        quizzes: [],
      } as unknown as ImportPlan,
      useCasePlan: { useCases: [] } as never,
      fileOfSource: new Map(),
      learningFileId: FILE,
    }).get(FILE)?.status;

  it('says new for a first run, whatever the use cases get next to it', () => {
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: { ...zero, insert: 13 },
            training_catalog_content_mappings: { ...zero, insert: 22 },
          },
          useCaseMappings: { ...zero, insert: 3 },
          useCaseCodes: { ...zero, update: 3 },
        })
      )
    ).toBe('new');
  });

  it('says extended when something is added next to what exists, or an addition alone', () => {
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: { ...zero, unchanged: 13 },
            training_catalog_content_mappings: {
              ...zero,
              insert: 2,
              unchanged: 20,
            },
          },
        })
      )
    ).toBe('extended');
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: { ...zero, unchanged: 13 },
            training_catalog_content_mappings: { ...zero, unchanged: 22 },
          },
          useCaseCodes: { ...zero, update: 1, unchanged: 2 },
        })
      )
    ).toBe('extended');
  });

  it('says unchanged when everything exists, never differs, and conflict for a conflict', () => {
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: { ...zero, unchanged: 13 },
            training_catalog_content_mappings: { ...zero, unchanged: 22 },
          },
        })
      )
    ).toBe('unchanged');
    expect(statusOf(report())).toBeUndefined();
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: { ...zero, insert: 13 },
            training_catalog_content_mappings: zero,
          },
          conflicts: [
            { table: 'training_catalog_learning_fields', key: 'LF3' },
          ],
        })
      )
    ).toBe('conflict');
    const all = learningEvents(
      report({
        tables: {
          training_catalog_learning_fields: {
            ...zero,
            update: 2,
            unchanged: 11,
          },
          training_catalog_content_mappings: zero,
        },
      })
    );
    expect(all.map(e => e.status)).not.toContain('differs');
  });

  it('says new when only mappings wait for enablers that this transfer brings, extended next to unchanged rows', () => {
    const waiting = [{ code: 'ENABLER_NOT_IN_DATABASE' }];
    const everyThingExists = {
      training_catalog_learning_fields: { ...zero, unchanged: 13 },
      training_catalog_content_mappings: zero,
    };
    expect(
      statusOf(report({ tables: everyThingExists, skipped: waiting }))
    ).toBe('extended');
    expect(
      statusOf(
        report({
          tables: {
            training_catalog_learning_fields: zero,
            training_catalog_content_mappings: zero,
          },
          skipped: waiting,
        })
      )
    ).toBe('new');
    expect(statusOf(report({ tables: everyThingExists }))).toBe('unchanged');
  });

  it('maps its rows to the file only when the plan has one', () => {
    const events = learningEvents(
      report({
        tables: {
          training_catalog_learning_fields: { ...zero, insert: 1 },
          training_catalog_content_mappings: zero,
        },
      })
    );
    const refs = {
      importPlan: {
        enablers: [],
        scenarios: [],
        quizzes: [],
      } as unknown as ImportPlan,
      useCasePlan: { useCases: [] } as never,
      fileOfSource: new Map<string, string>(),
    };
    expect(stockOfFiles({ ...refs, events }).size).toBe(0);
    expect(stockOfFiles({ ...refs, events, learningFileId: FILE }).size).toBe(
      1
    );
  });
});

describe('learningTables', () => {
  it('puts the mappings of enablers and use cases into one table and the codes into use_cases', () => {
    const tables = learningTables(
      {
        catalog: 'KFBM',
        tables: {
          training_catalog_learning_fields: {
            insert: 13,
            update: 0,
            unchanged: 0,
          },
          training_catalog_content_mappings: {
            insert: 22,
            update: 0,
            unchanged: 0,
          },
        },
        skipped: [],
        conflicts: [],
        differences: [],
        keptMappings: 0,
        useCaseMappings: { insert: 3, update: 0, unchanged: 1 },
        useCaseCodes: { insert: 0, update: 2, unchanged: 1 },
        enablersWithoutUseCase: [],
        useCasesWithoutEnabler: [],
        wrote: true,
      },
      { use_cases: { insert: 4, update: 0, unchanged: 1 } }
    );
    expect(tables).toEqual({
      training_catalog_learning_fields: { insert: 13, update: 0, unchanged: 0 },
      training_catalog_content_mappings: {
        insert: 25,
        update: 0,
        unchanged: 1,
      },
      use_cases: { insert: 4, update: 2, unchanged: 1 },
    });
  });
});

describe('the hash of a plan with a learning plan', () => {
  const base = {
    decisions: transferDecisions(),
    importPlan: {
      generatedAt: NOW.toISOString(),
      enablers: [],
    } as unknown as ImportPlan,
    useCasePlan: { generatedAt: NOW.toISOString(), useCases: [] } as never,
    options: { replaceFiles: [] },
    files: [],
    originals: [],
  };
  const plan = (now: Date, title?: string) =>
    buildLearningFieldPlan(sampleSheet(), sampleIndex(), {
      now,
      official: false,
      titles: title
        ? { titles: { 1: title }, years: {}, source: 'json', warnings: [] }
        : null,
    });

  it('names the plan and not the time of its build', () => {
    const one = decisionsHash({ ...base, learningPlan: plan(NOW) });
    const two = decisionsHash({ ...base, learningPlan: plan(LATER) });
    expect(one).toBe(two);
    expect(canonicalPlan({ ...base, learningPlan: plan(NOW) })).not.toContain(
      NOW.toISOString()
    );
  });

  it('changes with the table, and differs from a transfer without one', () => {
    const without = decisionsHash(base);
    const withNull = decisionsHash({ ...base, learningPlan: null });
    const withPlan = decisionsHash({ ...base, learningPlan: plan(NOW) });
    const other = decisionsHash({
      ...base,
      learningPlan: plan(NOW, 'Anderer Titel'),
    });
    expect(without).toBe(withNull);
    expect(withPlan).not.toBe(without);
    expect(other).not.toBe(withPlan);
  });

  it('says in the canonical plan that the learning engine only adds', () => {
    expect(canonicalPlan(base)).toContain('"learningUpdateExisting":false');
  });
});

describe('the attribution of the rows of the learning field import', () => {
  const attribution = planAttribution({
    importPlan: {
      quizzes: [],
      enablers: [],
      scenarios: [],
    } as unknown as ImportPlan,
    useCasePlan: { useCases: [{ code: 'K4-a', source: 'uc.docx' }] } as never,
    fileOfSource: new Map([['uc.docx', 'wordfile']]),
    learningFileId: FILE,
  });

  it('gives learning fields and mappings to the Excel file', () => {
    expect(
      attribution.inserted('training_catalog_learning_fields', { id: 'x' })
    ).toBe(FILE);
    expect(
      attribution.inserted('training_catalog_content_mappings', { id: 'y' })
    ).toBe(FILE);
  });

  it('gives the codes an update adds to a use case of the plan to the file of the use case, else to the Excel file', () => {
    expect(attribution.updated('use_cases', { id: 'u1', code: 'K4-a' })).toBe(
      'wordfile'
    );
    expect(attribution.updated('use_cases', { id: 'u2', code: 'K9-z' })).toBe(
      FILE
    );
    expect(
      attribution.inserted('use_cases', { id: 'u3', code: 'K9-z' })
    ).toBeNull();
    expect(
      attribution.updated('enablers', { id: 'e1', code: 'K4-a' })
    ).toBeNull();
  });

  it('gives nothing to anyone without an Excel file', () => {
    const none = planAttribution({
      importPlan: {
        quizzes: [],
        enablers: [],
        scenarios: [],
      } as unknown as ImportPlan,
      useCasePlan: { useCases: [] } as never,
      fileOfSource: new Map(),
    });
    expect(
      none.inserted('training_catalog_learning_fields', { id: 'x' })
    ).toBeNull();
    expect(none.updated('use_cases', { id: 'u', code: 'K1-a' })).toBeNull();
  });
});

describe('the rollback text and a list of codes', () => {
  const ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  const rollback = (before: Record<string, unknown>) =>
    buildRollbackSql({
      applyId: 'bbbbbbbb-0000-4000-8000-0000000000b1',
      runId: 'cccccccc-0000-4000-8000-000000000001',
      startedAt: NOW,
      generatedAt: LATER,
      rows: [{ table: 'use_cases', rowId: ID, action: 'update', before }],
    }).sql;

  it('writes the old list of a use case as a text array, an empty one and a missing one', () => {
    expect(rollback({ lernfelder: ['LF1', 'LF2'] })).toContain(
      "update use_cases set lernfelder = array['LF1', 'LF2']::text[], updated_at = now() where id = '" +
        ID +
        "';"
    );
    expect(rollback({ lernfelder: [] })).toContain("lernfelder = '{}'::text[]");
    expect(rollback({ lernfelder: null })).toContain('lernfelder = null');
  });

  it('writes a missing element of the old list as null (the engine drops it, the old value had it)', () => {
    expect(rollback({ lernfelder: ['LF1', null, 'LF3'] })).toContain(
      "lernfelder = array['LF1', null, 'LF3']::text[]"
    );
  });

  it('quotes a code, so a quote in a stored value cannot leave its place', () => {
    const text = rollback({ lernfelder: ["LF1'; drop table use_cases; --"] });
    expect(text).toContain("array['LF1''; drop table use_cases; --']::text[]");
  });

  it('refuses a list that is not a short list of texts', () => {
    expect(() => rollback({ lernfelder: [1, 2] })).toThrow(RollbackSqlError);
    expect(() => rollback({ lernfelder: [['LF1']] })).toThrow(RollbackSqlError);
    expect(() => rollback({ lernfelder: Array(201).fill('LF1') })).toThrow(
      RollbackSqlError
    );
    expect(() => rollback({ lernfelder: ['x'.repeat(201)] })).toThrow(
      RollbackSqlError
    );
    expect(() => rollback({ title: { a: 1 } })).toThrow();
  });
});

describe('checkAssignment for a JSON or an Excel file', () => {
  const context = {
    list: {} as PositiveList,
    decisions: transferDecisions(),
  };
  const none = { componentCode: null, enablerCode: null, quizLevel: null };
  const check = (
    a: Partial<
      Record<
        'docType' | 'componentCode' | 'enablerCode' | 'quizLevel',
        string | null
      >
    >,
    file: { ext: string; docType?: string | null }
  ) =>
    checkAssignment(
      { docType: null, ...none, ...a },
      { dupKey: null, ...file },
      context
    );

  it('accepts the kind the reader found and nothing more', () => {
    expect(
      check({ docType: 'quiz' }, { ext: 'json', docType: 'quiz' })
    ).toEqual({
      ok: true,
      key: 'json:quiz',
      assignment: { docType: 'quiz', ...none },
    });
    expect(
      check({ docType: 'global_quiz' }, { ext: 'json', docType: 'global_quiz' })
    ).toMatchObject({ ok: true, key: 'json:global_quiz' });
    expect(
      check({ docType: 'other' }, { ext: 'xlsx', docType: 'other' })
    ).toMatchObject({
      ok: true,
      key: 'xlsx:other',
    });
  });

  it('refuses another type, a code, a level, a missing type and a file the reader did not type', () => {
    const json = { ext: 'json', docType: 'quiz' };
    expect(check({ docType: 'global_quiz' }, json)).toEqual({
      ok: false,
      code: 'TYPE_EXT_MISMATCH',
    });
    expect(check({ docType: 'enabler' }, json)).toEqual({
      ok: false,
      code: 'TYPE_EXT_MISMATCH',
    });
    expect(check({ docType: 'pdf_original' }, json)).toEqual({
      ok: false,
      code: 'TYPE_EXT_MISMATCH',
    });
    expect(check({ docType: 'quiz', componentCode: 'K1' }, json)).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INVALID',
    });
    expect(check({ docType: 'quiz', enablerCode: 'K1-a' }, json)).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INVALID',
    });
    expect(check({ docType: 'quiz', quizLevel: 'low' }, json)).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INVALID',
    });
    expect(check({ docType: null }, json)).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INCOMPLETE',
    });
    expect(check({ docType: 'quiz' }, { ext: 'json', docType: null })).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INCOMPLETE',
    });
    expect(check({ docType: 'quiz' }, { ext: 'json' })).toEqual({
      ok: false,
      code: 'ASSIGNMENT_INCOMPLETE',
    });
    // an Excel file is no quiz, a quiz file is no mapping
    expect(
      check({ docType: 'quiz' }, { ext: 'xlsx', docType: 'other' })
    ).toEqual({ ok: false, code: 'TYPE_EXT_MISMATCH' });
    expect(check({ docType: 'other' }, json)).toEqual({
      ok: false,
      code: 'TYPE_EXT_MISMATCH',
    });
  });

  it('keeps a Word file from taking the type other or a JSON type without codes', () => {
    expect(
      check({ docType: 'other' }, { ext: 'docx', docType: 'other' }).ok
    ).toBe(false);
    expect(
      check({ docType: 'quiz' }, { ext: 'docx', docType: 'quiz' }).ok
    ).toBe(false);
    expect(check({ docType: 'quiz' }, { ext: 'pdf', docType: 'quiz' }).ok).toBe(
      false
    );
  });
});
