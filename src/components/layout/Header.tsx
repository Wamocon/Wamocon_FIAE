'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { Menu, ChevronLeft, Crown, Sparkles } from 'lucide-react';
import NotificationsBell from '@/components/ui/NotificationsBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';

interface HeaderProps {
  onGoBack: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  userRole: 'trainee' | 'trainer';
  hideBackButton?: boolean;
}

export function Header({
  onGoBack,
  onToggleSidebar,
  sidebarOpen,
  userRole,
  hideBackButton = false,
}: HeaderProps) {
  const { profile, subscriptionPlan, isPlatformOwner } = useAuth() as any;
  const { t } = useLanguage();
  const { breadcrumbs } = useBreadcrumbs();

  const canGoBack =
    breadcrumbs && Array.isArray(breadcrumbs) && breadcrumbs.length > 1;
  const currentBreadcrumb =
    breadcrumbs && Array.isArray(breadcrumbs) && breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1]
      : null;

  if (!profile) {
    return null;
  }

  return (
    <header className="bg-card/80 border-border/60 relative z-50 flex h-16 items-center justify-between border-b px-6 shadow-lg backdrop-blur-md">
      {/* Left side - Breadcrumbs and Sidebar Toggle */}
      <div className="flex items-center gap-4">
        {/* Sidebar Toggle */}
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
          className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        {canGoBack && !hideBackButton && (
          <button
            onClick={onGoBack}
            aria-label={t('common.back')}
            className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="text-foreground text-xl font-semibold">
          {currentBreadcrumb?.label || t('nav.dashboard')}
        </h2>
      </div>
      {/* Right side - Actions */}
      <div className="flex items-center gap-3" data-tour="header-settings">
        {!isPlatformOwner && subscriptionPlan && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              subscriptionPlan === 'PRO'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 ring-1 ring-amber-500/30'
                : 'bg-gradient-to-r from-sky-500/20 to-blue-500/20 text-sky-400 ring-1 ring-sky-500/30'
            }`}
          >
            {subscriptionPlan === 'PRO' ? (
              <Crown className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {subscriptionPlan === 'PRO' ? 'Pro' : 'Light'}
          </div>
        )}
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
        <div data-tour="header-notifications">
          <NotificationsBell />
        </div>
      </div>
    </header>
  );
}
