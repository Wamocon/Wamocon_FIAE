'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function DemoRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/demo/trainee/dashboard');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
