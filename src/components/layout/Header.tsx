'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { Bell, Menu, ChevronLeft } from 'lucide-react';

interface HeaderProps {
  onNavigation: (view: string, data?: any, title?: string) => void;
  onGoBack: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  userRole: 'trainee' | 'trainer';
}

export function Header({
  onNavigation,
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
    <header className="h-20 bg-card/80 backdrop-blur-md border-b border-border/60 flex items-center justify-between px-6 shadow-lg">
      {/* Left side - Breadcrumbs and Sidebar Toggle */}
      <div className="flex items-center gap-4">
        {/* Sidebar Toggle */}
        <button
          onClick={onToggleSidebar}
          className="p-2 text-muted hover:text-foreground hover:bg-muted rounded-lg transition-all duration-200"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2">
          {canGoBack && (
            <button
              onClick={onGoBack}
              className="p-2 text-muted hover:text-foreground hover:bg-muted rounded-lg transition-all duration-200"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-xl font-semibold text-foreground">
            {currentBreadcrumb?.label || 'Dashboard'}
          </h2>
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        {hasNotifications && (
          <button className="relative p-2 text-muted hover:text-foreground hover:bg-muted rounded-lg transition-all duration-200">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-accent rounded-full animate-pulse" />
          </button>
        )}

        {/* Role Switcher */}
        <button
          onClick={() =>
            switchRole(profile.role === 'trainee' ? 'trainer' : 'trainee')
          }
          className="px-4 py-2 text-sm font-medium text-primary-foreground bg-gradient-to-r from-accent to-primary hover:from-accent/90 hover:to-primary/90 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
        >
          {profile.role === 'trainee'
            ? 'Zur Ausbilder-Ansicht'
            : 'Zur Azubi-Ansicht'}
        </button>
      </div>
    </header>
  );
}
