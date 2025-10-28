'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Users, Eye, MessageSquare, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type TraineeItem = { id: string; full_name: string; avatar_url?: string | null; progress: number };

export default function TrainerTraineesPage() {
  const { profile, user, loading } = useAuth() as any;
  const router = useRouter();
  const [trainees, setTrainees] = useState<TraineeItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile || !user) return;
      try {
        const params = new URLSearchParams();
        if (user.id) params.set('trainerAuthId', user.id);
        if (profile.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/trainees?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Auszubildende nicht laden');
        const data = await res.json();
        setTrainees(data.trainees || []);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      }
    };
    if (profile?.role === 'trainer') load();
  }, [profile]);

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Auszubildende...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
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
            <Users className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Auszubildende
            </h1>
            <p className="text-muted">
              Verwalten Sie Ihre Auszubildenden und verfolgen Sie deren
              Fortschritt
            </p>
          </div>
        </div>
      </div>

      {/* Trainees Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {trainees.map(trainee => (
          <div
            key={trainee.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-4">
                {trainee.avatar_url ? (
                  <img
                    src={trainee.avatar_url}
                    alt={trainee.full_name}
                    className="border-accent/30 h-16 w-16 rounded-2xl border-2 shadow-lg object-cover"
                  />
                ) : (
                  <div className="border-accent/30 flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-muted text-muted shadow-lg">
                    <Users className="h-6 w-6" />
                  </div>
                )}
                <div>
                  <h3 className="text-foreground text-xl font-bold">
                    {trainee.full_name}
                  </h3>
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                    Auszubildender
                  </span>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Gesamtfortschritt</span>
                <span className="text-foreground font-medium">{trainee.progress ?? 0}%</span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted/30">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, trainee.progress ?? 0))}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-2xl font-bold">{trainee.progress}%</div>
                <div className="text-muted">Fortschritt</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-2xl font-bold">12</div>
                <div className="text-muted">Module</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/trainer/trainees/${trainee.id}`)}
                className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
              >
                <Eye className="mr-2 inline h-4 w-4" />
                Details
              </button>
              <button className="bg-muted/30 text-muted hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors">
                <MessageSquare className="h-4 w-4" />
              </button>
              <button className="bg-muted/30 text-muted hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors">
                <TrendingUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
