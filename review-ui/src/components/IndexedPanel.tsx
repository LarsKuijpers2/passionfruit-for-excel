import { useState, useMemo } from 'react';
import type { IndexedSection, Destination } from '../types';

interface IndexedPanelProps {
  visible: boolean;
  sections: IndexedSection[];
  selectedItems: Set<string>;
  reviewMode: boolean;
  getReviewStatus: (itemId: string) => 'accepted' | 'rejected' | undefined;
  onItemSelect: (itemId: string, multiSelect: boolean) => void;
  onAccept: (itemId: string) => void;
  onReject: (itemId: string, reason?: string) => void;
  onDestinationChange?: (itemId: string, destination: Destination) => void;
}

// Destination badge colors
const destinationColors: Record<string, string> = {
  company: 'bg-blue-900/50 text-blue-300 border-blue-700',
  answer_library: 'bg-green-900/50 text-green-300 border-green-700',
  product: 'bg-purple-900/50 text-purple-300 border-purple-700',
  exclude: 'bg-gray-900/50 text-gray-400 border-gray-600',
};

export function IndexedPanel({
  visible,
  sections,
  selectedItems,
  reviewMode,
  getReviewStatus,
  onItemSelect,
  onAccept,
  onReject,
  onDestinationChange,
}: IndexedPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [filterNeedsReview, setFilterNeedsReview] = useState(false);

  // Filter sections and items based on search query and needs_review filter
  const filteredSections = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          // Apply needs_review filter
          if (filterNeedsReview && !item.needs_review) return false;
          // Apply search filter
          if (query) {
            return (
              item.label.toLowerCase().includes(query) ||
              (item.value && item.value.toLowerCase().includes(query))
            );
          }
          return true;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, searchQuery, filterNeedsReview]);

  // Count items needing review
  const needsReviewCount = useMemo(() => {
    return sections.reduce(
      (acc, s) => acc + s.items.filter((i) => i.needs_review).length,
      0
    );
  }, [sections]);

  const toggleSection = (index: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Count total items
  const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col border-r border-border overflow-hidden min-w-0">
      {/* Panel header */}
      <div className="bg-card px-4 py-3 border-b border-border flex justify-between items-center">
        <span className="text-[13px] font-semibold">Extraction</span>
        <div className="flex items-center gap-3">
          {needsReviewCount > 0 && (
            <button
              onClick={() => setFilterNeedsReview(!filterNeedsReview)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                filterNeedsReview
                  ? 'bg-amber-900/50 text-amber-300 border-amber-700'
                  : 'bg-transparent text-amber-400 border-amber-700/50 hover:bg-amber-900/30'
              }`}
            >
              {needsReviewCount} needs review
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {sections.length} sections, {totalItems} items
          </span>
        </div>
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

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredSections.length === 0 ? (
          <div className="text-muted-foreground text-center p-10 italic">
            No items found
          </div>
        ) : (
          filteredSections.map((section, sectionIndex) => {
            const isCollapsed = collapsedSections.has(sectionIndex);

            return (
              <div
                key={`${section.title}-${section.sheet}-${section.rows}-${sectionIndex}`}
                className="bg-card border border-border rounded-md mb-3 overflow-hidden"
              >
                {/* Section header */}
                <div
                  className="bg-card px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => toggleSection(sectionIndex)}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[13px]">{section.title}</span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-2">
                      Rows {section.rows}
                      <span className="bg-muted text-foreground px-2 py-0.5 rounded-full text-[10px] font-medium">
                        {section.topic}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {section.items.length} items
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

                {/* Section items */}
                {!isCollapsed && (
                  <div className="border-t border-border p-2">
                    {section.items.map((item, itemIndex) => {
                      // Generate a stable ID
                      const itemId =
                        item.id ||
                        `${section.title}-${sectionIndex}-${itemIndex}-${item.lCell || item.label}`;

                      return (
                        <div
                          key={itemId}
                          className={`bg-background border rounded-md p-3 mb-2 last:mb-0 ${
                            item.needs_review
                              ? 'border-amber-700/50'
                              : 'border-border'
                          }`}
                        >
                          {/* Item header with destination badge */}
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <div className="flex-1 flex items-start gap-2">
                              <span className="text-xs text-muted-foreground flex-1">
                                {item.label}
                              </span>
                              {/* Destination badge */}
                              {item.destination && (
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                                    destinationColors[item.destination] || 'bg-muted text-foreground border-border'
                                  }`}
                                  title={item.tag_source}
                                >
                                  {item.destination === 'answer_library' ? 'library' : item.destination}
                                </span>
                              )}
                              {/* Needs review indicator */}
                              {item.needs_review && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded border bg-amber-900/50 text-amber-300 border-amber-700 whitespace-nowrap">
                                  needs review
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                              {item.lCell && item.vCell
                                ? `${item.lCell} → ${item.vCell}`
                                : item.lCell || item.ref || ''}
                            </span>
                          </div>

                          {/* Item value */}
                          <div
                            className={`text-[13px] bg-muted px-3 py-2 rounded ${
                              !item.value
                                ? 'text-muted-foreground italic'
                                : 'text-foreground'
                            }`}
                          >
                            {item.value || '(empty)'}
                          </div>

                          {/* Destination selector for items needing review */}
                          {item.needs_review && onDestinationChange && (
                            <div className="flex gap-1 mt-2">
                              <span className="text-[10px] text-muted-foreground mr-1 self-center">Set destination:</span>
                              {(['company', 'answer_library', 'product', 'exclude'] as Destination[]).map((dest) => (
                                <button
                                  key={dest}
                                  onClick={() => onDestinationChange(itemId, dest)}
                                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                    item.destination === dest
                                      ? destinationColors[dest]
                                      : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
                                  }`}
                                >
                                  {dest === 'answer_library' ? 'library' : dest}
                                </button>
                              ))}
                            </div>
                          )}

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
