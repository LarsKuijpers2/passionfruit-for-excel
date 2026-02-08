import { useState, useEffect } from 'react';
import type { IndexedItem, LibraryItem } from '../types';

interface CommandPaletteProps {
  visible: boolean;
  selectedCount: number;
  selectedItems: (IndexedItem | LibraryItem)[];
  panel: 'indexed' | 'library' | null;
  onClose: () => void;
  onApply: (updates: {
    action?: 'accept' | 'reject' | 'reset';
    reason?: string;
    label?: string;
    value?: string;
    section?: string;
    topic?: string;
    dataSource?: string;
  }) => void;
}

export function CommandPalette({
  visible,
  selectedCount,
  selectedItems,
  panel: _panel,
  onClose,
  onApply,
}: CommandPaletteProps) {
  const [action, setAction] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  const isSingleSelect = selectedCount === 1;

  // Reset form when opening
  useEffect(() => {
    if (visible) {
      setAction('');
      setRejectReason('');
      if (isSingleSelect && selectedItems.length === 1) {
        setLabel(selectedItems[0].label);
        setValue(selectedItems[0].value);
      } else {
        setLabel('');
        setValue('');
      }
    }
  }, [visible, isSingleSelect, selectedItems]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && visible) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  const handleApply = () => {
    const updates: Parameters<typeof onApply>[0] = {};

    if (action === 'accept') {
      updates.action = 'accept';
    } else if (action === 'reject') {
      updates.action = 'reject';
      if (rejectReason.trim()) {
        updates.reason = rejectReason.trim();
      }
    } else if (action === 'reset') {
      updates.action = 'reset';
    }

    if (isSingleSelect) {
      if (label.trim() && label !== selectedItems[0]?.label) {
        updates.label = label.trim();
      }
      if (value.trim() && value !== selectedItems[0]?.value) {
        updates.value = value.trim();
      }
    }

    onApply(updates);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded w-[400px] max-w-[90vw] shadow-2xl">
        <div className="flex justify-between items-center py-3 px-4 border-b border-border">
          <span className="font-medium text-foreground">
            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <kbd className="bg-muted px-1.5 py-0.5 rounded text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {isSingleSelect && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Label
                </label>
                <input
                  type="text"
                  className="bg-muted border border-border rounded py-2 px-3 text-foreground text-[13px] focus:outline-none focus:border-muted-foreground"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Item label"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Value
                </label>
                <textarea
                  className="bg-muted border border-border rounded py-2 px-3 text-foreground text-[13px] min-h-[60px] resize-y focus:outline-none focus:border-muted-foreground"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Item value"
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Review Action
            </label>
            <select
              className="bg-muted border border-border rounded py-2 px-3 text-foreground text-[13px] focus:outline-none focus:border-muted-foreground"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">— No action —</option>
              <option value="accept">Accept</option>
              <option value="reject">Reject</option>
              <option value="reset">Reset (clear review)</option>
            </select>
          </div>

          {action === 'reject' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Reject Reason
              </label>
              <input
                type="text"
                className="bg-muted border border-border rounded py-2 px-3 text-foreground text-[13px] focus:outline-none focus:border-muted-foreground"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Optional reason for rejection"
              />
            </div>
          )}

          {selectedCount > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Merge Values
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                <input type="checkbox" className="w-4 h-4 cursor-pointer" disabled />
                <span className="opacity-50">
                  Combine values from selected items (coming soon)
                </span>
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 py-3 px-4 border-t border-border">
          <button
            className="py-2 px-4 rounded text-[13px] cursor-pointer border border-border bg-muted text-foreground hover:bg-border"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="py-2 px-4 rounded text-[13px] cursor-pointer border border-foreground bg-foreground text-background hover:bg-muted-foreground hover:border-muted-foreground"
            onClick={handleApply}
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
