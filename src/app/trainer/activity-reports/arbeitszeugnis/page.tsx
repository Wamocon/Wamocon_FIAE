'use client';

import dynamic from 'next/dynamic';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const ArbeitszeugnisGenerator = dynamic(
  () =>
    import('@/components/trainer/arbeitszeugnis/ArbeitszeugnisGenerator').then(
      m => m.ArbeitszeugnisGenerator
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    ),
  }
);

export default function ArbeitszeugnisPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <ArbeitszeugnisGenerator />
    </div>
  );
}
