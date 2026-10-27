import { ImportAbort } from '@/lib/content-import/apply/db';
import { executePlan } from '@/lib/content-import/apply/engine';
import type { RunOptions } from '@/lib/content-import/apply/engine';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import type { ImportPlan } from '@/lib/content-import/apply/types';

import {
  CREATOR_ID,
  FIAE_CATALOG_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
  inTransaction,
} from '../../../helpers/memoryImportDb';
import {
  DIR,
  file,
  loadDecisions,
  quizContent,
  sampleTree,
  scenarioContent,
} from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const plan = (files = sampleTree()): ImportPlan =>
  buildImportPlan(files, loadDecisions(), { now: NOW });
const options = (patch: Partial<RunOptions> = {}): RunOptions => ({
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  scenarioSolutions: true,
  ...patch,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function expectAbort(
  promise: Promise<unknown>,
  code: string
): Promise<ImportAbort> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportAbort);
    expect((error as ImportAbort).code).toBe(code);
    return error as ImportAbort;
  }
  throw new Error(`expected ImportAbort ${code}`);
}

describe('executePlan: first run', () => {
  it('writes components, courses, enablers, quizzes, questions, options, links and documents', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(db, plan(), options());

    expect(report.wrote).toBe(true);
    expect(report.conflicts).toEqual([]);
    expect(db.count('training_components')).toBe(5);
    expect(db.count('courses')).toBe(5);
    expect(db.count('enablers')).toBe(6);
    expect(db.count('quizzes')).toBe(23);
    expect(db.count('questions')).toBe(280);
    expect(db.count('options')).toBe(1120);
    expect(db.count('enabler_quiz_links')).toBe(18);
    expect(db.count('content_documents')).toBe(18);
    expect(report.tables.options).toEqual({
      insert: 1120,
      update: 0,
      unchanged: 0,
    });
  });

  it('links the rows to each other and to the KFBM catalog', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());

    const comp = (code: string) =>
      db.tables.training_components.find(c => c.code === code)!;
    const k62 = comp('K6.2');
    expect(k62).toMatchObject({
      training_catalog_id: KFBM_CATALOG_ID,
      kind: 'pflicht',
      phase: 2,
      order_index: 62,
      total_weeks: 0,
      total_hours: 0,
    });
    expect(comp('K10')).toMatchObject({ kind: 'wahl', phase: null });
    expect(comp('K20')).toMatchObject({ kind: 'integrativ', phase: null });

    const course = db.tables.courses.find(c => c.code === 'K6.2')!;
    expect(course.training_component_id).toBe(k62.id);
    expect(course.created_by_id).toBe(CREATOR_ID);
    expect(course.is_active).toBe(false);
    expect(course.is_published).toBe(false);

    const enabler = db.tables.enablers.find(e => e.code === 'K6.2-d')!;
    expect(enabler.course_id).toBe(course.id);
    expect(enabler.is_active).toBe(false);

    const global = db.tables.quizzes.find(q => q.code === 'K6.2-global')!;
    expect(global).toMatchObject({
      quiz_type: 'GLOBAL',
      training_component_id: k62.id,
      training_catalog_id: KFBM_CATALOG_ID,
      is_active: false,
    });
    const lesson = db.tables.quizzes.find(q => q.code === 'K6.2-d-high')!;
    expect(lesson).toMatchObject({
      quiz_type: 'LESSON',
      training_component_id: null,
    });
    const link = db.tables.enabler_quiz_links.find(
      l => l.quiz_id === lesson.id
    )!;
    expect(link).toMatchObject({ enabler_id: enabler.id, difficulty: 'HIGH' });

    const questions = db.tables.questions.filter(q => q.quiz_id === lesson.id);
    expect(questions.map(q => q.order_index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(questions.every(q => q.question_type === 'MCQ')).toBe(true);
    const firstOptions = db.tables.options.filter(
      o => o.question_id === questions[0].id
    );
    expect(firstOptions.map(o => [o.order_index, o.is_correct])).toEqual([
      [1, false],
      [2, true],
      [3, false],
      [4, false],
    ]);
  });

  it('activates the content only if the presets say so', async () => {
    const p = clone(plan());
    // the plan file cannot switch the content on, only the options can
    p.decisions.activate = true;
    const off = new MemoryImportDb();
    await executePlan(off, p, options());
    expect(off.tables.courses.every(c => c.is_active === false)).toBe(true);
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options({ activate: true }));
    expect(
      db.tables.courses.every(
        c => c.is_active === true && c.is_published === true
      )
    ).toBe(true);
    expect(db.tables.enablers.every(e => e.is_active === true)).toBe(true);
    expect(db.tables.quizzes.every(q => q.is_active === true)).toBe(true);
  });

  it('only compares when write is off and writes nothing', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(db, plan(), options({ write: false }));
    expect(report.wrote).toBe(false);
    expect(report.tables.questions.insert).toBe(280);
    expect(db.totalRows()).toBe(0);
    expect(db.log).toEqual([]);
  });

  it('a dry run rolls back and leaves no row, a real run keeps them', async () => {
    const db = new MemoryImportDb();
    const dry = await inTransaction(db, 'rollback', () =>
      executePlan(db, plan(), options())
    );
    expect(dry.tables.quizzes.insert).toBe(23);
    expect(db.totalRows()).toBe(0);

    await inTransaction(db, 'commit', () => executePlan(db, plan(), options()));
    expect(db.count('quizzes')).toBe(23);
  });

  it('an error in the middle of the write rolls everything back', async () => {
    const db = new MemoryImportDb();
    const original = db.insert.bind(db);
    db.insert = async (table, rows) => {
      if (table === 'options') throw new Error('disk full');
      return original(table, rows);
    };
    await expect(
      inTransaction(db, 'commit', () => executePlan(db, plan(), options()))
    ).rejects.toThrow('disk full');
    expect(db.totalRows()).toBe(0);
  });
});

