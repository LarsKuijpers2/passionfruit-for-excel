import { useState, useMemo, forwardRef, useImperativeHandle, useRef, useCallback } from "react";
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import type { IndexedSection } from "../types";

interface IndexedPanelProps {
  visible: boolean;
  sections: IndexedSection[];
  selectedItems: Set<string>;
  lastSelectedId: string | null;
  reviewMode: boolean;
  getReviewStatus: (itemId: string) => "accepted" | "rejected" | undefined;
  onItemSelect: (itemId: string, multiSelect: boolean, shiftSelect: boolean) => void;
  onSelectGroup: (itemIds: string[]) => void;
  onRangeSelect: (fromId: string, toId: string, allIds: string[]) => void;
  onAccept: (itemId: string) => void;
  onReject: (itemId: string, reason?: string) => void;
  onCellRefClick?: (cellRef: string) => void;
}

export interface IndexedPanelHandle {
  scrollToItem: (itemId: string) => void;
  getAllItemIds: () => string[];
  toggleAllGroups: () => void;
}

// Linear-style destination colors (subtle)
const destinationConfig: Record<string, { label: string; color: string }> = {
  company: { label: "Company", color: "text-blue-400" },
  answer_library: { label: "Library", color: "text-emerald-400" },
  product: { label: "Product", color: "text-orange-400" },
  questionnaire: { label: "Questionnaire", color: "text-purple-400" },
  exclude: { label: "Exclude", color: "text-muted" },
};

