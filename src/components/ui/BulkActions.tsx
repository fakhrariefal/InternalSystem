import React, { useEffect, useRef, useState } from 'react';
import { CheckSquare, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './primitives';

interface SelectCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
  className?: string;
}

export const SelectCheckbox: React.FC<SelectCheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className={cn(
        'h-4 w-4 rounded border border-slate-300 bg-white text-[#1B5E99] accent-[#1B5E99] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1B5E99]/40 transition-colors shrink-0',
        className
      )}
    />
  );
};

export interface BulkActionConfig {
  id: string;
  label: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'accent' | 'gold' | 'outline' | 'ghost' | 'destructive';
  disabled?: boolean;
  requiresConfirm?: boolean;
  confirmLabel?: string;
  onClick: () => void | Promise<void>;
}

interface BulkActionBarProps {
  selectedCount: number;
  itemLabel?: string;
  onClear: () => void;
  actions: BulkActionConfig[];
  className?: string;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  itemLabel = 'data',
  onClear,
  actions,
  className,
}) => {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setConfirmingId(null);
  }, [selectedCount]);

  if (selectedCount <= 0) return null;

  const runAction = async (action: BulkActionConfig) => {
    if (action.requiresConfirm && confirmingId !== action.id) {
      setConfirmingId(action.id);
      return;
    }
    setConfirmingId(null);
    setBusyId(action.id);
    try {
      await action.onClick();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="region"
      aria-label={`Aksi massal untuk ${selectedCount} ${itemLabel} terpilih`}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#1B5E99]/25 bg-[#EFF5FB] px-3.5 py-2.5 text-sm shadow-xs',
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#0B1B3A] tabular-nums whitespace-nowrap">
          <CheckSquare className="h-4 w-4 text-[#1B5E99] shrink-0" />
          <span>
            {selectedCount} {itemLabel} dipilih
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setConfirmingId(null);
            onClear();
          }}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white/80 hover:text-[#0B1B3A] transition-colors cursor-pointer whitespace-nowrap"
        >
          <X className="h-3.5 w-3.5" />
          Batal Pilih
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          const isConfirming = confirmingId === action.id;
          const isBusy = busyId === action.id;
          return (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={isConfirming ? 'destructive' : action.variant || 'outline'}
              disabled={action.disabled || isBusy || (busyId !== null && !isBusy)}
              onClick={() => void runAction(action)}
              className="whitespace-nowrap shrink-0"
            >
              {action.icon}
              <span>
                {isBusy
                  ? 'Memproses...'
                  : isConfirming
                    ? action.confirmLabel || `Konfirmasi ${action.label}`
                    : action.label}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
