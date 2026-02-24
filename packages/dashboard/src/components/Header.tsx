'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface HeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function Header({ title, description, actions, className }: HeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div>
        <h1 className="text-xl font-bold text-nova-text-primary md:text-2xl">{title}</h1>
        {description && (
          <p className="mt-0.5 text-xs text-nova-text-secondary md:text-sm">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 sm:gap-3">{actions}</div>}
    </div>
  );
}
