'use client';

import { Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { TrainerSchoolView } from '@/components/trainer/TrainerSchoolView';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function SchoolPageContent() {
  const { profile, loading } = useAuth();

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
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <TrainerSchoolView />;
}

export default function TrainerSchoolPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <SchoolPageContent />
    </Suspense>
  );
}
