'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { BookOpen } from 'lucide-react';

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

  if (!profile) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-destructive/30 p-8 shadow-lg">
          <h1 className="text-foreground text-2xl font-bold">Bitte anmelden…</h1>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-accent/30 p-8 shadow-lg">
          <h1 className="text-foreground text-2xl font-bold">Lade…</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-destructive/30 p-8 shadow-lg">
          <h1 className="text-foreground text-2xl font-bold">{error}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-2 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-foreground mb-1 text-3xl font-bold">Meine Kurse</h1>
            <p className="text-muted">Zugewiesene Kurse und Lessons</p>
          </div>
        </div>
      </div>

      {/* Courses list */}
      <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
        {courses.length === 0 ? (
          <div className="text-muted-foreground">Keine Kurse zugewiesen.</div>
        ) : (
          <ul className="space-y-4">
            {courses.map((c) => (
              <li key={c.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-foreground truncate font-semibold">
                      <Link className="hover:text-accent transition-colors" href={`/trainee/modules/${c.id}`}>{c.title}</Link>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {c.year ? `Jahr ${c.year}` : '—'} {c.chapter ? `• Kapitel ${c.chapter}` : ''}
                    </div>
                  </div>
                  <Link className="shrink-0 rounded-xl border border-accent/30 px-3 py-1.5 text-sm hover:bg-background/60" href={`/trainee/modules/${c.id}`}>Öffnen</Link>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-sm font-medium">Lessons</div>
                  {c.enablers.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine aktiven Lessons</div>
                  ) : (
                    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {c.enablers.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-background/60 p-3">
                          <span className="text-foreground truncate">{e.title}</span>
                          <Link className="shrink-0 rounded-lg border border-accent/30 px-2 py-1 text-sm hover:bg-background/80" href={`/trainee/enablers/${e.id}`}>
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
    </div>
  );
}