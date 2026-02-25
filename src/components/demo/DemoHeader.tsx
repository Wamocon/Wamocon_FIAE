'use client';

import { useDemo } from './DemoContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Menu, ChevronLeft } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

interface DemoHeaderProps {
  onGoBack: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function DemoHeader({ onGoBack, onToggleSidebar, sidebarOpen }: DemoHeaderProps) {
  const { profile } = useDemo();
  const { t } = useLanguage();
  const pathname = usePathname();

  const pageTitle = useMemo(() => {
    if (!pathname) return t('nav.dashboard');
    if (pathname.includes('/dashboard')) return t('nav.dashboard');
    if (pathname.includes('/courses')) return t('nav.courses');
    if (pathname.includes('/profile')) return t('nav.profile');
    if (pathname.includes('/school')) return t('nav.school');
    if (pathname.includes('/content-management')) return t('nav.contentManagement');
    if (pathname.includes('/trainees')) return t('nav.trainees');
    if (pathname.includes('/activity-reports')) return t('nav.activityReports');
    return t('nav.dashboard');
  }, [pathname, t]);

  const canGoBack = pathname ? !pathname.endsWith('/dashboard') : false;

  if (!profile) return null;

  return (
    <header className="bg-card/80 border-border/60 relative z-50 flex h-16 items-center justify-between border-b px-6 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
          className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        {canGoBack && (
          <button
            onClick={onGoBack}
            aria-label={t('common.back')}
            className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="text-foreground text-xl font-semibold">{pageTitle}</h2>
      </div>
      <div className="flex items-center gap-3">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
    </header>
  );
}
