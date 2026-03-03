'use client';

import { Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { SchoolView } from '@/components/school/SchoolView';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function SchoolPageContent() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();

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
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return <SchoolView />;
}

function LoadingFallback() {
  return (
    <div className="bg-background flex min-h-full items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export default function TraineeSchoolPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SchoolPageContent />
    </Suspense>
  );
}
