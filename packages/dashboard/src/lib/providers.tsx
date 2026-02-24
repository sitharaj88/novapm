'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useAppStore } from './store';

export function Providers({ children }: { children: ReactNode }) {
  const refreshInterval = useAppStore((s) => s.refreshInterval);
  const theme = useAppStore((s) => s.theme);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            retry: 1,
          },
        },
      }),
    [],
  );

  // Sync theme class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    queryClient.setDefaultOptions({
      queries: {
        staleTime: 5000,
        refetchInterval: refreshInterval > 0 ? refreshInterval * 1000 : false,
        retry: 1,
      },
    });
    queryClient.invalidateQueries();
  }, [refreshInterval, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
