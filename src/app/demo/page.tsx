'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DemoRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/demo/trainee/dashboard');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-muted-foreground animate-pulse text-lg">Wird geladen...</div>
    </div>
  );
}
