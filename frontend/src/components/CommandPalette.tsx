import { useState, useEffect, useCallback } from 'react';
import type { IndexedItem, LibraryItem, Destination } from '../types';

interface CommandPaletteProps {
  visible: boolean;
  selectedCount: number;
  selectedItems: (IndexedItem | LibraryItem)[];
  onClose: () => void;
  onApply: (updates: {
    action?: 'accept' | 'reject' | 'reset';
    reason?: string;
    label?: string;
    value?: string;
    destination?: Destination;
  }) => void;
}

const destinations: { id: Destination; label: string; color: string }[] = [
  { id: 'company', label: 'Company', color: 'text-blue-400' },
  { id: 'answer_library', label: 'Library', color: 'text-emerald-400' },
  { id: 'product', label: 'Product', color: 'text-orange-400' },
  { id: 'exclude', label: 'Exclude', color: 'text-muted' },
];

export function CommandPalette({
  visible,
  selectedCount,
  selectedItems,
  onClose,
  onApply,
}: CommandPaletteProps) {
  const [action, setAction] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [destination, setDestination] = useState<string>('');

  const isSingleSelect = selectedCount === 1;

  useEffect(() => {
    if (visible) {
      setAction('');
      setRejectReason('');
      setDestination('');
      if (isSingleSelect && selectedItems.length === 1) {
        setLabel(selectedItems[0].label);
        setValue(selectedItems[0].value || '');
        setDestination(selectedItems[0].destination || '');
      } else {
        setLabel('');
        setValue('');
      }
    }
  }, [visible, isSingleSelect, selectedItems]);

  const handleApply = useCallback(() => {
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

    if (destination && destination !== selectedItems[0]?.destination) {
      updates.destination = destination as Destination;
    }

    onApply(updates);
  }, [action, rejectReason, isSingleSelect, label, value, destination, selectedItems, onApply]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;

      // Don't capture keys when typing in input/textarea
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Number keys 1-4 for destinations (only when not typing)
      if (!isTyping && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (destinations[index]) {
          const destId = destinations[index].id;
          setDestination(destId === destination ? '' : destId);
        }
        return;
      }

      // Enter to apply (only when not in textarea)
      if (e.key === 'Enter' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleApply();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose, destination, handleApply]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70 dark:bg-black/70" onClick={onClose} />

      <div className="relative z-10 bg-card border border-default rounded-lg w-[480px] max-w-[90vw] shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center h-12 px-4 border-b border-default">
          <span className="text-[13px] font-medium text-primary">
            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <kbd className="bg-app-secondary px-1.5 py-0.5 rounded text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Label */}
          {isSingleSelect && (
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
                Label
              </label>
              <input
                type="text"
                className="w-full h-8 px-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Item label"
              />
            </div>
          )}

          {/* Value */}
          {isSingleSelect && (
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
                Value
              </label>
              <textarea
                className="w-full px-3 py-2 bg-app border border-default rounded text-[13px] text-primary min-h-[80px] resize-y focus:outline-none focus:border-accent"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Item value"
              />
            </div>
          )}

          {/* Destination */}
          <div>
            <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
              Destination
            </label>
            <div className="flex gap-1.5">
              {destinations.map((dest, index) => (
                <button
                  key={dest.id}
                  onClick={() => setDestination(dest.id === destination ? '' : dest.id)}
                  className={`h-8 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
                    destination === dest.id
                      ? 'bg-accent text-white'
                      : `bg-app-secondary hover:bg-card-hover ${dest.color}`
                  }`}
                >
                  <kbd className={`text-[10px] px-1 rounded ${
                    destination === dest.id
                      ? 'bg-white/20'
                      : 'bg-app'
                  }`}>{index + 1}</kbd>
                  {dest.label}
                </button>
              ))}
            </div>
          </div>

          {/* Review Action */}
          <div>
            <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
              Review Action
            </label>
            <select
              className="w-full h-8 px-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">— No action —</option>
              <option value="accept">Accept</option>
              <option value="reject">Reject</option>
              <option value="reset">Reset</option>
            </select>
          </div>

          {/* Reject Reason */}
          {action === 'reject' && (
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
                Reject Reason
              </label>
              <input
                type="text"
                className="w-full h-8 px-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Optional reason"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 h-14 px-4 items-center border-t border-default">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded text-[12px] font-medium bg-app-secondary text-primary hover:bg-card-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="h-8 px-4 rounded text-[12px] font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
