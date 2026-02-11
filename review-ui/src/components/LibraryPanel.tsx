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
  exclude: { label: "Exclude", color: "text-neutral-500" },
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
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-neutral-950">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-neutral-800 bg-neutral-900/50">
        <span className="text-[13px] font-medium text-neutral-200">Save as</span>
        <span className="text-[11px] text-neutral-500">
          {totalItems}
        </span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-neutral-800">
        <input
          type="text"
          className="w-full h-7 px-2.5 bg-neutral-900 border border-neutral-800 rounded text-[13px] text-neutral-200 focus:outline-none focus:border-neutral-700 placeholder:text-neutral-600"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {groupedItems.length === 0 ? (
          <div className="text-neutral-600 text-center py-12 text-[13px]">
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
                  <div className="h-8 px-3 flex items-center gap-2 bg-neutral-900/70 backdrop-blur-md border-b border-neutral-800/50 sticky top-0 z-10">
                    {/* Checkbox */}
                    <div
                      onClick={(e) => handleGroupCheckboxClick(e, groupItemIds)}
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center cursor-pointer transition-colors ${
                        allSelected
                          ? "bg-blue-500 border-blue-500"
                          : partiallySelected
                            ? "bg-blue-500/30 border-blue-500/50"
                            : "border-neutral-600 hover:border-neutral-500"
                      }`}
                    >
                      {allSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {partiallySelected && !allSelected && (
                        <div className="w-1.5 h-0.5 bg-blue-400 rounded-full" />
                      )}
                    </div>

                    <div
                      className="flex-1 flex items-center gap-2 cursor-pointer"
                      onClick={() => toggleGroup(destination)}
                    >
                      <span className={`text-neutral-500 text-[10px] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                        ▼
                      </span>
                      <span className={`text-[12px] font-medium ${destConfig.color}`}>
                        {destConfig.label}
                      </span>
                      <span className="text-[11px] text-neutral-600 ml-auto">
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
                            className={`group flex items-start gap-2 py-1.5 px-3 border-b border-neutral-800/30 cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-blue-500/10"
                                : "hover:bg-neutral-800/50"
                            }`}
                          >
                            {/* Checkbox */}
                            <div className="pt-0.5">
                              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? "bg-blue-500 border-blue-500"
                                  : "border-neutral-700 group-hover:border-neutral-600"
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
                                <span className="text-[12px] text-neutral-500 truncate">
                                  {item.label}
                                </span>
                              </div>
                              <div className={`text-[13px] truncate ${
                                item.value
                                  ? "text-neutral-200"
                                  : "text-neutral-600 italic"
                              }`}>
                                {item.value || "(empty)"}
                              </div>
                            </div>

                            {/* Right side metadata */}
                            <div className="flex items-center gap-2 pt-0.5">
                              {item.lCell && (
                                <span
                                  className={`text-[10px] text-neutral-600 font-mono ${onCellRefClick ? "hover:text-blue-400 cursor-pointer" : ""}`}
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
                                <span className="text-[10px] text-neutral-600 uppercase">
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
