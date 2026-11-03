'use client';

import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Fragment, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { CatalogTabs } from '@/components/catalog/CatalogTabs';
import { useCatalog } from '@/contexts/CatalogContext';
import { isCatalogTabPath } from '@/lib/catalog/tabs';

// Use the same User interface as AuthContext
interface User {
  id: string;
  email: string;
}

type UserRole =
  | 'super_admin'
  | 'admin'
  | 'temp_admin'
  | 'trainer'
  | 'trainee';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
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
  user: _user,
  profile: _profile,
  onGoBack,
  sidebarOpen,
  onToggleSidebar,
  userRole,
  children,
}: MainLayoutProps) {
  // Determine current view from URL path - optimized with useMemo
  const currentView = useMemo(() => 'dashboard', []);
  const pathname = usePathname();
  // Tabs per training on the content and list pages (trainer level users and
  // trainees with more than one occupation). The page content is keyed with
  // the epoch, so a switch loads every page again for the chosen occupation.
  // The tabs sit outside of the key and keep the focus.
  const { tabs, epoch } = useCatalog();
  const showTabs = tabs.length > 1 && isCatalogTabPath(pathname);
  const hideBackButton = useMemo(() => {
    if (!pathname) return false;
    // Hide back button on dashboard and quiz pages (no meaningful back navigation)
    return (
      pathname === '/trainee/dashboard' ||
      pathname === '/trainer/dashboard' ||
      pathname.startsWith('/trainee/quizzes/')
    );
  }, [pathname]);

  // Memoize the layout structure to prevent unnecessary re-renders
  const layoutContent = useMemo(
    () => (
      <div className="from-background relative flex h-screen bg-gradient-to-br via-red-900/20 to-red-800/30">
        {/* Sidebar + hover edge wrapper */}
        <div className="group relative z-40">
          {/* Hover edge to reveal sidebar when hidden (desktop only) */}
          <div
            className="absolute top-0 left-0 hidden h-full w-2 lg:block"
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
            {showTabs && <CatalogTabs />}
            <Fragment key={epoch}>{children}</Fragment>
          </div>
        </main>
      </div>
    ),
    [
      currentView,
      sidebarOpen,
      onToggleSidebar,
      userRole,
      onGoBack,
      children,
      hideBackButton,
      showTabs,
      epoch,
    ]
  );

  return layoutContent;
}
