'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useParams } from 'next/navigation';
import { TraineeDetail } from '@/components/trainer/TraineeDetail';

export default function TrainerTraineeDetailPage() {
  const { profile, loading } = useAuth();
  const params = useParams();
  const traineeId = params.traineeId as string;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Lade Trainee Details...</p>
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

  if (profile.role !== 'trainer') {
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
    <TraineeDetail
      onNavigation={(view, data) => {
        switch (view) {
          case 'acceptanceProtocol':
            window.location.href = '/trainer/acceptance-protocol';
            break;
          case 'dashboard':
            window.location.href = '/trainer/dashboard';
            break;
          default:
            console.log('Navigation:', view, data);
        }
      }}
    />
  );
}
