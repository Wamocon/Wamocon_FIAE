/**
 * @jest-environment node
 */
import {
  percentOf,
  progressPercentAt,
  progressTrendOf,
  summarizeTraineeProgress,
} from '@/lib/trainer/trainee-progress';

// The ONE progress figure of the trainer pages (WMCNL-2980, 2982, 2995):
// completed enablers (every required lesson quiz passed) over the active
// enablers of the courses in scope. The figure is a percentage and never
// leaves 0 to 100.

const day = 86_400_000;
const NOW = new Date('2026-11-02T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * day);

const enabler = (id: string, courseId = 'c1', isActive = true) => ({
  id,
  courseId,
  isActive,
});
const link = (enablerId: string, quizId: string, over = {}) => ({
  enablerId,
  quizId,
  difficulty: null,
  quizIsActive: true,
  gradable: true,
  ...over,
});

describe('percentOf', () => {
  it('is 0 without enablers and never above 100', () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(7, 3)).toBe(100);
    expect(percentOf(1, 3)).toBe(33);
  });
});

describe('summarizeTraineeProgress', () => {
  it('counts an enabler as completed when its required quiz was passed', () => {
    const p = summarizeTraineeProgress({
      courseIds: ['c1'],
      enablers: [enabler('e1'), enabler('e2')],
      links: [link('e1', 'q1'), link('e2', 'q2')],
      attempts: [
        { quizId: 'q1', score: 80, submittedAt: ago(3) },
        { quizId: 'q2', score: 40, submittedAt: ago(3) },
      ],
    });
    expect(p.completed).toBe(1);
    expect(p.total).toBe(2);
    expect(p.pct).toBe(50);
    expect(p.courses.get('c1')).toEqual({ completed: 1, total: 2 });
  });

  it('uses the best attempt and ignores inactive enablers', () => {
    const p = summarizeTraineeProgress({
      courseIds: ['c1'],
      enablers: [enabler('e1'), enabler('e2', 'c1', false)],
      links: [link('e1', 'q1'), link('e2', 'q2')],
      attempts: [
        { quizId: 'q1', score: 20, submittedAt: ago(5) },
        { quizId: 'q1', score: 90, submittedAt: ago(1) },
      ],
    });
    expect(p.total).toBe(1);
    expect(p.pct).toBe(100);
  });

  it('an enabler without a required quiz counts as completed (as in the trainee area)', () => {
    const p = summarizeTraineeProgress({
      courseIds: ['c1'],
      enablers: [enabler('e1'), enabler('e2')],
      // e2 only has an inactive quiz and a quiz that cannot be graded
      links: [
        link('e1', 'q1'),
        link('e2', 'q2', { quizIsActive: false }),
        link('e2', 'q3', { gradable: false }),
      ],
      attempts: [],
    });
    expect(p.completed).toBe(1);
    expect(p.undated).toBe(1);
    expect(p.pct).toBe(50);
  });

  it('counts only the courses in scope (the other occupation does not count)', () => {
    const p = summarizeTraineeProgress({
      courseIds: ['c1'],
      enablers: [
        enabler('e1', 'c1'),
        enabler('e2', 'c-other'),
        enabler('e3', 'c-other'),
      ],
      links: [link('e1', 'q1')],
      attempts: [{ quizId: 'q1', score: 100, submittedAt: ago(1) }],
    });
    expect(p.total).toBe(1);
    expect(p.pct).toBe(100);
    expect(p.courses.size).toBe(1);
  });

  it('a trainee without a course has 0 of 0 and 0 %', () => {
    const p = summarizeTraineeProgress({
      courseIds: [],
      enablers: [enabler('e1')],
      links: [],
      attempts: [],
    });
    expect(p).toMatchObject({ completed: 0, total: 0, pct: 0 });
    expect(p.courses.size).toBe(0);
  });

  it('dates an enabler with the last of its required quizzes (first passing attempt each)', () => {
    const p = summarizeTraineeProgress({
      courseIds: ['c1'],
      enablers: [enabler('e1')],
      links: [link('e1', 'q1'), link('e1', 'q2')],
      attempts: [
        { quizId: 'q1', score: 10, submittedAt: ago(20) },
        { quizId: 'q1', score: 70, submittedAt: ago(10) },
        { quizId: 'q1', score: 95, submittedAt: ago(2) },
        { quizId: 'q2', score: 60, submittedAt: ago(6) },
      ],
    });
    expect(p.completionDates).toHaveLength(1);
    expect(p.completionDates[0].getTime()).toBe(ago(6).getTime());
  });
});

describe('progressTrendOf', () => {
  const all = summarizeTraineeProgress({
    courseIds: ['c1'],
    enablers: Array.from({ length: 3 }, (_, i) => enabler(`e${i}`)),
    links: [link('e0', 'q0'), link('e1', 'q1'), link('e2', 'q2')],
    attempts: [
      // many attempts in the last week: the old chart counted them as 3000 "percent"
      ...Array.from({ length: 30 }, (_, i) => ({
        quizId: 'q0',
        score: 90,
        submittedAt: ago(1 + i / 100),
      })),
      { quizId: 'q1', score: 90, submittedAt: ago(1) },
    ],
  });

  it('is a percentage: every point between 0 and 100, six weeks, oldest first', () => {
    const trend = progressTrendOf([all], NOW);
    expect(trend.map(p => p.week)).toEqual([
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'W6',
    ]);
    for (const point of trend) {
      expect(point.progress).toBeGreaterThanOrEqual(0);
      expect(point.progress).toBeLessThanOrEqual(100);
    }
  });

  it('jumps only in the week a quiz was passed and ends at the figure of today', () => {
    const trend = progressTrendOf([all], NOW);
    expect(trend.slice(0, 5).map(p => p.progress)).toEqual([0, 0, 0, 0, 0]);
    expect(trend[5].progress).toBe(all.pct);
    expect(all.pct).toBe(67);
  });

  it('averages the trainees and is 0 for nobody', () => {
    const none = summarizeTraineeProgress({
      courseIds: [],
      enablers: [],
      links: [],
      attempts: [],
    });
    expect(progressTrendOf([all, none], NOW)[5].progress).toBe(34);
    expect(progressTrendOf([], NOW).every(p => p.progress === 0)).toBe(true);
  });

  it('progressPercentAt counts only what was completed by then', () => {
    expect(progressPercentAt(all, ago(3))).toBe(0);
    expect(progressPercentAt(all, NOW)).toBe(67);
  });
});
