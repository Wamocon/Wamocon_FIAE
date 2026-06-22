'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Profile } from '@/components/profile/Profile';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TrainerProfilePage() {
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

  if (!['trainer', 'admin', 'temp_admin'].includes(profile.role)) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <Profile />;
}
