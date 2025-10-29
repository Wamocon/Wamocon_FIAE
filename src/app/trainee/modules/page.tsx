'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

type CourseItem = { id: string; title: string; year: number | null; chapter: number | null };

export default function TraineeModulesPage() {
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
        const list: CourseItem[] = (data.courses || []).map((c: any) => ({ id: c.id, title: c.title, year: c.year, chapter: c.chapter }));
        setCourses(list);
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
      <h1 className="text-2xl font-bold">Meine Module</h1>
      {courses.length === 0 ? (
        <div className="text-muted">Keine Kurse zugewiesen.</div>
      ) : (
        <ul className="space-y-3">
          {courses.map((c) => (
            <li key={c.id} className="rounded-md border p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{c.title}</div>
                <div className="text-sm text-muted-foreground">
                  {c.year ? `Jahr ${c.year}` : '—'} {c.chapter ? `• Kapitel ${c.chapter}` : ''}
                </div>
              </div>
              <Link className="text-primary underline" href={`/trainee/modules/${c.id}`}>Öffnen</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
