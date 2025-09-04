'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { Bell, Menu, ChevronLeft } from 'lucide-react';

interface HeaderProps {
  onGoBack: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  userRole: 'trainee' | 'trainer';
}

export function Header({
  onGoBack,
  onToggleSidebar,
  sidebarOpen,
  userRole,
}: HeaderProps) {
  const { profile, switchRole } = useAuth();
  const { language } = useLanguage();
  const { breadcrumbs } = useBreadcrumbs();

  const hasNotifications = profile?.role === 'trainer';
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
    <header className="bg-card/80 border-border/60 flex h-20 items-center justify-between border-b px-6 shadow-lg backdrop-blur-md">
      {/* Left side - Breadcrumbs and Sidebar Toggle */}
      <div className="flex items-center gap-4">
        {/* Sidebar Toggle */}
        <button
          onClick={onToggleSidebar}
          className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2">
          {canGoBack && (
            <button
              onClick={onGoBack}
              className="text-muted hover:text-foreground hover:bg-muted rounded-lg p-2 transition-all duration-200"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-foreground text-xl font-semibold">
            {currentBreadcrumb?.label || 'Dashboard'}
          </h2>
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        {hasNotifications && (
          <button className="text-muted hover:text-foreground hover:bg-muted relative rounded-lg p-2 transition-all duration-200">
            <Bell className="h-5 w-5" />
            <span className="bg-accent absolute top-1 right-1 h-2.5 w-2.5 animate-pulse rounded-full" />
          </button>
        )}

        {/* Role Switcher */}
        <button
          onClick={() =>
            switchRole(profile.role === 'trainee' ? 'trainer' : 'trainee')
          }
          className="text-primary-foreground from-accent to-primary hover:from-accent/90 hover:to-primary/90 focus:ring-accent focus:ring-offset-background transform rounded-lg bg-gradient-to-r px-4 py-2 text-sm font-medium shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          {profile.role === 'trainee'
            ? 'Zur Ausbilder-Ansicht'
            : 'Zur Azubi-Ansicht'}
        </button>
      </div>
    </header>
  );
}
