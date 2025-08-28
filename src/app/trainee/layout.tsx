'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function TraineeLayout({
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

    // Redirect non-trainee users
    if (!loading && profile && profile.role !== 'trainee') {
      router.push('/login');
    }
  }, [user, profile, loading, router]);

  const handleNavigation = (view: string, data?: any, title?: string) => {
    // Navigate to the appropriate trainee route
    switch (view) {
      case 'dashboard':
        router.push('/trainee/dashboard');
        break;
      case 'profile':
        router.push('/trainee/profile');
        break;
      case 'reflection':
        router.push('/trainee/reflection');
        break;
      case 'knowledgeSubmission':
        router.push('/trainee/knowledge-submission');
        break;
      case 'modules':
        if (data?.moduleId) {
          router.push(`/trainee/modules/${data.moduleId}`);
        } else {
          router.push('/trainee/modules');
        }
        break;
      case 'lessons':
        if (data?.lessonId) {
          router.push(`/trainee/lessons/${data.lessonId}`);
        } else {
          router.push('/trainee/lessons');
        }
        break;
      case 'quizzes':
        if (data?.quizId) {
          router.push(`/trainee/quizzes/${data.quizId}`);
        } else {
          router.push('/trainee/quizzes');
        }
        break;
      default:
        router.push('/trainee/dashboard');
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
            Lade Trainee Dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Weiterleitung...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
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
      onNavigation={handleNavigation}
      onGoBack={handleGoBack}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={handleToggleSidebar}
      userRole="trainee"
    >
      {children}
    </MainLayout>
  );
}
