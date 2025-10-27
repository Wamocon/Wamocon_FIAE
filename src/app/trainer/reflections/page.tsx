'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

type ReflectionItem = {
  id: string;
  user_id: string;
  due_date: string | null;
  submitted_at: string | null;
  mes_status: string | null;
  trainee_name: string;
};

export default function TrainerReflectionsPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ReflectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (!user?.id && !profile?.id) return;
        const params = new URLSearchParams();
        if (user?.id) params.set('trainerAuthId', user.id);
        if (profile?.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/reflections?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load reflections');
        const data = await res.json();
        setItems(data.reflections || []);
      } catch (e: any) {
        setError(e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id, profile?.id]);

  if (loading) return <div className="p-6">Lade Reflektionen…</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reflektionen meiner Auszubildenden</h1>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">Keine Reflektionen gefunden.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-background/50">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-background/70 text-left text-muted-foreground">
                <th className="p-3">Auszubildende/r</th>
                <th className="p-3">Fällig am</th>
                <th className="p-3">Eingereicht am</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-background/70">
                  <td className="p-3 font-medium">{r.trainee_name}</td>
                  <td className="p-3">{r.due_date || '—'}</td>
                  <td className="p-3">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}</td>
                  <td className="p-3">{r.mes_status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
