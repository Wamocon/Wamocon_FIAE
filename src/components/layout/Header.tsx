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
  const { profile } = useAuth();
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

      {/* Right side actions */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        {hasNotifications && (
          <button className="text-muted hover:text-foreground hover:bg-muted relative rounded-lg p-2 transition-all duration-200">
            
            <span className="bg-accent absolute top-1 right-1 h-2.5 w-2.5 animate-pulse rounded-full" />
          </button>
        )}
      </div>
    </header>
  );
}
