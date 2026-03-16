'use client';

import { useAuth } from '@/contexts/AuthContext';
import { QuizManagement } from '@/components/trainer/QuizManagement';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TrainerQuizManagementPage() {
  const { profile, loading } = useAuth();

  if (loading || !profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <QuizManagement />;
}
