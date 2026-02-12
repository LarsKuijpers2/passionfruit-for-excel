import { useState, useEffect } from 'react';
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
  { id: 'exclude', label: 'Exclude', color: 'text-neutral-500' },
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

    if (destination && destination !== selectedItems[0]?.destination) {
      updates.destination = destination as Destination;
    }

    onApply(updates);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />

      <div className="relative z-10 bg-neutral-900 border border-neutral-700 rounded-lg w-[480px] max-w-[90vw] shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center h-12 px-4 border-b border-neutral-800">
          <span className="text-[13px] font-medium text-neutral-200">
            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-[10px] text-neutral-500">
            Esc
          </kbd>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Label */}
          {isSingleSelect && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                Label
              </label>
              <input
                type="text"
                className="w-full h-8 px-3 bg-neutral-950 border border-neutral-800 rounded text-[13px] text-neutral-200 focus:outline-none focus:border-neutral-700"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Item label"
              />
            </div>
          )}

          {/* Value */}
          {isSingleSelect && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                Value
              </label>
              <textarea
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded text-[13px] text-neutral-200 min-h-[80px] resize-y focus:outline-none focus:border-neutral-700"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Item value"
              />
            </div>
          )}

          {/* Destination */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
              Destination
            </label>
            <div className="flex gap-1.5">
              {destinations.map((dest) => (
                <button
                  key={dest.id}
                  onClick={() => setDestination(dest.id === destination ? '' : dest.id)}
                  className={`h-8 px-3 rounded text-[12px] font-medium transition-colors ${
                    destination === dest.id
                      ? 'bg-blue-500 text-white'
                      : `bg-neutral-800 hover:bg-neutral-700 ${dest.color}`
                  }`}
                >
                  {dest.label}
                </button>
              ))}
            </div>
          </div>

          {/* Review Action */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
              Review Action
            </label>
            <select
              className="w-full h-8 px-3 bg-neutral-950 border border-neutral-800 rounded text-[13px] text-neutral-200 focus:outline-none focus:border-neutral-700"
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
              <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                Reject Reason
              </label>
              <input
                type="text"
                className="w-full h-8 px-3 bg-neutral-950 border border-neutral-800 rounded text-[13px] text-neutral-200 focus:outline-none focus:border-neutral-700"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Optional reason"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 h-14 px-4 items-center border-t border-neutral-800">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded text-[12px] font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="h-8 px-4 rounded text-[12px] font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
