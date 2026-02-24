'use client';

import { Eye } from 'lucide-react';
import Link from 'next/link';

export function DemoBanner() {
  return (
    <div className="relative z-[60] flex items-center justify-between bg-amber-500/90 px-4 py-2 text-sm font-medium text-black backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4" />
        <span>Demo Modus &mdash; Alle Daten sind Beispieldaten</span>
      </div>
      <Link
        href="/register"
        className="rounded-lg bg-black/20 px-3 py-1 text-xs font-semibold transition-colors hover:bg-black/30"
      >
        Konto erstellen
      </Link>
    </div>
  );
}
