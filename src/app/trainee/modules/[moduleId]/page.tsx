'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function TraineeModuleDetailPage() {
  const params = useParams<{ moduleId: string }>();
  const courseId = params?.moduleId as string;
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [course, setCourse] = useState<{ id: string; title: string; year: number | null; chapter: number | null } | null>(null);
  const [enablers, setEnablers] = useState<Array<{ id: string; title: string }>>([]);
  const [useCases, setUseCases] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id || !courseId) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/courses/${courseId}?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('Kurs konnte nicht geladen werden');
        const data = await r.json();
        setCourse(data.course);
        setEnablers(data.enablers || []);
        setUseCases(data.useCases || []);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, courseId]);

  if (!profile) return <div className="p-6">Bitte anmelden…</div>;
  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!course) return <div className="p-6">Nicht gefunden</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-6">
        <h1 className="text-foreground text-2xl font-bold">{course.title}</h1>
        <div className="text-muted-foreground mt-1 text-sm">
          {course.year ? `Jahr ${course.year}` : '—'} {course.chapter ? `• Kapitel ${course.chapter}` : ''}
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-3xl border border-accent/30 bg-black/30 p-5">
          <div className="mb-3 text-sm font-semibold">Enabler</div>
          {enablers.length === 0 ? (
            <div className="text-sm text-muted-foreground">Keine aktiven Enabler</div>
          ) : (
            <ul className="space-y-2">
              {enablers.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-xl border border-accent/20 bg-black/20 p-3">
                  <span className="truncate">{e.title}</span>
                  <Link href={`/trainee/enablers/${e.id}`} className="rounded-lg border border-accent/30 px-2 py-1 text-sm hover:bg-background/60">Öffnen</Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border border-accent/30 bg-black/30 p-5">
          <div className="mb-3 text-sm font-semibold">Use Cases</div>
          {useCases.length === 0 ? (
            <div className="text-sm text-muted-foreground">Keine aktiven Use Cases</div>
          ) : (
            <ul className="space-y-2">
              {useCases.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded-xl border border-accent/20 bg-black/20 p-3">
                  <span className="truncate">{u.title}</span>
                  <Link href={`/trainee/use-cases/${u.id}`} className="rounded-lg border border-accent/30 px-2 py-1 text-sm hover:bg-background/60">Öffnen</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
