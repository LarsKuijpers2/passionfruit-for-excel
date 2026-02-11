import { useState, useMemo } from 'react';
import type { LibraryItem } from '../types';

interface LibraryPanelProps {
  visible: boolean;
  items: LibraryItem[];
  selectedItems: Set<string>;
  reviewMode: boolean;
  getReviewStatus: (itemId: string) => 'accepted' | 'rejected' | undefined;
  onItemSelect: (itemId: string, multiSelect: boolean) => void;
  onAccept: (itemId: string) => void;
  onReject: (itemId: string, reason?: string) => void;
}

export function LibraryPanel({
  visible,
  items,
  selectedItems,
  reviewMode,
  getReviewStatus,
  onItemSelect,
  onAccept,
  onReject,
}: LibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Destination display info
  const destInfo: Record<string, { label: string; color: string }> = {
    company: { label: 'Company', color: '#3b82f6' },
    answer_library: { label: 'Answer Library', color: '#22c55e' },
    product: { label: 'Product', color: '#f97316' },
    exclude: { label: 'Excluded', color: '#6b7280' },
  };

  // Group items by destination
  const groupedItems = useMemo(() => {
    // Ensure items is an array
    const itemsArray = Array.isArray(items) ? items : [];

    const query = searchQuery.toLowerCase();
    const filtered = searchQuery.trim()
      ? itemsArray.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            (item.value && item.value.toLowerCase().includes(query))
        )
      : itemsArray;

    // Group by destination
    const groups: Record<string, LibraryItem[]> = {};
    filtered.forEach((item) => {
      const destination = item.destination || 'answer_library';
      if (!groups[destination]) {
        groups[destination] = [];
      }
      groups[destination].push(item);
    });

    // Sort: company first, then answer_library, then product, then exclude
    const order = ['company', 'answer_library', 'product', 'exclude'];
    return Object.entries(groups).sort(([a], [b]) => {
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
  }, [items, searchQuery]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  // Count total items
  const totalItems = Array.isArray(items) ? items.length : 0;

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Panel header */}
      <div className="bg-card px-4 py-3 border-b border-border flex justify-between items-center">
        <span className="text-[13px] font-semibold">Save as</span>
        <span className="text-xs text-muted-foreground">{totalItems} items</span>
      </div>

      {/* Search */}
      <div className="py-2 px-4">
        <input
          type="text"
          className="w-full py-1.5 px-0 bg-transparent border-0 border-b border-white/15 rounded-none text-foreground text-xs focus:outline-none focus:border-white/30 placeholder:text-white/40"
          placeholder="Search label or value..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Topics */}
      <div className="flex-1 overflow-y-auto p-4">
        {groupedItems.length === 0 ? (
          <div className="text-muted-foreground text-center p-10 italic">
            No library items
          </div>
        ) : (
          groupedItems.map(([destination, destItems]) => {
            const isCollapsed = collapsedGroups.has(destination);
            const info = destInfo[destination] || { label: destination, color: '#6b7280' };

            return (
              <div key={destination} className="mb-5">
                {/* Destination header */}
                <div
                  className="text-xs font-semibold uppercase tracking-wide mb-2 pb-2 border-b border-border flex justify-between items-center cursor-pointer"
                  style={{ color: info.color }}
                  onClick={() => toggleGroup(destination)}
                >
                  <span>{info.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="bg-muted text-foreground px-2 py-0.5 rounded-full text-[10px] font-medium normal-case">
                      {destItems.length}
                    </span>
                    <button
                      className={`text-muted-foreground transition-transform duration-150 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    >
                      ▼
                    </button>
                  </div>
                </div>

                {/* Destination items */}
                {!isCollapsed && (
                  <div className="flex flex-col">
                    {destItems.map((item, itemIndex) => {
                      // Generate a stable ID
                      const itemId = item.id || `${destination}-${itemIndex}-${item.label}`;

                      return (
                        <div
                          key={itemId}
                          className="bg-background border border-border border-l-[3px] rounded-md p-3 mb-2"
                          style={{ borderLeftColor: info.color }}
                        >
                          {/* Item header */}
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <span className="text-xs text-muted-foreground flex-1" title={item.label}>
                              {item.label}
                            </span>
                            <div className="flex items-center gap-2">
                              {item.topic && (
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded uppercase">
                                  {item.topic}
                                </span>
                              )}
                              {item.source && (
                                <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                                  {item.source.sheet}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Item value */}
                          <div
                            className={`text-[13px] bg-muted px-3 py-2 rounded ${
                              !item.value
                                ? 'text-muted-foreground italic'
                                : 'text-foreground'
                            }`}
                            title={item.value || ''}
                          >
                            {item.value || '(empty)'}
                          </div>

                          {/* Review actions (when in review mode) */}
                          {reviewMode && (
                            <div className="flex gap-1 mt-2">
                              <button
                                onClick={() => onAccept(itemId)}
                                className={`px-2 py-1 border border-border rounded text-xs cursor-pointer transition-colors ${
                                  getReviewStatus(itemId) === 'accepted'
                                    ? 'bg-green-900 text-green-400 border-green-700'
                                    : 'bg-background text-muted-foreground hover:bg-green-900/50 hover:text-green-400 hover:border-green-700'
                                }`}
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => onReject(itemId)}
                                className={`px-2 py-1 border border-border rounded text-xs cursor-pointer transition-colors ${
                                  getReviewStatus(itemId) === 'rejected'
                                    ? 'bg-red-900 text-red-400 border-red-700'
                                    : 'bg-background text-muted-foreground hover:bg-red-900/50 hover:text-red-400 hover:border-red-700'
                                }`}
                              >
                                ✗
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
