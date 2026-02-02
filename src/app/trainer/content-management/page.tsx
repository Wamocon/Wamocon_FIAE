'use client';

import { useAuth } from '@/contexts/AuthContext';
import { ContentManagement } from '@/components/trainer/ContentManagement';

export default function TrainerContentManagementPage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Inhalts-Management...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  return <ContentManagement />;
}
