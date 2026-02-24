'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DemoProvider, useDemo } from '@/components/demo/DemoContext';
import { DemoSidebar } from '@/components/demo/DemoSidebar';
import { DemoHeader } from '@/components/demo/DemoHeader';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { DemoRoleSwitcher } from '@/components/demo/DemoRoleSwitcher';
import { DemoHaiChat } from '@/components/demo/DemoHaiChat';

function DemoLayoutInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const { role } = useDemo();

  const handleGoBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <DemoBanner />
      <div className="from-background relative flex flex-1 overflow-hidden bg-gradient-to-br via-red-900/20 to-red-800/30">
        {/* Sidebar + hover edge wrapper */}
        <div className="group relative z-40">
          <div
            className="absolute top-0 left-0 hidden h-full w-2 lg:block"
            aria-hidden="true"
          />
          <DemoSidebar isOpen={sidebarOpen} onToggle={handleToggleSidebar} />
        </div>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={handleToggleSidebar}
            aria-hidden="true"
          />
        )}

        {/* Main Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <DemoHeader
            onGoBack={handleGoBack}
            onToggleSidebar={handleToggleSidebar}
            sidebarOpen={sidebarOpen}
          />
          <div className="from-background/80 flex-1 overflow-y-auto bg-gradient-to-br via-red-900/15 to-red-800/25">
            {children}
          </div>
        </main>
      </div>
      <DemoRoleSwitcher />
      <DemoHaiChat />
    </div>
  );
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <DemoProvider>
      <DemoLayoutInner>{children}</DemoLayoutInner>
    </DemoProvider>
  );
}
