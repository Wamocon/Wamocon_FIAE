'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { isAdminRole } from '@/lib/auth/roles';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ContentStatsView } from '@/components/admin/ContentStatsView';

/**
 * Content statistics per training catalog, for every admin level. This only
 * decides what is shown: the route checks the role on every call and sends an
 * organization admin the actual numbers of the own catalogs only.
 */
export default function ContentStatsPage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (!profile || !isAdminRole(profile.role)) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <p role="alert" className="text-muted-foreground">
          {t('common.accessDenied')}
        </p>
      </div>
    );
  }
  return <ContentStatsView />;
}
