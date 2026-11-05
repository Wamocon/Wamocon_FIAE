/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ORG, T1, loadScoped, scopeReq } from '../../../helpers/trainerScope';

// WMCNL-3016: 150 of 100 points were saved, and the grading could not be
// corrected. The server takes whole points from 0 up to the maximum only, and
// the list of the exams brings the saved result back (points, the maximum
// derived from the percentage), also a result saved above its maximum before.

const EXAM = 'aaaaaaa4-0000-4000-8000-000000000004';
const API = 'http://localhost/api/trainer/school/exams';

const traineeRow = {
  id: T1,
  role: 'TRAINEE',
  organizationId: ORG,
  fullName: 'Leon Moretz',
  email: 'leon@example.com',
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function grade(body: unknown) {
  const { mod, mock } = await loadScoped(
    'trainer/school/exams/[examId]/grade/route',
    {
      tables: {
        profiles: [traineeRow],
        schoolExams: [{ traineeId: T1, subject: 'Netzwerktechnik' }],
        schoolExamResults: [],
      },
      returns: { schoolExamResults: [{ id: 'res1', points: 70 }] },
    }
  );
  const res = await mod.PUT(
    scopeReq(`${API}/${EXAM}/grade`, { method: 'PUT', body }),
    { params: Promise.resolve({ examId: EXAM }) }
  );
  return { res, mock };
}

describe('PUT /api/trainer/school/exams/[examId]/grade', () => {
  it('refuses 150 of 100 points and writes nothing', async () => {
    const { res, mock } = await grade({ points: 150, maxPoints: 100 });
    expect(res.status).toBe(400);
    const answer = await res.json();
    expect(answer.code).toBe('POINTS_ABOVE_MAX');
    expect(answer.error).toContain('nicht überschreiten');
    expect(mock.writes('insert', 'school_exam_results')).toHaveLength(0);
    expect(mock.writes('update', 'school_exam_results')).toHaveLength(0);
  });

  it.each([
    ['negative points', { points: -1, maxPoints: 100 }, 'POINTS_INVALID'],
    ['half points', { points: 7.5, maxPoints: 15 }, 'POINTS_INVALID'],
    ['text as points', { points: 'viel', maxPoints: 100 }, 'POINTS_INVALID'],
    ['a maximum of 0', { points: 0, maxPoints: 0 }, 'MAX_POINTS_INVALID'],
    ['a huge maximum', { points: 1, maxPoints: 1e12 }, 'MAX_POINTS_INVALID'],
  ])('refuses %s with %s', async (_name, body, code) => {
    const { res } = await grade(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
  });

  it.each([
    [{ points: 100, maxPoints: 100 }],
    [{ points: 0, maxPoints: 100 }],
    [{ points: '70', maxPoints: '100' }],
  ])('takes %j and writes the result', async body => {
    const { res, mock } = await grade(body);
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'school_exam_results')).toHaveLength(1);
  });
});

describe('GET /api/trainer/school/exams', () => {
  async function list(results: unknown[]) {
    const { mod } = await loadScoped('trainer/school/exams/route', {
      tables: {
        profiles: [traineeRow],
        schoolExams: [
          {
            id: EXAM,
            traineeId: T1,
            examDate: new Date(2026, 9, 20),
            subject: 'Netzwerktechnik',
            examTypeValue: 'TEST',
            isPersonal: false,
            lernfeldCode: null,
          },
        ],
        schoolExamResults: results,
      },
    });
    const res = await mod.GET(scopeReq(`${API}?traineeId=${T1}`));
    return (await res.json()).exams[0];
  }

  it('brings the saved result back with the maximum derived from the percentage', async () => {
    const exam = await list([
      { examId: EXAM, points: 70, percentage: 70, passed: true },
    ]);
    expect(exam).toMatchObject({ points: 70, maxPoints: 100, passed: true });
  });

  it('shows a result saved above its maximum, without breaking', async () => {
    const exam = await list([
      { examId: EXAM, points: 150, percentage: 150, passed: true },
    ]);
    expect(exam).toMatchObject({ points: 150, maxPoints: 100, passed: true });
  });

  it('keeps an exam without a result as it was', async () => {
    const exam = await list([]);
    expect(exam).toMatchObject({ points: null, maxPoints: null, passed: null });
  });
});
