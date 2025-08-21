'use client';

import { useAuth } from '@/contexts/AuthContext';
import { mockData } from '@/lib/supabase';
import { Play, Clock, BookOpen, CheckCircle, Target } from 'lucide-react';

export default function TraineeLessonsPage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Lade Lektionen...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  // Get all lessons from curriculum
  const allLessons = mockData.curriculum.flatMap(module =>
    (module.chapters || []).flatMap(chapter =>
      (chapter.lessons || []).map(lesson => ({
        ...lesson,
        moduleTitle: module.title,
        moduleId: module.moduleId,
        chapterTitle: chapter.title,
      }))
    )
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex items-center gap-6 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center">
            <Play className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Alle Lektionen
            </h1>
            <p className="text-muted">
              Übersicht über alle verfügbaren Lektionen in Ihren Modulen
            </p>
          </div>
        </div>
      </div>

      {/* Lessons Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allLessons.map(lesson => (
          <div
            key={lesson.id}
            className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30 hover:shadow-xl transition-all duration-300"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                  <Play className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-foreground">
                    {lesson.title}
                  </h3>
                  <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-sm font-medium">
                    {lesson.moduleTitle}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2">
              {lesson.ref || 'Keine Beschreibung verfügbar'}
            </p>

            {/* Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted">Status</span>
                <span className="font-medium text-foreground">
                  {lesson.completed ? 'Abgeschlossen' : 'Nicht begonnen'}
                </span>
              </div>
              <div className="w-full bg-muted/30 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-500"
                  style={{ width: lesson.completed ? '100%' : '0%' }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div className="text-center p-3 bg-background/50 rounded-xl">
                <div className="text-lg font-bold text-accent">45 min</div>
                <div className="text-muted">Dauer</div>
              </div>
              <div className="text-center p-3 bg-background/50 rounded-xl">
                <div className="text-lg font-bold text-primary">
                  {lesson.type}
                </div>
                <div className="text-muted">Typ</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-xl hover:bg-accent/90 transition-colors text-sm font-medium">
                <Play className="w-4 h-4 mr-2 inline" />
                {lesson.completed ? 'Wiederholen' : 'Starten'}
              </button>
              <button className="px-4 py-2 bg-muted/30 text-muted hover:text-foreground rounded-xl hover:bg-muted/50 transition-colors">
                <CheckCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
