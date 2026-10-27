import { buildImportPlan } from '@/lib/content-import/apply/plan';
import { mergeQuizSources } from '@/lib/content-import/quiz-json/merge';
import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '@/lib/content-import/quiz-json/read';
import { parseQuizText } from '@/lib/content-import/source-parsers';

import {
  DIR,
  file,
  loadDecisions,
  quizLines,
  sampleTree,
} from '../apply/fixtures';
import {
  SAMPLE_GLOBALS,
  SECTION,
  clone,
  globalFile,
  jsonGlobalQuiz,
  jsonQuiz,
  lessonFile,
  sampleLesson,
} from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const decisions = loadDecisions();

const lesson = (change: (file: any) => void = () => undefined) => {
  const raw = sampleLesson();
  change(raw);
  return readLessonQuizzes(raw);
};
const plan = (
  word: ReturnType<typeof sampleTree>,
  reads: ReturnType<typeof lesson>[],
  options: { preferJson?: boolean } = {}
) => {
  const merged = mergeQuizSources(word, reads, options);
  return {
    merged,
    plan: buildImportPlan(merged.files, decisions, {
      now: NOW,
      extra: { skipped: merged.skipped, superseded: merged.superseded },
    }),
  };
};
const bySource = (p: ReturnType<typeof plan>['plan'], code: string) =>
  p.quizzes.find(q => q.code === code)?.source;

describe('a Word file that cannot be used does not hold its key', () => {
  const brokenLow = () =>
    sampleTree().map(f =>
      f.info.key === 'quiz:1a:low'
        ? file(
            f.rel,
            {
              type: 'quiz',
              result: parseQuizText(
                quizLines({ heading: '1a) Erfundenes Thema', skipAnswerOf: 2 })
              ),
            },
            {}
          )
        : f
    );

  it('the JSON quiz fills the gap and the Word file is listed as an older copy', () => {
    const { plan: p, merged } = plan(brokenLow(), [lesson()]);
    expect(bySource(p, 'K1-a-low')).toBe('quiz-json#1a/low');
    expect(p.skipped.filter(s => s.code === 'PARSE_ERROR')).toEqual([]);
    expect(merged.counts.filledForWord).toBe(1);
    expect(p.superseded).toContainEqual(
      expect.objectContaining({
        key: 'quiz:1a:low',
        keptFile: 'quiz-json#1a/low',
      })
    );
    // the other keys stay with Word
    expect(bySource(p, 'K1-a-medium')).toMatch(/Quiz_Medium\.docx$/);
  });

  it('a placeholder, a read error and a path that does not fit are no cover either', () => {
    for (const extra of [
      { placeholder: true },
      { readError: 'Timeout' },
    ] as const) {
      const files = sampleTree().map(f =>
        f.info.key === 'quiz:1a:low'
          ? { ...file(f.rel, undefined, extra), content: undefined }
          : f
      );
      const { plan: p } = plan(files, [lesson()]);
      expect(bySource(p, 'K1-a-low')).toBe('quiz-json#1a/low');
    }
  });

  it('a Word quiz that was not read (no content) is not a cover', () => {
    const files = sampleTree().map(f =>
      f.info.key === 'quiz:1a:low' ? file(f.rel) : f
    );
    const { plan: p } = plan(files, [lesson()]);
    expect(bySource(p, 'K1-a-low')).toBe('quiz-json#1a/low');
  });
});

describe('--prefer-json-quizzes only replaces with a JSON set without errors', () => {
  it('a broken JSON level leaves the good Word quiz in place', () => {
    const read = lesson(raw => {
      raw.quizzes[0].difficulties.leicht.questions[0].correct_answer = 'Z';
    });
    const { plan: p, merged } = plan(sampleTree(), [read], {
      preferJson: true,
    });
    expect(bySource(p, 'K1-a-low')).toMatch(/Quiz_Low\.docx$/);
    expect(bySource(p, 'K1-a-medium')).toBe('quiz-json#1a/medium');
    expect(merged.counts.replacedWord).toBe(14);
    expect(p.superseded).toContainEqual(
      expect.objectContaining({
        file: 'quiz-json#1a/low',
        key: 'quiz:1a:low',
      })
    );
  });
});

describe('component, group and title of a Word component stay with Word', () => {
  it('a JSON section of another part does not move the component (and its phase)', () => {
    const quiz = jsonQuiz({
      id: '1b',
      componentId: '01',
      dir: DIR.k1,
      title: '1b) Zusätzliches Thema',
    });
    quiz.training_section = SECTION.t2;
    quiz.category = SECTION.t2;
    quiz.curriculum_component.title = '01 - Anderer Titel (§ 4 Abs. 2 Nr. 1)';
    const read = readLessonQuizzes(lessonFile([quiz]));
    // keep only K1 of the tree, and remove its enabler 1b of the Word tree
    const word = sampleTree().filter(
      f => f.info.component?.code === 'K1' && !/1b/.test(f.info.key ?? '')
    );
    const { plan: p } = plan(word, [read]);
    const k1 = p.components.find(c => c.code === 'K1');
    expect(k1).toMatchObject({
      group: 'teil1',
      phase: 1,
      title: 'Erfundenes Thema Eins',
    });
    expect(p.enablers.map(e => e.code)).toContain('K1-b');
  });

  it('a component that only the JSON knows comes from the JSON', () => {
    const read = readLessonQuizzes(
      lessonFile([jsonQuiz({ id: '6d', componentId: '06.2', dir: DIR.k6_2 })])
    );
    const { plan: p } = plan([], [read]);
    expect(p.components[0]).toMatchObject({
      code: 'K6.2',
      group: 'teil2',
      phase: 2,
    });
  });

  it('global quizzes follow the same rule', () => {
    const global = readGlobalQuizzes(
      globalFile(SAMPLE_GLOBALS.map(id => jsonGlobalQuiz(id)))
    );
    const { plan: p } = plan(
      sampleTree().filter(f => f.info.type !== 'global-quiz'),
      [global]
    );
    expect(p.quizzes.filter(q => q.kind === 'global')).toHaveLength(5);
    expect(p.skipped).toEqual([]);
  });
});

describe('the merge does not change its inputs', () => {
  it('leaves the files of the reader and of the tree as they are', () => {
    const read = lesson();
    const before = clone(read.files.map(f => f.info));
    mergeQuizSources(sampleTree(), [read], { preferJson: true });
    expect(read.files.map(f => f.info)).toEqual(before);
  });
});
