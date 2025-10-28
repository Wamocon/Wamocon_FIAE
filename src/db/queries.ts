// Deprecated legacy queries file (pre-normalized schema)
// This module now provides minimal stubs to avoid type errors in legacy imports.
// The new implementation lives under Next.js API routes and feature-specific loaders.
// If a screen still depends on these utilities, wire it to the new APIs instead.

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
  // Return empty to prevent runtime failures; replace with new API-backed loader if needed
  return [];
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

export async function getModuleWithLessons(_moduleId: string): Promise<ModuleWithLessons | null> {
  return null;
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

export async function getLessonWithSubLessons(_lessonId: string): Promise<LessonWithSubLessons | null> {
  return null;
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

export async function getUserModuleProgress(_userId: string): Promise<ModuleProgress[]> {
  return [];
}

export type NextLesson = {
  lessonId: string;
  lessonTitle: string;
  moduleTitle: string;
  subLessonId: string;
  subLessonTitle: string;
  estimatedTime: string; // e.g. "45 min"
};

export async function getNextSubLessonForUser(_userId: string): Promise<NextLesson | null> {
  return null;
}

export type WeeklyProgressPoint = { week: string; progress: number };

export async function getWeeklyProgress(_userId: string, weeks: number = 6): Promise<WeeklyProgressPoint[]> {
  const out: WeeklyProgressPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    out.push({ week: `W${weeks - i}`, progress: 0 });
  }
  return out;
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

export async function getQuizzesForUser(_userId: string): Promise<QuizListItem[]> {
  return [];
}

// ------------------------------
// Dashboard: Achievements & Deadlines
// ------------------------------

export type AchievementItem = {
  kind: 'quiz' | 'module' | 'streak';
  text: string;
  at?: string | null; // ISO datetime when applicable
};

export async function getRecentAchievements(_userId: string): Promise<AchievementItem[]> {
  return [];
}

export type DeadlineItem = { label: string; dueDate: string };

export async function getUpcomingDeadlines(_userId: string): Promise<DeadlineItem[]> {
  return [];
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

export async function getQuizWithQuestions(_quizId: string): Promise<QuizWithQuestions | null> {
  return null;
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

export async function getSubLessonWithLesson(_subLessonId: string): Promise<SubLessonDetail | null> {
  return null;
}
