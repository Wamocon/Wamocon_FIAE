/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';
import { createTableDb } from '../../../helpers/mockDb';

// Write path 3: api/hai/embed (indexEnabler and the background reindex). Every
// indexContent call states catalog, visibility and organization, a quiz is
// split into questions (all) and answers (trainer) before the size chunking,
// and no call writes answer content with visibility 'all'.

const KFBM = '00000000-0000-4000-8000-000000000002';
const FIAE = '00000000-0000-4000-8000-000000000001';
const STAFF = fakeSession({ id: 'p-trainer', isPlatformOwner: true });

const ANSWER_MARKERS = ['✓', '✗', 'Erklärung:', 'Erwartete Antwort:'];

type Tables = Record<string, any[]>;

const defaultTables = (): Tables => ({
  courses: [
    { id: 'c1', title: 'Kurs', year: 1, chapter: 1, trainingCatalogId: KFBM },
  ],
  enablers: [
    {
      id: 'e1',
      title: 'Enabler',
      courseId: 'c1',
      descriptionText: 'Eine Beschreibung.',
      trainingCatalogId: KFBM,
    },
  ],
  quizzes: [{ id: 'q1', title: 'Quiz Eins', trainingCatalogId: KFBM }],
  questions: [
    {
      id: 'k1',
      questionText: 'Was ist ein Router?',
      questionType: 'MCQ',
      expectedAnswer: null,
      orderIndex: 0,
    },
  ],
  options: [
    { optionText: 'Ein Gerät', isCorrect: true, explanation: 'weil es routet' },
    { optionText: 'Ein Kabel', isCorrect: false, explanation: null },
  ],
  trainingCatalogLearningFields: [
    {
      id: 'lf1',
      label: 'LF-1',
      title: 'Lernfeld Eins',
      description: 'Beschreibung des Lernfelds.',
      trainingCatalogId: FIAE,
    },
  ],
  trainingCatalogContentMappings: [{ enablerId: 'e1', useCaseId: null }],
});

async function load(tables: Tables) {
  jest.resetModules();
  mockSession(STAFF);
  const hai = createTableDb(tables);
  jest.doMock('@/db/haiDb', () => ({ __esModule: true, default: hai.db }));
  jest.doMock('@/db', () => ({ __esModule: true, default: {} }));
  const indexContent = jest.fn(async (_options: unknown) => ({
    success: true,
    chunksIndexed: 1,
    chunksSkipped: 0,
    chunksFailed: 0,
  }));
  const removeChunkPart = jest.fn(async (..._args: unknown[]) => undefined);
  jest.doMock('@/lib/hai', () => ({
    __esModule: true,
    indexContent,
    removeChunkPart,
    removeEmbeddings: jest.fn(async () => true),
    getEmbeddingCount: jest.fn(async () => 0),
    getIndexedSources: jest.fn(async () => []),
  }));
  const jobs = {
    createReindexJob: jest.fn(async (..._args: unknown[]) => ({
      jobId: 'job-1',
      error: undefined,
    })),
    getJobStatus: jest.fn(async () => null),
    getLatestJob: jest.fn(async () => null),
    markJobRunning: jest.fn(async () => undefined),
    markJobCompleted: jest.fn(async (..._args: unknown[]) => undefined),
    markJobFailed: jest.fn(async (..._args: unknown[]) => undefined),
    markJobCancelled: jest.fn(async () => undefined),
    updateJobProgress: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => false),
    requestCancellation: jest.fn(async () => true),
  };
  jest.doMock('@/lib/hai/reindexJob', () => ({ __esModule: true, ...jobs }));
  const mod = (await import('@/app/api/hai/embed/route')) as any;
  const calls = () => indexContent.mock.calls.map(([o]) => o as any);
  return { mod, indexContent, removeChunkPart, jobs, calls };
}

