'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useParams } from 'next/navigation';
import { ModuleDetail } from '@/components/learning/ModuleDetail';

export default function TraineeModuleDetailPage() {
  const { profile, loading } = useAuth();
  const params = useParams();
  const moduleId = params.moduleId as string;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Lade Modul...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  return (
    <ModuleDetail
      moduleId={moduleId}
      onNavigation={(view, data) => {
        switch (view) {
          case 'chapterDetail':
            if (data?.moduleId && data?.chapterId) {
              window.location.href = `/trainee/modules/${data.moduleId}/chapters/${data.chapterId}`;
            } else {
              window.location.href = '/trainee/modules';
            }
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
