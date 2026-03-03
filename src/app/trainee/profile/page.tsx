'use client';

import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Profile } from '@/components/profile/Profile';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TraineeProfilePage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const isRequired = searchParams.get('required') === 'true';

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.userNotFound')}</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.accessDenied')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isRequired && !profile?.birth_date && (
        <div className="bg-destructive/10 border-destructive/50 m-4 rounded-2xl border p-4 md:p-6">
          <div className="flex gap-3">
            <AlertCircle className="text-destructive mt-0.5 h-6 w-6 flex-shrink-0" />
            <div>
              <h3 className="text-destructive mb-2 font-bold">
                {t('profile.birthDateRequired') || 'Geburtsdatum erforderlich'}
              </h3>
              <p className="text-destructive/90 text-sm">
                {t('profile.birthDateRequiredText') ||
                  'Bitte aktualisieren Sie Ihr Profil mit Ihrem Geburtsdatum, um auf das Dashboard zuzugreifen.'}
              </p>
            </div>
          </div>
        </div>
      )}
      <Profile />
    </>
  );
}
