import { useState, useMemo } from 'react';
import type { LibraryItem } from '../types';
import { ItemCard } from './ItemCard';

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

  // Group items by topic
  const groupedItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = searchQuery.trim()
      ? items.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            item.value.toLowerCase().includes(query)
        )
      : items;

    // Group by topic
    const groups: Record<string, LibraryItem[]> = {};
    filtered.forEach((item) => {
      const topic = item.topic || 'Uncategorized';
      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(item);
    });

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [items, searchQuery]);

  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set());

  const toggleTopic = (topic: string) => {
    setCollapsedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div className="py-2 px-4">
        <input
          type="text"
          className="w-full py-1.5 px-0 bg-transparent border-0 border-b border-white/15 rounded-none text-foreground text-xs focus:outline-none focus:border-white/30 placeholder:text-white/40"
          placeholder="Search label or value..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {groupedItems.length === 0 ? (
          <div className="text-muted-foreground text-center p-10 italic">
            No library items
          </div>
        ) : (
          groupedItems.map(([topic, topicItems]) => {
            const isCollapsed = collapsedTopics.has(topic);

            return (
              <div key={topic} className="mb-6">
                <div
                  className="flex justify-between items-center py-2 px-3 bg-muted rounded mb-2 cursor-pointer"
                  onClick={() => toggleTopic(topic)}
                >
                  <span className="font-semibold text-[13px]">{topic}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-background">
                      {topicItems.length}
                    </span>
                    <button
                      className={`px-2 py-1 border border-border rounded text-[10px] cursor-pointer bg-background text-muted-foreground transition-transform duration-150 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    >
                      &#9660;
                    </button>
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="flex flex-col pl-3">
                    {topicItems.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        selected={selectedItems.has(item.id)}
                        reviewMode={reviewMode}
                        reviewStatus={getReviewStatus(item.id)}
                        onSelect={(multi) => onItemSelect(item.id, multi)}
                        onAccept={() => onAccept(item.id)}
                        onReject={(reason) => onReject(item.id, reason)}
                      />
                    ))}
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
