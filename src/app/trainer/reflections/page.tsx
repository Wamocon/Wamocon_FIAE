'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Circle } from 'lucide-react';

type ReflectionItem = {
  id: string;
  traineeId: string;
  traineeName: string;
  strengths: string | null;
  weaknesses: string | null;
  mesMore: string | null;
  mesEqual: string | null;
  isReviewed: boolean;
  reviewedById: string | null;
  createdAt: string;
};

export default function TrainerReflectionsPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<ReflectionItem[]>([]);
  const [summary, setSummary] = useState<{ total: number; reviewed: number; unread: number }>({ total: 0, reviewed: 0, unread: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'reviewed'>('all');

  const filtered = useMemo(() => {
    switch (filter) {
      case 'unread':
        return items.filter(i => !i.isReviewed);
      case 'reviewed':
        return items.filter(i => i.isReviewed);
      default:
        return items;
    }
  }, [filter, items]);

  const load = async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainer/reflections?trainerProfileId=${profile.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Fehler beim Laden der Reflektionen');
      const data = await res.json();
      setItems(data.reflections || []);
      setSummary(data.summary || { total: 0, reviewed: 0, unread: 0 });
    } catch (e: any) {
      setError(e.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const toggleReviewed = async (id: string, current: boolean) => {
    try {
      await fetch(`/api/trainer/reflections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_reviewed: !current, reviewer_id: profile?.id }),
      });
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-background min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-foreground text-2xl font-bold">Reflektionen meiner Auszubildenden</h1>
              <div className="text-muted text-sm">Insgesamt: {summary.total} · Gelesen: {summary.reviewed} · Offen: {summary.unread}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setFilter('all')} className={`rounded-xl px-4 py-2 text-sm ${filter === 'all' ? 'bg-accent text-foreground' : 'border border-accent/30 text-foreground'}`}>Alle</button>
              <button onClick={() => setFilter('unread')} className={`rounded-xl px-4 py-2 text-sm ${filter === 'unread' ? 'bg-accent text-foreground' : 'border border-accent/30 text-foreground'}`}>Offen ({summary.unread})</button>
              <button onClick={() => setFilter('reviewed')} className={`rounded-xl px-4 py-2 text-sm ${filter === 'reviewed' ? 'bg-accent text-foreground' : 'border border-accent/30 text-foreground'}`}>Gelesen ({summary.reviewed})</button>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
          {loading ? (
            <div className="text-center text-muted">Lade…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 text-red-300">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted">Keine Reflektionen vorhanden.</div>
          ) : (
            <ul className="space-y-4">
              {filtered.map((r) => (
                <li key={r.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground font-semibold">{r.traineeName}</div>
                      <div className="text-muted text-xs">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => toggleReviewed(r.id, r.isReviewed)}
                      className={`rounded-xl px-3 py-2 text-sm ${r.isReviewed ? 'border border-green-600/40 text-green-300 hover:bg-green-900/20' : 'border border-accent/30 text-foreground hover:bg-background/50'}`}
                    >
                      {r.isReviewed ? (
                        <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Gelesen</span>
                      ) : (
                        <span className="inline-flex items-center gap-2"><Circle className="h-4 w-4" /> Als gelesen markieren</span>
                      )}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-muted mb-1 text-xs">Stärken</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.strengths || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Schwächen</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.weaknesses || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Mehr davon</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.mesMore || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Gleich lassen</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.mesEqual || '-'}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
