import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import db from './index';
import {
  modules,
  lessons,
  subLessons,
  progress,
  quizzes,
  quizSubmissions,
  questions,
  options,
  reflections,
} from './migrations/schemas/schema';

export type ModuleSummary = {
  id: string;
  title: string;
  training_year: number;
  lessonsCount: number;
  subLessonsCount: number;
  progress?: number; // optional for future per-user progress
  estimatedWeeks?: number; // sum of lessons.duration_weeks (if set)
};

export async function getModulesWithCounts(): Promise<ModuleSummary[]> {
  // Fetch modules
  const mods = await db.select().from(modules).orderBy(modules.order_index);

  if (mods.length === 0) return [];

  // For small datasets, do simple per-module counts (avoids complex group joins)
  const results: ModuleSummary[] = [];
  for (const m of mods) {
    const [{ value: lessonsCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(lessons)
      .where(eq(lessons.module_id, m.id));

    // Count sub-lessons across lessons of this module
    const lessonIds = (
      await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.module_id, m.id))
    ).map(r => r.id);

    let subLessonsCount = 0;
    if (lessonIds.length > 0) {
      const [{ value = 0 } = { value: 0 }] = await db
        .select({ value: count() })
        .from(subLessons)
        .where(inArray(subLessons.lesson_id, lessonIds));
      subLessonsCount = value;
    }

    // Compute estimated weeks based on lesson.duration_weeks
    let estimatedWeeks = 0;
    const lessonDurations = await db
      .select({ duration_weeks: lessons.duration_weeks })
      .from(lessons)
      .where(eq(lessons.module_id, m.id));
    if (lessonDurations.length > 0) {
      estimatedWeeks = lessonDurations.reduce((acc, row) => acc + (row.duration_weeks ?? 0), 0);
    }

    results.push({
      id: m.id,
      title: m.title,
      training_year: m.training_year,
      lessonsCount,
      subLessonsCount,
      progress: 0,
      estimatedWeeks,
    });
  }

  return results;
}

export type LessonSummary = {
  id: string;
  title: string;
  order_index: number;
  duration_weeks: number | null;
  subLessonsCount: number;
};

export type ModuleWithLessons = {
  module: { id: string; title: string; training_year: number };
  lessons: LessonSummary[];
};

export async function getModuleWithLessons(moduleId: string): Promise<ModuleWithLessons | null> {
  const [m] = await db.select().from(modules).where(eq(modules.id, moduleId));
  if (!m) return null;

  const ls = await db
    .select({ id: lessons.id, title: lessons.title, order_index: lessons.order_index, duration_weeks: lessons.duration_weeks })
    .from(lessons)
    .where(eq(lessons.module_id, moduleId))
    .orderBy(lessons.order_index);

  const lessonIds = ls.map(l => l.id);
  let counts: Record<string, number> = {};
  if (lessonIds.length > 0) {
    // Count sub-lessons per lesson
    const subs = await db
      .select({ lesson_id: subLessons.lesson_id, cnt: count() })
      .from(subLessons)
      .where(inArray(subLessons.lesson_id, lessonIds))
      .groupBy(subLessons.lesson_id);
    counts = subs.reduce((acc, row) => {
      acc[row.lesson_id] = Number(row.cnt);
      return acc;
    }, {} as Record<string, number>);
  }

  const lessonsWithCounts: LessonSummary[] = ls.map(l => ({
    id: l.id,
    title: l.title,
    order_index: l.order_index,
    duration_weeks: l.duration_weeks ?? null,
    subLessonsCount: counts[l.id] ?? 0,
  }));

  return {
    module: { id: m.id, title: m.title, training_year: m.training_year },
    lessons: lessonsWithCounts,
  };
}

export type SubLessonItem = {
  id: string;
  title: string;
  content: string | null;
  order_index: number;
  duration_minutes: number | null;
};

export type LessonWithSubLessons = {
  lesson: { id: string; title: string; order_index: number; duration_weeks: number | null };
  subLessons: SubLessonItem[];
};

export async function getLessonWithSubLessons(lessonId: string): Promise<LessonWithSubLessons | null> {
  const [l] = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      order_index: lessons.order_index,
      duration_weeks: lessons.duration_weeks,
    })
    .from(lessons)
    .where(eq(lessons.id, lessonId));
  if (!l) return null;

  const subs = await db
    .select({
      id: subLessons.id,
      title: subLessons.title,
      content: subLessons.content,
      order_index: subLessons.order_index,
      duration_minutes: subLessons.duration_minutes,
    })
    .from(subLessons)
    .where(eq(subLessons.lesson_id, lessonId))
    .orderBy(subLessons.order_index);

  return {
    lesson: l,
    subLessons: subs,
  };
}

