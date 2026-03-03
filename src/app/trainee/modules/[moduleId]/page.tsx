'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { Check, Clock, X as XIcon, ChevronRight } from 'lucide-react';
import { PageLoader } from '@/components/ui/PageLoader';

export default function TraineeModuleDetailPage() {
  const params = useParams<{ moduleId: string }>();
  const courseId = params?.moduleId as string;
  const { profile } = useAuth();
  const { t } = useLanguage();

  type CourseDetail = {
    course: {
      id: string;
      title: string;
      year: number | null;
      chapter: number | null;
    } | null;
    enablers: Array<{
      id: string;
      title: string;
      attemptNumber?: number | null;
      status?: string | null;
    }>;
    useCases: Array<{
      id: string;
      title: string;
      attemptNumber?: number | null;
      status?: string | null;
    }>;
  };

  const {
    data,
    isLoading: loading,
    error,
  } = useApiQuery<CourseDetail>(
    profile?.id && courseId
      ? `/api/trainee/courses/${courseId}?traineeId=${profile.id}`
      : null
  );
  const course = data?.course || null;
  const enablers = data?.enablers || [];
  const useCases = data?.useCases || [];

  // Helper to render status indicator
  const StatusIndicator = ({ status }: { status?: string | null }) => {
    if (status === 'APPROVED') {
      return (
        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          <span className="text-xs">{t('status.passed')}</span>
        </div>
      );
    }
    if (status === 'PENDING') {
      return (
        <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
          <Clock className="h-4 w-4" />
          <span className="text-xs">{t('status.underReview')}</span>
        </div>
      );
    }
    if (status === 'REJECTED') {
      return (
        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <XIcon className="h-4 w-4" />
          <span className="text-xs">{t('status.revise')}</span>
        </div>
      );
    }
    return null;
  };

  if (!profile) return <div className="p-6">{t('courses.loginPrompt')}</div>;
  if (loading) return <PageLoader />;
  if (error) return <div className="p-6 text-red-500">{error.message}</div>;
  if (!course) return <div className="p-6">{t('common.notFound')}</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="border-accent/30 bg-card/50 rounded-3xl border-5 p-6">
        <h1 className="text-foreground text-2xl font-bold">{course.title}</h1>
        <div className="text-muted-foreground mt-1 text-sm">
          {course.year
            ? t('courses.year').replace('{year}', String(course.year))
            : '—'}{' '}
          {course.chapter
            ? `• ${t('courses.chapter').replace('{chapter}', String(course.chapter))}`
            : ''}
        </div>
      </div>

      <div className="space-y-5">
        <div className="border-accent/30 bg-card/50 rounded-3xl border-5 p-5">
          <div className="mb-3 text-sm font-semibold">
            {t('courses.lessons')}
          </div>
          {enablers.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {t('courses.noActiveLessons')}
            </div>
          ) : (
            <ul className="space-y-2">
              {enablers.map(e => (
                <li key={e.id}>
                  <Link
                    prefetch={false}
                    href={`/trainee/enablers/${e.id}`}
                    className={`group flex items-center justify-between rounded-xl border-3 p-3 transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${
                      e.status === 'APPROVED'
                        ? 'border-green-500/40 bg-green-500/10 hover:border-green-500/60 hover:shadow-green-500/5'
                        : e.status === 'PENDING'
                          ? 'border-yellow-500/30 bg-yellow-500/5 hover:border-yellow-500/50 hover:shadow-yellow-500/5'
                          : e.status === 'REJECTED'
                            ? 'border-red-500/30 bg-red-500/5 hover:border-red-500/50 hover:shadow-red-500/5'
                            : 'border-accent/20 bg-card hover:border-accent/50 hover:shadow-accent/5'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <StatusIndicator status={e.status} />
                      <span className="group-hover:text-accent transition-colors duration-200">
                        {e.title}
                      </span>
                      {e.attemptNumber && !e.status ? (
                        <span className="border-accent/30 ml-2 shrink-0 rounded-full border px-2 py-0.5 text-xs">
                          {t('courses.attempt').replace(
                            '{number}',
                            String(e.attemptNumber)
                          )}
                        </span>
                      ) : null}
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-accent h-4 w-4 shrink-0 transition-all duration-200 group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-accent/30 bg-card/50 rounded-3xl border-5 p-5">
          <div className="mb-3 text-sm font-semibold">
            {t('courses.useCases')}
          </div>
          {useCases.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {t('courses.noActiveUseCases')}
            </div>
          ) : (
            <ul className="space-y-2">
              {useCases.map(u => (
                <li key={u.id}>
                  <Link
                    prefetch={false}
                    href={`/trainee/use-cases/${u.id}`}
                    className={`group flex items-center justify-between rounded-xl border p-3 transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${
                      u.status === 'APPROVED'
                        ? 'border-green-500/40 bg-green-500/10 hover:border-green-500/60 hover:shadow-green-500/5'
                        : u.status === 'PENDING'
                          ? 'border-yellow-500/30 bg-yellow-500/5 hover:border-yellow-500/50 hover:shadow-yellow-500/5'
                          : u.status === 'REJECTED'
                            ? 'border-red-500/30 bg-red-500/5 hover:border-red-500/50 hover:shadow-red-500/5'
                            : 'border-accent/20 bg-card hover:border-accent/50 hover:shadow-accent/5'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <StatusIndicator status={u.status} />
                      <span className="group-hover:text-accent transition-colors duration-200">
                        {u.title}
                      </span>
                      {u.attemptNumber && !u.status ? (
                        <span className="border-accent/30 ml-2 shrink-0 rounded-full border px-2 py-0.5 text-xs">
                          {t('courses.attempt').replace(
                            '{number}',
                            String(u.attemptNumber)
                          )}
                        </span>
                      ) : null}
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-accent h-4 w-4 shrink-0 transition-all duration-200 group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
