import { useState, useMemo } from 'react';
import type { IndexedItem } from '../types';
import { ItemCard } from './ItemCard';

interface Section {
  name: string;
  items: IndexedItem[];
}

interface IndexedPanelProps {
  visible: boolean;
  sections: Section[];
  selectedItems: Set<string>;
  reviewMode: boolean;
  getReviewStatus: (itemId: string) => 'accepted' | 'rejected' | undefined;
  onItemSelect: (itemId: string, multiSelect: boolean) => void;
  onAccept: (itemId: string) => void;
  onReject: (itemId: string, reason?: string) => void;
}

export function IndexedPanel({
  visible,
  sections,
  selectedItems,
  reviewMode,
  getReviewStatus,
  onItemSelect,
  onAccept,
  onReject,
}: IndexedPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Filter items based on search query
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;

    const query = searchQuery.toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            item.value.toLowerCase().includes(query)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, searchQuery]);

  const toggleSection = (sectionName: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionName)) {
        next.delete(sectionName);
      } else {
        next.add(sectionName);
      }
      return next;
    });
  };

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col border-r border-border overflow-hidden min-w-0">
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
        {filteredSections.length === 0 ? (
          <div className="text-muted-foreground text-center p-10 italic">
            No items found
          </div>
        ) : (
          filteredSections.map((section) => {
            const isCollapsed = collapsedSections.has(section.name);

            return (
              <div key={section.name} className="mb-6">
                <div
                  className="flex justify-between items-center py-2 px-3 bg-muted rounded mb-2 cursor-pointer"
                  onClick={() => toggleSection(section.name)}
                >
                  <span className="font-semibold text-[13px]">{section.name}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-background">
                      {section.items.length}
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
                    {section.items.map((item) => (
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
