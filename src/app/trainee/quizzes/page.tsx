'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Brain, Play, Award } from 'lucide-react';
import { useEffect, useState } from 'react';

type QuizCard = {
  id: string;
  title: string;
  difficulty?: string;
  description?: string;
  bestScore?: number;
  questionsCount?: number;
  timeLimit?: number | string;
  attempts?: number;
};

export default function TraineeQuizzesPage() {
  const { profile, loading } = useAuth();
  const [quizzes, setQuizzes] = useState<QuizCard[]>([]);

  // Always declare hooks before any conditional return
  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      try {
        const res = await fetch(`/api/trainee/quizzes?userId=${profile.id}`);
        const data = (await res.json()) as QuizCard[];
        setQuizzes(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setQuizzes([]);
      }
    };
    load();
  }, [profile?.id]);

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Quizze...</p>
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

  

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Brain className="h-8 w-8 text-foreground" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
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
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {quizzes.map(quiz => (
          <div
            key={quiz.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <Brain className="h-6 w-6 text-foreground" />
                </div>
                <div>
                  <h3 className="text-foreground text-xl font-bold">
                    {quiz.title}
                  </h3>
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                    {quiz.difficulty}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2">{quiz.description}</p>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Bestes Ergebnis</span>
                <span className="text-foreground font-medium">
                  {quiz.bestScore || 0}%
                </span>
              </div>
              <div className="bg-muted/30 h-3 w-full rounded-full">
                <div
                  className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
                  style={{ width: `${quiz.bestScore || 0}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">
                  {quiz.questionsCount || 0}
                </div>
                <div className="text-muted">Fragen</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-lg font-bold">
                  {quiz.timeLimit}
                </div>
                <div className="text-muted">Zeit</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">
                  {quiz.attempts || 0}
                </div>
                <div className="text-muted">Versuche</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <a href={`/trainee/quizzes/${quiz.id}`} className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors">
                <Play className="mr-2 inline h-4 w-4" />
                {(quiz.bestScore ?? 0) > 0 ? 'Wiederholen' : 'Starten'}
              </a>
              <button className="bg-muted/30 text-muted hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors">
                <Award className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
