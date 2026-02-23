'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import toast from 'react-hot-toast';
import { Users, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

type TraineeItem = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  progress: number;
  coursesCount?: number;
  isActive?: boolean;
};

export default function TrainerTraineesPage() {
  const { profile, user, loading } = useAuth() as any;
  const { t } = useLanguage();
  const router = useRouter();
  const [trainees, setTrainees] = useState<TraineeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      if (!profile || !user) return;
      try {
        const params = new URLSearchParams();
        if (user.id) params.set('trainerAuthId', user.id);
        if (profile.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/trainees?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(t('trainee.management.loadError'));
        const data = await res.json();
        setTrainees(data.trainees || []);
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      }
    };
    if (profile?.role === 'trainer') load();
  }, [profile]);

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">
            {t('trainee.management.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">{t('quiz.userNotFound')}</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">{t('quiz.accessDenied')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Users className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('trainee.management.title')}
            </h1>
            <p className="text-muted">{t('trainee.management.description')}</p>
          </div>
        </div>
      </div>

      {/* Trainees Grid */}
      {error && <div className="text-red-500 text-sm">{error}</div>}
      {!error && trainees.length === 0 && (
        <div className="border-accent/30 rounded-3xl border p-12 text-center">
          <Users className="text-muted mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground text-lg font-semibold">{t('trainee.management.noTrainees')}</h3>
          <p className="text-muted mt-1 text-sm">{t('trainee.management.noTraineesDesc')}</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {trainees.map(trainee => (
          <div
            key={trainee.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-4">
                {trainee.avatar_url ? (
                  <Image
                    src={trainee.avatar_url}
                    alt={trainee.full_name}
                    width={64}
                    height={64}
                    className="border-accent/30 h-16 w-16 rounded-2xl border-2 object-cover shadow-lg"
                  />
                ) : (
                  <div className="border-accent/30 bg-muted text-muted flex h-16 w-16 items-center justify-center rounded-2xl border-2 shadow-lg">
                    <Users className="h-6 w-6" />
                  </div>
                )}
                <div>
                  <h3 className="text-foreground text-xl font-bold">
                    {trainee.full_name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                      {t('roles.trainee')}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${trainee.isActive ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}`}
                    >
                      {trainee.isActive
                        ? t('common.active')
                        : t('common.inactive')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">
                  {t('trainee.management.overallProgress')}
                </span>
                <span className="text-foreground font-medium">
                  {trainee.progress ?? 0}%
                </span>
              </div>
              <div className="bg-muted/30 h-3 w-full rounded-full">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                  style={{
                    width: `${Math.max(0, Math.min(100, trainee.progress ?? 0))}%`,
                  }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-2xl font-bold">
                  {trainee.progress}%
                </div>
                <div className="text-muted">{t('modules.progress')}</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-2xl font-bold">{trainee.coursesCount ?? 0}</div>
                <div className="text-muted">
                  {t('trainee.management.modules')}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/trainer/trainees/${trainee.id}`)}
                className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
              >
                <Eye className="mr-2 inline h-4 w-4" />
                {t('trainee.management.details')}
              </button>
              <button
                disabled={togglingIds.has(trainee.id)}
                onClick={async () => {
                  const previousState = trainee.isActive;
                  // Optimistic update
                  setTrainees(prev =>
                    prev.map(t =>
                      t.id === trainee.id ? { ...t, isActive: !t.isActive } : t
                    )
                  );
                  setTogglingIds(prev => new Set(prev).add(trainee.id));
                  try {
                    const res = await fetch(`/api/trainer/trainees/${trainee.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        trainer_id: profile?.id,
                        isActive: !previousState,
                      }),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    // Optimistic update already applied — don't re-fetch
                    // (server cache may still be stale for a moment)
                    toast.success(
                      !previousState
                        ? t('trainee.management.activated')
                        : t('trainee.management.deactivated')
                    );
                  } catch (e) {
                    console.error(e);
                    // Revert optimistic update
                    setTrainees(prev =>
                      prev.map(t =>
                        t.id === trainee.id ? { ...t, isActive: previousState } : t
                      )
                    );
                    toast.error(t('trainee.management.updateError'));
                  } finally {
                    setTogglingIds(prev => {
                      const next = new Set(prev);
                      next.delete(trainee.id);
                      return next;
                    });
                  }
                }}
                className={`ml-2 rounded-xl px-3 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${trainee.isActive ? 'border border-yellow-400 text-yellow-500' : 'text-foreground bg-green-600 hover:bg-green-700'}`}
              >
                {togglingIds.has(trainee.id) ? (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {trainee.isActive
                      ? t('trainee.management.deactivate')
                      : t('trainee.management.activate')}
                  </span>
                ) : trainee.isActive ? (
                  t('trainee.management.deactivate')
                ) : (
                  t('trainee.management.activate')
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
