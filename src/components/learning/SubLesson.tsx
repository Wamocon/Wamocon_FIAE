"use client";

import { ArrowLeft, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SubLessonDetail } from '@/db/queries';
import { useAuth } from '@/contexts/AuthContext';

export default function SubLesson({ data }: { data: SubLessonDetail | null }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);

  // Ensure hooks run before any conditional returns
  useEffect(() => {
    const load = async () => {
      if (!profile?.id || !data?.lesson.id || !data?.id) return;
      try {
        const res = await fetch(`/api/trainee/lesson-progress?userId=${profile.id}&lessonId=${data.lesson.id}`);
        const j = await res.json();
        const set: string[] = j.completedIds || [];
        setCompleted(set.includes(data.id));
      } catch {
        // no-op
      }
    };
    load();
  }, [profile?.id, data?.lesson.id, data?.id]);

  if (!data) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Aufgabe nicht gefunden...</p>
        </div>
      </div>
    );
  }

  

  const toggle = async (next: boolean) => {
    if (!profile?.id) return;
    setSaving(true);
    try {
      setCompleted(next);
      await fetch('/api/trainee/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, subLessonId: data.id, completed: next }),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleGoBack = () => router.back();

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
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
            <h1 className="text-foreground text-2xl font-bold">{data.title}</h1>
            <p className="text-muted mt-1">Lektion: {data.lesson.title}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-red-600"
              checked={completed}
              onChange={e => toggle(e.target.checked)}
              disabled={saving}
            />
            <span className="text-muted-foreground">Abgeschlossen</span>
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="glass-effect border-accent/30 rounded-2xl border p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <div className="from-accent to-primary flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <h3 className="text-foreground text-lg font-semibold">Aufgabe</h3>
        </div>
        {data.content ? (
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-muted">{data.content}</div>
        ) : (
          <div className="text-muted-foreground">Kein Inhalt verfügbar.</div>
        )}
        <div className="text-muted mt-4 text-xs">Dauer: {data.duration_minutes ?? 0} Minuten</div>
      </div>

      <div className="flex justify-end">
        <Link href={`/trainee/lessons/${data.lesson.id}`} className="text-muted hover:text-foreground rounded-xl px-4 py-2 transition-colors">
          Zurück zur Lektion
        </Link>
      </div>
    </div>
  );
}
