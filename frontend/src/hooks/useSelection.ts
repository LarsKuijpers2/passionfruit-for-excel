import { useState, useCallback, useEffect, useRef } from 'react';

interface UseSelectionReturn {
  selectedPanel: 'indexed' | 'library' | null;
  selectedItems: Set<string>;
  commandPaletteOpen: boolean;
  lastSelectedId: string | null;
  handleItemSelect: (panel: 'indexed' | 'library', itemId: string, multiSelect: boolean, shiftSelect?: boolean) => void;
  handleRangeSelect: (panel: 'indexed' | 'library', fromId: string, toId: string, allIds: string[]) => void;
  selectMultiple: (panel: 'indexed' | 'library', itemIds: string[], addToSelection?: boolean) => void;
  selectAll: (panel: 'indexed' | 'library', allIds: string[]) => void;
  clearSelection: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export function useSelection(): UseSelectionReturn {
  const [selectedPanel, setSelectedPanel] = useState<'indexed' | 'library' | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Store callback for Cmd+A - will be set by App
  const selectAllCallbackRef = useRef<(() => void) | null>(null);

  // Keyboard shortcuts for selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Cmd+K or Ctrl+K to open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (selectedItems.size > 0) {
          setCommandPaletteOpen(true);
        }
      }

      // Cmd+A or Ctrl+A to select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        if (selectAllCallbackRef.current) {
          selectAllCallbackRef.current();
        }
      }

      // Escape to close command palette or clear selection
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (selectedItems.size > 0) {
          setSelectedItems(new Set());
          setSelectedPanel(null);
          setLastSelectedId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, commandPaletteOpen]);

  const handleItemSelect = useCallback(
    (panel: 'indexed' | 'library', itemId: string, _multiSelect: boolean, _shiftSelect?: boolean) => {
      if (selectedPanel && selectedPanel !== panel) {
        // Switching panels - clear selection and start fresh
        setSelectedPanel(panel);
        setSelectedItems(new Set([itemId]));
        setLastSelectedId(itemId);
        return;
      }

      setSelectedPanel(panel);
      // Always toggle selection (add if not selected, remove if selected)
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }
        return next;
      });
      setLastSelectedId(itemId);
    },
    [selectedPanel]
  );

  const handleRangeSelect = useCallback(
    (panel: 'indexed' | 'library', fromId: string, toId: string, allIds: string[]) => {
      const fromIndex = allIds.indexOf(fromId);
      const toIndex = allIds.indexOf(toId);

      if (fromIndex === -1 || toIndex === -1) return;

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      const rangeIds = allIds.slice(start, end + 1);

      setSelectedPanel(panel);
      setSelectedItems((prev) => {
        const next = new Set(prev);
        rangeIds.forEach(id => next.add(id));
        return next;
      });
      setLastSelectedId(toId);
    },
    []
  );

  const selectMultiple = useCallback(
    (panel: 'indexed' | 'library', itemIds: string[], addToSelection = false) => {
      if (selectedPanel && selectedPanel !== panel && !addToSelection) {
        setSelectedPanel(panel);
        setSelectedItems(new Set(itemIds));
        return;
      }

      setSelectedPanel(panel);
      setSelectedItems((prev) => {
        if (addToSelection) {
          const next = new Set(prev);
          itemIds.forEach(id => next.add(id));
          return next;
        }
        return new Set(itemIds);
      });
    },
    [selectedPanel]
  );

  const selectAll = useCallback(
    (panel: 'indexed' | 'library', allIds: string[]) => {
      setSelectedPanel(panel);
      setSelectedItems(new Set(allIds));
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
    setSelectedPanel(null);
    setLastSelectedId(null);
  }, []);

  const openCommandPalette = useCallback(() => {
    if (selectedItems.size > 0) {
      setCommandPaletteOpen(true);
    }
  }, [selectedItems]);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  return {
    selectedPanel,
    selectedItems,
    commandPaletteOpen,
    lastSelectedId,
    handleItemSelect,
    handleRangeSelect,
    selectMultiple,
    selectAll,
    clearSelection,
    openCommandPalette,
    closeCommandPalette,
  };
}
