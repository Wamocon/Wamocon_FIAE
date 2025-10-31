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
    <header className="bg-card/80 border-border/60 relative z-50 flex h-20 items-center justify-between border-b px-6 shadow-lg backdrop-blur-md">
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
    </header>
  );
}
