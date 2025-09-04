'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Play,
  CheckCircle,
  Lock,
  Clock,
  Award,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { mockData } from '@/lib/supabase';

interface ModuleDetailProps {
  moduleId: string;
}

export default function ModuleDetail({ moduleId }: ModuleDetailProps) {
  const router = useRouter();
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  // Use mock data from supabase
  const modules = mockData.curriculum;

  const handleChapterClick = (moduleId: string, chapterId: string) => {
    router.push(`/trainee/modules/${moduleId}/chapters/${chapterId}`);
  };

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModule(selectedModule === moduleId ? null : null);
  };

  const getModuleProgress = (module: any) => {
    return module.progress || 0;
  };

  const getCompletedLessons = (module: any) => {
    let completed = 0;
    module.chapters?.forEach((chapter: any) => {
      chapter.lessons?.forEach((lesson: any) => {
        if (lesson.completed) completed++;
      });
    });
    return completed;
  };

  const getTotalLessons = (module: any) => {
    let total = 0;
    module.chapters?.forEach((chapter: any) => {
      total += chapter.lessons?.length || 0;
    });
    return total;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="from-accent to-primary mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            Module Übersicht
          </h1>
          <p className="text-muted">
            Entdecke alle verfügbaren Lernmodule und wähle deinen nächsten
            Schritt
          </p>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {modules.map(module => {
          const progress = getModuleProgress(module);
          const completedLessons = getCompletedLessons(module);
          const totalLessons = getTotalLessons(module);
          const isExpanded = selectedModule === module.moduleId;

          return (
            <div
              key={module.moduleId}
              className="glass-effect border-accent/30 overflow-hidden rounded-3xl border shadow-lg"
            >
              {/* Module Header */}
              <div className="p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <BookOpen className="h-8 w-8 text-white" />
                  </div>
                  <button
                    onClick={() => handleModuleSelect(module.moduleId)}
                    className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200"
                  >
                    <ChevronRight
                      className={`h-5 w-5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>
                </div>

                <h3 className="text-foreground mb-2 text-xl font-bold">
                  {module.title}
                </h3>
                <div className="text-muted mb-4 flex items-center gap-4 text-sm">
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 font-medium">
                    Jahr {module.training_year}
                  </span>
                  <span>{module.chapters?.length || 0} Kapitel</span>
                </div>

                {/* Progress Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-sm">
                      Gesamtfortschritt
                    </span>
                    <span className="text-accent text-lg font-bold">
                      {progress}%
                    </span>
                  </div>

                  <div className="bg-muted/30 h-3 w-full overflow-hidden rounded-full">
                    <div
                      className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-muted">
                        {completedLessons} abgeschlossen
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="text-muted h-4 w-4" />
                      <span className="text-muted">
                        {totalLessons} Lektionen
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chapters Section */}
              {isExpanded && module.chapters && (
                <div className="border-accent/20 border-t px-6 pb-6">
                  <h4 className="text-foreground mt-4 mb-4 font-semibold">
                    Kapitel in diesem Modul
                  </h4>
                  <div className="space-y-3">
                    {module.chapters.map((chapter: any) => {
                      const chapterProgress =
                        chapter.lessons?.filter((l: any) => l.completed)
                          .length || 0;
                      const totalChapterLessons = chapter.lessons?.length || 0;
                      const chapterPercentage =
                        totalChapterLessons > 0
                          ? Math.round(
                              (chapterProgress / totalChapterLessons) * 100
                            )
                          : 0;

                      return (
                        <div
                          key={chapter.chapterId}
                          className="bg-background/50 border-accent/20 hover:border-accent/40 cursor-pointer rounded-xl border p-4 transition-colors"
                          onClick={() =>
                            handleChapterClick(
                              module.moduleId,
                              chapter.chapterId
                            )
                          }
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <h5 className="text-foreground font-medium">
                              {chapter.title}
                            </h5>
                            <div className="flex items-center gap-2">
                              {chapterPercentage === 100 ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Play className="text-accent h-4 w-4" />
                              )}
                            </div>
                          </div>

                          <div className="bg-muted/30 mb-2 h-2 w-full rounded-full">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                chapterPercentage === 100
                                  ? 'bg-green-500'
                                  : 'bg-accent'
                              }`}
                              style={{ width: `${chapterPercentage}%` }}
                            />
                          </div>

                          <p className="text-muted text-xs">
                            {chapterProgress} von {totalChapterLessons}{' '}
                            Lektionen abgeschlossen
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Learning Statistics */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-6 flex items-center text-2xl font-bold">
          <TrendingUp className="text-accent mr-3 h-6 w-6" />
          Lernstatistiken
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="bg-background/50 border-accent/20 rounded-2xl border p-6 text-center">
            <Award className="text-accent mx-auto mb-3 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              Abgeschlossene Module
            </h3>
            <p className="text-accent text-3xl font-bold">
              {modules.filter(m => m.progress === 100).length}
            </p>
          </div>
          <div className="bg-background/50 border-accent/20 rounded-2xl border p-6 text-center">
            <BookOpen className="text-primary mx-auto mb-3 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              Aktive Module
            </h3>
            <p className="text-primary text-3xl font-bold">
              {modules.filter(m => m.progress > 0 && m.progress < 100).length}
            </p>
          </div>
          <div className="bg-background/50 border-accent/20 rounded-2xl border p-6 text-center">
            <Clock className="text-muted mx-auto mb-3 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              Verbleibende
            </h3>
            <p className="text-muted text-3xl font-bold">
              {modules.filter(m => m.progress === 0).length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
