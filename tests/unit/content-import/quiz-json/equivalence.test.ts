// A plan from the Word tree and a plan from the JSON of the same content must
// name the same rows, so a run from either source never creates a second row.
import { executePlan } from '@/lib/content-import/apply/engine';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import type { ImportPlan } from '@/lib/content-import/apply/types';
import { mergeQuizSources } from '@/lib/content-import/quiz-json/merge';
import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '@/lib/content-import/quiz-json/read';

import {
  CREATOR_ID,
  MemoryImportDb,
  inTransaction,
} from '../../../helpers/memoryImportDb';
import { DIR, loadDecisions, sampleTree } from '../apply/fixtures';
import {
  SAMPLE_GLOBALS,
  clone,
  globalFile,
  jsonGlobalQuiz,
  jsonQuiz,
  lessonFile,
} from './fixtures';
import type { QuizSpec } from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const decisions = loadDecisions();

/** The enablers of sampleTree() in the JSON form, with the same titles and texts. */
const SPECS: QuizSpec[] = [
  {
    id: '1a',
    componentId: '01',
    dir: DIR.k1,
    title: '1a) Erfundenes Enabler-Thema',
  },
  { id: '1b', componentId: '01', dir: DIR.k1, title: '1b) Zweites Thema' },
  {
    id: '6a',
    componentId: '06.1',
    dir: DIR.k6_1,
    title: '6a) Erfundenes Enabler-Thema',
  },
  {
    id: '6d',
    componentId: '06.2',
    dir: DIR.k6_2,
    title: '6d) Erfundenes Enabler-Thema',
  },
  {
    id: '10a',
    componentId: '10',
    dir: DIR.k10,
    title: '10a) Erfundenes Enabler-Thema',
  },
  {
    id: '20a',
    componentId: '20',
    dir: DIR.k20,
    title: '20a) Erfundenes Enabler-Thema',
  },
];

const lessonRead = () => readLessonQuizzes(lessonFile(SPECS.map(jsonQuiz)));
const globalRead = () =>
  readGlobalQuizzes(globalFile(SAMPLE_GLOBALS.map(id => jsonGlobalQuiz(id))));

const wordPlan = () => buildImportPlan(sampleTree(), decisions, { now: NOW });
const jsonPlan = () =>
  buildImportPlan([...lessonRead().files, ...globalRead().files], decisions, {
    now: NOW,
  });

/** A plan without the fields that differ by source (file names, texts of the enablers). */
function comparable(plan: ImportPlan) {
  return {
    components: plan.components,
    enablers: plan.enablers.map(
      ({ source: _s, descriptionText: _d, ...e }) => e
    ),
    quizzes: plan.quizzes.map(({ source: _s, ...q }) => q),
  };
}

describe('the same content from Word and from JSON', () => {
  it('gives the same components, enablers, quiz codes, titles, questions and options', () => {
    const word = wordPlan();
    const json = jsonPlan();
    expect(json.skipped).toEqual([]);
    expect(json.warnings).toEqual([]);
    expect(comparable(json)).toEqual(comparable(word));
  });

  it('names the quizzes by the same codes and keeps them unique', () => {
    const codes = jsonPlan().quizzes.map(q => q.code);
    expect(codes).toEqual(wordPlan().quizzes.map(q => q.code));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('K6.2-d-medium');
    expect(codes).toContain('K10-global');
  });

  it('the JSON has no enabler text, the Word documents have', () => {
    expect(jsonPlan().enablers.every(e => e.descriptionText === null)).toBe(
      true
    );
    expect(wordPlan().enablers.every(e => e.descriptionText !== null)).toBe(
      true
    );
  });
});

