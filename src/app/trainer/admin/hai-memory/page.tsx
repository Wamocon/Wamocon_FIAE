'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useIsSuperAdmin } from '@/lib/hooks/useIsSuperAdmin';
import { HaiMemoryAdminView } from '@/components/admin/HaiMemoryAdminView';

/**
 * Shared HAI memory (platform admin only). This only decides what is shown: the
 * routes under /api/admin/hai/memory check the role on every call. The page never
 * shows the memory of one person.
 */
export default function AdminHaiMemoryPage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();
  const isSuperAdmin = useIsSuperAdmin();

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (!profile || !isSuperAdmin) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <p role="alert" className="text-muted-foreground">
          {t('common.accessDenied')}
        </p>
      </div>
    );
  }
  return <HaiMemoryAdminView />;
}