describe('executePlan: idempotence', () => {
  it('a second run writes nothing', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const rows = db.totalRows();
    const logBefore = db.log.length;

    const second = await executePlan(db, plan(), options());
    expect(db.totalRows()).toBe(rows);
    expect(db.log.length).toBe(logBefore);
    for (const count of Object.values(second.tables)) {
      expect(count.insert).toBe(0);
      expect(count.update).toBe(0);
    }
    expect(second.tables.questions.unchanged).toBe(280);
    expect(second.tables.options.unchanged).toBe(1120);
    expect(second.tables.enabler_quiz_links.unchanged).toBe(18);
    expect(second.tables.content_documents.unchanged).toBe(18);
    expect(second.differences).toEqual([]);
  });

  it('adds only what is missing when the plan grows', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(sampleTree().slice(0, 5)), options());
    const first = db.totalRows();
    expect(db.count('enablers')).toBe(1);

    const report = await executePlan(db, plan(), options());
    expect(report.tables.training_components.unchanged).toBe(1);
    expect(report.tables.training_components.insert).toBe(4);
    expect(report.tables.enablers.insert).toBe(5);
    expect(db.count('enablers')).toBe(6);
    expect(db.totalRows()).toBeGreaterThan(first);
    // and now it is complete: nothing more
    const again = await executePlan(db, plan(), options());
    expect(Object.values(again.tables).every(c => c.insert === 0)).toBe(true);
  });

  it('never touches the rows of another catalog', async () => {
    const db = new MemoryImportDb();
    db.tables.training_components.push({
      id: 'fiae-1',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'K1',
      title: 'Same code in FIAE',
    });
    db.tables.courses.push({
      id: 'fiae-course',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'K1',
      training_component_id: 'fiae-1',
      title: 'FIAE course',
    });
    await executePlan(db, plan(), options({ updateExisting: true }));
    expect(db.tables.training_components.find(c => c.id === 'fiae-1')).toEqual({
      id: 'fiae-1',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'K1',
      title: 'Same code in FIAE',
    });
    expect(db.tables.courses.find(c => c.id === 'fiae-course')!.title).toBe(
      'FIAE course'
    );
    expect(
      db.tables.training_components.filter(
        c => c.training_catalog_id === KFBM_CATALOG_ID
      )
    ).toHaveLength(5);
  });

  it('fills an existing quiz that has no questions yet', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const ids = db.tables.questions
      .filter(q => q.quiz_id === quiz.id)
      .map(q => q.id);
    db.tables.options = db.tables.options.filter(
      o => !ids.includes(o.question_id as string)
    );
    db.tables.questions = db.tables.questions.filter(
      q => q.quiz_id !== quiz.id
    );

    const report = await executePlan(db, plan(), options());
    expect(report.tables.questions.insert).toBe(10);
    expect(report.tables.options.insert).toBe(40);
    expect(db.tables.questions.filter(q => q.quiz_id === quiz.id)).toHaveLength(
      10
    );
  });
});

