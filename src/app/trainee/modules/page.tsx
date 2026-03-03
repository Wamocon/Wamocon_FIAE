'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { ChevronRight } from 'lucide-react';
import { PageLoader } from '@/components/ui/PageLoader';

type CourseItem = {
  id: string;
  title: string;
  year: number | null;
  chapter: number | null;
};

export default function TraineeModulesPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();

  const {
    data,
    isLoading: loading,
    error,
  } = useApiQuery<{ courses: CourseItem[] }>(
    profile?.id ? `/api/trainee/courses?traineeId=${profile.id}` : null
  );
  const courses = data?.courses || [];

  if (!profile) return <div className="p-6">{t('courses.loginPrompt')}</div>;
  if (loading) return <PageLoader />;
  if (error) return <div className="p-6 text-red-500">{error.message}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">
        {t('modules.title')}
      </h1>
      {courses.length === 0 ? (
        <div className="text-muted-foreground">{t('courses.none')}</div>
      ) : (
        <ul className="space-y-3">
          {courses.map(c => (
            <li key={c.id}>
              <Link
                prefetch={false}
                href={`/trainee/modules/${c.id}`}
                className="group border-accent/30 hover:border-accent/50 hover:shadow-accent/5 flex items-center justify-between rounded-3xl border bg-black/30 p-5 transition-all duration-200 hover:scale-[1.01] hover:shadow-lg"
              >
                <div>
                  <div className="group-hover:text-accent font-semibold transition-colors duration-200">
                    {c.title}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {c.year
                      ? t('courses.year').replace('{year}', String(c.year))
                      : '—'}{' '}
                    {c.chapter
                      ? `• ${t('courses.chapter').replace('{chapter}', String(c.chapter))}`
                      : ''}
                  </div>
                </div>
                <ChevronRight className="text-muted-foreground group-hover:text-accent h-5 w-5 shrink-0 transition-all duration-200 group-hover:translate-x-1" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
