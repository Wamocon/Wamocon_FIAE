/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  T1,
  loadScoped,
  scopeReq,
  selectsFrom,
} from '../../../helpers/trainerScope';
import { renderCondition } from '../../../helpers/mockDb';

// WMCNL-2999: the dashboard counted 2158 open reviews, the quiz list ended at 200
// rows (a fixed limit) without a hint, the lesson and use case lists read every row.
// Every list now answers one bounded page together with the total of the same
// filter, and the page loads more on request.

const API = 'http://localhost/api/trainer';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const baseTables = {
  profiles: [
    {
      id: T1,
      fullName: 'Azubi Eins',
      avatarUrl: null,
      isActive: true,
      organizationId: 'org-1',
    },
  ],
  courses: [{ id: 'c1', title: 'Kurs' }],
  courseMembers: [],
  enablers: [{ id: 'e1', courseId: 'c1', title: 'E', scenarioPdfUrl: null }],
  useCases: [{ id: 'u1', courseId: 'c1', title: 'U' }],
};

const enablerRow = (id: string) => ({
  id,
  enablerId: 'e1',
  traineeId: T1,
  solutionText: 'x',
  solutions: null,
  trainerFeedback: null,
  feedbacks: null,
  status: 'PENDING',
  submittedAt: new Date('2026-11-01T10:00:00Z'),
  attemptNumber: 1,
});

async function reviews(query: string, enablerRows = [enablerRow('a')]) {
  const { mod, mock } = await loadScoped('trainer/reviews/route', {
    tables: {
      ...baseTables,
      // the count query comes first, then the page
      enablerSubmissions: { sequence: [[{ c: 2158 }], enablerRows] },
      useCaseSubmissions: { sequence: [[{ c: 7 }], []] },
    },
  });
  const res = await mod.GET(
    scopeReq(`${API}/reviews?${query}`, { header: 'KFBM' })
  );
  expect(res.status).toBe(200);
  return { body: await res.json(), mock };
}

const pageQuery = (mock: any, table: string) =>
  selectsFrom(mock, table).find(c => c.limit !== undefined);

