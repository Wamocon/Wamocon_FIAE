'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  GraduationCap,
  Layers,
  Lock,
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  EnablerStateBadge,
  type EnablerStateValue,
} from '@/components/trainee/EnablerStateBadge';

type DurationUnit = 'DAYS' | 'WEEKS' | null;

interface Lernfeld {
  id: string;
  title: string;
  description: string | null;
  label: string;
  hoursBudget: number | null;
  trainingYear: number | null;
}

interface UseCaseItem {
  id: string;
  title: string;
  descriptionText: string | null;
  durationValue: number | null;
  durationUnit: DurationUnit;
  accessible: boolean;
}

interface EnablerItem {
  id: string;
  code: string | null;
  title: string;
  courseTitle: string | null;
  durationValue: number | null;
  durationUnit: DurationUnit;
  accessible: boolean;
  /** Order of work (a trainee who is a member of the course): locked, open or completed */
  state?: EnablerStateValue | null;
  lockedBy?: { id: string; title: string } | null;
}

type Detail = {
  lernfeld: Lernfeld;
  useCases: UseCaseItem[];
  enablers: EnablerItem[];
};

const BACK_HREF = '/trainee/school?tab=lernfelder';

/**
 * Detail page of a learning field for the trainee: description, hours and the
 * use cases and enablers of the learning field. An item links to its page only
 * when the trainee is a member of its course (the answer says so), the other
 * items are listed without a link. The route only answers inside the catalog
 * of the trainee, a field of another occupation is "not found".
 */
export default function TraineeLernfeldDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const { t } = useLanguage();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    authFetch(`/api/trainee/lernfelder/${id}`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('not found');
        return res.json() as Promise<Detail>;
      })
      .then(body => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const duration = (value: number | null, unit: DurationUnit) =>
    value
      ? `${value} ${unit === 'WEEKS' ? t('lernfelder.detail.weeks') : t('lernfelder.detail.days')}`
      : null;

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (failed || !data?.lernfeld) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <div className="glass-effect border-accent/30 rounded-2xl border p-8 text-center">
          <Layers className="text-muted mx-auto mb-3 h-12 w-12" />
          <p role="alert" className="text-muted-foreground">
            {t('lernfelder.detail.notFound')}
          </p>
          <Link
            href={BACK_HREF}
            className="text-accent mt-4 inline-flex items-center gap-2 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('common.back')}
          </Link>
        </div>
      </div>
    );
  }

  const { lernfeld, useCases, enablers } = data;

  const card = 'glass-effect border-accent/20 rounded-2xl border p-5 shadow-md';

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <Link
        href={BACK_HREF}
        className="text-muted hover:text-foreground inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        {t('common.back')}
      </Link>

      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="bg-primary from-accent to-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
            <Layers
              className="text-primary-foreground h-7 w-7"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-bold">
              {lernfeld.label}
            </span>
            <h1 className="text-foreground mt-2 text-2xl font-bold break-words">
              {lernfeld.title}
            </h1>
            {lernfeld.description ? (
              <p className="text-muted mt-2 max-w-2xl text-sm whitespace-pre-line">
                {lernfeld.description}
              </p>
            ) : (
              <p className="text-muted/70 mt-2 text-sm italic">
                {t('lernfelder.noDescription')}
              </p>
            )}
            <dl className="text-muted mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              {lernfeld.trainingYear !== null && (
                <div className="flex gap-1.5">
                  <dt>{t('lernfelder.detail.year')}</dt>
                  <dd className="text-foreground font-semibold">
                    {lernfeld.trainingYear}
                  </dd>
                </div>
              )}
              <div className="flex gap-1.5">
                <dt>{t('lernfelder.detail.hours')}</dt>
                <dd className="text-foreground font-semibold">
                  {lernfeld.hoursBudget !== null
                    ? lernfeld.hoursBudget
                    : t('lernfelder.detail.noHours')}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <section aria-labelledby="lf-enablers" className="space-y-3">
        <h2
          id="lf-enablers"
          className="text-foreground flex items-center gap-2 px-1 text-lg font-semibold"
        >
          <GraduationCap className="text-accent h-5 w-5" aria-hidden="true" />
          {t('lernfelder.detail.enablers')}
        </h2>
        {enablers.length === 0 ? (
          <p className="text-muted px-1 text-sm">
            {t('lernfelder.detail.noEnablers')}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enablers.map(enabler => (
              <li key={enabler.id} className={card}>
                {enabler.accessible ? (
                  <Link
                    href={`/trainee/enablers/${enabler.id}`}
                    className="text-foreground hover:text-accent decoration-accent/40 hover:decoration-accent font-semibold break-words underline underline-offset-4"
                  >
                    {enabler.title}
                  </Link>
                ) : (
                  <span className="text-foreground font-semibold break-words">
                    {enabler.title}
                  </span>
                )}
                <p className="text-muted mt-1 text-xs">
                  {[enabler.code, enabler.courseTitle]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="text-muted mt-3 flex items-center gap-3 text-xs">
                  {duration(enabler.durationValue, enabler.durationUnit) && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {duration(enabler.durationValue, enabler.durationUnit)}
                    </span>
                  )}
                  {!enabler.accessible && (
                    <span className="flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('lernfelder.detail.notAssigned')}
                    </span>
                  )}
                </div>
                {enabler.accessible && enabler.state && (
                  <div className="mt-2">
                    <EnablerStateBadge
                      state={enabler.state}
                      reason={enabler.lockedBy ? 'SEQUENCE' : 'MANUAL'}
                      lockedByTitle={enabler.lockedBy?.title}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lf-usecases" className="space-y-3">
        <h2
          id="lf-usecases"
          className="text-foreground flex items-center gap-2 px-1 text-lg font-semibold"
        >
          <BookOpen className="text-accent h-5 w-5" aria-hidden="true" />
          {t('lernfelder.detail.useCases')}
        </h2>
        {useCases.length === 0 ? (
          <p className="text-muted px-1 text-sm">
            {t('lernfelder.detail.noUseCases')}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {useCases.map(useCase => (
              <li key={useCase.id} className={card}>
                {useCase.accessible ? (
                  <Link
                    href={`/trainee/use-cases/${useCase.id}`}
                    className="text-foreground hover:text-accent decoration-accent/40 hover:decoration-accent font-semibold break-words underline underline-offset-4"
                  >
                    {useCase.title}
                  </Link>
                ) : (
                  <span className="text-foreground font-semibold break-words">
                    {useCase.title}
                  </span>
                )}
                {useCase.descriptionText && (
                  <p className="text-muted mt-1 line-clamp-3 text-xs">
                    {useCase.descriptionText}
                  </p>
                )}
                <div className="text-muted mt-3 flex items-center gap-3 text-xs">
                  {duration(useCase.durationValue, useCase.durationUnit) && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {duration(useCase.durationValue, useCase.durationUnit)}
                    </span>
                  )}
                  {!useCase.accessible && (
                    <span className="flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('lernfelder.detail.notAssigned')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