// ------------------------------
// Trainee Dashboard Data
// ------------------------------

export type ModuleProgress = {
  id: string;
  title: string;
  training_year: number;
  progress: number; // 0-100
  totalSubLessons: number;
  completedSubLessons: number;
};

export async function getUserModuleProgress(userId: string): Promise<ModuleProgress[]> {
  // Get all modules
  const mods = await db.select().from(modules).orderBy(modules.order_index);

  const results: ModuleProgress[] = [];
  for (const m of mods) {
    // Lessons in module
    const lessonIds = (
      await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.module_id, m.id))
    ).map(r => r.id);

    // Total sub-lessons across lessons
    let totalSub = 0;
    if (lessonIds.length > 0) {
      const [{ value = 0 } = { value: 0 }] = await db
        .select({ value: count() })
        .from(subLessons)
        .where(inArray(subLessons.lesson_id, lessonIds));
      totalSub = Number(value);
    }

    // Completed sub-lessons for this user in these lessons
    let completed = 0;
    if (lessonIds.length > 0) {
      const subIds = (
        await db
          .select({ id: subLessons.id })
          .from(subLessons)
          .where(inArray(subLessons.lesson_id, lessonIds))
      ).map(r => r.id);
      if (subIds.length > 0) {
        const [{ value = 0 } = { value: 0 }] = await db
          .select({ value: count() })
          .from(progress)
          .where(and(inArray(progress.sub_lesson_id, subIds), eq(progress.user_id, userId)));
        completed = Number(value);
      }
    }

    const pct = totalSub > 0 ? Math.round((completed / totalSub) * 100) : 0;
    results.push({
      id: m.id,
      title: m.title,
      training_year: m.training_year,
      progress: pct,
      totalSubLessons: totalSub,
      completedSubLessons: completed,
    });
  }

  return results;
}

export type NextLesson = {
  lessonId: string;
  lessonTitle: string;
  moduleTitle: string;
  subLessonId: string;
  subLessonTitle: string;
  estimatedTime: string; // e.g. "45 min"
};

export async function getNextSubLessonForUser(userId: string): Promise<NextLesson | null> {
  // Order by module.order_index, lesson.order_index, subLesson.order_index
  const modList = await db.select().from(modules).orderBy(modules.order_index);
  for (const m of modList) {
    const lessonList = await db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .where(eq(lessons.module_id, m.id))
      .orderBy(lessons.order_index);
    for (const l of lessonList) {
      const subList = await db
        .select({
          id: subLessons.id,
          title: subLessons.title,
          duration_minutes: subLessons.duration_minutes,
        })
        .from(subLessons)
        .where(eq(subLessons.lesson_id, l.id))
        .orderBy(subLessons.order_index);
      for (const s of subList) {
        // Check if completed
        const existing = await db
          .select({ user_id: progress.user_id })
          .from(progress)
          .where(and(eq(progress.user_id, userId), eq(progress.sub_lesson_id, s.id)))
          .limit(1);
        if (existing.length === 0) {
          const mins = s.duration_minutes ?? 30;
          return {
            lessonId: l.id,
            lessonTitle: l.title,
            moduleTitle: m.title,
            subLessonId: s.id,
            subLessonTitle: s.title,
            estimatedTime: `${mins} min`,
          };
        }
      }
    }
  }
  return null;
}

export type WeeklyProgressPoint = { week: string; progress: number };

