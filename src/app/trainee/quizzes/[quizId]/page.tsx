'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useParams } from 'next/navigation';
import { Quiz } from '@/components/learning/Quiz';

export default function TraineeQuizPage() {
  const { profile, loading } = useAuth();
  const params = useParams();
  const quizId = params.quizId as string;

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Quiz...</p>
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
    <Quiz
      onNavigation={(view, data) => {
        switch (view) {
          case 'chapterDetail':
            window.location.href = '/trainee/modules';
            break;
          case 'dashboard':
            window.location.href = '/trainee/dashboard';
            break;
          default:
            console.log('Navigation:', view, data);
        }
      }}
    />
  );
}