describe('executePlan: the target must fit', () => {
  it('stops when the catalog KFBM does not exist', async () => {
    const db = new MemoryImportDb();
    db.catalogs = db.catalogs.filter(c => c.code !== 'KFBM');
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CATALOG_MISSING'
    );
    expect(abort.message).toMatch(/does not exist/);
    expect(db.totalRows()).toBe(0);
  });

  it('stops when the catalog KFBM is not active', async () => {
    const db = new MemoryImportDb();
    db.catalogs.find(c => c.code === 'KFBM')!.is_active = false;
    await expectAbort(executePlan(db, plan(), options()), 'CATALOG_INACTIVE');
    expect(db.totalRows()).toBe(0);
  });

  it('stops when the profile of the author does not exist', async () => {
    const db = new MemoryImportDb();
    await expectAbort(
      executePlan(
        db,
        plan(),
        options({ createdBy: '00000000-0000-4000-8000-0000000000aa' })
      ),
      'CREATOR_MISSING'
    );
  });

  it('refuses any plan for another catalog than KFBM', async () => {
    const db = new MemoryImportDb();
    const p = clone(plan());
    p.catalog = 'FIAE';
    await expectAbort(executePlan(db, p, options()), 'PLAN_INVALID');
    expect(db.totalRows()).toBe(0);
  });

  it('refuses a plan that is not valid', async () => {
    const db = new MemoryImportDb();
    const p = clone(plan());
    p.quizzes[0].questions[0].options[0].isCorrect = true;
    await expectAbort(executePlan(db, p, options()), 'PLAN_INVALID');
    expect(db.totalRows()).toBe(0);
  });
});

describe('executePlan: skipped files stay out', () => {
  it('writes only what the plan holds, not the skipped quiz', async () => {
    const files = sampleTree().filter(
      f => !f.rel.endsWith('1a_Quiz_Medium.docx')
    );
    files.push(
      file(
        `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Medium.docx`,
        quizContent({
          heading: '1a) Thema',
          level: 'mittel',
          tag: 'bad',
          skipAnswerOf: 2,
        })
      )
    );
    const p = plan(files);
    expect(p.skipped).toHaveLength(1);
    const db = new MemoryImportDb();
    await executePlan(db, p, options());
    expect(db.tables.quizzes.map(q => q.code)).not.toContain('K1-a-medium');
    expect(db.count('quizzes')).toBe(22);
    // the quiz that was skipped has no question in the database
    const texts = db.tables.questions.map(q => String(q.question_text));
    expect(texts.some(t => t.includes('bad'))).toBe(false);
    expect(
      db.tables.enabler_quiz_links.map(l => l.difficulty).sort()
    ).toHaveLength(17);
  });
});