describe('a run from Word and a run from JSON meet the same rows', () => {
  const options = {
    createdBy: CREATOR_ID,
    updateExisting: false,
    write: true,
    activate: false,
    scenarioSolutions: false,
  };

  it('a run from JSON after a run from Word writes no new quiz, question or option', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, wordPlan(), options);
    const before = {
      quizzes: db.count('quizzes'),
      questions: db.count('questions'),
      options: db.count('options'),
      enablers: db.count('enablers'),
      links: db.count('enabler_quiz_links'),
    };
    const report = await executePlan(db, jsonPlan(), options);
    expect(report.conflicts).toEqual([]);
    for (const table of [
      'training_components',
      'courses',
      'enablers',
      'quizzes',
      'questions',
      'options',
      'enabler_quiz_links',
    ] as const) {
      expect(report.tables[table].insert).toBe(0);
      expect(report.tables[table].update).toBe(0);
    }
    expect(db.count('quizzes')).toBe(before.quizzes);
    expect(db.count('questions')).toBe(before.questions);
    expect(db.count('options')).toBe(before.options);
    expect(db.count('enablers')).toBe(before.enablers);
    expect(db.count('enabler_quiz_links')).toBe(before.links);
  });

  it('and the other way round', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, jsonPlan(), options);
    const quizzes = db.count('quizzes');
    const report = await executePlan(db, wordPlan(), options);
    expect(report.tables.quizzes.insert).toBe(0);
    expect(report.tables.questions.insert).toBe(0);
    expect(report.tables.options.insert).toBe(0);
    expect(db.count('quizzes')).toBe(quizzes);
  });

  it('a changed text in the JSON is reported but not written without --update-existing', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, wordPlan(), options);
    const lesson = lessonFile(SPECS.map(jsonQuiz));
    lesson.quizzes[0].difficulties.leicht.questions[0].question =
      'Erfundene neue Frage?';
    const plan = buildImportPlan(
      [...readLessonQuizzes(lesson).files, ...globalRead().files],
      decisions,
      { now: NOW }
    );
    const dry = await executePlan(db, plan, options);
    expect(dry.differences.map(d => [d.table, d.key])).toContainEqual([
      'questions',
      'K1-a-low#1',
    ]);
    expect(dry.tables.questions.update).toBe(0);
    const stored = db.tables.questions.find(
      q => q.question_text === 'Erfundene Frage 1aLow1?'
    );
    expect(stored).toBeDefined();

    const updated = await executePlan(db, plan, {
      ...options,
      updateExisting: true,
    });
    expect(updated.tables.questions.update).toBe(1);
    expect(
      db.tables.questions.some(q => q.question_text === 'Erfundene neue Frage?')
    ).toBe(true);
  });

  it('a first run from JSON alone creates the components, enablers (no text), quizzes and links', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(db, jsonPlan(), options);
    expect(report.tables.quizzes.insert).toBe(23);
    expect(report.tables.enablers.insert).toBe(6);
    expect(db.tables.enablers.every(e => !e.description_text)).toBe(true);
    expect(db.count('enabler_quiz_links')).toBe(18);
    expect(db.count('content_documents')).toBe(0);
    // the solution only in its columns
    const visible = JSON.stringify(
      db.tables.questions.map(q => [q.question_text, q.expected_answer])
    );
    expect(visible).not.toContain('ZETA');
  });

  it('a dry run from JSON leaves nothing behind', async () => {
    const db = new MemoryImportDb();
    await expect(
      inTransaction(db, 'rollback', () => executePlan(db, jsonPlan(), options))
    ).resolves.toBeDefined();
    expect(db.count('quizzes')).toBe(0);
  });
});

