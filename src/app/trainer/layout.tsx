'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TrainerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }

    // Redirect non-trainer users
    if (!loading && profile && profile.role !== 'trainer') {
      router.push('/login');
    }
  }, [user, profile, loading, router]);

  const handleNavigation = (view: string, data?: any, title?: string) => {
    // Navigate to the appropriate trainer route
    switch (view) {
      case 'dashboard':
        router.push('/trainer/dashboard');
        break;
      case 'profile':
        router.push('/trainer/profile');
        break;
      case 'contentManagement':
        router.push('/trainer/content-management');
        break;
      case 'quizManagement':
        router.push('/trainer/quiz-management');
        break;
      case 'trainees':
        if (data?.traineeId) {
          router.push(`/trainer/trainees/${data.traineeId}`);
        } else {
          router.push('/trainer/trainees');
        }
        break;
      case 'acceptanceProtocol':
        router.push('/trainer/acceptance-protocol');
        break;
      case 'analytics':
        router.push('/trainer/analytics');
        break;
      default:
        router.push('/trainer/dashboard');
    }
  };

  const handleGoBack = () => {
    router.back();
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">
            Lade Trainer Dashboard...
          </p>
        </div>
      </div>
    );
  }

  // Show redirect state
  if (shouldRedirect) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Weiterleitung...</p>
        </div>
      </div>
    );
  }

  // Show access denied state
  if (!isAuthenticated) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  return (
    <MainLayout
      user={user}
      profile={profile}
      onGoBack={handleGoBack}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={handleToggleSidebar}
      userRole="trainer"
    >
      {children}
    </MainLayout>
  );
}

export default memo(TrainerLayoutComponent)
