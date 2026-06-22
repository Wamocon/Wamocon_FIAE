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
            staleTime: 60 * 1000, // 60 s – serve cached data instantly on navigation, fewer spinners
            gcTime: 10 * 60 * 1000, // 10 min – keep in memory for back-navigation
            refetchOnWindowFocus: false, // avoid jarring refetch/spinner flashes on tab switch
            refetchOnReconnect: true, // still refresh after the network reconnects
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
