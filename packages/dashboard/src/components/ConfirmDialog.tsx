'use client';

import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl border border-nova-border bg-nova-card p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nova-red/10">
            <AlertTriangle className="h-5 w-5 text-nova-red" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-nova-text-primary">
              {title}
            </h3>
            <p className="mt-1 text-sm text-nova-text-secondary">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="shrink-0 rounded-lg p-1 text-nova-text-muted hover:bg-nova-elevated hover:text-nova-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-nova-border px-4 py-2 text-sm font-medium text-nova-text-secondary transition-colors hover:bg-nova-elevated"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onCancel();
            }}
            className="rounded-xl bg-nova-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nova-red/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
