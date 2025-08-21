'use client';

import { useAuth } from '@/contexts/AuthContext';
import { mockData } from '@/lib/supabase';
import { Brain, Clock, Target, Play, CheckCircle, Award } from 'lucide-react';

export default function TraineeQuizzesPage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Lade Quizze...</p>
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

  // Extract quizzes from curriculum
  const quizzes = mockData.curriculum.flatMap(
    module =>
      module.chapters?.flatMap(
        chapter =>
          chapter.lessons
            ?.filter(lesson => lesson.type === 'quiz')
            .map(lesson => ({
              id: lesson.quizId || lesson.id,
              title: lesson.title,
              description: `Quiz aus Modul: ${module.title}`,
              difficulty: 'intermediate',
              bestScore: lesson.completed ? 85 : 0,
              questions: [],
              timeLimit: '15 min',
              attempts: lesson.completed ? 1 : 0,
            })) || []
      ) || []
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex items-center gap-6 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Quizze & Tests
            </h1>
            <p className="text-muted">
              Testen Sie Ihr Wissen mit verschiedenen Quizzen und bewerten Sie
              Ihren Fortschritt
            </p>
          </div>
        </div>
      </div>

      {/* Quizzes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {quizzes.map(quiz => (
          <div
            key={quiz.id}
            className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30 hover:shadow-xl transition-all duration-300"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-foreground">
                    {quiz.title}
                  </h3>
                  <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-sm font-medium">
                    {quiz.difficulty}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2">{quiz.description}</p>

            {/* Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted">Bestes Ergebnis</span>
                <span className="font-medium text-foreground">
                  {quiz.bestScore || 0}%
                </span>
              </div>
              <div className="w-full bg-muted/30 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-500"
                  style={{ width: `${quiz.bestScore || 0}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div className="text-center p-3 bg-background/50 rounded-xl">
                <div className="text-lg font-bold text-accent">
                  {quiz.questions?.length || 0}
                </div>
                <div className="text-muted">Fragen</div>
              </div>
              <div className="text-center p-3 bg-background/50 rounded-xl">
                <div className="text-lg font-bold text-primary">
                  {quiz.timeLimit}
                </div>
                <div className="text-muted">Zeit</div>
              </div>
              <div className="text-center p-3 bg-background/50 rounded-xl">
                <div className="text-lg font-bold text-accent">
                  {quiz.attempts || 0}
                </div>
                <div className="text-muted">Versuche</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-xl hover:bg-accent/90 transition-colors text-sm font-medium">
                <Play className="w-4 h-4 mr-2 inline" />
                {quiz.bestScore > 0 ? 'Wiederholen' : 'Starten'}
              </button>
              <button className="px-4 py-2 bg-muted/30 text-muted hover:text-foreground rounded-xl hover:bg-muted/50 transition-colors">
                <Award className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
