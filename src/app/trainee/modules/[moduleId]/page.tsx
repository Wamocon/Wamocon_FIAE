'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Check, Clock, X as XIcon } from 'lucide-react';

export default function TraineeModuleDetailPage() {
  const params = useParams<{ moduleId: string }>();
  const courseId = params?.moduleId as string;
  const { profile } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [course, setCourse] = useState<{ id: string; title: string; year: number | null; chapter: number | null } | null>(null);
  const [enablers, setEnablers] = useState<Array<{ id: string; title: string; attemptNumber?: number | null; status?: string | null }>>([]);
  const [useCases, setUseCases] = useState<Array<{ id: string; title: string; attemptNumber?: number | null; status?: string | null }>>([]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id || !courseId) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/courses/${courseId}?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(t('courses.loadError'));
        const data = await r.json();
        setCourse(data.course);
        setEnablers(data.enablers || []);
        setUseCases(data.useCases || []);
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, courseId]);

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
  if (loading) return <div className="p-6">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!course) return <div className="p-6">{t('common.notFound')}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="rounded-3xl border-5 border-accent/30 bg-card/50 p-6">
        <h1 className="text-foreground text-2xl font-bold">{course.title}</h1>
        <div className="text-muted-foreground mt-1 text-sm">
          {course.year ? t('courses.year').replace('{year}', String(course.year)) : '—'} {course.chapter ? `• ${t('courses.chapter').replace('{chapter}', String(course.chapter))}` : ''}
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-3xl border-5 border-accent/30 bg-card/50 p-5">
          <div className="mb-3 text-sm font-semibold">{t('courses.lessons')}</div>
          {enablers.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('courses.noActiveLessons')}</div>
          ) : (
            <ul className="space-y-2">
              {enablers.map((e) => (
                <li key={e.id} className={`flex items-center justify-between rounded-xl border-3 p-3 ${e.status === 'APPROVED' ? 'border-green-500/40 bg-green-500/10' :
                  e.status === 'PENDING' ? 'border-yellow-500/30 bg-yellow-500/5' :
                    e.status === 'REJECTED' ? 'border-red-500/30 bg-red-500/5' :
                      'border-accent/20 bg-card'
                  }`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <StatusIndicator status={e.status} />
                    <span className="truncate">{e.title}</span>
                    {e.attemptNumber && !e.status ? (
                      <span className="ml-2 rounded-full border border-accent/30 px-2 py-0.5 text-xs shrink-0">
                        {t('courses.attempt').replace('{number}', String(e.attemptNumber))}
                      </span>
                    ) : null}
                  </div>
                  <Link href={`/trainee/enablers/${e.id}`} className="rounded-lg border-3 border-accent/30 px-2 py-1 text-sm hover:bg-background/60 shrink-0 ml-2">
                    {t('common.open')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border-5 border-accent/30 bg-card/50 p-5">
          <div className="mb-3 text-sm font-semibold">{t('courses.useCases')}</div>
          {useCases.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('courses.noActiveUseCases')}</div>
          ) : (
            <ul className="space-y-2">
              {useCases.map((u) => (
                <li key={u.id} className={`flex items-center justify-between rounded-xl border p-3 ${u.status === 'APPROVED' ? 'border-green-500/40 bg-green-500/10' :
                  u.status === 'PENDING' ? 'border-yellow-500/30 bg-yellow-500/5' :
                    u.status === 'REJECTED' ? 'border-red-500/30 bg-red-500/5' :
                      'border-accent/20 bg-card'
                  }`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <StatusIndicator status={u.status} />
                    <span className="truncate">{u.title}</span>
                    {u.attemptNumber && !u.status ? (
                      <span className="ml-2 rounded-full border border-accent/30 px-2 py-0.5 text-xs shrink-0">
                        {t('courses.attempt').replace('{number}', String(u.attemptNumber))}
                      </span>
                    ) : null}
                  </div>
                  <Link href={`/trainee/use-cases/${u.id}`} className="rounded-lg border-3 border-accent/30 px-2 py-1 text-sm hover:bg-background/60 shrink-0 ml-2">
                    {t('common.open')}
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