describe('the Word tree and the JSON together', () => {
  const merged = (preferJson: boolean, limitedTo: string[] = []) => {
    const lesson = lessonRead();
    const global = globalRead();
    const result = mergeQuizSources(sampleTree(), [lesson, global], {
      preferJson,
      limitedTo,
    });
    const plan = buildImportPlan(result.files, decisions, {
      now: NOW,
      limitedTo,
      extra: { skipped: result.skipped, superseded: result.superseded },
    });
    return { result, plan };
  };

  it('keeps the Word quizzes and lists every JSON quiz as left out', () => {
    const { result, plan } = merged(false);
    const word = wordPlan();
    expect(plan.quizzes.map(q => [q.code, q.source])).toEqual(
      word.quizzes.map(q => [q.code, q.source])
    );
    expect(plan.enablers).toEqual(word.enablers);
    expect(plan.skipped).toEqual([]);
    expect(result.counts).toMatchObject({
      jsonQuizFiles: 0,
      jsonEnablerFiles: 0,
      leftOutForWord: 6 * 3 + 5,
      replacedWord: 0,
    });
    expect(plan.superseded).toHaveLength(6 * 3 + 5);
    expect(
      plan.superseded.every(
        s =>
          s.file.startsWith('quiz-json#') ||
          s.file.startsWith('global-quiz-json#')
      )
    ).toBe(true);
  });

  it('takes the JSON quizzes only with the switch, the enablers stay the Word ones', () => {
    const { result, plan } = merged(true);
    expect(plan.quizzes).toHaveLength(23);
    expect(
      plan.quizzes.every(q => /^(global-)?quiz-json#/.test(q.source))
    ).toBe(true);
    expect(plan.enablers.every(e => e.descriptionText !== null)).toBe(true);
    expect(plan.enablers.every(e => !e.source.startsWith('quiz-json'))).toBe(
      true
    );
    expect(result.counts.replacedWord).toBe(23);
    // the Word quizzes are listed as older copies, the scenarios stay
    expect(plan.superseded).toHaveLength(23);
    expect(plan.scenarios).toHaveLength(6);
    expect(comparable(plan).quizzes).toEqual(comparable(wordPlan()).quizzes);
  });

  it('a JSON quiz of a level that Word lacks is added, a Word quiz stays by default', () => {
    const files = sampleTree().filter(
      f => f.info.key !== 'quiz:1a:high' && f.info.key !== 'quiz:1a:medium'
    );
    const result = mergeQuizSources(files, [lessonRead(), globalRead()], {
      preferJson: false,
    });
    const plan = buildImportPlan(result.files, decisions, {
      now: NOW,
      extra: { superseded: result.superseded },
    });
    const bySource = (code: string) =>
      plan.quizzes.find(q => q.code === code)?.source;
    expect(bySource('K1-a-low')).toMatch(/Quiz_Low\.docx$/);
    expect(bySource('K1-a-medium')).toBe('quiz-json#1a/medium');
    expect(bySource('K1-a-high')).toBe('quiz-json#1a/high');
    expect(plan.quizzes).toHaveLength(23);
  });

  it('an enabler that only the JSON knows is planned without text, a Word enabler wins', () => {
    const word = sampleTree().filter(f => !/:1b(:|$)/.test(f.info.key ?? ''));
    const result = mergeQuizSources(word, [lessonRead(), globalRead()], {});
    const plan = buildImportPlan(result.files, decisions, { now: NOW });
    expect(result.counts.jsonEnablerFiles).toBe(1);
    const b = plan.enablers.find(e => e.code === 'K1-b');
    expect(b).toMatchObject({ title: 'Zweites Thema', descriptionText: null });
    expect(
      plan.enablers.find(e => e.code === 'K1-a')?.descriptionText
    ).not.toBeNull();
    expect(plan.quizzes.filter(q => q.code.startsWith('K1-b'))).toHaveLength(3);
  });

  it('follows --components for the JSON too', () => {
    const { plan, result } = merged(false, ['K6.2']);
    expect(plan.components.map(c => c.code)).toEqual(['K6.2']);
    expect(plan.superseded.map(s => s.key).sort()).toEqual([
      'global-quiz:06.2',
      'quiz:6.2d:high',
      'quiz:6.2d:low',
      'quiz:6.2d:medium',
    ]);
    expect(result.counts.leftOutForWord).toBe(4);
  });

  it('puts the quizzes that have no content key into the skipped list, only for the limited components', () => {
    const lesson = lessonFile(SPECS.map(jsonQuiz));
    delete lesson.quizzes[4].difficulties.schwer;
    delete lesson.quizzes[0].difficulties.schwer;
    const read = readLessonQuizzes(lesson);
    const all = mergeQuizSources([], [read], {});
    expect(all.skipped.map(s => s.key)).toEqual([
      'quiz:1a:high',
      'quiz:10a:high',
    ]);
    const some = mergeQuizSources([], [read], { limitedTo: ['K10'] });
    expect(some.skipped.map(s => s.key)).toEqual(['quiz:10a:high']);
    const plan = buildImportPlan(all.files, decisions, {
      now: NOW,
      extra: { skipped: all.skipped },
    });
    expect(plan.skipped.map(s => s.code)).toEqual([
      'LEVEL_MISSING',
      'LEVEL_MISSING',
    ]);
  });

  it('does not read a file whose head was refused', () => {
    const bad = readLessonQuizzes({ ...lessonFile([]), schema_version: '9' });
    const result = mergeQuizSources(sampleTree(), [bad], {});
    expect(result.files).toHaveLength(sampleTree().length);
    expect(result.superseded).toEqual([]);
  });

  it('does not change the Word files it was given', () => {
    const files = sampleTree();
    const copy = clone(files.map(f => f.rel));
    mergeQuizSources(files, [lessonRead(), globalRead()], { preferJson: true });
    expect(files.map(f => f.rel)).toEqual(copy);
  });
});
