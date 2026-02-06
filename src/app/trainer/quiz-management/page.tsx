'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { QuizManagement } from '@/components/trainer/QuizManagement';

export default function TrainerQuizManagementPage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">{t('quiz.managementLoading')}</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">{t('quiz.userNotFound')}</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">{t('quiz.accessDenied')}</p>
        </div>
      </div>
    );
  }

  return <QuizManagement />;
}
