import { weeklyProgressPercent } from '@/lib/catalog/weekly-progress';

// WMCNL-2950: the weekly progress counted events (completions plus quiz
// attempts) and printed them as percent, so a week showed 318 %. It is the
// share of completed enablers of the occupation now, between 0 and 100.

const NOW = new Date('2026-11-02T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const enabler = (id: string, isActive = true) => ({
  id,
  title: id,
  courseId: 'c1',
  orderIndex: 1,
  isActive,
});
const link = (enablerId: string, quizId: string, gradable = true) => ({
  enablerId,
  quizId,
  difficulty: 'LOW' as const,
  quizIsActive: true,
  gradable,
});

describe('weeklyProgressPercent', () => {
  it('never leaves 0 to 100, however many attempts there are', () => {
    const attempts = Array.from({ length: 400 }, (_, i) => ({
      quizId: `q${i % 2}`,
      score: 90,
      submittedAt: daysAgo(i % 40),
    }));
    const points = weeklyProgressPercent({
      now: NOW,
      courses: [
        {
          enablers: [enabler('e1'), enabler('e2')],
          quizLinks: [link('e1', 'q0'), link('e2', 'q1')],
        },
      ],
      attempts,
    });
    expect(points).toHaveLength(6);
    for (const p of points) {
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThanOrEqual(100);
    }
    expect(points[5].progress).toBe(100);
  });

  it('is the share of completed enablers at the end of each week, never falling', () => {
    const points = weeklyProgressPercent({
      now: NOW,
      courses: [
        {
          enablers: [enabler('e1'), enabler('e2'), enabler('e3')],
          quizLinks: [link('e1', 'q1'), link('e2', 'q2'), link('e3', 'q3')],
        },
      ],
      attempts: [
        { quizId: 'q1', score: 80, submittedAt: daysAgo(20) },
        { quizId: 'q2', score: 60, submittedAt: daysAgo(3) },
        // below the passing score: no completion
        { quizId: 'q3', score: 40, submittedAt: daysAgo(1) },
      ],
    });
    expect(points.map(p => p.progress)).toEqual([0, 0, 0, 33, 33, 67]);
    expect(points.map(p => p.week)).toEqual([
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'W6',
    ]);
  });

  it('only counts the enablers handed in (the occupation of the tab)', () => {
    const other = weeklyProgressPercent({
      now: NOW,
      courses: [],
      attempts: [{ quizId: 'q9', score: 100, submittedAt: daysAgo(1) }],
    });
    expect(other.map(p => p.progress)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ignores inactive enablers and quizzes that cannot be passed', () => {
    const points = weeklyProgressPercent({
      now: NOW,
      courses: [
        {
          enablers: [enabler('e1'), enabler('e2', false), enabler('e3')],
          quizLinks: [
            link('e1', 'q1'),
            link('e2', 'q2'),
            link('e3', 'q3', false),
          ],
        },
      ],
      attempts: [{ quizId: 'q1', score: 90, submittedAt: daysAgo(1) }],
    });
    // only e1 is rated: e2 is inactive, e3 has no gradable quiz
    expect(points[5].progress).toBe(100);
  });
});
