'use client';

import { useAuth } from '@/contexts/AuthContext';
import { ContentManagement } from '@/components/trainer/ContentManagement';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TrainerContentManagementPage() {
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

  return <ContentManagement />;
}
