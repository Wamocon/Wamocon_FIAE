'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

type CourseItem = { id: string; title: string; year: number | null; chapter: number | null; enablers: { id: string; title: string }[] };

export default function TraineeCoursesPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/courses?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('Kurse konnten nicht geladen werden');
        const data = await r.json();
        setCourses(data.courses || []);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id]);

  if (!profile) return <div className="p-6">Bitte anmelden…</div>;
  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">Meine Kurse</h1>
      {courses.length === 0 ? (
        <div className="text-muted">Keine Kurse zugewiesen.</div>
      ) : (
        <ul className="space-y-4">
          {courses.map((c) => (
            <li key={c.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    <Link className="text-primary underline" href={`/trainee/modules/${c.id}`}>{c.title}</Link>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {c.year ? `Jahr ${c.year}` : '—'} {c.chapter ? `• Kapitel ${c.chapter}` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-sm font-medium mb-2">Enabler</div>
                {c.enablers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine aktiven Enabler</div>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {c.enablers.map((e) => (
                      <li key={e.id} className="rounded border p-3 flex items-center justify-between">
                        <span className="truncate">{e.title}</span>
                        <Link className="text-primary underline" href={`/trainee/enablers/${e.id}`}>
                          Öffnen
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
