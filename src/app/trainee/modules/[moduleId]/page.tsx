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
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{course.title}</h1>
        <div className="text-sm text-muted-foreground">
          {course.year ? `Jahr ${course.year}` : '—'} {course.chapter ? `• Kapitel ${course.chapter}` : ''}
        </div>
      </div>

      <div className="rounded-md border p-4">
        <div className="font-semibold mb-2">Enabler</div>
        {enablers.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine aktiven Enabler</div>
        ) : (
          <ul className="space-y-2">
            {enablers.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded border p-3">
                <span className="truncate">{e.title}</span>
                <Link href={`/trainee/enablers/${e.id}`} className="text-primary underline">Öffnen</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border p-4">
        <div className="font-semibold mb-2">Use Cases</div>
        {useCases.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine aktiven Use Cases</div>
        ) : (
          <ul className="space-y-2">
            {useCases.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded border p-3">
                <span className="truncate">{u.title}</span>
                <Link href={`/trainee/use-cases/${u.id}`} className="text-primary underline">Öffnen</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
