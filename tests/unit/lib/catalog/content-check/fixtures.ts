import type {
  ContentSnapshot,
  QuizDifficulty,
  SnapshotDocument,
  SnapshotEnabler,
  SnapshotQuestion,
  SnapshotQuiz,
  SnapshotUseCase,
} from '@/lib/catalog/content-check/snapshot';

export const CATALOG = '00000000-0000-4000-8000-0000000000aa';
export const OTHER_CATALOG = '00000000-0000-4000-8000-0000000000bb';
const LEVELS: QuizDifficulty[] = ['LOW', 'MEDIUM', 'HIGH'];

export function enabler(
  n: number,
  over: Partial<SnapshotEnabler> = {}
): SnapshotEnabler {
  return {
    id: `en${n}`,
    courseId: 'c1',
    catalogId: CATALOG,
    courseCatalogId: CATALOG,
    code: `K1-${String.fromCharCode(96 + n)}`,
    title: `Enabler ${n} Thema`,
    orderIndex: n,
    description: `Beschreibung des Enablers ${n}`,
    hasScenarioPdf: false,
    isActive: true,
    ...over,
  };
}

export function doc(
  id: string,
  over: Partial<SnapshotDocument> = {}
): SnapshotDocument {
  return {
    id,
    enablerId: null,
    useCaseId: null,
    courseId: null,
    title: `Dokument ${id}`,
    type: 'THEORY',
    fileName: `${id}.pdf`,
    hasFile: true,
    hasText: false,
    fileSize: null,
    pageCount: null,
    ...over,
  };
}

export function quizzesOf(enablerId: string): SnapshotQuiz[] {
  return LEVELS.map(level => ({
    id: `q-${enablerId}-${level}`,
    code: null,
    title: `Quiz ${enablerId} ${level}`,
    type: 'LESSON',
    isActive: true,
    catalogId: CATALOG,
    enablerId,
    enablerCatalogId: CATALOG,
    difficulty: level,
    questionCount: 2,
  }));
}

export function questionsOf(quizId: string): SnapshotQuestion[] {
  return [1, 2].map(i => ({
    id: `${quizId}-f${i}`,
    quizId,
    type: 'MCQ',
    text: `Frage ${i} zu ${quizId}`,
    optionCount: 4,
    correctCount: 1,
    emptyOptionCount: 0,
  }));
}

export function makeUseCase(
  n: number,
  over: Partial<SnapshotUseCase> = {}
): SnapshotUseCase {
  return {
    id: `uc${n}`,
    courseId: 'c1',
    catalogId: CATALOG,
    enablerId: `en${n}`,
    code: `K1-${String.fromCharCode(96 + n)}`,
    title: `Use Case ${n} Aufgabe`,
    description: `Aufgabenbeschreibung ${n}`,
    orderIndex: n,
    isActive: true,
    ...over,
  };
}

/** A catalog without any finding: two enablers, all quizzes, documents, use cases and mappings. */
export function cleanSnapshot(): ContentSnapshot {
  const enablers = [enabler(1), enabler(2)];
  const quizzes = enablers.flatMap(e => quizzesOf(e.id));
  return {
    catalog: {
      id: CATALOG,
      code: 'TEST',
      title: 'Testberuf',
      isActive: true,
      durationYears: 3,
      settings: {},
    },
    courses: [
      {
        id: 'c1',
        code: 'K1',
        title: 'Komponente Eins',
        description: null,
        trainingComponentId: null,
        isActive: true,
      },
    ],
    enablers,
    useCases: [makeUseCase(1), makeUseCase(2)],
    quizzes,
    questions: quizzes.flatMap(z => questionsOf(z.id)),
    documents: enablers
      .flatMap(e => [
        doc(`th-${e.id}`, { enablerId: e.id, type: 'THEORY' }),
        doc(`sc-${e.id}`, {
          enablerId: e.id,
          type: 'EXERCISE',
          title: 'Szenario: Part 1: Thema',
        }),
      ])
      .concat(
        [1, 2].flatMap(n => [
          doc(`ta-${n}`, { useCaseId: `uc${n}`, type: 'TRAINEE_QUESTION' }),
          doc(`lo-${n}`, { useCaseId: `uc${n}`, type: 'TRAINER_SOLUTION' }),
        ])
      ),
    learningFields: [{ id: 'lf1', code: 'LF1', title: 'Lernfeld Eins' }],
    mappings: [
      { learningFieldId: 'lf1', enablerId: 'en1', useCaseId: null },
      { learningFieldId: 'lf1', enablerId: 'en2', useCaseId: null },
      { learningFieldId: 'lf1', enablerId: null, useCaseId: 'uc1' },
      { learningFieldId: 'lf1', enablerId: null, useCaseId: 'uc2' },
    ],
    components: [],
  };
}