describe('GET /reviews: one page and the total', () => {
  it('answers the first page of 50 and the total of the filter, not the whole list', async () => {
    const { body, mock } = await reviews('type=enabler&status=pending');
    const page = pageQuery(mock, 'enabler_submissions');
    expect(page?.limit).toBe(50);
    expect(page?.offset).toBe(0);
    expect(body.enablerTotal).toBe(2158);
    expect(body.enablerSubmissions).toHaveLength(1);
  });

  it('passes limit and offset on for the next page', async () => {
    const { mock } = await reviews(
      'type=enabler&status=all&limit=50&offset=50'
    );
    const page = pageQuery(mock, 'enabler_submissions');
    expect(page?.limit).toBe(50);
    expect(page?.offset).toBe(50);
  });

  it('bounds the page size: no request asks for an unlimited list', async () => {
    const { mock } = await reviews('type=enabler&limit=100000');
    expect(pageQuery(mock, 'enabler_submissions')?.limit).toBe(100);
  });

  it.each(['abc', '-5', '0', '1.5', ''])(
    'falls back to the default page for the limit %p',
    async limit => {
      const { mock } = await reviews(`type=enabler&limit=${limit}`);
      expect(pageQuery(mock, 'enabler_submissions')?.limit).toBe(50);
    }
  );

  it('reads only the list that was asked for with type', async () => {
    const { body, mock } = await reviews('type=usecase');
    expect(selectsFrom(mock, 'enabler_submissions')).toHaveLength(0);
    expect(body.enablerSubmissions).toEqual([]);
    expect(body.enablerTotal).toBe(0);
    expect(body.useCaseTotal).toBe(7);
  });

  it('counts and lists with the same status filter', async () => {
    const { mock } = await reviews('type=enabler&status=approved');
    const where = selectsFrom(mock, 'enabler_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));
    expect(where).toHaveLength(2);
    for (const w of where) {
      expect(w.sql).toContain('"enabler_submissions"."status" = $');
      expect(w.params).toContain('APPROVED');
    }
  });

  it('status=all does not limit by status', async () => {
    const { mock } = await reviews('type=enabler&status=all');
    const where = selectsFrom(mock, 'enabler_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w).sql);
    for (const sql of where) expect(sql).not.toContain('"status" = $');
  });

  it('keeps the older onlyPending=true link of the dashboard working', async () => {
    const { mock } = await reviews('onlyPending=true');
    const where = selectsFrom(mock, 'enabler_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));
    expect(where[0].params).toContain('PENDING');
  });
});

describe('GET /quiz-submissions: one page and the total', () => {
  const quizRow = (id: string) => ({
    id,
    traineeId: T1,
    quizId: 'q1',
    score: 80,
    isReviewed: false,
    submittedAt: new Date('2026-11-01T10:00:00Z'),
    attemptNumber: 1,
    traineeName: 'Azubi Eins',
    quizTitle: 'Quiz',
    quizType: 'LESSON',
    difficulty: 'LOW',
    enablerTitle: 'E',
  });

  async function quizzes(query: string) {
    const { mod, mock } = await loadScoped('trainer/quiz-submissions/route', {
      tables: {
        ...baseTables,
        quizSubmissions: {
          sequence: [[{ c: 2100 }], [quizRow('s1'), quizRow('s2')]],
        },
      },
    });
    const res = await mod.GET(
      scopeReq(`${API}/quiz-submissions?${query}`, { header: 'KFBM' })
    );
    expect(res.status).toBe(200);
    return { body: await res.json(), mock };
  }

  it('no longer ends at 200 rows: a page of 50 and the total of the filter', async () => {
    const { body, mock } = await quizzes('onlyPending=true');
    const page = pageQuery(mock, 'quiz_submissions');
    expect(page?.limit).toBe(50);
    expect(page?.offset).toBe(0);
    expect(body.total).toBe(2100);
    expect(body.submissions).toHaveLength(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('serves the next page with offset', async () => {
    const { body, mock } = await quizzes(
      'onlyPending=true&limit=50&offset=150'
    );
    expect(pageQuery(mock, 'quiz_submissions')?.offset).toBe(150);
    expect(body.offset).toBe(150);
  });

  it('bounds the page size', async () => {
    const { mock } = await quizzes('limit=5000');
    expect(pageQuery(mock, 'quiz_submissions')?.limit).toBe(100);
  });

  it('counts and lists with one condition', async () => {
    const { mock } = await quizzes('onlyPending=true&quizType=GLOBAL&q=Anna');
    const where = selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));
    expect(where).toHaveLength(2);
    expect(where[1]).toEqual(where[0]);
  });

  it('narrows the list to a quiz type', async () => {
    const { mock } = await quizzes('quizType=GLOBAL');
    const sql = selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));
    expect(sql[0].sql).toContain('"quizzes"."quiz_type" = $');
    expect(sql[0].params).toContain('GLOBAL');
  });

  it('ignores a quiz type that does not exist', async () => {
    const { mock } = await quizzes('quizType=EXAM');
    const sql = selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w).sql);
    expect(sql[0]).not.toContain('quiz_type');
  });

  it('searches the name of the trainee and the title of the quiz, with % and _ as plain characters', async () => {
    const { mock } = await quizzes(`q=${encodeURIComponent('50%_x')}`);
    const where = selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));
    expect(where[0].sql).toContain('"profiles"."full_name" ilike');
    expect(where[0].sql).toContain('"quizzes"."title" ilike');
    expect(where[0].params).toContain('%50\\%\\_x%');
  });

  it('does not search without a text', async () => {
    const { mock } = await quizzes('q=%20%20');
    const sql = selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w).sql);
    expect(sql[0]).not.toContain('ilike');
  });

  // WMCNL-3001: filter by the course (Fragenkomplex) of the quiz
  const COURSE = '77777777-7777-4777-8777-777777777777';
  const conditions = (mock: any) =>
    selectsFrom(mock, 'quiz_submissions')
      .flatMap(c => c.where ?? [])
      .map(w => renderCondition(w));

  it('narrows the list to the quizzes of one course, inside the catalog scope', async () => {
    const { mock } = await quizzes(`course=${COURSE}`);
    const [counted, listed] = conditions(mock);
    expect(counted.sql).toContain('"enabler_quiz_links"."quiz_id"');
    expect(counted.sql).toContain('"enablers"."course_id" = $');
    expect(counted.params).toContain(COURSE);
    // the course has to lie in the occupation of the caller (x-catalog KFBM)
    expect(counted.sql).toContain('"enablers"."training_catalog_id" = $');
    // the total and the page use one condition
    expect(listed).toEqual(counted);
  });

  it('narrows the list to the global quizzes, which have no course', async () => {
    const { mock } = await quizzes('course=global');
    const [counted] = conditions(mock);
    expect(counted.sql).toContain('"quizzes"."quiz_type" = $');
    expect(counted.params).toContain('GLOBAL');
    expect(counted.sql).not.toContain('enabler_quiz_links');
  });

  it('ignores a course that is no id', async () => {
    const { mock } = await quizzes('course=nope');
    const [counted] = conditions(mock);
    expect(counted.sql).not.toContain('enabler_quiz_links');
    expect(counted.sql).not.toContain('course_id');
  });

  it('does not filter by course without the parameter', async () => {
    const { mock } = await quizzes('onlyPending=true');
    expect(conditions(mock)[0].sql).not.toContain('enabler_quiz_links');
  });
});
