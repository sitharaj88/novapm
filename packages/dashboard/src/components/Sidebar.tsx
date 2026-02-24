'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  LayoutDashboard,
  Server,
  ScrollText,
  BarChart3,
  Globe,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/processes', label: 'Processes', icon: Server },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/servers', label: 'Servers', icon: Globe },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-nova-border bg-nova-card transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-nova-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nova-purple">
          <Zap className="h-4 w-4 text-white" />
        </div>
        {!sidebarCollapsed && (
          <span className="text-lg font-bold text-nova-text-primary">
            NovaPM
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-nova-purple/10 text-nova-purple'
                  : 'text-nova-text-secondary hover:bg-nova-elevated hover:text-nova-text-primary'
              )}
            >
              <item.icon className={cn('h-5 w-5 shrink-0')} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-nova-border p-3">
        <button
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center rounded-lg p-2 text-nova-text-secondary transition-colors hover:bg-nova-elevated hover:text-nova-text-primary"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>
    </aside>
  );
}
