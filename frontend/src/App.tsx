import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchQuestionnaires,
  fetchQuestionnaire,
  bulkUpdateItems,
  exportGrouped,
  saveNotes,
} from "./api";
import type { PanelType, IndexedItem, Destination } from "./types";
import { Toaster, toast } from "sonner";
import { TabBar } from "./components/TabBar";
import { OriginalPanel, type OriginalPanelHandle } from "./components/OriginalPanel";
import { IndexedPanel, type IndexedPanelHandle } from "./components/IndexedPanel";
import { LibraryPanel, type LibraryPanelHandle } from "./components/LibraryPanel";
import { CommandPalette } from "./components/CommandPalette";
import { NotesPanel } from "./components/NotesPanel";
import { useTheme } from "./hooks/useTheme";
import { useTabs } from "./hooks/useTabs";
import { useFeedback } from "./hooks/useFeedback";
import { useSelection } from "./hooks/useSelection";

// Format relative time (e.g. "2 hours ago", "3 days ago")
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return "just now";
}

export default function App() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  // Panel refs for cross-panel sync
  const originalPanelRef = useRef<OriginalPanelHandle>(null);
  const indexedPanelRef = useRef<IndexedPanelHandle>(null);
  const libraryPanelRef = useRef<LibraryPanelHandle>(null);

  // Queries
  const { data: healthData } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 30000,
    retry: false,
  });

  const { data: questionnairesData } = useQuery({
    queryKey: ["questionnaires"],
    queryFn: fetchQuestionnaires,
  });

  const questionnaires = questionnairesData?.questionnaires || [];

  // Custom hooks
  const {
    openTabs,
    currentQuestionnaire,
    openTab,
    closeTab,
    switchTab,
    markCompleted,
  } = useTabs(questionnaires);
  const {
    pendingFeedback,
    getReviewStatus,
    handleAccept,
    handleReject,
    resetFeedback,
  } = useFeedback();
  const {
    selectedPanel,
    selectedItems,
    commandPaletteOpen,
    lastSelectedId,
    handleItemSelect,
    handleRangeSelect,
    selectMultiple,
    selectAll,
    clearSelection,
    closeCommandPalette,
  } = useSelection();

  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [visiblePanels] = useState<Set<PanelType>>(
    new Set(["original", "indexed", "library"])
  );
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);

  // Current questionnaire data
  const { data: questionnaireData, isLoading: questionnaireLoading } = useQuery({
    queryKey: ["questionnaire", currentQuestionnaire],
    queryFn: () => fetchQuestionnaire(currentQuestionnaire!),
    enabled: !!currentQuestionnaire,
  });

  // Set active sheet when questionnaire data loads
  useEffect(() => {
    const sheets = questionnaireData?.structure?.sheets;
    if (sheets?.length && !activeSheet) {
      setActiveSheet(sheets[0].name);
    }
  }, [questionnaireData, activeSheet]);

  // Reset active sheet when switching questionnaires
  useEffect(() => {
    setActiveSheet(null);
  }, [currentQuestionnaire]);

  // Keyboard shortcuts for review mode, sidebar, and Cmd+A select all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (commandPaletteOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        setReviewMode((prev) => !prev);
      }
      if (e.key === "b" && !e.metaKey && !e.ctrlKey) {
        setSidebarOpen((prev) => !prev);
      }
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        setNotesPanelOpen((prev) => !prev);
      }
      // Cmd+A to select all items in the active panel (or indexed panel by default)
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        const panel = selectedPanel || "indexed";
        const ref = panel === "indexed" ? indexedPanelRef : libraryPanelRef;
        if (ref.current) {
          const allIds = ref.current.getAllItemIds();
          selectAll(panel, allIds);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, selectedPanel, selectAll]);

  // Mutations
  const completeMutation = useMutation({
    mutationFn: (id: string) => exportGrouped(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["questionnaires"] });
      if (currentQuestionnaire) {
        markCompleted(currentQuestionnaire);
      }
      toast.success("Export completed", {
        description: `Company: ${data.stats.company}, Library: ${data.stats.library}, Product: ${data.stats.product}, Questionnaire: ${data.stats.questionnaire}, Exclude: ${data.stats.exclude}`,
      });
    },
    onError: (error) => {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Bulk update mutation for persisting changes
  const bulkUpdateMutation = useMutation({
    mutationFn: ({
      panel,
      itemIds,
      updates,
    }: {
      panel: "indexed" | "library";
      itemIds: string[];
      updates: Record<string, unknown>;
    }) => {
      if (!currentQuestionnaire) throw new Error("No questionnaire selected");
      return bulkUpdateItems(currentQuestionnaire, panel, itemIds, updates);
    },
    onSuccess: () => {
      if (currentQuestionnaire) {
        queryClient.invalidateQueries({
          queryKey: ["questionnaire", currentQuestionnaire],
        });
      }
      toast.success("Changes saved");
    },
    onError: (error) => {
      toast.error("Failed to save changes", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
      // Refetch to restore original state
      if (currentQuestionnaire) {
        queryClient.invalidateQueries({
          queryKey: ["questionnaire", currentQuestionnaire],
        });
      }
    },
  });

  // Notes save mutation
  const notesMutation = useMutation({
    mutationFn: (notes: string) => {
      if (!currentQuestionnaire) throw new Error("No questionnaire selected");
      return saveNotes(currentQuestionnaire, notes);
    },
    onSuccess: () => {
      if (currentQuestionnaire) {
        queryClient.invalidateQueries({
          queryKey: ["questionnaire", currentQuestionnaire],
        });
      }
      toast.success("Notes saved");
    },
    onError: (error) => {
      toast.error("Failed to save notes", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Handle notes save
  const handleSaveNotes = useCallback(
    (notes: string) => {
      notesMutation.mutate(notes);
    },
    [notesMutation]
  );

  // Handle cell click in original panel - select and scroll to matching items
  const handleCellClick = useCallback(
    (cellRef: string) => {
      // Set active cell for highlighting
      setActiveCell(cellRef);

      if (!questionnaireData?.indexed?.sections) return;

      // Find all items that reference this cell (lCell or vCell)
      const matchingItemIds: string[] = [];
      let firstMatchId: string | null = null;

      for (const section of questionnaireData.indexed.sections) {
        for (const item of section.items) {
          if (item.lCell === cellRef || item.vCell === cellRef) {
            if (item.id) {
              matchingItemIds.push(item.id);
              if (!firstMatchId) firstMatchId = item.id;
            }
          }
        }
      }

      if (matchingItemIds.length > 0 && firstMatchId) {
        // Select the matching items in the indexed panel
        selectMultiple("indexed", matchingItemIds);

        // Scroll to the first match in indexed panel
        if (indexedPanelRef.current) {
          indexedPanelRef.current.scrollToItem(firstMatchId);
        }

        // Also scroll to the same item in the library panel (same items, just grouped by destination)
        if (libraryPanelRef.current) {
          libraryPanelRef.current.scrollToItem(firstMatchId);
        }
      }
    },
    [questionnaireData, selectMultiple]
  );

  // Handle cell ref click in indexed/library panels - scroll to cell in original panel
  const handleCellRefClick = useCallback(
    (cellRef: string) => {
      setActiveCell(cellRef);
      if (originalPanelRef.current) {
        originalPanelRef.current.scrollToCell(cellRef);
      }
    },
    []
  );

  // Complete review - export grouped JSON
  const handleCompleteReview = useCallback(() => {
    if (!currentQuestionnaire) return;
    completeMutation.mutate(currentQuestionnaire);
  }, [currentQuestionnaire, completeMutation]);

  // Command palette apply
  const handleCommandPaletteApply = useCallback(
    (updates: {
      action?: "accept" | "reject" | "reset";
      reason?: string;
      label?: string;
      value?: string;
      destination?: Destination;
      note?: string;
    }) => {
      if (!selectedPanel) return;

      const itemIds = Array.from(selectedItems);

      // Build server update payload
      const serverUpdates: Record<string, unknown> = {};

      if (updates.label) {
        serverUpdates.label = updates.label;
      }

      if (updates.value) {
        serverUpdates.value = updates.value;
      }

      if (updates.destination) {
        serverUpdates.destination = updates.destination;
        serverUpdates.needs_review = false;
        serverUpdates.tag_source = "manual";
      }

      if (updates.note !== undefined) {
        serverUpdates.note = updates.note;
      }

      // Handle field changes - persist to server
      if (Object.keys(serverUpdates).length > 0) {
        // Optimistically update local state with immutable update
        if (questionnaireData?.indexed?.sections) {
          const updatedSections = questionnaireData.indexed.sections.map(section => ({
            ...section,
            items: section.items.map(item =>
              selectedItems.has(item.id || "")
                ? {
                    ...item,
                    ...(updates.label && { label: updates.label }),
                    ...(updates.value && { value: updates.value }),
                    ...(updates.destination && { destination: updates.destination, needs_review: false, tag_source: "manual" }),
                    ...(updates.note !== undefined && { note: updates.note })
                  }
                : item
            ),
          }));

          queryClient.setQueryData(["questionnaire", currentQuestionnaire], {
            ...questionnaireData,
            indexed: {
              ...questionnaireData.indexed,
              sections: updatedSections,
            },
          });
        }

        // Persist to server - always use "indexed" since both panels show the same indexed data
        bulkUpdateMutation.mutate({
          panel: "indexed",
          itemIds,
          updates: serverUpdates,
        });
      }

      // Handle review actions (these still use pending feedback)
      selectedItems.forEach((itemId) => {
        if (updates.action === "accept") {
          handleAccept(selectedPanel, itemId);
        } else if (updates.action === "reject") {
          handleReject(selectedPanel, itemId, updates.reason);
        } else if (updates.action === "reset") {
          resetFeedback(itemId);
        }
      });

      closeCommandPalette();
      clearSelection();
    },
    [
      selectedPanel,
      selectedItems,
      questionnaireData,
      currentQuestionnaire,
      queryClient,
      bulkUpdateMutation,
      handleAccept,
      handleReject,
      resetFeedback,
      closeCommandPalette,
      clearSelection,
    ]
  );

  // Get selected items data for command palette
  // Both panels now show the same indexed items (just grouped differently)
  const getSelectedItemsData = useMemo((): IndexedItem[] => {
    if (!questionnaireData || !selectedPanel) return [];

    const allItems: IndexedItem[] = [];
    questionnaireData.indexed?.sections?.forEach((section) => {
      allItems.push(...section.items);
    });
    return allItems.filter((item) => selectedItems.has(item.id || ""));
  }, [questionnaireData, selectedPanel, selectedItems]);

  const serverConnected = !!healthData;

  // Welcome screen if no questionnaire selected
  if (!currentQuestionnaire) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 p-10 bg-app">
        <h1 className="text-xl font-medium text-primary">Passionfruit Review</h1>
        <p className="text-muted max-w-[400px] text-center text-[13px]">
          Select a questionnaire to review its indexed structure and harvested library items.
        </p>
        <div className="flex flex-col gap-1 max-w-[600px] w-full max-h-[400px] overflow-y-auto">
          {/* Header row */}
          <div className="flex items-center h-7 px-3 text-[10px] font-medium text-muted">
            <span className="flex-1">Document</span>
            <span className="w-20 text-center">Approved</span>
            <span className="w-20 text-center">Imported</span>
          </div>
          {questionnaires.map((q) => (
            <div
              key={q.name}
              className="flex items-center h-10 px-3 bg-card border border-default rounded cursor-pointer transition-colors bg-card-hover"
              onClick={() => openTab(q.name)}
            >
              <span className="flex-1 text-[13px] text-primary overflow-hidden text-ellipsis whitespace-nowrap">
                {q.displayName}
              </span>
              {/* Approved column */}
              <div className="w-20 flex flex-col items-center text-[10px]">
                {q.approvedCount ? (
                  <>
                    <span className="text-emerald-500 font-medium">{q.approvedCount}</span>
                    {q.approvedAt && (
                      <span className="text-muted">{formatRelativeTime(q.approvedAt)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">-</span>
                )}
              </div>
              {/* Imported column */}
              <div className="w-20 flex flex-col items-center text-[10px]">
                {q.apiReadyCount ? (
                  <>
                    <span className="text-blue-500 font-medium">{q.apiReadyCount}</span>
                    {q.apiReadyAt && (
                      <span className="text-muted">{formatRelativeTime(q.apiReadyAt)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">-</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Loading state
  if (questionnaireLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-app">
        <div className="w-5 h-5 border-2 border-default border-t-accent rounded-full animate-spin" />
        <div className="text-muted text-[13px]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-app">
      <TabBar
        tabs={openTabs}
        currentTab={currentQuestionnaire}
        serverConnected={serverConnected}
        theme={theme}
        hasNotes={!!(questionnaireData?.indexed?.meta?.notes)}
        onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
        onTabClick={switchTab}
        onTabClose={closeTab}
        onComplete={handleCompleteReview}
        onNotesClick={() => setNotesPanelOpen((prev) => !prev)}
        onThemeChange={setTheme}
      />

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/50 z-[99]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-10 bottom-0 w-[440px] bg-app-secondary border-r border-default flex flex-col z-[100] transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-10 px-4 flex items-center border-b border-default">
          <span className="flex-1 text-[13px] font-medium text-primary">Documents</span>
          <span className="w-20 text-[10px] font-medium text-muted text-center">Approved</span>
          <span className="w-20 text-[10px] font-medium text-muted text-center">Imported</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {(() => {
            const grouped: Record<string, typeof questionnaires> = {};
            questionnaires.forEach((q) => {
              const customer = q.customer || "default";
              if (!grouped[customer]) grouped[customer] = [];
              grouped[customer].push(q);
            });
            const customers = Object.keys(grouped).sort((a, b) =>
              a === "default" ? 1 : b === "default" ? -1 : a.localeCompare(b)
            );

            return customers.map((customer) => (
              <div key={customer}>
                <div className="h-7 px-4 flex items-center text-[10px] font-semibold text-muted uppercase tracking-wide bg-app border-b border-default">
                  {customer}
                </div>
                {grouped[customer].map((q) => (
                  <div
                    key={q.name}
                    className={`flex items-center h-9 px-4 cursor-pointer transition-colors border-b border-subtle gap-2 bg-card-hover ${
                      currentQuestionnaire === q.name
                        ? "bg-selected border-l-2 border-l-accent"
                        : ""
                    }`}
                    onClick={() => openTab(q.name)}
                  >
                    {q.completed && (
                      <span className="text-emerald-500 text-[11px]">✓</span>
                    )}
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-primary">
                      {q.displayName}
                    </span>
                    {/* Approved column */}
                    <div className="w-20 flex flex-col items-center text-[10px]">
                      {q.approvedCount ? (
                        <>
                          <span className="text-emerald-500 font-medium">{q.approvedCount}</span>
                          {q.approvedAt && (
                            <span className="text-muted">{formatRelativeTime(q.approvedAt)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </div>
                    {/* Imported column */}
                    <div className="w-20 flex flex-col items-center text-[10px]">
                      {q.apiReadyCount ? (
                        <>
                          <span className="text-blue-500 font-medium">{q.apiReadyCount}</span>
                          {q.apiReadyAt && (
                            <span className="text-muted">{formatRelativeTime(q.apiReadyAt)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Sheet tabs */}
      <div className="flex items-center gap-0 px-3 bg-app-secondary border-b border-default h-9 overflow-x-auto scrollbar-none">
        {questionnaireData?.structure?.sheets?.map((sheet) => (
          <button
            key={sheet.name}
            className={`px-3 h-full border-b-2 text-[12px] cursor-pointer transition-colors whitespace-nowrap ${
              activeSheet === sheet.name
                ? "text-primary border-b-accent"
                : "text-muted border-transparent hover:text-primary"
            }`}
            onClick={() => setActiveSheet(sheet.name)}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      {/* Main panels */}
      <div className="flex flex-1 overflow-hidden">
        <OriginalPanel
          ref={originalPanelRef}
          visible={visiblePanels.has("original")}
          sheet={questionnaireData?.structure?.sheets?.find(
            (s) => s.name === activeSheet
          )}
          activeCell={activeCell}
          onCellClick={handleCellClick}
        />
        <IndexedPanel
          ref={indexedPanelRef}
          visible={visiblePanels.has("indexed")}
          sections={questionnaireData?.indexed?.sections || []}
          selectedItems={selectedPanel === "indexed" ? selectedItems : new Set()}
          lastSelectedId={selectedPanel === "indexed" ? lastSelectedId : null}
          reviewMode={reviewMode}
          getReviewStatus={getReviewStatus}
          onItemSelect={(id, multi, shift) => handleItemSelect("indexed", id, multi, shift)}
          onSelectGroup={(itemIds) => {
            const allSelected = itemIds.every(id => selectedItems.has(id));
            if (allSelected) {
              // Deselect all in group
              const newSelection = new Set(selectedItems);
              itemIds.forEach(id => newSelection.delete(id));
              selectMultiple("indexed", [...newSelection]);
            } else {
              // Select all in group (add to selection)
              selectMultiple("indexed", itemIds, true);
            }
          }}
          onRangeSelect={(fromId, toId, allIds) => handleRangeSelect("indexed", fromId, toId, allIds)}
          onAccept={(id) => handleAccept("indexed", id)}
          onCellRefClick={handleCellRefClick}
          onReject={(id, reason) => handleReject("indexed", id, reason)}
        />
        <LibraryPanel
          ref={libraryPanelRef}
          visible={visiblePanels.has("library")}
          items={
            // Use the same indexed items, just grouped by destination in the panel
            questionnaireData?.indexed?.sections?.flatMap(section =>
              section.items.map(item => ({
                id: item.id,
                label: item.label,
                value: item.value || "",
                topic: item.topic,
                destination: item.destination || "answer_library",
                lCell: item.lCell,
              }))
            ) || []
          }
          selectedItems={selectedPanel === "library" ? selectedItems : new Set()}
          lastSelectedId={selectedPanel === "library" ? lastSelectedId : null}
          reviewMode={reviewMode}
          getReviewStatus={getReviewStatus}
          onItemSelect={(id, multi, shift) => handleItemSelect("library", id, multi, shift)}
          onSelectGroup={(itemIds) => {
            const allSelected = itemIds.every(id => selectedItems.has(id));
            if (allSelected) {
              // Deselect all in group
              const newSelection = new Set(selectedItems);
              itemIds.forEach(id => newSelection.delete(id));
              selectMultiple("library", [...newSelection]);
            } else {
              // Select all in group (add to selection)
              selectMultiple("library", itemIds, true);
            }
          }}
          onRangeSelect={(fromId, toId, allIds) => handleRangeSelect("library", fromId, toId, allIds)}
          onAccept={(id) => handleAccept("library", id)}
          onReject={(id, reason) => handleReject("library", id, reason)}
          onCellRefClick={handleCellRefClick}
        />
      </div>

      {/* Stats bar */}
      <div className="flex justify-between items-center h-7 px-4 bg-app-secondary border-t border-default text-[11px] text-muted">
        <div className="flex gap-4">
          {questionnaireData?.indexed?.sections && (
            <span>
              {questionnaireData.indexed.sections.reduce(
                (acc, s) => acc + s.items.length,
                0
              )} items
            </span>
          )}
        </div>
        <div className="flex gap-4">
          {pendingFeedback.length > 0 && (
            <span className="text-amber-500">{pendingFeedback.length} pending</span>
          )}
        </div>
      </div>

      {/* Selection badge */}
      {selectedItems.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-default text-primary h-9 px-4 rounded-lg text-[13px] font-medium flex items-center gap-3 shadow-lg z-[1000]">
          <span>
            {selectedItems.size} selected
          </span>
          <kbd className="bg-app-secondary px-1.5 py-0.5 rounded text-[11px] text-muted">
            ⌘K
          </kbd>
        </div>
      )}

      {/* Command palette */}
      <CommandPalette
        visible={commandPaletteOpen}
        selectedCount={selectedItems.size}
        selectedItems={getSelectedItemsData}
        onClose={closeCommandPalette}
        onApply={handleCommandPaletteApply}
      />

      {/* Notes panel */}
      <NotesPanel
        visible={notesPanelOpen}
        questionnaireId={currentQuestionnaire}
        initialNotes={questionnaireData?.indexed?.meta?.notes || ""}
        itemNotes={
          questionnaireData?.indexed?.sections?.flatMap(section =>
            section.items
              .filter(item => item.note)
              .map(item => ({
                id: item.id || "",
                label: item.label,
                note: item.note || "",
                lCell: item.lCell,
              }))
          ) || []
        }
        onClose={() => setNotesPanelOpen(false)}
        onSave={handleSaveNotes}
        onItemClick={(itemId) => {
          // Select the item and scroll to it
          selectMultiple("indexed", [itemId]);
          if (indexedPanelRef.current) {
            indexedPanelRef.current.scrollToItem(itemId);
          }
        }}
      />

      {/* Toast notifications - Sonner */}
      <Toaster
        position="bottom-right"
        theme={theme === "system" ? undefined : theme}
        toastOptions={{
          className: "bg-card border-default text-primary",
        }}
      />
    </div>
  );
}
