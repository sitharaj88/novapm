'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Moon, Sun, Globe, Info, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const { theme, toggleTheme, refreshInterval, setRefreshInterval, logViewerLines, setLogViewerLines } = useAppStore();

  const { data: health, isLoading: healthLoading, isError: healthError, refetch: refetchHealth } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    retry: false,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4 md:space-y-6">
      <Header
        title="Settings"
        description="Configure your NovaPM dashboard"
      />

      {/* Dashboard Configuration */}
      <section className="rounded-xl border border-nova-border bg-nova-card">
        <div className="border-b border-nova-border px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-sm font-semibold text-nova-text-primary sm:text-base">
            Dashboard Configuration
          </h2>
          <p className="mt-0.5 text-xs text-nova-text-secondary sm:text-sm">
            Customize the dashboard appearance and behavior
          </p>
        </div>
        <div className="divide-y divide-nova-border">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon className="h-5 w-5 text-nova-purple" />
              ) : (
                <Sun className="h-5 w-5 text-nova-yellow" />
              )}
              <div>
                <p className="text-sm font-medium text-nova-text-primary">
                  Theme
                </p>
                <p className="text-xs text-nova-text-secondary">
                  Switch between dark and light mode
                </p>
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                theme === 'dark' ? 'bg-nova-purple' : 'bg-nova-text-muted'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                  theme === 'dark' ? 'left-[22px]' : 'left-0.5'
                )}
              />
            </button>
          </div>

          {/* Auto-refresh interval */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <p className="text-sm font-medium text-nova-text-primary">
                Auto-refresh Interval
              </p>
              <p className="text-xs text-nova-text-secondary">
                How often to fetch updated data
              </p>
            </div>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="rounded-lg border border-nova-border bg-nova-bg px-3 py-1.5 text-sm text-nova-text-primary focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
            >
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={0}>Disabled</option>
            </select>
          </div>

          {/* Log retention */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <p className="text-sm font-medium text-nova-text-primary">
                Log Viewer Lines
              </p>
              <p className="text-xs text-nova-text-secondary">
                Maximum number of log lines to display
              </p>
            </div>
            <select
              value={logViewerLines}
              onChange={(e) => setLogViewerLines(Number(e.target.value))}
              className="rounded-lg border border-nova-border bg-nova-bg px-3 py-1.5 text-sm text-nova-text-primary focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
            >
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>
          </div>
        </div>
      </section>

      {/* API Connection */}
      <section className="rounded-xl border border-nova-border bg-nova-card">
        <div className="border-b border-nova-border px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-nova-text-primary sm:text-base">
                API Connection
              </h2>
              <p className="mt-0.5 text-xs text-nova-text-secondary sm:text-sm">
                Connection details for the NovaPM core daemon
              </p>
            </div>
            <button
              onClick={() => refetchHealth()}
              className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-text-primary"
              title="Check connection"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="divide-y divide-nova-border">
          {/* Connection Status */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-3">
              {healthLoading ? (
                <RefreshCw className="h-5 w-5 animate-spin text-nova-text-muted" />
              ) : healthError ? (
                <XCircle className="h-5 w-5 text-nova-red" />
              ) : (
                <CheckCircle className="h-5 w-5 text-nova-green" />
              )}
              <div>
                <p className="text-sm font-medium text-nova-text-primary">
                  Connection Status
                </p>
                <p className="text-xs text-nova-text-secondary">
                  {healthLoading
                    ? 'Checking connection...'
                    : healthError
                      ? 'Unable to reach the NovaPM daemon'
                      : `Connected — ${health?.processCount ?? 0} process${(health?.processCount ?? 0) !== 1 ? 'es' : ''} managed`}
                </p>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                healthLoading
                  ? 'border-nova-border bg-nova-elevated text-nova-text-muted'
                  : healthError
                    ? 'border-nova-red/20 bg-nova-red/10 text-nova-red'
                    : 'border-nova-green/20 bg-nova-green/10 text-nova-green'
              )}
            >
              {healthLoading ? 'Checking' : healthError ? 'Disconnected' : 'Connected'}
            </span>
          </div>

          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-nova-cyan" />
              <div>
                <p className="text-sm font-medium text-nova-text-primary">
                  API Endpoint
                </p>
                <p className="text-xs text-nova-text-secondary">
                  Base URL for the NovaPM HTTP API
                </p>
              </div>
            </div>
            <code className="rounded-md bg-nova-bg px-2 py-1 text-xs text-nova-cyan sm:px-3 sm:py-1.5 sm:text-sm">
              {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9615'}
            </code>
          </div>

          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <p className="text-sm font-medium text-nova-text-primary">
                WebSocket Endpoints
              </p>
              <p className="text-xs text-nova-text-secondary">
                Real-time data streams
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-nova-text-secondary">
                <code className="rounded bg-nova-bg px-1.5 py-0.5 text-nova-text-primary">
                  /ws/logs
                </code>
              </p>
              <p className="text-xs text-nova-text-secondary">
                <code className="rounded bg-nova-bg px-1.5 py-0.5 text-nova-text-primary">
                  /ws/metrics
                </code>
              </p>
              <p className="text-xs text-nova-text-secondary">
                <code className="rounded bg-nova-bg px-1.5 py-0.5 text-nova-text-primary">
                  /ws/events
                </code>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="rounded-xl border border-nova-border bg-nova-card">
        <div className="border-b border-nova-border px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-sm font-semibold text-nova-text-primary sm:text-base">
            About
          </h2>
        </div>
        <div className="px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-nova-purple to-nova-cyan shadow-lg shadow-nova-purple/20">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-white" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-nova-text-primary">
                NovaPM Dashboard
              </h3>
              <p className="text-sm text-nova-text-secondary">
                Next-generation AI-powered process manager
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-nova-text-muted">Dashboard Version</p>
              <p className="mt-0.5 text-sm font-medium text-nova-text-primary">
                1.0.0
              </p>
            </div>
            <div>
              <p className="text-xs text-nova-text-muted">Framework</p>
              <p className="mt-0.5 text-sm font-medium text-nova-text-primary">
                Next.js 16
              </p>
            </div>
            <div>
              <p className="text-xs text-nova-text-muted">License</p>
              <p className="mt-0.5 text-sm font-medium text-nova-text-primary">
                MIT
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-nova-bg p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-nova-blue" />
            <p className="text-xs text-nova-text-secondary">
              NovaPM is an open-source, next-generation process manager with AI-powered
              monitoring, intelligent auto-scaling, and a beautiful web dashboard. Built
              with TypeScript and designed for modern application deployment.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
