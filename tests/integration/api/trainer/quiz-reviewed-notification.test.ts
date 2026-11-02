/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ORG, T1, loadScoped, scopeReq } from '../../../helpers/trainerScope';
import { quizReviewedMessage } from '@/lib/notifications/quiz-reviewed';

// WMCNL-2963: the notification "Quiz bewertet" named no quiz and no result, a
// trainee with several quizzes could not tell which one it was about. It now
// carries the title and the result of the reviewed quiz and leads to the page
// with the result and the feedback.

const ONE = 'trainer/quiz-submissions/[submissionId]/route';
const SUBMISSION = 'bbbbbbb2-0000-4000-8000-000000000002';
const QUIZ = 'bbbbbbb1-0000-4000-8000-000000000001';
const URL_ONE = `http://localhost/api/trainer/quiz-submissions/${SUBMISSION}`;
const params = { params: Promise.resolve({ submissionId: SUBMISSION }) };

const submission = (overrides: Record<string, unknown> = {}) => ({
  id: SUBMISSION,
  traineeId: T1,
  quizId: QUIZ,
  score: 80,
  isReviewed: false,
  trainerFeedback: null,
  ...overrides,
});

describe('PATCH quiz-submissions: the notification of the trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  async function review(
    body: Record<string, unknown>,
    updated: Record<string, unknown> = {}
  ) {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        quizSubmissions: [submission()],
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: ORG }],
        quizzes: [
          {
            id: QUIZ,
            title: 'Netzwerktechnik Grundlagen',
            trainingCatalogId: '00000000-0000-4000-8000-000000000001',
          },
        ],
      },
      returns: {
        quizSubmissions: [submission({ isReviewed: true, ...updated })],
      },
    });
    const res = await mod.PATCH(
      scopeReq(URL_ONE, { method: 'PATCH', body }),
      params
    );
    expect(res.status).toBe(200);
    const [values] = mock.writes('insert', 'notifications') as any[];
    return values;
  }

  it('names the quiz and the result and links to the feedback page', async () => {
    const values = await review({ is_reviewed: true });
    expect(values.type).toBe('QUIZ_REVIEWED');
    expect(values.message).toBe(
      'Dein Quiz „Netzwerktechnik Grundlagen“ wurde bewertet (Ergebnis: 80 %).'
    );
    expect(values.linkUrl).toBe('/trainee/trainer-feedback');
    // the title is in the context too, so the list does not look it up again
    expect(values.context).toMatchObject({
      submissionId: SUBMISSION,
      quizId: QUIZ,
      quizTitle: 'Netzwerktechnik Grundlagen',
      score: 80,
    });
  });

  it('says that there is feedback when the trainer wrote some', async () => {
    const values = await review({
      is_reviewed: true,
      trainer_feedback: 'Gut',
    });
    expect(values.message).toBe(
      'Dein Quiz „Netzwerktechnik Grundlagen“ wurde bewertet (Ergebnis: 80 %). Trainer-Feedback ist verfügbar.'
    );
  });
});

describe('quizReviewedMessage', () => {
  it('leaves out what is not known', () => {
    expect(quizReviewedMessage({})).toBe('Dein Quiz wurde bewertet.');
    expect(quizReviewedMessage({ quizTitle: 'Test', score: null })).toBe(
      'Dein Quiz „Test“ wurde bewertet.'
    );
    expect(quizReviewedMessage({ score: '66.67' })).toBe(
      'Dein Quiz wurde bewertet (Ergebnis: 67 %).'
    );
  });
});