export async function getWeeklyProgress(userId: string, weeks: number = 6): Promise<WeeklyProgressPoint[]> {
  // Get last N weeks counts from progress.completed_at
  // We'll do it in JS since Postgres date_trunc depends on SQL raw; this is simple enough
  const rows = await db
    .select({ completed_at: progress.completed_at })
    .from(progress)
    .where(eq(progress.user_id, userId as any))
    .orderBy(desc(progress.completed_at));

  const now = new Date();
  const buckets: WeeklyProgressPoint[] = [];
  // Initialize weeks W1..Wn (oldest to newest)
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekLabel = `W${weeks - i}`;
    buckets.push({ week: weekLabel, progress: 0 });
  }

  for (const r of rows) {
    const dt = r.completed_at ? new Date(r.completed_at as any) : null;
    if (!dt) continue;
    const diffDays = Math.floor((now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
    const bucketIndex = Math.floor(diffDays / 7);
    if (bucketIndex >= 0 && bucketIndex < weeks) {
      // We filled newest first in buckets; ensure mapping consistent
      // Our buckets are oldest->newest, index = weeks-1-bucketIndex
      const idx = weeks - 1 - bucketIndex;
      buckets[idx].progress += 1;
    }
  }
  // Normalize to percentage-like scale (optional). We'll cap at 100 and scale if >100.
  const maxVal = buckets.reduce((m, b) => Math.max(m, b.progress), 0) || 1;
  return buckets.map(b => ({ week: b.week, progress: Math.round((b.progress / maxVal) * 100) }));
}

// ------------------------------
// Quizzes
// ------------------------------

export type QuizListItem = {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  bestScore: number;
  questionsCount: number;
  timeLimit: string; // e.g. "15 min"
  attempts: number;
};

export async function getQuizzesForUser(userId: string): Promise<QuizListItem[]> {
  const qs = await db.select().from(quizzes).orderBy(quizzes.created_at);
  const items: QuizListItem[] = [];
  for (const q of qs) {
    // title: q.title, description from module or lesson
    let description = '';
    if (q.lesson_id) {
      const [l] = await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, q.lesson_id));
      if (l) description = `Quiz zur Lektion: ${l.title}`;
    } else if (q.module_id) {
      const [m] = await db.select({ title: modules.title }).from(modules).where(eq(modules.id, q.module_id));
      if (m) description = `Quiz zum Modul: ${m.title}`;
    } else {
      description = `Quiz Jahr ${q.training_year}`;
    }

    const [{ value: qCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(questions)
      .where(eq(questions.quiz_id, q.id));

    const [{ maxScore = 0 } = { maxScore: 0 }] = await db
      .select({ maxScore: max(quizSubmissions.score) })
      .from(quizSubmissions)
  .where(and(eq(quizSubmissions.user_id, userId), eq(quizSubmissions.quiz_id, q.id)));

    const [{ attempts = 0 } = { attempts: 0 }] = await db
      .select({ attempts: count() })
      .from(quizSubmissions)
  .where(and(eq(quizSubmissions.user_id, userId), eq(quizSubmissions.quiz_id, q.id)));

    items.push({
      id: q.id,
      title: q.title,
      description,
      difficulty: 'intermediate',
      bestScore: Number(maxScore) || 0,
      questionsCount: Number(qCount) || 0,
      timeLimit: `${q.time_limit_minutes ?? 30} min`,
      attempts: Number(attempts) || 0,
    });
  }
  return items;
}

// ------------------------------
// Dashboard: Achievements & Deadlines
// ------------------------------

export type AchievementItem = {
  kind: 'quiz' | 'module' | 'streak';
  text: string;
  at?: string | null; // ISO datetime when applicable
};

export async function getRecentAchievements(userId: string): Promise<AchievementItem[]> {
  const out: AchievementItem[] = [];

  // Recent quiz submission
  const recentQuiz = await db
    .select({ quiz_id: quizSubmissions.quiz_id, score: quizSubmissions.score, submitted_at: quizSubmissions.submitted_at })
    .from(quizSubmissions)
    .where(eq(quizSubmissions.user_id, userId))
    .orderBy(desc(quizSubmissions.submitted_at))
    .limit(1);
  if (recentQuiz.length > 0) {
    const rq = recentQuiz[0];
    const [q] = await db.select({ title: quizzes.title }).from(quizzes).where(eq(quizzes.id, rq.quiz_id));
    const title = q?.title || 'Quiz';
    out.push({ kind: 'quiz', text: `${rq.score ?? 0}% im Quiz "${title}"`, at: rq.submitted_at ? new Date(rq.submitted_at as any).toISOString() : null });
  }

  // Completed module (100%): compute latest completion
  const modList = await db.select().from(modules).orderBy(modules.order_index);
  let lastCompleted: { moduleTitle: string; at: string } | null = null;
  for (const m of modList) {
    const lessonIds = (await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.module_id, m.id))).map(r => r.id);
    if (lessonIds.length === 0) continue;
    const subIds = (await db.select({ id: subLessons.id }).from(subLessons).where(inArray(subLessons.lesson_id, lessonIds))).map(r => r.id);
    if (subIds.length === 0) continue;
    const [{ value: doneCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(progress)
      .where(and(eq(progress.user_id, userId), inArray(progress.sub_lesson_id, subIds)));
    if (Number(doneCount) === subIds.length) {
      // Completed; find last completed_at among those sub-lessons
      const last = await db
        .select({ at: progress.completed_at })
        .from(progress)
        .where(and(eq(progress.user_id, userId), inArray(progress.sub_lesson_id, subIds)))
        .orderBy(desc(progress.completed_at))
        .limit(1);
      if (last.length > 0 && last[0].at) {
        const atIso = new Date(last[0].at as any).toISOString();
        if (!lastCompleted || atIso > lastCompleted.at) {
          lastCompleted = { moduleTitle: m.title, at: atIso };
        }
      }
    }
  }
  if (lastCompleted) {
    out.push({ kind: 'module', text: `Modul "${lastCompleted.moduleTitle}" abgeschlossen`, at: lastCompleted.at });
  }

  // Streak: count consecutive days with progress up to 7
  const now = new Date();
  let streak = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    const rows = await db
      .select({ at: progress.completed_at })
      .from(progress)
      .where(and(eq(progress.user_id, userId), (
        // emulate BETWEEN with >= and < using JS filtering post-select would be expensive; but drizzle lacks direct between for timestamps, so rely on client filtering as a compromise for small data.
        // We'll just check existence by counting completed entries and comparing date parts.
        // Fetch recent entries and test in JS.
        eq(progress.user_id, userId)
      )));
    const hadAny = rows.some(r => {
      if (!r.at) return false;
      const d = new Date(r.at as any);
      return d >= day && d < nextDay;
    });
    if (hadAny) streak += 1; else break;
  }
  if (streak >= 3) {
    out.push({ kind: 'streak', text: `${streak} Tage in Folge gelernt`, at: new Date().toISOString() });
  }

  return out;
}