async function runIndexAll(tables: Tables) {
  const loaded = await load(tables);
  const res = await loaded.mod.POST(
    makeRequest('POST', 'http://localhost/api/hai/embed', {
      token: 't',
      body: { action: 'index_all' },
    })
  );
  expect(res.status).toBe(200);
  // the job runs after the response (setTimeout 0)
  for (let i = 0; i < 100; i++) {
    if (
      loaded.jobs.markJobCompleted.mock.calls.length > 0 ||
      loaded.jobs.markJobFailed.mock.calls.length > 0
    ) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(loaded.jobs.markJobFailed).not.toHaveBeenCalled();
  expect(loaded.jobs.markJobCompleted).toHaveBeenCalled();
  return loaded;
}

describe('embed route write paths state the scope', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('index_enabler: catalog of the enabler, visible to all, no organization', async () => {
    const { mod, calls } = await load(defaultTables());
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/hai/embed', {
        token: 't',
        body: { action: 'index_enabler', sourceId: '3b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11' },
      })
    );
    expect(res.status).toBe(200);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({
      sourceType: 'enabler',
      trainingCatalogId: KFBM,
      visibility: 'all',
      organizationId: null,
    });
  });

  it('index_all: every call has catalog, visibility and organization', async () => {
    const { calls } = await runIndexAll(defaultTables());
    const types = calls().map(c => c.sourceType);
    expect(types).toEqual(
      expect.arrayContaining(['course', 'enabler', 'quiz'])
    );
    for (const call of calls()) {
      expect(call.trainingCatalogId).toEqual(expect.stringMatching(/^0000/));
      expect(['all', 'trainer']).toContain(call.visibility);
      expect(call.organizationId).toBeNull();
    }
  });

  it('index_all: course and learning field take their own occupation', async () => {
    const { calls } = await runIndexAll(defaultTables());
    const course = calls().find(c => c.sourceType === 'course');
    expect(course.trainingCatalogId).toBe(KFBM);
    const learningField = calls().find(c => c.metadata?.type === 'lernfeld');
    expect(learningField.trainingCatalogId).toBe(FIAE);
    expect(learningField.visibility).toBe('all');
    expect(learningField.metadata.label).toBe('LF-1');
  });

  it('index_all: the quiz is split into questions (all) and answers (trainer)', async () => {
    const { calls, removeChunkPart } = await runIndexAll(defaultTables());
    const quiz = calls().filter(c => c.sourceType === 'quiz');
    expect(quiz).toHaveLength(2);
    const questions = quiz.find(c => c.metadata.contentPart === 'questions');
    const answers = quiz.find(c => c.metadata.contentPart === 'answers');

    expect(questions.visibility).toBe('all');
    expect(questions.chunkIndexOffset).toBeUndefined();
    for (const marker of ANSWER_MARKERS) {
      expect(questions.content).not.toContain(marker);
    }
    expect(questions.content).toContain('Was ist ein Router?');
    expect(questions.content).toContain('Ein Gerät');

    expect(answers.visibility).toBe('trainer');
    expect(answers.chunkIndexOffset).toBe(10000);
    expect(answers.content).toContain('✓ Ein Gerät');
    expect(answers.content).toContain('Erklärung: weil es routet');
    expect(answers.trainingCatalogId).toBe(KFBM);
    expect(removeChunkPart).not.toHaveBeenCalled();
  });

  it('index_all: no call with visibility all carries answer content', async () => {
    const tables = defaultTables();
    tables.questions = [
      ...tables.questions,
      {
        id: 'k2',
        questionText: 'Nenne ein Beispiel',
        questionType: 'TEXT',
        expectedAnswer: 'Ein Switch',
        orderIndex: 1,
      },
    ];
    const { calls } = await runIndexAll(tables);
    for (const call of calls().filter(c => c.visibility === 'all')) {
      for (const marker of ANSWER_MARKERS) {
        expect(call.content).not.toContain(marker);
      }
      expect(call.content).not.toContain('Ein Switch');
    }
    const answers = calls().find(c => c.metadata?.contentPart === 'answers');
    expect(answers.content).toContain('Erwartete Antwort: Ein Switch');
  });

  it('index_all: a quiz without answer content clears the answers block', async () => {
    const tables = defaultTables();
    tables.questions = [
      {
        id: 'k1',
        questionText: 'Frage ohne Antwort',
        questionType: 'TEXT',
        expectedAnswer: null,
        orderIndex: 0,
      },
    ];
    const { calls, removeChunkPart } = await runIndexAll(tables);
    expect(
      calls().filter(c => c.sourceType === 'quiz' && c.visibility === 'trainer')
    ).toHaveLength(0);
    expect(removeChunkPart).toHaveBeenCalledWith('quiz', 'q1', 10000);
  });

  it('index_all: reports a source whose write was refused', async () => {
    const loaded = await load(defaultTables());
    loaded.indexContent.mockImplementation(async (options: any) =>
      options.sourceType === 'quiz' && options.visibility === 'trainer'
        ? {
            success: false,
            chunksIndexed: 0,
            chunksSkipped: 0,
            chunksFailed: 0,
            error: 'Index scope incomplete',
          }
        : { success: true, chunksIndexed: 1, chunksSkipped: 0, chunksFailed: 0 }
    );
    await loaded.mod.POST(
      makeRequest('POST', 'http://localhost/api/hai/embed', {
        token: 't',
        body: { action: 'index_all' },
      })
    );
    for (let i = 0; i < 100; i++) {
      if (loaded.jobs.markJobCompleted.mock.calls.length > 0) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const progress = loaded.jobs.markJobCompleted.mock.calls[0][1] as any;
    expect(progress.failedSources).toBe(1);
    expect(progress.errors[0]).toMatch(/Quiz "Quiz Eins".*Index scope/);
  });
});
