'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsSuperAdmin } from '@/lib/hooks/useIsSuperAdmin';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

/**
 * The pages of the content upload are for the people who may write curriculum
 * content (platform administrators). Anybody else is sent back with a note. This
 * only decides what is shown: every route checks the right again on every call
 * (requireCurriculumEditor), so a changed page in the browser opens nothing.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const allowed = useIsSuperAdmin();
  const { t } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !allowed) {
      toast.error(t('contentUpload.noAccess'));
      router.replace('/trainer/dashboard');
    }
  }, [loading, allowed, router, t]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (!allowed) {
    return (
      <p role="alert" className="text-foreground p-6">
        {t('contentUpload.noAccess')}
      </p>
    );
  }
  return <>{children}</>;
}
