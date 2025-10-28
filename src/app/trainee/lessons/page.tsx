'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Play, Clock, BookOpen, CheckCircle, Target } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function TraineeLessonsPage() {
  const { profile, loading } = useAuth();
  const [lessonsList, setLessonsList] = useState<any[]>([]);
  const [fetching, setFetching] = useState(false);

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Lektionen...</p>
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

  if (profile.role !== 'trainee') {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      setFetching(true);
      try {
        const res = await fetch(`/api/trainee/lessons?userId=${profile.id}`);
        const data = await res.json();
        setLessonsList(data || []);
      } catch (e) {
        console.error(e);
        setLessonsList([]);
      } finally {
        setFetching(false);
      }
    };
    load();
  }, [profile?.id]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Play className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Alle Lektionen
            </h1>
            <p className="text-muted">
              Übersicht über alle verfügbaren Lektionen in Ihren Modulen
            </p>
          </div>
        </div>
      </div>

      {/* Lessons Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {lessonsList.map(lesson => (
          <div
            key={lesson.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl h-[420px] flex flex-col overflow-hidden"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <Play className="h-6 w-6 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-foreground text-xl font-bold line-clamp-2 break-words">
                    {lesson.title}
                  </h3>
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium inline-block max-w-[220px] truncate">
                    {lesson.moduleTitle}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2 break-words">
      {'Keine Beschreibung verfügbar'}
            </p>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Status</span>
                <span className="text-foreground font-medium">
                  {lesson.completed ? 'Abgeschlossen' : 'Nicht begonnen'}
                </span>
              </div>
              <div className="bg-muted/30 h-3 w-full rounded-full">
                <div
                  className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
                  style={{ width: lesson.completed ? '100%' : '0%' }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">45 min</div>
                <div className="text-muted">Dauer</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-lg font-bold">
                  Lesson
                </div>
                <div className="text-muted">Type</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-auto pt-2">
              <a href={`/trainee/lessons/${lesson.id}`} className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors">
                <Play className="mr-2 inline h-4 w-4" />
                {lesson.completed ? 'Wiederholen' : 'Starten'}
              </a>
              <button className="bg-muted/30 text-muted hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors">
                <CheckCircle className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
