import { create } from 'zustand';
import type { ProcessInfo, SystemMetrics } from './api';

function loadSetting<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(`novapm:${key}`);
    return stored !== null ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`novapm:${key}`, JSON.stringify(value));
  } catch {
    // localStorage unavailable
  }
}

interface AppState {
  // Processes
  processes: ProcessInfo[];
  setProcesses: (processes: ProcessInfo[]) => void;

  // System metrics
  systemMetrics: SystemMetrics | null;
  setSystemMetrics: (metrics: SystemMetrics) => void;

  // Selected process
  selectedProcessId: string | null;
  setSelectedProcessId: (id: string | null) => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Settings (persisted)
  refreshInterval: number;
  setRefreshInterval: (interval: number) => void;
  logViewerLines: number;
  setLogViewerLines: (lines: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Processes
  processes: [],
  setProcesses: (processes) => set({ processes }),

  // System metrics
  systemMetrics: null,
  setSystemMetrics: (systemMetrics) => set({ systemMetrics }),

  // Selected process
  selectedProcessId: null,
  setSelectedProcessId: (selectedProcessId) => set({ selectedProcessId }),

  // Theme
  theme: loadSetting<'dark' | 'light'>('theme', 'dark'),
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      saveSetting('theme', next);
      return { theme: next };
    }),

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  // Settings
  refreshInterval: loadSetting<number>('refreshInterval', 10),
  setRefreshInterval: (refreshInterval) => {
    saveSetting('refreshInterval', refreshInterval);
    set({ refreshInterval });
  },
  logViewerLines: loadSetting<number>('logViewerLines', 200),
  setLogViewerLines: (logViewerLines) => {
    saveSetting('logViewerLines', logViewerLines);
    set({ logViewerLines });
  },
}));
