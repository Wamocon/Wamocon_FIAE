'use client';

import {
  BookOpen,
  Edit3,
  FileQuestion,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react';
import { mockData } from '@/lib/supabase';

interface ChapterDetailProps {
  onNavigation: (view: string, data?: any) => void;
}

export function ChapterDetail({ onNavigation }: ChapterDetailProps) {
  // Use mock data from supabase - get first chapter for demo
  const mockChapter = mockData.curriculum[0].chapters[0];

  const getIcon = (type: string) => {
    switch (type) {
      case 'lesson':
        return <BookOpen className="h-5 w-5" />;
      case 'exercise':
        return <Edit3 className="h-5 w-5" />;
      case 'quiz':
        return <FileQuestion className="h-5 w-5" />;
      default:
        return <BookOpen className="h-5 w-5" />;
    }
  };

  const getStatusIcon = (completed: boolean, type: string) => {
    if (type === 'quiz') {
      return <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />;
    }
    return completed ? (
      <CheckCircle2 className="h-6 w-6 text-green-500" />
    ) : (
      <Circle className="text-muted h-6 w-6" />
    );
  };

  const handleLessonClick = (lessonId: string) => {
    onNavigation('lesson', { lessonId });
  };

  const handleQuizClick = (quizId: string) => {
    onNavigation('quiz', { quizId });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="from-accent to-primary mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            {mockChapter.title}
          </h1>
          <p className="text-muted">
            Kapitel aus dem Modul "Grundlagen der Anwendungsentwicklung"
          </p>
        </div>
      </div>

      {/* Lessons List */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <h2 className="text-foreground mb-6 text-2xl font-bold">
          Lektionen in diesem Kapitel
        </h2>
        <div className="space-y-4">
          {mockChapter.lessons.map(lesson => (
            <div
              key={lesson.id}
              className="bg-background/50 border-accent/20 hover:border-accent/40 cursor-pointer rounded-2xl border p-6 transition-all duration-200 hover:shadow-md"
              onClick={() => handleLessonClick(lesson.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                    {getIcon(lesson.type)}
                  </div>
                  <div>
                    <h3 className="text-foreground text-lg font-semibold">
                      {lesson.title}
                    </h3>
                    <p className="text-muted text-sm">{lesson.ref}</p>
                  </div>
                </div>
                {getStatusIcon(lesson.completed, lesson.type)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quiz Section */}
      <div
        className="glass-effect border-accent/30 hover:border-accent/50 cursor-pointer rounded-3xl border p-8 transition-all duration-200 hover:shadow-lg"
        onClick={() => handleQuizClick(mockChapter.mainQuizId)}
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-foreground mb-2 text-2xl font-bold">
              Abschlusstest: {mockChapter.title}
            </h4>
            <p className="text-muted">Teste dein Wissen aus diesem Kapitel.</p>
          </div>
          <button className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-8 py-4 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            Quiz starten
          </button>
        </div>
      </div>
    </div>
  );
}
