'use client';

import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useMemo } from 'react';

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
  onNavigation: (view: string, data?: any, title?: string) => void;
  onGoBack: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  userRole: 'trainee' | 'trainer';
  children: React.ReactNode;
}

export function MainLayout({
  user,
  profile,
  onNavigation,
  onGoBack,
  sidebarOpen,
  onToggleSidebar,
  userRole,
  children,
}: MainLayoutProps) {
  // Determine current view from URL path - optimized with useMemo
  const currentView = useMemo(() => 'dashboard', []);

  return (
    <div className="flex h-screen bg-gradient-to-br from-background via-red-900/20 to-red-800/30">
      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onNavigation={onNavigation}
        isOpen={sidebarOpen}
        onToggle={onToggleSidebar}
        userRole={userRole}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header
          onNavigation={onNavigation}
          onGoBack={onGoBack}
          onToggleSidebar={onToggleSidebar}
          sidebarOpen={sidebarOpen}
          userRole={userRole}
        />

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-br from-background/80 via-red-900/15 to-red-800/25">
          {children}
        </div>
      </main>
    </div>
  );
}
