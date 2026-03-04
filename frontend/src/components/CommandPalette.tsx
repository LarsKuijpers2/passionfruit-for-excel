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
    note?: string;
  }) => void;
}

const destinations: { id: Destination; label: string; color: string }[] = [
  { id: 'company', label: 'Company', color: 'text-blue-400' },
  { id: 'answer_library', label: 'Library', color: 'text-emerald-400' },
  { id: 'product', label: 'Product', color: 'text-orange-400' },
  { id: 'questionnaire', label: 'Questionnaire', color: 'text-purple-400' },
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
  const [note, setNote] = useState('');

  // Store original values for revert
  const [originalLabel, setOriginalLabel] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [originalDestination, setOriginalDestination] = useState('');
  const [originalNote, setOriginalNote] = useState('');

  const isSingleSelect = selectedCount === 1;

  useEffect(() => {
    if (visible) {
      setAction('');
      setRejectReason('');
      if (isSingleSelect && selectedItems.length === 1) {
        const item = selectedItems[0] as IndexedItem;
        setLabel(item.label);
        setValue(item.value || '');
        setDestination(item.destination || '');
        setNote(item.note || '');
        // Store originals for revert
        setOriginalLabel(item.label);
        setOriginalValue(item.value || '');
        setOriginalDestination(item.destination || '');
        setOriginalNote(item.note || '');
      } else {
        setLabel('');
        setValue('');
        setDestination('');
        setNote('');
        setOriginalLabel('');
        setOriginalValue('');
        setOriginalDestination('');
        setOriginalNote('');
      }
    }
  }, [visible, isSingleSelect, selectedItems]);

  const handleRevert = useCallback(() => {
    setLabel(originalLabel);
    setValue(originalValue);
    setDestination(originalDestination);
    setNote(originalNote);
    setAction('');
    setRejectReason('');
  }, [originalLabel, originalValue, originalDestination, originalNote]);

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
    } else {
      // Multi-select: include value if set (Yes/No)
      if (value.trim()) {
        updates.value = value.trim();
      }
    }

    if (destination && destination !== selectedItems[0]?.destination) {
      updates.destination = destination as Destination;
    }

    // Include note if it changed (for single select) or if provided (for multi select)
    const originalNote = (selectedItems[0] as IndexedItem)?.note || '';
    if (note.trim() !== originalNote) {
      updates.note = note.trim();
    }

    onApply(updates);
  }, [action, rejectReason, isSingleSelect, label, value, destination, note, selectedItems, onApply]);

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

      // Number keys 1-5 for destinations (only when not typing)
      if (!isTyping && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (destinations[index]) {
          const destId = destinations[index].id;
          setDestination(destId === destination ? '' : destId);
        }
        return;
      }

      // Y for Yes, N for No (only when not typing)
      if (!isTyping && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        setValue(value === 'Yes' ? '' : 'Yes');
        return;
      }
      if (!isTyping && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setValue(value === 'No' ? '' : 'No');
        return;
      }

      // R for Revert (only when not typing)
      if (!isTyping && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRevert();
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
  }, [visible, onClose, destination, value, handleApply, handleRevert]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70 dark:bg-black/70" onClick={onClose} />

      <div className="relative z-10 bg-card border border-default rounded-lg w-[480px] max-w-[90vw] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center h-12 px-4 border-b border-default shrink-0">
          <span className="text-[13px] font-medium text-primary">
            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <kbd className="bg-app-secondary px-1.5 py-0.5 rounded text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        {/* Content - scrollable */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
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
          {isSingleSelect ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
                  Value
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setValue('Yes')}
                    className={`h-6 px-2.5 rounded text-[11px] font-medium transition-colors ${
                      value === 'Yes'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-app-secondary text-emerald-400 hover:bg-emerald-500/20'
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setValue('No')}
                    className={`h-6 px-2.5 rounded text-[11px] font-medium transition-colors ${
                      value === 'No'
                        ? 'bg-red-500 text-white'
                        : 'bg-app-secondary text-red-400 hover:bg-red-500/20'
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>
              <textarea
                className="w-full px-3 py-2 bg-app border border-default rounded text-[13px] text-primary min-h-[80px] resize-y focus:outline-none focus:border-accent"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Item value"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
                  Set Value
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setValue('Yes')}
                    className={`h-6 px-2 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      value === 'Yes'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-app-secondary text-emerald-400 hover:bg-emerald-500/20'
                    }`}
                  >
                    <kbd className={`text-[9px] px-0.5 rounded ${
                      value === 'Yes' ? 'bg-white/20' : 'bg-app'
                    }`}>Y</kbd>
                    Yes
                  </button>
                  <button
                    onClick={() => setValue('No')}
                    className={`h-6 px-2 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      value === 'No'
                        ? 'bg-red-500 text-white'
                        : 'bg-app-secondary text-red-400 hover:bg-red-500/20'
                    }`}
                  >
                    <kbd className={`text-[9px] px-0.5 rounded ${
                      value === 'No' ? 'bg-white/20' : 'bg-app'
                    }`}>N</kbd>
                    No
                  </button>
                </div>
              </div>
              <input
                type="text"
                className="w-full h-8 px-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter value to apply to all selected items..."
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

          {/* Note */}
          <div>
            <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
              Note
            </label>
            <input
              type="text"
              className="w-full h-8 px-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this item..."
            />
          </div>

          {/* Review Action */}
          <div>
            <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-1.5">
              Review Action
            </label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setAction(action === 'accept' ? '' : 'accept')}
                className={`h-8 px-4 rounded text-[12px] font-medium transition-colors ${
                  action === 'accept'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-app-secondary text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                Accept
              </button>
              <button
                onClick={() => setAction(action === 'reject' ? '' : 'reject')}
                className={`h-8 px-4 rounded text-[12px] font-medium transition-colors ${
                  action === 'reject'
                    ? 'bg-red-500 text-white'
                    : 'bg-app-secondary text-red-400 hover:bg-red-500/20'
                }`}
              >
                Reject
              </button>
              <button
                onClick={() => setAction(action === 'reset' ? '' : 'reset')}
                className={`h-8 px-4 rounded text-[12px] font-medium transition-colors ${
                  action === 'reset'
                    ? 'bg-gray-500 text-white'
                    : 'bg-app-secondary text-muted hover:bg-card-hover'
                }`}
              >
                Reset
              </button>
            </div>
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
        <div className="flex justify-between h-14 px-4 items-center border-t border-default shrink-0">
          <button
            onClick={handleRevert}
            className="h-8 px-4 rounded text-[12px] font-medium bg-app-secondary text-muted hover:bg-card-hover hover:text-primary transition-colors flex items-center gap-1.5"
          >
            <kbd className="text-[10px] px-1 rounded bg-app">R</kbd>
            Revert
          </button>
          <div className="flex gap-2">
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
    </div>
  );
}
