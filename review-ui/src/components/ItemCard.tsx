import { useState } from 'react';
import type { IndexedItem, LibraryItem } from '../types';

interface ItemCardProps {
  item: IndexedItem | LibraryItem;
  selected: boolean;
  reviewMode: boolean;
  reviewStatus?: 'accepted' | 'rejected';
  onSelect: (multiSelect: boolean) => void;
  onAccept: () => void;
  onReject: (reason?: string) => void;
}

export function ItemCard({
  item,
  selected,
  reviewMode,
  reviewStatus,
  onSelect,
  onAccept,
  onReject,
}: ItemCardProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const hasValue = item.value && item.value.trim() !== '';

  const handleClick = (e: React.MouseEvent) => {
    onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
  };

  const handleAcceptClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAccept();
  };

  const handleRejectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reviewMode) {
      setShowRejectInput(true);
    } else {
      onReject();
    }
  };

  const handleRejectSubmit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReject(rejectReason || undefined);
    setShowRejectInput(false);
    setRejectReason('');
  };

  const handleRejectCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRejectInput(false);
    setRejectReason('');
  };

  // Check if item is IndexedItem (has 'section' property)
  const indexedItem = 'section' in item ? (item as IndexedItem) : null;
  const libraryItem = 'dataSource' in item ? (item as LibraryItem) : null;

  return (
    <div
      className={`py-2 px-3 bg-transparent border-b border-border cursor-pointer transition-colors duration-100 hover:bg-muted ${
        selected ? 'bg-white/5 border-l-2 border-l-muted-foreground pl-2.5' : ''
      } ${!hasValue ? 'opacity-50' : ''} ${
        reviewStatus === 'accepted' ? 'border-l-[3px] border-l-green-500 pl-2 bg-green-500/5' : ''
      } ${
        reviewStatus === 'rejected' ? 'border-l-[3px] border-l-red-500 pl-2 bg-red-500/5' : ''
      }`}
      onClick={handleClick}
    >
      <div className="text-xs text-muted-foreground mb-1">
        {item.label}
        {indexedItem?.level && (
          <span
            className={`inline-block text-[9px] px-1.5 py-px rounded ml-1.5 font-medium uppercase tracking-wide opacity-80 align-middle ${
              indexedItem.level === 'entity'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-purple-500/20 text-purple-400'
            }`}
          >
            {indexedItem.level}
          </span>
        )}
        {item.topic && (
          <span className="inline-block text-[9px] px-1.5 py-px rounded ml-1.5 font-medium uppercase tracking-wide bg-muted text-muted-foreground align-middle">
            {item.topic}
          </span>
        )}
        {libraryItem?.dataSource && (
          <span className="inline-block text-[9px] px-1.5 py-px rounded ml-1.5 font-medium uppercase tracking-wide bg-green-500/20 text-green-400 opacity-80 align-middle">
            {libraryItem.dataSource}
          </span>
        )}
      </div>
      <div
        className={`text-[13px] text-foreground bg-muted py-2 px-3 rounded ${
          !hasValue ? 'text-muted-foreground italic' : ''
        }`}
      >
        {hasValue ? item.value : '(no value)'}
      </div>
      {indexedItem?.ref && (
        <div className="text-[10px] text-muted-foreground mt-2 font-mono">
          {indexedItem.ref.sheet}:{indexedItem.ref.row}:{indexedItem.ref.col}
        </div>
      )}

      {reviewMode && (
        <div className="flex gap-1 mt-2">
          <button
            className={`px-2 py-1 border border-border rounded text-xs cursor-pointer transition-all duration-150 bg-background text-muted-foreground hover:bg-muted hover:text-foreground ${
              reviewStatus === 'accepted'
                ? 'bg-green-900 text-green-400 border-green-800'
                : 'hover:bg-green-900 hover:text-green-400 hover:border-green-800'
            }`}
            onClick={handleAcceptClick}
            title="Accept this extraction"
          >
            &#10003; Accept
          </button>
          <button
            className={`px-2 py-1 border border-border rounded text-xs cursor-pointer transition-all duration-150 bg-background text-muted-foreground hover:bg-muted hover:text-foreground ${
              reviewStatus === 'rejected'
                ? 'bg-red-900 text-red-400 border-red-800'
                : 'hover:bg-red-900 hover:text-red-400 hover:border-red-800'
            }`}
            onClick={handleRejectClick}
            title="Reject this extraction"
          >
            &#10007; Reject
          </button>
        </div>
      )}

      {showRejectInput && (
        <div className="mt-2">
          <input
            type="text"
            className="w-full px-2.5 py-1.5 bg-background border border-border rounded text-foreground text-xs"
            placeholder="Optional rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onReject(rejectReason || undefined);
                setShowRejectInput(false);
                setRejectReason('');
              } else if (e.key === 'Escape') {
                setShowRejectInput(false);
                setRejectReason('');
              }
            }}
            autoFocus
          />
          <div className="flex gap-1 mt-1">
            <button
              className="px-2 py-1 border border-border rounded text-[11px] cursor-pointer bg-background text-muted-foreground"
              onClick={handleRejectCancel}
            >
              Cancel
            </button>
            <button
              className="px-2 py-1 border border-red-800 rounded text-[11px] cursor-pointer bg-red-900 text-red-400"
              onClick={handleRejectSubmit}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
