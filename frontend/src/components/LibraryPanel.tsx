import { useState, useMemo, forwardRef, useImperativeHandle, useRef } from "react";
import type { LibraryItem } from "../types";

interface LibraryPanelProps {
  visible: boolean;
  items: LibraryItem[];
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

export interface LibraryPanelHandle {
  scrollToItem: (itemId: string) => void;
  getAllItemIds: () => string[];
}

// Linear-style destination colors (subtle)
const destinationConfig: Record<string, { label: string; color: string }> = {
  company: { label: "Company", color: "text-blue-400" },
  answer_library: { label: "Library", color: "text-emerald-400" },
  product: { label: "Product", color: "text-orange-400" },
  exclude: { label: "Exclude", color: "text-muted" },
};

export const LibraryPanel = forwardRef<LibraryPanelHandle, LibraryPanelProps>(function LibraryPanel(
  {
    visible,
    items,
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const allItemIds = useMemo(() => {
    const itemsArray = Array.isArray(items) ? items : [];
    return itemsArray.map((item, index) => {
      const destination = item.destination || "answer_library";
      return item.id || `${destination}-${index}-${item.label}`;
    });
  }, [items]);

  useImperativeHandle(ref, () => ({
    scrollToItem: (itemId: string) => {
      const element = itemRefs.current.get(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("bg-blue-500/10");
        setTimeout(() => element.classList.remove("bg-blue-500/10"), 2000);
      }
    },
    getAllItemIds: () => allItemIds,
  }));

  // Group items by destination
  const groupedItems = useMemo(() => {
    const itemsArray = Array.isArray(items) ? items : [];
    const query = searchQuery.toLowerCase();

    const filtered = searchQuery.trim()
      ? itemsArray.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            (item.value && item.value.toLowerCase().includes(query))
        )
      : itemsArray;

    const groups: Record<string, (LibraryItem & { itemId: string })[]> = {};
    filtered.forEach((item, index) => {
      const destination = item.destination || "answer_library";
      const itemId = item.id || `${destination}-${index}-${item.label}`;
      if (!groups[destination]) groups[destination] = [];
      groups[destination].push({ ...item, itemId });
    });

    const order = ["company", "answer_library", "product", "exclude"];
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

  const totalItems = Array.isArray(items) ? items.length : 0;

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-app">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
        <span className="text-[13px] font-medium text-primary">Save as</span>
        <span className="text-[11px] text-muted">
          {totalItems}
        </span>
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
        {groupedItems.length === 0 ? (
          <div className="text-muted text-center py-12 text-[13px]">
            No library items
          </div>
        ) : (
          <div>
            {groupedItems.map(([destination, destItems]) => {
              const isCollapsed = collapsedGroups.has(destination);
              const destConfig = destinationConfig[destination] || destinationConfig.answer_library;
              const groupItemIds = destItems.map(i => i.itemId);
              const allSelected = isGroupFullySelected(groupItemIds);
              const partiallySelected = isGroupPartiallySelected(groupItemIds);

              return (
                <div key={destination}>
                  {/* Group header */}
                  <div className="h-8 px-3 flex items-center gap-2 bg-app-secondary/80 backdrop-blur-md border-b border-subtle sticky top-0 z-10">
                    {/* Checkbox */}
                    <div
                      onClick={(e) => handleGroupCheckboxClick(e, groupItemIds)}
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
                      className="flex-1 flex items-center gap-2 cursor-pointer"
                      onClick={() => toggleGroup(destination)}
                    >
                      <span className={`text-muted text-[10px] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                        ▼
                      </span>
                      <span className={`text-[12px] font-medium ${destConfig.color}`}>
                        {destConfig.label}
                      </span>
                      <span className="text-[11px] text-muted ml-auto">
                        {destItems.length}
                      </span>
                    </div>
                  </div>

                  {/* Items */}
                  {!isCollapsed && (
                    <div>
                      {destItems.map((item) => {
                        const isSelected = selectedItems.has(item.itemId);
                        const reviewStatus = getReviewStatus(item.itemId);

                        return (
                          <div
                            key={item.itemId}
                            ref={(el) => { if (el) itemRefs.current.set(item.itemId, el); }}
                            onClick={(e) => handleItemClick(e, item.itemId)}
                            className={`group flex items-start gap-2 py-1.5 px-3 border-b border-subtle cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-selected"
                                : "hover:bg-[var(--color-card-hover)]"
                            }`}
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
                            <div className="flex items-center gap-2 pt-0.5">
                              {item.lCell && (
                                <span
                                  className={`text-[10px] text-muted font-mono ${onCellRefClick ? "hover:text-accent cursor-pointer" : ""}`}
                                  onClick={(e) => {
                                    if (onCellRefClick) {
                                      e.stopPropagation();
                                      onCellRefClick(item.lCell!);
                                    }
                                  }}
                                >
                                  {item.lCell}
                                </span>
                              )}
                              {item.topic && (
                                <span className="text-[10px] text-muted uppercase">
                                  {item.topic}
                                </span>
                              )}
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
