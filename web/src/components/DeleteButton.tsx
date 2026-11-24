import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { del } from '../lib/api';
import { useApp } from '../lib/app-context';

/**
 * A delete button that asks first, calls DELETE on `url`, refreshes the given lists and says what happened.
 * Server answers `{ removed: 'hidden' }` when the item is kept out of sight because past payments use it.
 */
export function DeleteButton({
  url,
  what,
  confirmText,
  refresh = [],
  onDone,
  label,
  small = true,
  icon = false,
}: {
  url: string;
  /** e.g. `price "Hourly"` */
  what: string;
  confirmText?: string;
  refresh?: string[][];
  onDone?(): void;
  label?: string;
  small?: boolean;
  icon?: boolean;
}) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => del<{ removed?: 'deleted' | 'hidden' }>(url),
    onSuccess: (r) => {
      for (const k of refresh) qc.invalidateQueries({ queryKey: k });
      toast('success', r?.removed === 'hidden' ? `Deleted ${what} — kept hidden because past bills use it` : `Deleted ${what}`);
      onDone?.();
    },
    onError: (e: Error) => toast('error', e.message),
  });
  return (
    <button
      type="button"
      className={`btn ${small ? 'btn-sm' : ''} btn-ghost ${icon ? 'btn-icon' : ''}`}
      style={{ color: 'var(--danger)' }}
      disabled={m.isPending}
      title={`Delete ${what}`}
      aria-label={`Delete ${what}`}
      onClick={(e) => {
        e.stopPropagation();
        if (window.confirm(confirmText ?? `Delete ${what}? This cannot be undone.`)) m.mutate();
      }}
    >
      <Trash2 size={14} />
      {!icon && (label ?? 'Delete')}
    </button>
  );
}
