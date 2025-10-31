'use client';

import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';

// Use the same User interface as AuthContext
interface User {
  id: string;
  email: string;
}

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'trainee' | 'trainer';
  avatar?: string | null;
  training_start_date?: string | null;
  trainer_id?: string | null;
}

interface MainLayoutProps {
  user?: User | null;
  profile: Profile | null;
  onGoBack: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  userRole: 'trainee' | 'trainer';
  children: React.ReactNode;
}

export function MainLayout({
  user,
  profile,
  onGoBack,
  sidebarOpen,
  onToggleSidebar,
  userRole,
  children,
}: MainLayoutProps) {
  // Determine current view from URL path - optimized with useMemo
  const currentView = useMemo(() => 'dashboard', []);
  const pathname = usePathname();
  const hideBackButton = useMemo(() => {
    if (!pathname) return false;
    return pathname.startsWith('/trainee/quizzes/');
  }, [pathname]);

  // Memoize the layout structure to prevent unnecessary re-renders
  const layoutContent = useMemo(
    () => (
      <div className="from-background relative flex h-screen bg-gradient-to-br via-red-900/20 to-red-800/30">
        {/* Sidebar + hover edge wrapper */}
        <div className="relative z-40 group">
          {/* Hover edge to reveal sidebar when hidden (desktop only) */}
          <div
            className="absolute left-0 top-0 hidden h-full w-2 lg:block"
            aria-hidden="true"
          />

          {/* Sidebar */}
          <Sidebar
            currentView={currentView}
            isOpen={sidebarOpen}
            onToggle={onToggleSidebar}
            userRole={userRole}
          />
        </div>

        {/* Mobile overlay when sidebar is open */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={onToggleSidebar}
            aria-hidden="true"
          />
        )}

        {/* Main Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <Header
            onGoBack={onGoBack}
            onToggleSidebar={onToggleSidebar}
            sidebarOpen={sidebarOpen}
            userRole={userRole}
            hideBackButton={hideBackButton}
          />

          {/* Page Content */}
          <div className="from-background/80 flex-1 overflow-y-auto bg-gradient-to-br via-red-900/15 to-red-800/25">
            {children}
          </div>
        </main>
      </div>
    ),
    [currentView, sidebarOpen, onToggleSidebar, userRole, onGoBack, children]
  );

  return layoutContent;
}
