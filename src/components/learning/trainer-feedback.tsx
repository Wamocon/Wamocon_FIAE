'use client';

import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LessonWithSubLessons } from '@/db/queries';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface LessonProps {
  data: LessonWithSubLessons | null;
}

export default function Lesson({ data }: LessonProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  // Ensure hooks run before any conditional return
  useEffect(() => {
    const load = async () => {
      if (!data?.lesson.id || !profile?.id) return;
      try {
        const res = await fetch(
          `/api/trainee/lesson-progress?userId=${profile.id}&lessonId=${data.lesson.id}`
        );
        const j = await res.json();
        const set = new Set<string>(j.completedIds || []);
        setCompletedIds(set);
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, [data?.lesson.id, profile?.id]);

  if (!data) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lektion nicht gefunden...</p>
        </div>
      </div>
    );
  }

  const handleGoBack = () => router.back();

  const toggleCompletion = async (subLessonId: string, next: boolean) => {
    if (!profile?.id) return;
    setSaving(subLessonId);
    try {
      // optimistic update
      setCompletedIds(prev => {
        const copy = new Set(prev);
        if (next) copy.add(subLessonId);
        else copy.delete(subLessonId);
        return copy;
      });
      await fetch('/api/trainee/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.id,
          subLessonId,
          completed: next,
        }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handleGoBack}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              {data.lesson.title}
            </h1>
            <p className="text-muted mt-1">{data.subLessons.length} Aufgaben</p>
          </div>
        </div>
      </div>

      {/* Sub-lessons list */}
      <div className="space-y-4">
        {data.subLessons.map(s => (
          <div
            key={s.id}
            className="glass-effect border-accent/30 rounded-2xl border p-6 shadow-lg"
          >
            <div className="mb-2 flex items-center gap-3">
              <div className="from-accent to-primary flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                <BookOpen className="text-foregroundround h-5 w-5" />
              </div>
              <h3 className="text-foreground flex-1 text-lg font-semibold">
                {s.title}
              </h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-red-600"
                  checked={completedIds.has(s.id)}
                  onChange={e => toggleCompletion(s.id, e.target.checked)}
                  disabled={!!saving}
                />
                <span className="text-muted-foreground">Abgeschlossen</span>
              </label>
            </div>
            {s.content && (
              <p className="text-muted whitespace-pre-wrap">{s.content}</p>
            )}
            <div className="text-muted mt-2 text-xs">
              Dauer: {s.duration_minutes ?? 0} Minuten
            </div>
            <div className="mt-4 flex justify-end">
              <Link
                prefetch={false}
                href={`/trainee/lessons/${data.lesson.id}/${s.id}`}
                className="text-accent inline-flex items-center gap-1 text-sm hover:underline"
              >
                Öffnen
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Link
          href="/trainee/modules"
          className="text-muted hover:text-foreground rounded-xl px-4 py-2 transition-colors"
        >
          Zurück zu den Modulen
        </Link>
      </div>
    </div>
  );
}