export const IndexedPanel = forwardRef<IndexedPanelHandle, IndexedPanelProps>(function IndexedPanel(
  {
    visible,
    sections,
    selectedItems,
    lastSelectedId,
    reviewMode,
    getReviewStatus,
    onItemSelect,
    onSelectGroup,
    onRangeSelect,
    onAccept: _onAccept,
    onReject: _onReject,
    onCellRefClick,
  },
  ref
) {
  void _onAccept;
  void _onReject;
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [filterNeedsReview, setFilterNeedsReview] = useState(false);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const allItemIds = useMemo(() => {
    const ids: string[] = [];
    sections.forEach((section, sectionIndex) => {
      section.items.forEach((item, itemIndex) => {
        const itemId = item.id || `${section.title}-${sectionIndex}-${itemIndex}-${item.lCell || item.label}`;
        ids.push(itemId);
      });
    });
    return ids;
  }, [sections]);

  const toggleAllSectionsRef = useRef<() => void>(() => {});

  useImperativeHandle(ref, () => ({
    scrollToItem: (itemId: string) => {
      const element = itemRefs.current.get(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("bg-accent/10");
        setTimeout(() => element.classList.remove("bg-accent/10"), 2000);
      }
    },
    getAllItemIds: () => allItemIds,
    toggleAllGroups: () => toggleAllSectionsRef.current(),
  }));

  const filteredSections = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return sections
      .map((section, sectionIndex) => ({
        ...section,
        sectionIndex,
        items: section.items
          .map((item, itemIndex) => ({
            ...item,
            itemId: item.id || `${section.title}-${sectionIndex}-${itemIndex}-${item.lCell || item.label}`,
          }))
          .filter((item) => {
            if (filterNeedsReview && !item.needs_review) return false;
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

  const toggleAllSections = useCallback(() => {
    const allIndices = sections.map((_, i) => i);
    setCollapsedSections(prev => {
      const allCollapsed = allIndices.every(i => prev.has(i));
      if (allCollapsed) {
        return new Set();
      } else {
        return new Set(allIndices);
      }
    });
  }, [sections]);

  // Keep ref updated for imperative handle
  toggleAllSectionsRef.current = toggleAllSections;

  const allSectionsCollapsed = sections.length > 0 && sections.every((_, i) => collapsedSections.has(i));

  const handleItemClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (e.shiftKey && lastSelectedId) {
      onRangeSelect(lastSelectedId, itemId, allItemIds);
    } else {
      onItemSelect(itemId, e.metaKey || e.ctrlKey, e.shiftKey);
    }
  };

  const handleGroupCheckboxClick = (e: React.MouseEvent, itemIds: string[]) => {
    e.stopPropagation();
    onSelectGroup(itemIds);
  };

  const isGroupFullySelected = (itemIds: string[]) => {
    return itemIds.length > 0 && itemIds.every(id => selectedItems.has(id));
  };

  const isGroupPartiallySelected = (itemIds: string[]) => {
    const selected = itemIds.filter(id => selectedItems.has(id));
    return selected.length > 0 && selected.length < itemIds.length;
  };

  const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col border-r border-default overflow-hidden min-w-0 bg-app">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-primary">Extraction</span>
          <button
            onClick={toggleAllSections}
            className="p-1 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
            title={allSectionsCollapsed ? "Expand all" : "Collapse all"}
          >
            {allSectionsCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {needsReviewCount > 0 && (
            <button
              onClick={() => setFilterNeedsReview(!filterNeedsReview)}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                filterNeedsReview
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-amber-500 hover:bg-amber-500/10"
              }`}
            >
              {needsReviewCount} needs review
            </button>
          )}
          <span className="text-[11px] text-muted">
            {totalItems}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-default">
        <input
          type="text"
          className="w-full h-7 px-2.5 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent placeholder:text-muted"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredSections.length === 0 ? (
          <div className="text-muted text-center py-12 text-[13px]">
            No items found
          </div>
        ) : (
          <div>
            {filteredSections.map((section) => {
              const isCollapsed = collapsedSections.has(section.sectionIndex);
              const sectionItemIds = section.items.map(i => i.itemId);
              const allSelected = isGroupFullySelected(sectionItemIds);
              const partiallySelected = isGroupPartiallySelected(sectionItemIds);

              return (
                <div key={`${section.title}-${section.sheet}-${section.rows}-${section.sectionIndex}`}>
                  {/* Section header */}
                  <div className="h-8 px-3 flex items-center gap-2 bg-app-secondary/80 backdrop-blur-md border-b border-subtle sticky top-0 z-10">
                    {/* Checkbox */}
                    <div
                      onClick={(e) => handleGroupCheckboxClick(e, sectionItemIds)}
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center cursor-pointer transition-colors ${
                        allSelected
                          ? "bg-accent border-accent"
                          : partiallySelected
                            ? "bg-accent/30 border-accent/50"
                            : "border-default hover:border-muted"
                      }`}
                    >
                      {allSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {partiallySelected && !allSelected && (
                        <div className="w-1.5 h-0.5 bg-accent rounded-full" />
                      )}
                    </div>

                    <div
                      className="flex-1 flex items-center gap-2 cursor-pointer min-w-0"
                      onClick={() => toggleSection(section.sectionIndex)}
                    >
                      <span className={`text-muted text-[10px] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                        ▼
                      </span>
                      <span className="text-[12px] font-medium text-primary truncate">
                        {section.title}
                      </span>
                      <span className="text-[10px] text-muted uppercase tracking-wide">
                        {section.topic}
                      </span>
                      <span className="text-[11px] text-muted ml-auto">
                        {section.items.length}
                      </span>
                    </div>
                  </div>

                  {/* Items */}
                  {!isCollapsed && (
                    <div>
                      {section.items.map((item) => {
                        const isSelected = selectedItems.has(item.itemId);
                        const reviewStatus = getReviewStatus(item.itemId);
                        const destination = item.destination || "answer_library";
                        const destConfig = destinationConfig[destination] || destinationConfig.answer_library;

                        return (
                          <div
                            key={item.itemId}
                            ref={(el) => { if (el) itemRefs.current.set(item.itemId, el); }}
                            onClick={(e) => handleItemClick(e, item.itemId)}
                            className={`group flex items-start gap-2 py-1.5 px-3 border-b border-subtle cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-selected"
                                : "hover:bg-[var(--color-card-hover)]"
                            } ${item.needs_review ? "border-l-2 border-l-amber-500/60" : ""}`}
                          >
                            {/* Checkbox */}
                            <div className="pt-0.5">
                              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? "bg-accent border-accent"
                                  : "border-default group-hover:border-muted"
                              }`}>
                                {isSelected && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-muted truncate">
                                  {item.label}
                                </span>
                              </div>
                              <div className={`text-[13px] truncate ${
                                item.value
                                  ? "text-primary"
                                  : "text-muted italic"
                              }`}>
                                {item.value || "(empty)"}
                              </div>
                            </div>

                            {/* Right side metadata */}
                            <div className="flex flex-col items-end gap-0.5 pt-0.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] text-muted font-mono ${item.lCell && onCellRefClick ? "hover:text-accent cursor-pointer" : ""}`}
                                  onClick={(e) => {
                                    if (item.lCell && onCellRefClick) {
                                      e.stopPropagation();
                                      onCellRefClick(item.lCell);
                                    }
                                  }}
                                >
                                  {item.lCell || ""}
                                </span>
                                <span className={`text-[10px] ${destConfig.color}`}>
                                  {destConfig.label}
                                </span>
                                {reviewMode && reviewStatus && (
                                  <span className={`text-[11px] ${
                                    reviewStatus === "accepted"
                                      ? "text-emerald-500"
                                      : "text-red-500"
                                  }`}>
                                    {reviewStatus === "accepted" ? "✓" : "✗"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
