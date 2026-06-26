'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import { Users, Eye, UserCheck, UserX, Clock, CheckCircle2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAusbildungDurationLabel } from '@/lib/ausbildung/duration';

type TraineeItem = {
  id: string;
  full_name: string;
  email?: string;
  avatar_url?: string | null;
  ausbildungDurationYears?: number | null;
  ausbildung_duration_years?: number | null;
  progress: number;
  coursesCount?: number;
  isActive?: boolean;
  trainerActivated?: boolean;
};

const TRAINER_LEVEL_ROLES = ['admin', 'temp_admin', 'trainer'];

const getDurationYears = (trainee: TraineeItem) =>
  trainee.ausbildungDurationYears ?? trainee.ausbildung_duration_years ?? 3;

const getDurationLabel = (trainee: TraineeItem) =>
  getAusbildungDurationLabel(getDurationYears(trainee));

export default function TrainerTraineesPage() {
  const { profile, user, loading } = useAuth() as any;
  const { t } = useLanguage();
  const router = useRouter();
  const [trainees, setTrainees] = useState<TraineeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'deactivated'>('all');

  const loadTrainees = useCallback(async () => {
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
  }, [profile, user, t]);

  useEffect(() => {
    if (profile && TRAINER_LEVEL_ROLES.includes(profile.role)) loadTrainees();
  }, [profile, loadTrainees]);

  const toggleActivation = useCallback(
    async (trainee: TraineeItem) => {
      const previous = trainee.trainerActivated;
      setTrainees(prev =>
        prev.map(t =>
          t.id === trainee.id ? { ...t, trainerActivated: !t.trainerActivated } : t
        )
      );
      setTogglingIds(prev => new Set(prev).add(trainee.id));
      try {
        const res = await fetch(`/api/trainer/trainees/${trainee.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainer_id: profile?.id,
            trainer_activated: !previous,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success(
          !previous
            ? t('trainee.management.activated')
            : t('trainee.management.deactivated')
        );
      } catch (e) {
        console.error(e);
        setTrainees(prev =>
          prev.map(t =>
            t.id === trainee.id ? { ...t, trainerActivated: previous } : t
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
    },
    [profile, t]
  );

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.userNotFound')}</p>
        </div>
      </div>
    );
  }

  if (!TRAINER_LEVEL_ROLES.includes(profile.role)) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.accessDenied')}</p>
        </div>
      </div>
    );
  }

  const pendingTrainees = trainees.filter(t => !t.trainerActivated);
  const activeTrainees = trainees.filter(t => t.trainerActivated);
  const deactivatedByAdmin = trainees.filter(t => !t.isActive);

  const filteredTrainees =
    filter === 'pending'
      ? pendingTrainees
      : filter === 'active'
        ? activeTrainees
        : filter === 'deactivated'
          ? deactivatedByAdmin
          : trainees;

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

        {/* Stats summary */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="bg-background/50 rounded-2xl p-4 text-center">
            <div className="text-foreground text-2xl font-bold">{trainees.length}</div>
            <div className="text-muted text-sm">{t('common.total')}</div>
          </div>
          <div className="bg-background/50 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-500">{pendingTrainees.length}</div>
            <div className="text-muted text-sm">{t('trainee.management.pendingActivation')}</div>
          </div>
          <div className="bg-background/50 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-green-500">{activeTrainees.length}</div>
            <div className="text-muted text-sm">{t('common.active')}</div>
          </div>
          <div className="bg-background/50 rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-red-500">{deactivatedByAdmin.length}</div>
            <div className="text-muted text-sm">{t('common.inactive')}</div>
          </div>
        </div>
      </div>

      {/* Pending Activation Banner */}
      {pendingTrainees.length > 0 && filter !== 'pending' && (
        <div className="border-amber-500/30 bg-amber-500/5 flex items-center gap-4 rounded-2xl border p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20">
            <Clock className="h-6 w-6 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-foreground font-semibold">
              {pendingTrainees.length}{' '}
              {pendingTrainees.length === 1
                ? t('trainee.management.pendingTrainee')
                : t('trainee.management.pendingTrainees')}
            </h3>
            <p className="text-muted text-sm">
              {t('trainee.management.pendingDescription')}
            </p>
          </div>
          <button
            onClick={() => setFilter('pending')}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
          >
            {t('trainee.management.showPending')}
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'pending', 'active', 'deactivated'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              filter === f
                ? 'bg-accent text-accent-foreground shadow-md'
                : 'text-muted hover:text-foreground hover:bg-accent/10'
            }`}
          >
            {f === 'all' && t('common.all')}
            {f === 'pending' && t('trainee.management.pendingActivation')}
            {f === 'active' && t('common.active')}
            {f === 'deactivated' && t('common.inactive')}
            {f === 'pending' && pendingTrainees.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
                {pendingTrainees.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Trainees Grid */}
      {error && <div className="text-sm text-red-500">{error}</div>}
      {!error && filteredTrainees.length === 0 && (
        <div className="border-accent/30 rounded-3xl border p-12 text-center">
          <Users className="text-muted mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground text-lg font-semibold">
            {filter === 'pending'
              ? t('trainee.management.noPending')
              : t('trainee.management.noTrainees')}
          </h3>
          <p className="text-muted mt-1 text-sm">
            {filter === 'pending'
              ? t('trainee.management.noPendingDesc')
              : t('trainee.management.noTraineesDesc')}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredTrainees.map(trainee => (
          <div
            key={trainee.id}
            className={`glass-effect flex min-h-[330px] flex-col rounded-3xl border p-6 shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${
              !trainee.trainerActivated
                ? 'border-amber-500/40 ring-1 ring-amber-500/20'
                : 'border-accent/30 hover:border-accent/50 hover:shadow-accent/5'
            }`}
          >
            <div className="mb-4 grid min-h-[88px] grid-cols-[72px_1fr] gap-4">
              <div className="flex justify-center">
                <Avatar className="border-accent/30 h-16 w-16 rounded-2xl border-2 shadow-lg">
                  {trainee.avatar_url ? (
                    <AvatarImage
                      src={trainee.avatar_url}
                      alt={trainee.full_name}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="text-muted rounded-2xl">
                    <Users className="h-6 w-6" />
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="min-w-0">
                <h3 className="text-foreground truncate text-xl font-bold leading-7">
                  {trainee.full_name}
                </h3>
                {trainee.email && (
                  <p className="text-muted max-w-full truncate text-sm leading-5">
                    {trainee.email}
                  </p>
                )}
                <div className="mt-2 flex min-h-7 flex-nowrap items-center gap-2 overflow-hidden">
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-0.5 text-xs font-medium">
                    {t('roles.trainee')}
                  </span>
                  <span
                    className="min-w-0 truncate rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-500"
                    title={getDurationLabel(trainee)}
                  >
                    {getDurationLabel(trainee)}
                  </span>
                  {!trainee.trainerActivated ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                      <Clock className="h-3 w-3" />
                      {t('trainee.management.pendingActivation')}
                    </span>
                  ) : trainee.isActive ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-green-500/50 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
                      <CheckCircle2 className="h-3 w-3" />
                      {t('common.active')}
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">
                      {t('common.inactive')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-4 mt-1">
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
                <div className="text-primary text-2xl font-bold">
                  {trainee.coursesCount ?? 0}
                </div>
                <div className="text-muted">
                  {t('trainee.management.modules')}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-auto flex items-center gap-2">
              <button
                onClick={() => router.push(`/trainer/trainees/${trainee.id}`)}
                className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
              >
                <Eye className="mr-2 inline h-4 w-4" />
                {t('trainee.management.details')}
              </button>
              <button
                disabled={togglingIds.has(trainee.id)}
                onClick={() => toggleActivation(trainee)}
                className={`ml-auto flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  trainee.trainerActivated
                    ? 'border border-red-400/50 text-red-500 hover:bg-red-500/10'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {togglingIds.has(trainee.id) ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : trainee.trainerActivated ? (
                  <UserX className="h-4 w-4" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
                {trainee.trainerActivated
                  ? t('trainee.management.deactivate')
                  : t('trainee.management.activate')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
