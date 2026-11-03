'use client';

/**
 * The column of the app layout the HAI panel lives in (MainLayout renders it
 * as the last child of the flex row, right of the header and the page).
 *
 * Its width is the space the page gives to the panel (--hai-dock-inset: the
 * panel width while the panel is open, 0 while it is closed) and it animates
 * that width (0.28 s, no motion with reduced motion: --hai-dock-ms is 0). The
 * panel itself is rendered into this column (portal, HaiChat) with a fixed
 * width and clings to the left edge of the column, so the panel does not
 * reflow while the column grows or shrinks: it slides in with the edge of the
 * page, and the page moves to the left at the same speed.
 *
 * Without the dock provider (no HAI for this account) there is no column.
 */

import { useEffect } from 'react';
import { useHaiDockRegistry, useOptionalHaiDock } from './HaiDockContext';

export function HaiDockColumn({ sidebarOpen }: { sidebarOpen: boolean }) {
  const registry = useHaiDockRegistry();
  const dock = useOptionalHaiDock();
  const setSidebarOpen = registry?.setSidebarOpen;

  useEffect(() => {
    setSidebarOpen?.(sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  if (!registry) return null;

  return (
    <div
      ref={registry.slotRef}
      data-testid="hai-dock-column"
      data-open={dock?.open ? 'true' : 'false'}
      data-docked={dock?.docked ? 'true' : 'false'}
      // the width is the variable (haiDock.ts: --hai-dock-inset, --hai-dock-ms)
      className="relative z-30 h-full w-[var(--hai-dock-inset,0px)] shrink-0 overflow-hidden transition-[width] duration-[var(--hai-dock-ms,280ms)] ease-[cubic-bezier(0.32,0.72,0,1)]"
    />
  );
}
