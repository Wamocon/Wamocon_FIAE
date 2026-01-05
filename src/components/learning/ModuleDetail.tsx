"use client";

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
import type { ModuleWithLessons } from '@/db/queries';
import Link from 'next/link';

interface ModuleDetailProps {
  data: ModuleWithLessons | null;
}

export default function ModuleDetail({ data }: ModuleDetailProps) {
  const router = useRouter();
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  if (!data) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Modul nicht gefunden...</p>
        </div>
      </div>
    );
  }

  const handleChapterClick = (moduleId: string, chapterId: string) => {
    router.push(`/trainee/modules/${moduleId}/chapters/${chapterId}`);
  };

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModule(selectedModule === moduleId ? null : moduleId);
  };

  const moduleTitle = data.module.title;
  const trainingYear = data.module.training_year;
  const totalLessons = data.lessons.length;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="from-accent to-primary mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-10 w-10 text-foreground" />
          </div>
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            {moduleTitle}
          </h1>
          <p className="text-muted">
            Modul aus dem {trainingYear}. Ausbildungsjahr
          </p>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="glass-effect border-accent/30 overflow-hidden rounded-3xl border shadow-lg">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
              <BookOpen className="h-8 w-8 text-foreground" />
            </div>
            <button
              onClick={() => handleModuleSelect(data.module.id)}
              className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200"
            >
              <ChevronRight
                className={`h-5 w-5 transition-transform duration-200 ${selectedModule === data.module.id ? 'rotate-90' : ''}`}
              />
            </button>
          </div>

          <h3 className="text-foreground mb-2 text-xl font-bold">{moduleTitle}</h3>
          <div className="text-muted mb-4 flex items-center gap-4 text-sm">
            <span className="bg-accent/20 text-accent rounded-full px-3 py-1 font-medium">
              Jahr {trainingYear}
            </span>
            <span>{totalLessons} Lektionen</span>
          </div>

          {/* Lessons List */}
          <div className="space-y-3">
            {data.lessons.map((lesson) => (
              <Link
                key={lesson.id}
                href={`/trainee/trainer-feedback/${lesson.id}`}
                className="bg-background/50 border-accent/20 hover:border-accent/40 rounded-xl border p-4 transition-colors block"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h5 className="text-foreground font-medium">{lesson.title}</h5>
                  <div className="text-muted text-sm">{lesson.subLessonsCount} Aufgaben</div>
                </div>
                <div className="text-muted text-xs">Dauer: {lesson.duration_weeks ?? 0} Wochen</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Statistics section removed for now; can reintroduce with real per-user progress later */}
    </div>
  );
}