describe('executePlan: solution protection', () => {
  const solutionMarks = ['ZETA', 'OMEGA', 'SIGMA'];

  it('keeps every solution out of the visible columns', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const visible = (table: keyof typeof db.tables, columns: string[]) =>
      db.tables[table].flatMap(row => columns.map(c => String(row[c] ?? '')));
    const texts = [
      ...visible('training_components', ['title', 'description']),
      ...visible('courses', ['title', 'description']),
      ...visible('enablers', ['title', 'description_text']),
      ...visible('quizzes', ['title']),
      ...visible('questions', ['question_text']),
      ...visible('options', ['option_text']),
    ];
    for (const text of texts) {
      for (const mark of solutionMarks) expect(text).not.toContain(mark);
      expect(text).not.toMatch(
        /Richtige Antwort|Kurzbegründung|Lösungsszenario/
      );
    }
  });

  it('puts the rationale only on the correct option and leaves expected_answer empty', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    for (const option of db.tables.options) {
      if (option.is_correct) {
        expect(String(option.explanation)).toMatch(
          /^Erfundene Begründung ZETA-/
        );
      } else {
        expect(option.explanation).toBeNull();
      }
    }
    expect(db.tables.options.filter(o => o.is_correct)).toHaveLength(280);
    expect(db.tables.questions.every(q => q.expected_answer === null)).toBe(
      true
    );
  });

  it('writes the scenario as three document rows, the solution parts trainer only', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const enabler = db.tables.enablers.find(e => e.code === 'K1-a')!;
    const docs = db.tables.content_documents
      .filter(d => d.enabler_id === enabler.id)
      .sort((a, b) => Number(a.order_index) - Number(b.order_index));
    expect(docs.map(d => [d.document_type, d.visibility])).toEqual([
      ['TRAINEE_QUESTION', 'ALL'],
      ['TRAINER_SOLUTION', 'TRAINER_ONLY'],
      ['TRAINER_SOLUTION', 'TRAINER_ONLY'],
    ]);
    expect(docs[0].description).toBe('Eine erfundene Lage am Arbeitsplatz.');
    expect(docs[1].description).toBe('Eine erfundene Lösung OMEGA.');
    expect(docs[2].description).toBe('Ein erfundener Beitrag SIGMA.');
    for (const doc of docs) {
      expect(doc).toMatchObject({
        storage_url: '',
        storage_path: null,
        file_size: null,
        use_case_id: null,
        course_id: null,
        organization_id: null,
        uploaded_by_id: CREATOR_ID,
        file_name: 'Szenario_1a.docx',
      });
      expect(String(doc.title)).not.toMatch(
        /Lösungsszenario|Fachwissen zur Lösung/
      );
    }
    // nothing of the trainer rows is visible in the trainee row
    for (const mark of ['OMEGA', 'SIGMA']) {
      expect(String(docs[0].description)).not.toContain(mark);
      expect(String(docs[0].title)).not.toContain(mark);
    }
  });

  describe('a scenario with a task', () => {
    const TASK = 'Eine erfundene Aufgabe TAU.';
    const withTask = () => {
      const files = sampleTree().filter(
        f => !f.rel.endsWith('Szenario_1a.docx')
      );
      files.push(
        file(
          `${DIR.k1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
          scenarioContent('1a', { task: TASK })
        )
      );
      return plan(files);
    };
    const docsOf = (db: MemoryImportDb, code: string) => {
      const enabler = db.tables.enablers.find(e => e.code === code)!;
      return db.tables.content_documents
        .filter(d => d.enabler_id === enabler.id)
        .sort((a, b) => Number(a.order_index) - Number(b.order_index));
    };

    it('puts the task under the heading Aufgabe into the visible situation row, the rows stay three', async () => {
      const db = new MemoryImportDb();
      await executePlan(db, withTask(), options());
      const docs = docsOf(db, 'K1-a');
      expect(docs.map(d => [d.document_type, d.visibility, d.title])).toEqual([
        ['TRAINEE_QUESTION', 'ALL', 'Szenario K1-a: Ausgangssituation'],
        ['TRAINER_SOLUTION', 'TRAINER_ONLY', 'Szenario K1-a: Lösung (Trainer)'],
        [
          'TRAINER_SOLUTION',
          'TRAINER_ONLY',
          'Szenario K1-a: Fachwissen (Trainer)',
        ],
      ]);
      expect(docs[0].description).toBe(
        `Eine erfundene Lage am Arbeitsplatz.\n\nAufgabe\n\n${TASK}`
      );
      // no solution text in the visible row, no task in the trainer rows
      for (const mark of ['OMEGA', 'SIGMA']) {
        expect(String(docs[0].description)).not.toContain(mark);
      }
      expect(String(docs[1].description)).not.toContain('TAU');
      expect(String(docs[2].description)).not.toContain('TAU');
    });

    it('leaves the rows of the other scenarios exactly as they were', async () => {
      const before = new MemoryImportDb();
      await executePlan(before, plan(), options());
      const after = new MemoryImportDb();
      await executePlan(after, withTask(), options());
      for (const code of ['K1-b', 'K6.1-a', 'K6.2-d', 'K10-a', 'K20-a']) {
        const strip = (db: MemoryImportDb) =>
          docsOf(db, code).map(d => [d.title, d.description, d.order_index]);
        expect(strip(after)).toEqual(strip(before));
      }
      expect(after.count('content_documents')).toBe(
        before.count('content_documents')
      );
    });

    it('writes the task also when only the visible situation is written', async () => {
      const db = new MemoryImportDb();
      await executePlan(db, withTask(), options({ scenarioSolutions: false }));
      const docs = docsOf(db, 'K1-a');
      expect(docs).toHaveLength(1);
      expect(docs[0].description).toContain(TASK);
      expect(JSON.stringify(db.tables)).not.toContain('OMEGA');
    });

    it('is stable on a second run', async () => {
      const db = new MemoryImportDb();
      await executePlan(db, withTask(), options());
      const report = await executePlan(db, withTask(), options());
      expect(report.tables.content_documents).toEqual({
        insert: 0,
        update: 0,
        unchanged: 18,
      });
    });

    it('adds a task to an existing scenario by updating the situation text only', async () => {
      const db = new MemoryImportDb();
      await executePlan(db, plan(), options());
      const report = await executePlan(
        db,
        withTask(),
        options({ updateExisting: true })
      );
      expect(report.tables.content_documents).toEqual({
        insert: 0,
        update: 1,
        unchanged: 17,
      });
      expect(db.count('content_documents')).toBe(18);
      expect(docsOf(db, 'K1-a')[0].description).toContain(TASK);
    });

    it('refuses a plan whose task shows a solution marker', async () => {
      const db = new MemoryImportDb();
      const p = clone(withTask());
      const s = p.scenarios.find(x => x.enablerCode === 'K1-a')!;
      s.task = `${TASK} Richtige Antwort: B`;
      await expectAbort(executePlan(db, p, options()), 'PLAN_INVALID');
      expect(db.totalRows()).toBe(0);
    });
  });

  it('writes only the situation of a scenario unless the solutions are asked for', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options({ scenarioSolutions: false }));
    expect(db.count('content_documents')).toBe(6);
    expect(
      db.tables.content_documents.every(
        d => d.document_type === 'TRAINEE_QUESTION' && d.visibility === 'ALL'
      )
    ).toBe(true);
    const all = JSON.stringify(db.tables);
    for (const mark of ['OMEGA', 'SIGMA']) expect(all).not.toContain(mark);
    // a later run with the switch adds the trainer rows and nothing else
    const report = await executePlan(db, plan(), options());
    expect(report.tables.content_documents).toEqual({
      insert: 12,
      update: 0,
      unchanged: 6,
    });
  });

  it('refuses an author who is not a trainer or an admin', async () => {
    const db = new MemoryImportDb();
    db.profiles[0].role = 'TRAINEE';
    await expectAbort(executePlan(db, plan(), options()), 'CREATOR_ROLE');
    expect(db.totalRows()).toBe(0);
  });

  it('refuses a plan whose question shows a solution', async () => {
    const db = new MemoryImportDb();
    const p = clone(plan());
    p.quizzes[0].questions[3].options[2].text += ' (Richtige Antwort: B)';
    await expectAbort(executePlan(db, p, options()), 'PLAN_INVALID');
    expect(db.totalRows()).toBe(0);
  });
});

describe('executePlan: conflicts stop the run before the first write', () => {
  const seed = async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    return db;
  };

  it('a course of the same code that points to another component', async () => {
    const db = await seed();
    const course = db.tables.courses.find(c => c.code === 'K1')!;
    course.training_component_id = db.tables.training_components.find(
      c => c.code === 'K10'
    )!.id;
    const rows = db.totalRows();
    const logBefore = db.log.length;
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({ table: 'courses', key: 'K1' });
    expect(db.totalRows()).toBe(rows);
    expect(db.log.length).toBe(logBefore);
  });

  it('a quiz with another number of questions', async () => {
    const db = await seed();
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const question = db.tables.questions.find(q => q.quiz_id === quiz.id)!;
    db.tables.options = db.tables.options.filter(
      o => o.question_id !== question.id
    );
    db.tables.questions = db.tables.questions.filter(q => q.id !== question.id);
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0].reason).toMatch(
      /9 questions in the database and 10 in the plan/
    );
  });

  it('a comparison without write reports the conflicts instead of stopping', async () => {
    const db = await seed();
    db.tables.quizzes.find(q => q.code === 'K1-a-low')!.quiz_type = 'GLOBAL';
    const report = await executePlan(db, plan(), options({ write: false }));
    expect(report.wrote).toBe(false);
    expect(report.conflicts[0]).toMatchObject({
      table: 'quizzes',
      key: 'K1-a-low',
    });
    expect(report.tables.quizzes.unchanged).toBe(22);
  });

  it('a quiz that exists as another type', async () => {
    const db = await seed();
    db.tables.quizzes.find(q => q.code === 'K1-a-low')!.quiz_type = 'GLOBAL';
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({
      table: 'quizzes',
      key: 'K1-a-low',
    });
  });

  it('an enabler whose slot holds another quiz', async () => {
    const db = await seed();
    const low = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const other = db.tables.quizzes.find(q => q.code === 'K1-b-low')!;
    db.tables.enabler_quiz_links.find(l => l.quiz_id === low.id)!.quiz_id =
      other.id;
    // the link of K1-b-low now sits twice: remove its own link to isolate the case
    const enablerB = db.tables.enablers.find(e => e.code === 'K1-b')!;
    db.tables.enabler_quiz_links = db.tables.enabler_quiz_links.filter(
      l => !(l.enabler_id === enablerB.id && l.difficulty === 'LOW')
    );
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts.some(c => c.table === 'enabler_quiz_links')).toBe(
      true
    );
  });

  it('a global quiz that another code already holds for the component', async () => {
    const db = await seed();
    const global = db.tables.quizzes.find(q => q.code === 'K1-global')!;
    global.code = 'K1-global-old';
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({
      table: 'quizzes',
      key: 'K1-global',
    });
  });

  it('an enabler code that exists in another course', async () => {
    const db = await seed();
    const enabler = db.tables.enablers.find(e => e.code === 'K1-a')!;
    enabler.course_id = db.tables.courses.find(c => c.code === 'K10')!.id;
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({
      table: 'enablers',
      key: 'K1-a',
    });
  });

  it('a component that another course already holds', async () => {
    const db = new MemoryImportDb();
    const component = {
      id: 'comp-1',
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K1',
      title: 'x',
    };
    db.tables.training_components.push(component);
    db.tables.courses.push({
      id: 'course-x',
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K1-old',
      training_component_id: 'comp-1',
      title: 'x',
    });
    const abort = await expectAbort(
      executePlan(db, plan(), options()),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({ table: 'courses', key: 'K1' });
    expect(db.log).toEqual([]);
  });
});

describe('executePlan: existing rows and --update-existing', () => {
  const changed = (): ImportPlan => {
    const p = clone(plan());
    p.enablers.find(e => e.code === 'K1-a')!.title = 'Neuer Titel';
    p.components.find(c => c.code === 'K1')!.title = 'Neuer Komponententitel';
    p.quizzes.find(q => q.code === 'K1-a-low')!.questions[0].text =
      'Neue Frage?';
    p.quizzes.find(
      q => q.code === 'K1-a-low'
    )!.questions[0].options[1].explanation = 'Neue Begründung ZETA-neu.';
    return p;
  };

  it('reports the differences but does not change a row without the switch', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const before = db.snapshot();
    const report = await executePlan(db, changed(), options());
    expect(db.snapshot()).toBe(before);
    expect(report.differences.map(d => `${d.table}:${d.key}`)).toEqual(
      expect.arrayContaining([
        'enablers:K1-a',
        'training_components:K1',
        'questions:K1-a-low#1',
        'options:K1-a-low#1B',
      ])
    );
    expect(Object.values(report.tables).every(c => c.update === 0)).toBe(true);
  });

  it('updates only the named columns and never is_active or the author', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    // someone activated the course and the enabler by hand in the meantime
    db.tables.enablers.find(e => e.code === 'K1-a')!.is_active = true;
    db.tables.courses.find(c => c.code === 'K1')!.is_active = true;
    const logBefore = db.log.length;

    const report = await executePlan(
      db,
      changed(),
      options({ updateExisting: true })
    );
    expect(db.tables.enablers.find(e => e.code === 'K1-a')).toMatchObject({
      title: 'Neuer Titel',
      is_active: true,
    });
    expect(
      db.tables.training_components.find(c => c.code === 'K1')!.title
    ).toBe('Neuer Komponententitel');
    expect(db.tables.courses.find(c => c.code === 'K1')!.is_active).toBe(true);
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const question = db.tables.questions.find(
      q => q.quiz_id === quiz.id && q.order_index === 1
    )!;
    expect(question.question_text).toBe('Neue Frage?');
    expect(
      db.tables.options.find(
        o => o.question_id === question.id && o.order_index === 2
      )!.explanation
    ).toBe('Neue Begründung ZETA-neu.');
    expect(report.tables.enablers.update).toBe(1);
    // only update writes were added, no insert
    expect(db.log.slice(logBefore).every(entry => entry.op === 'update')).toBe(
      true
    );
    for (const entry of db.log.slice(logBefore)) {
      expect(entry.columns).not.toContain('is_active');
      expect(entry.columns).not.toContain('created_by_id');
    }
    // and once more: nothing left to do
    const again = await executePlan(
      db,
      changed(),
      options({ updateExisting: true })
    );
    expect(
      Object.values(again.tables).every(c => c.update === 0 && c.insert === 0)
    ).toBe(true);
  });

  it('does not erase existing text where the plan has none, but clears a stray explanation', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const p = clone(plan());
    p.enablers.find(e => e.code === 'K1-a')!.descriptionText = null;
    await executePlan(db, p, options({ updateExisting: true }));
    expect(
      String(db.tables.enablers.find(e => e.code === 'K1-a')!.description_text)
    ).toMatch(/Lehrtext/);
    // a rationale on a wrong option is removed
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const question = db.tables.questions.find(
      q => q.quiz_id === quiz.id && q.order_index === 1
    )!;
    const wrong = db.tables.options.find(
      o => o.question_id === question.id && o.order_index === 1
    )!;
    wrong.explanation = 'zu viel';
    await executePlan(db, plan(), options({ updateExisting: true }));
    expect(wrong.explanation).toBeNull();
  });

  it('a document with another visibility than the plan is a conflict, not an update', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const doc = db.tables.content_documents.find(
      d => d.document_type === 'TRAINER_SOLUTION'
    )!;
    doc.visibility = 'ALL';
    const abort = await expectAbort(
      executePlan(db, plan(), options({ updateExisting: true })),
      'CONFLICTS'
    );
    expect(abort.conflicts[0]).toMatchObject({ table: 'content_documents' });
  });

  it('has no way to delete: the interface offers no delete', () => {
    const db = new MemoryImportDb();
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(db)).filter(n =>
        /delete|remove|truncate/i.test(n)
      )
    ).toEqual([]);
  });
});
