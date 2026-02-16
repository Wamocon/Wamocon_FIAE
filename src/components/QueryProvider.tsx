'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Wraps the app in a React Query QueryClientProvider.
 * Created as a separate client component so the root layout stays a Server Component.
 */
export default function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 min – matches server-side Data Cache TTL
            gcTime: 10 * 60 * 1000, // 10 min – keep in memory for back-navigation
            refetchOnWindowFocus: true, // auto-refresh when user returns to tab
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
