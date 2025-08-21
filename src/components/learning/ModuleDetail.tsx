'use client';

import { useState } from 'react';
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
  onNavigation: (view: string, data?: any) => void;
}

export function ModuleDetail({ onNavigation }: ModuleDetailProps) {
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  // Use mock data from supabase
  const modules = mockData.curriculum;

  const handleChapterClick = (moduleId: string, chapterId: string) => {
    onNavigation('chapterDetail', { moduleId, chapterId });
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
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Module Übersicht
          </h1>
          <p className="text-muted">
            Entdecke alle verfügbaren Lernmodule und wähle deinen nächsten
            Schritt
          </p>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {modules.map(module => {
          const progress = getModuleProgress(module);
          const completedLessons = getCompletedLessons(module);
          const totalLessons = getTotalLessons(module);
          const isExpanded = selectedModule === module.moduleId;

          return (
            <div
              key={module.moduleId}
              className="glass-effect rounded-3xl shadow-lg border border-accent/30 overflow-hidden"
            >
              {/* Module Header */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-white" />
                  </div>
                  <button
                    onClick={() => handleModuleSelect(module.moduleId)}
                    className="p-2 text-muted hover:text-foreground hover:bg-accent/20 rounded-xl transition-all duration-200"
                  >
                    <ChevronRight
                      className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>
                </div>

                <h3 className="font-bold text-xl text-foreground mb-2">
                  {module.title}
                </h3>
                <div className="flex items-center gap-4 text-sm text-muted mb-4">
                  <span className="px-3 py-1 bg-accent/20 text-accent rounded-full font-medium">
                    Jahr {module.training_year}
                  </span>
                  <span>{module.chapters?.length || 0} Kapitel</span>
                </div>

                {/* Progress Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">
                      Gesamtfortschritt
                    </span>
                    <span className="text-lg font-bold text-accent">
                      {progress}%
                    </span>
                  </div>

                  <div className="w-full bg-muted/30 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-muted">
                        {completedLessons} abgeschlossen
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted" />
                      <span className="text-muted">
                        {totalLessons} Lektionen
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chapters Section */}
              {isExpanded && module.chapters && (
                <div className="px-6 pb-6 border-t border-accent/20">
                  <h4 className="font-semibold text-foreground mb-4 mt-4">
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
                          className="p-4 bg-background/50 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors cursor-pointer"
                          onClick={() =>
                            handleChapterClick(
                              module.moduleId,
                              chapter.chapterId
                            )
                          }
                        >
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="font-medium text-foreground">
                              {chapter.title}
                            </h5>
                            <div className="flex items-center gap-2">
                              {chapterPercentage === 100 ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <Play className="w-4 h-4 text-accent" />
                              )}
                            </div>
                          </div>

                          <div className="w-full bg-muted/30 rounded-full h-2 mb-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                chapterPercentage === 100
                                  ? 'bg-green-500'
                                  : 'bg-accent'
                              }`}
                              style={{ width: `${chapterPercentage}%` }}
                            />
                          </div>

                          <p className="text-xs text-muted">
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
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center">
          <TrendingUp className="w-6 h-6 mr-3 text-accent" />
          Lernstatistiken
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-6 bg-background/50 rounded-2xl border border-accent/20">
            <Award className="w-12 h-12 text-accent mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Abgeschlossene Module
            </h3>
            <p className="text-3xl font-bold text-accent">
              {modules.filter(m => m.progress === 100).length}
            </p>
          </div>
          <div className="text-center p-6 bg-background/50 rounded-2xl border border-accent/20">
            <BookOpen className="w-12 h-12 text-primary mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Aktive Module
            </h3>
            <p className="text-3xl font-bold text-primary">
              {modules.filter(m => m.progress > 0 && m.progress < 100).length}
            </p>
          </div>
          <div className="text-center p-6 bg-background/50 rounded-2xl border border-accent/20">
            <Clock className="w-12 h-12 text-muted mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Verbleibende
            </h3>
            <p className="text-3xl font-bold text-muted">
              {modules.filter(m => m.progress === 0).length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