export type DeadlineItem = { label: string; dueDate: string };

export async function getUpcomingDeadlines(userId: string): Promise<DeadlineItem[]> {
  // From reflections due_date upcoming
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const all = await db.select({ due_date: reflections.due_date }).from(reflections).where(eq(reflections.user_id, userId));
  const upcoming = all
    .filter(r => !!r.due_date)
    .map(r => new Date(r.due_date as any))
    .filter(d => d >= today)
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, 3)
    .map(d => ({ label: 'Reflexion fällig', dueDate: d.toISOString().split('T')[0] }));
  return upcoming;
}

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number; // For now, include correct index for client-side scoring. TODO: move scoring server-side.
  order_index: number;
};

export type QuizWithQuestions = {
  id: string;
  title: string;
  description: string;
  totalQuestions: number;
  timeLimitMinutes: number;
  questions: QuizQuestion[];
};

export async function getQuizWithQuestions(quizId: string): Promise<QuizWithQuestions | null> {
  const [qz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
  if (!qz) return null;

  let description = '';
  if (qz.lesson_id) {
    const [l] = await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, qz.lesson_id));
    if (l) description = `Quiz zur Lektion: ${l.title}`;
  } else if (qz.module_id) {
    const [m] = await db.select({ title: modules.title }).from(modules).where(eq(modules.id, qz.module_id));
    if (m) description = `Quiz zum Modul: ${m.title}`;
  } else {
    description = `Quiz Jahr ${qz.training_year}`;
  }

  const qs = await db
    .select({ id: questions.id, question_text: questions.question_text, order_index: questions.order_index })
    .from(questions)
    .where(eq(questions.quiz_id, quizId))
    .orderBy(questions.order_index);

  const outQuestions: QuizQuestion[] = [];
  for (const q of qs) {
    const opts = await db
      .select({ option_text: options.option_text, is_correct: options.is_correct })
      .from(options)
      .where(eq(options.question_id, q.id));
    const optionsTexts = opts.map(o => o.option_text);
    const correctIndex = Math.max(0, opts.findIndex(o => o.is_correct));
    outQuestions.push({
      id: q.id,
      question: q.question_text,
      options: optionsTexts,
      correctIndex,
      order_index: q.order_index,
    });
  }

  return {
    id: qz.id,
    title: qz.title,
    description,
    totalQuestions: outQuestions.length,
    timeLimitMinutes: qz.time_limit_minutes ?? 30,
    questions: outQuestions,
  };
}

// ------------------------------
// Sub-lesson detail
// ------------------------------

export type SubLessonDetail = {
  id: string;
  title: string;
  content: string | null;
  duration_minutes: number | null;
  lesson: { id: string; title: string };
};

export async function getSubLessonWithLesson(subLessonId: string): Promise<SubLessonDetail | null> {
  const [s] = await db
    .select({
      id: subLessons.id,
      title: subLessons.title,
      content: subLessons.content,
      duration_minutes: subLessons.duration_minutes,
      lesson_id: subLessons.lesson_id,
    })
    .from(subLessons)
    .where(eq(subLessons.id, subLessonId));
  if (!s) return null;
  const [l] = await db.select({ id: lessons.id, title: lessons.title }).from(lessons).where(eq(lessons.id, s.lesson_id));
  if (!l) return null;
  return { id: s.id, title: s.title, content: s.content, duration_minutes: s.duration_minutes, lesson: l };
}
