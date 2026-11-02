import {
  bestScoresOf,
  hasRequiredQuiz,
  isEnablerCompleted,
  type ProgressionEnabler,
  type ProgressionQuizLink,
} from '@/lib/catalog/progression';

export interface WeeklyProgressPoint {
  week: string;
  /** Percent, 0 to 100. */
  progress: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The weekly progress of the dashboard: for each of the last `weeks` weeks (the
 * last one ends now) the share, in percent, of the enablers of the chosen
 * occupation that were completed by the end of that week. "Completed" is the
 * one definition (every required quiz passed, isEnablerCompleted) applied to
 * the attempts made until then, so the curve never falls and never leaves 0 to
 * 100. Only enablers with a required quiz count (an enabler without one cannot
 * be worked on and says nothing about progress). Without such an enabler every
 * week is 0.
 */
export function weeklyProgressPercent(input: {
  now: Date;
  weeks?: number;
  /** Enablers and quiz links of the courses of the chosen occupation. */
  courses: ReadonlyArray<{
    enablers: ReadonlyArray<ProgressionEnabler>;
    quizLinks: ReadonlyArray<ProgressionQuizLink>;
  }>;
  /** Every quiz attempt of the trainee (other occupations do no harm). */
  attempts: ReadonlyArray<{
    quizId: unknown;
    score: number | null | undefined;
    submittedAt: Date | string | null | undefined;
  }>;
}): WeeklyProgressPoint[] {
  const weeks = input.weeks ?? 6;
  const rated: Array<ReturnType<typeof linksOfEnabler>> = [];
  for (const course of input.courses) {
    for (const enabler of course.enablers) {
      if (!enabler.isActive) continue;
      const links = linksOfEnabler(course.quizLinks, enabler.id);
      if (hasRequiredQuiz(links)) rated.push(links);
    }
  }

  const dated = input.attempts.flatMap(a => {
    if (!a.submittedAt) return [];
    const at = new Date(a.submittedAt as Date).getTime();
    return Number.isNaN(at) ? [] : [{ ...a, at }];
  });

  const points: WeeklyProgressPoint[] = [];
  for (let k = 0; k < weeks; k++) {
    const end = input.now.getTime() - (weeks - 1 - k) * 7 * DAY_MS;
    let progress = 0;
    if (rated.length > 0) {
      const best = bestScoresOf(dated.filter(a => a.at <= end));
      const done = rated.filter(links => isEnablerCompleted(links, best));
      progress = Math.round((done.length / rated.length) * 100);
    }
    points.push({ week: `W${k + 1}`, progress });
  }
  return points;
}

function linksOfEnabler(
  links: ReadonlyArray<ProgressionQuizLink>,
  enablerId: string
): ProgressionQuizLink[] {
  return links.filter(l => String(l.enablerId) === String(enablerId));
}
