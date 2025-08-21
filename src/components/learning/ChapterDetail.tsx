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
        return <BookOpen className="w-5 h-5" />;
      case 'exercise':
        return <Edit3 className="w-5 h-5" />;
      case 'quiz':
        return <FileQuestion className="w-5 h-5" />;
      default:
        return <BookOpen className="w-5 h-5" />;
    }
  };

  const getStatusIcon = (completed: boolean, type: string) => {
    if (type === 'quiz') {
      return <Loader2 className="w-6 h-6 text-yellow-500 animate-spin" />;
    }
    return completed ? (
      <CheckCircle2 className="w-6 h-6 text-green-500" />
    ) : (
      <Circle className="w-6 h-6 text-muted" />
    );
  };

  const handleLessonClick = (lessonId: string) => {
    onNavigation('lesson', { lessonId });
  };

  const handleQuizClick = (quizId: string) => {
    onNavigation('quiz', { quizId });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {mockChapter.title}
          </h1>
          <p className="text-muted">
            Kapitel aus dem Modul "Grundlagen der Anwendungsentwicklung"
          </p>
        </div>
      </div>

      {/* Lessons List */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <h2 className="text-2xl font-bold text-foreground mb-6">
          Lektionen in diesem Kapitel
        </h2>
        <div className="space-y-4">
          {mockChapter.lessons.map(lesson => (
            <div
              key={lesson.id}
              className="p-6 bg-background/50 rounded-2xl border border-accent/20 cursor-pointer hover:border-accent/40 hover:shadow-md transition-all duration-200"
              onClick={() => handleLessonClick(lesson.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                    {getIcon(lesson.type)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg">
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
        className="glass-effect rounded-3xl p-8 border border-accent/30 cursor-pointer hover:border-accent/50 hover:shadow-lg transition-all duration-200"
        onClick={() => handleQuizClick(mockChapter.mainQuizId)}
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-2xl text-foreground mb-2">
              Abschlusstest: {mockChapter.title}
            </h4>
            <p className="text-muted">Teste dein Wissen aus diesem Kapitel.</p>
          </div>
          <button className="px-8 py-4 font-semibold text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
            Quiz starten
          </button>
        </div>
      </div>
    </div>
  );
}
