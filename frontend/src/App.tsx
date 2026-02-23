import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchQuestionnaires,
  fetchQuestionnaire,
  bulkUpdateItems,
  exportGrouped,
  saveNotes,
  submitDiscrepancyVerdict,
  undoDiscrepancyVerdict,
} from "./api";
import type { PanelType, IndexedItem, Destination } from "./types";
import { Toaster, toast } from "sonner";
import { Database, GitBranch, Table } from "@phosphor-icons/react";
import { TabBar } from "./components/TabBar";
import { OriginalPanel, type OriginalPanelHandle } from "./components/OriginalPanel";
import { IndexedPanel, type IndexedPanelHandle } from "./components/IndexedPanel";
import { LibraryPanel, type LibraryPanelHandle } from "./components/LibraryPanel";
import { CommandPalette } from "./components/CommandPalette";
import { NotesPanel } from "./components/NotesPanel";
import { AggregatedLibraryPanel } from "./components/AggregatedLibraryPanel";
import { PipelinePanel } from "./components/PipelinePanel";
import { StructureAnalyzerPanel } from "./components/StructureAnalyzerPanel";
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
  const [visiblePanels, setVisiblePanels] = useState<Set<PanelType>>(
    new Set(["original", "indexed", "library"])
  );

  // Toggle panel visibility
  const togglePanel = useCallback((panel: PanelType) => {
    setVisiblePanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        // Don't allow hiding all panels
        if (next.size > 1) {
          next.delete(panel);
        }
      } else {
        next.add(panel);
      }
      return next;
    });
  }, []);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);

  // View state: questionnaire (detail), library (database), pipeline (status), structure (analyzer)
  const [currentView, setCurrentView] = useState<'questionnaire' | 'library' | 'pipeline' | 'structure'>('questionnaire');
  const [libraryCustomer, setLibraryCustomer] = useState<string | null>(null);
  const [pipelineCustomer, setPipelineCustomer] = useState<string | null>(null);
  const [structureCustomer, setStructureCustomer] = useState<string | null>(null);

  // Vision corrections panel
  const [visionPanelOpen, setVisionPanelOpen] = useState(false);

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
      // Panel toggle shortcuts: 1=Original, 2=Indexed, 3=Library
      if (e.key === "1" && !e.metaKey && !e.ctrlKey) {
        togglePanel("original");
      }
      if (e.key === "2" && !e.metaKey && !e.ctrlKey) {
        togglePanel("indexed");
      }
      if (e.key === "3" && !e.metaKey && !e.ctrlKey) {
        togglePanel("library");
      }
      // Toggle all groups in panels
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        indexedPanelRef.current?.toggleAllGroups();
        libraryPanelRef.current?.toggleAllGroups();
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
  }, [commandPaletteOpen, selectedPanel, selectAll, togglePanel]);

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

      // Capture selection immediately to avoid race conditions
      const selectedItemsSnapshot = new Set(selectedItems);
      const itemIds = Array.from(selectedItemsSnapshot);

      console.log(`Command palette apply: ${itemIds.length} items`, updates);

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
              selectedItemsSnapshot.has(item.id || "")
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
      selectedItemsSnapshot.forEach((itemId) => {
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

  // Build set of item IDs that have Vision discrepancies (for highlighting)
  const visionDiscrepancyIds = useMemo(() => {
    const ids = new Set<string>();
    questionnaireData?.indexed?.visionValidation?.discrepancies?.forEach(d => ids.add(d.itemId));
    return ids;
  }, [questionnaireData?.indexed?.visionValidation?.discrepancies]);

  const serverConnected = !!healthData;

  // Welcome screen if no questionnaire selected and not in library/pipeline view
  if (!currentQuestionnaire && currentView === 'questionnaire') {
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
              title={q.displayName}
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

  // Loading state (only for questionnaire view)
  if (questionnaireLoading && currentView === 'questionnaire') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-app">
        <div className="w-5 h-5 border-2 border-default border-t-accent rounded-full animate-spin" />
        <div className="text-muted text-[13px]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-app">
      {/* Only show TabBar when in questionnaire view */}
      {currentView === 'questionnaire' && (
        <TabBar
          tabs={openTabs}
          currentTab={currentQuestionnaire}
          serverConnected={serverConnected}
          theme={theme}
          hasNotes={!!(questionnaireData?.indexed?.meta?.notes)}
          visiblePanels={visiblePanels}
          onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
          onTabClick={switchTab}
          onTabClose={closeTab}
          onComplete={handleCompleteReview}
          onNotesClick={() => setNotesPanelOpen((prev) => !prev)}
          onThemeChange={setTheme}
          onTogglePanel={togglePanel}
        />
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/50 z-[99]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 ${currentView === 'questionnaire' ? 'top-10' : 'top-0'} bottom-0 w-[560px] bg-app-secondary border-r border-default flex flex-col z-[100] transition-transform duration-200 ${
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
                <div className="h-7 px-4 flex items-center justify-between text-[10px] font-semibold text-muted uppercase tracking-wide bg-app border-b border-default">
                  <span>{customer}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentView('pipeline');
                        setPipelineCustomer(customer);
                        setSidebarOpen(false);
                      }}
                      className={`p-1 rounded transition-colors ${
                        currentView === 'pipeline' && pipelineCustomer === customer
                          ? 'text-accent bg-accent/20'
                          : 'text-muted hover:text-primary hover:bg-card-hover'
                      }`}
                      title={`View ${customer} pipeline`}
                    >
                      <GitBranch size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentView('library');
                        setLibraryCustomer(customer);
                        setSidebarOpen(false);
                      }}
                      className={`p-1 rounded transition-colors ${
                        currentView === 'library' && libraryCustomer === customer
                          ? 'text-accent bg-accent/20'
                          : 'text-muted hover:text-primary hover:bg-card-hover'
                      }`}
                      title={`View ${customer} database`}
                    >
                      <Database size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentView('structure');
                        setStructureCustomer(customer);
                        setSidebarOpen(false);
                      }}
                      className={`p-1 rounded transition-colors ${
                        currentView === 'structure' && structureCustomer === customer
                          ? 'text-accent bg-accent/20'
                          : 'text-muted hover:text-primary hover:bg-card-hover'
                      }`}
                      title={`Analyze ${customer} structure`}
                    >
                      <Table size={14} />
                    </button>
                  </div>
                </div>
                {grouped[customer].map((q) => (
                  <div
                    key={q.name}
                    className={`flex items-center h-9 px-4 cursor-pointer transition-colors border-b border-subtle gap-2 bg-card-hover ${
                      currentQuestionnaire === q.name && currentView === 'questionnaire'
                        ? "bg-selected border-l-2 border-l-accent"
                        : ""
                    }`}
                    onClick={() => {
                      setCurrentView('questionnaire');
                      openTab(q.name);
                    }}
                    title={q.displayName}
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

      {/* Content area - questionnaire, library, or pipeline view */}
      {currentView === 'pipeline' && pipelineCustomer ? (
        <PipelinePanel
          customer={pipelineCustomer}
          onBack={() => setCurrentView('questionnaire')}
          onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
          onQuestionnaireClick={(filename) => {
            // Find matching questionnaire and open it
            const match = questionnaires.find(q =>
              q.name.includes(filename.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_'))
            );
            if (match) {
              setCurrentView('questionnaire');
              openTab(match.name);
            }
          }}
        />
      ) : currentView === 'library' && libraryCustomer ? (
        <AggregatedLibraryPanel
          customer={libraryCustomer}
          onBack={() => setCurrentView('questionnaire')}
          onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
        />
      ) : currentView === 'structure' && structureCustomer ? (
        <StructureAnalyzerPanel
          customer={structureCustomer}
          onBack={() => setCurrentView('questionnaire')}
          onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
        />
      ) : (
        <>
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
          sections={questionnaireData?.indexed?.sections || []}
          textContent={questionnaireData?.structure?.textContent}
          activeCell={activeCell}
          onCellClick={handleCellClick}
          questionnaireId={currentQuestionnaire || undefined}
          pages={questionnaireData?.structure?.pages}
        />
        <IndexedPanel
          ref={indexedPanelRef}
          visible={visiblePanels.has("indexed")}
          sections={questionnaireData?.indexed?.sections || []}
          selectedItems={selectedPanel === "indexed" ? selectedItems : new Set()}
          lastSelectedId={selectedPanel === "indexed" ? lastSelectedId : null}
          reviewMode={reviewMode}
          visionCorrectedIds={visionDiscrepancyIds}
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
          onItemClick={(item) => {
            if (item.lCell) {
              setActiveCell(item.lCell);
              if (originalPanelRef.current) {
                originalPanelRef.current.scrollToCell(item.lCell);
              }
            }
          }}
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
              {(questionnaireData?.indexed?.visionValidation || questionnaireData?.indexed?.visionCorrection) && (
                <button
                  className={`cursor-pointer flex items-center gap-1 ${
                    questionnaireData?.indexed?.visionCorrection
                      ? "text-blue-500 hover:text-blue-400"
                      : (questionnaireData?.indexed?.visionValidation?.discrepancies?.length ?? 0) > 0
                        ? "text-orange-500 hover:text-orange-400"
                        : "text-emerald-500 hover:text-emerald-400"
                  }`}
                  onClick={() => setVisionPanelOpen(prev => !prev)}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    questionnaireData?.indexed?.visionCorrection
                      ? "bg-blue-500"
                      : (questionnaireData?.indexed?.visionValidation?.discrepancies?.length ?? 0) > 0
                        ? "bg-orange-500"
                        : "bg-emerald-500"
                  }`} />
                  {questionnaireData?.indexed?.visionCorrection
                    ? `${questionnaireData.indexed.visionCorrection.correctedCount} corrected, ${Math.round((questionnaireData.indexed.visionCorrection.matchedCorrectly / questionnaireData.indexed.visionCorrection.totalItems) * 100)}% accuracy`
                    : (questionnaireData?.indexed?.visionValidation?.discrepancies?.length ?? 0) > 0
                      ? `${questionnaireData?.indexed?.visionValidation?.discrepancies?.length} to review`
                      : `${questionnaireData?.indexed?.visionValidation?.matchedCorrectly} validated`
                  }
                </button>
              )}
            </div>
            <div className="flex gap-4">
              {pendingFeedback.length > 0 && (
                <span className="text-amber-500">{pendingFeedback.length} pending</span>
              )}
            </div>
          </div>
        </>
      )}

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

      {/* Vision validation/correction panel */}
      {visionPanelOpen && (questionnaireData?.indexed?.visionValidation || questionnaireData?.indexed?.visionCorrection) && (
        <div className="fixed bottom-7 left-0 right-0 bg-card border-t border-default z-[50] flex flex-col max-h-[300px]">
          {/* Fixed header - not scrollable */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-default bg-app-secondary shrink-0">
            <div className="flex items-center gap-2">
              {/* Show correction info if available, otherwise validation info */}
              {questionnaireData.indexed.visionCorrection ? (
                <>
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full" />
                  <span className="text-[13px] font-medium text-primary">
                    Vision Correction - {questionnaireData.indexed.visionCorrection.correctedCount} auto-corrected
                  </span>
                  <span className="text-[11px] text-muted">
                    {questionnaireData.indexed.visionCorrection.matchedCorrectly}/{questionnaireData.indexed.visionCorrection.totalItems} accuracy
                  </span>
                  {questionnaireData.indexed.visionCorrection.remainingDiscrepancies?.length > 0 && (
                    <span className="text-[11px] text-orange-400">
                      ({questionnaireData.indexed.visionCorrection.remainingDiscrepancies.length} text discrepancies)
                    </span>
                  )}
                </>
              ) : (questionnaireData?.indexed?.visionValidation?.discrepancies?.length ?? 0) > 0 ? (
                <>
                  <span className="inline-block w-2 h-2 bg-orange-500 rounded-full" />
                  <span className="text-[13px] font-medium text-primary">
                    Vision Validation - {questionnaireData?.indexed?.visionValidation?.discrepancies?.length} discrepancies
                  </span>
                  <span className="text-[11px] text-muted">
                    {questionnaireData?.indexed?.visionValidation?.matchedCorrectly}/{questionnaireData?.indexed?.visionValidation?.totalItems} confirmed correct
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full" />
                  <span className="text-[13px] font-medium text-primary">
                    Vision Validation - All matched
                  </span>
                  <span className="text-[11px] text-muted">
                    {questionnaireData.indexed.visionValidation?.matchedCorrectly}/{questionnaireData.indexed.visionValidation?.totalItems} confirmed correct
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-muted hover:text-primary text-[18px] leading-none cursor-pointer"
                onClick={() => setVisionPanelOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {/* Scrollable content */}
          {questionnaireData.indexed.visionCorrection ? (
            // Show correction results
            <div className="overflow-y-auto flex-1">
              {/* Corrections section */}
              {questionnaireData.indexed.visionCorrection.corrections?.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-blue-500/10 text-blue-400 text-[11px] font-medium sticky top-0">
                    Auto-corrected Yes/No values ({questionnaireData.indexed.visionCorrection.corrections.length})
                  </div>
                  <table className="w-full text-[12px]">
                    <thead className="bg-app-secondary sticky top-7">
                      <tr className="text-left text-muted">
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium w-24">Was</th>
                        <th className="px-4 py-2 font-medium w-24">Now</th>
                        <th className="px-4 py-2 font-medium w-20">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionnaireData.indexed.visionCorrection.corrections.map((c: any, idx: number) => {
                        // Find the item to get its label
                        const item = questionnaireData.indexed?.sections?.flatMap((s: any) => s.items).find((i: any) => i.id === c.itemId);
                        return (
                          <tr
                            key={idx}
                            className="border-t border-default hover:bg-card-hover cursor-pointer"
                            onClick={() => {
                              selectMultiple("indexed", [c.itemId]);
                              indexedPanelRef.current?.scrollToItem(c.itemId);
                            }}
                          >
                            <td className="px-4 py-2 text-primary">
                              <div className="truncate max-w-[400px]" title={item?.label || c.itemId}>
                                {item?.label || c.itemId}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-red-400 line-through">
                              {c.oldValue || <span className="italic">empty</span>}
                            </td>
                            <td className="px-4 py-2 text-emerald-400 font-medium">
                              {c.newValue}
                            </td>
                            <td className="px-4 py-2 text-muted">
                              {Math.round(c.matchScore * 100)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {/* Remaining discrepancies section */}
              {questionnaireData.indexed.visionCorrection.remainingDiscrepancies?.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-orange-500/10 text-orange-400 text-[11px] font-medium sticky top-0">
                    Text field discrepancies (not auto-corrected) ({questionnaireData.indexed.visionCorrection.remainingDiscrepancies.length})
                  </div>
                  <table className="w-full text-[12px]">
                    <thead className="bg-app-secondary sticky top-7">
                      <tr className="text-left text-muted">
                        <th className="px-4 py-2 font-medium">Label</th>
                        <th className="px-4 py-2 font-medium">Base extracted</th>
                        <th className="px-4 py-2 font-medium">Vision sees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionnaireData.indexed.visionCorrection.remainingDiscrepancies.map((d: any, idx: number) => (
                        <tr
                          key={idx}
                          className="border-t border-default hover:bg-card-hover cursor-pointer"
                          onClick={() => {
                            selectMultiple("indexed", [d.itemId]);
                            indexedPanelRef.current?.scrollToItem(d.itemId);
                          }}
                        >
                          <td className="px-4 py-2 text-primary">
                            <div className="truncate max-w-[250px]" title={d.label}>
                              {d.label}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-primary">
                            <div className="truncate max-w-[250px]" title={d.baseValue}>
                              {d.baseValue || <span className="text-muted italic">empty</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-orange-400">
                            <div className="truncate max-w-[250px]" title={d.visionValue}>
                              {d.visionValue}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* All good message */}
              {(!questionnaireData.indexed.visionCorrection.corrections?.length &&
                !questionnaireData.indexed.visionCorrection.remainingDiscrepancies?.length) && (
                <div className="p-8 text-center text-muted">
                  <div className="text-emerald-500 text-2xl mb-2">✓</div>
                  <div>Vision confirms the base extraction is correct</div>
                </div>
              )}
            </div>
          ) : (questionnaireData?.indexed?.visionValidation?.discrepancies?.length ?? 0) > 0 ? (
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-[12px]">
                <thead className="bg-app-secondary sticky top-0">
                  <tr className="text-left text-muted">
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium w-24">Type</th>
                    <th className="px-4 py-2 font-medium w-28">Base extracted</th>
                    <th className="px-4 py-2 font-medium w-28">Vision sees</th>
                    <th className="px-4 py-2 font-medium w-36">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                {questionnaireData?.indexed?.visionValidation?.discrepancies?.map((d, idx) => (
                  <tr
                    key={idx}
                    className={`border-t border-default hover:bg-card-hover ${d.reviewed ? 'opacity-50' : ''}`}
                  >
                    <td
                      className="px-4 py-2 text-primary cursor-pointer"
                      onClick={() => {
                        selectMultiple("indexed", [d.itemId]);
                        indexedPanelRef.current?.scrollToItem(d.itemId);
                      }}
                    >
                      <div className="truncate max-w-[300px]" title={d.label}>
                        {d.label}
                      </div>
                      {d.visionQuestion !== d.label && (
                        <div className="text-[10px] text-muted truncate max-w-[300px]" title={d.visionQuestion}>
                          Vision: {d.visionQuestion}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        d.type === 'mismatch' ? 'bg-orange-500/20 text-orange-400' :
                        d.type === 'missing_in_base' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-muted/20 text-muted'
                      }`}>
                        {d.type === 'mismatch' ? 'Mismatch' :
                         d.type === 'missing_in_base' ? 'Base empty' : 'Vision empty'}
                      </span>
                    </td>
                    <td className={`px-4 py-2 ${d.verdict === 'base_correct' ? 'text-emerald-400 font-medium' : 'text-primary'}`}>
                      {d.baseValue || <span className="text-muted italic">empty</span>}
                    </td>
                    <td className={`px-4 py-2 ${d.verdict === 'vision_correct' ? 'text-emerald-400 font-medium' : 'text-orange-400'}`}>
                      {d.visionValue}
                    </td>
                    <td className="px-4 py-2">
                      {d.reviewed ? (
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            d.verdict === 'base_correct' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {d.verdict === 'base_correct' ? '✓ Base correct' : '✓ Used Vision'}
                          </span>
                          <button
                            className="px-1.5 py-0.5 text-[10px] text-muted hover:text-primary hover:bg-card-hover rounded cursor-pointer"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!currentQuestionnaire) return;
                              try {
                                await undoDiscrepancyVerdict(currentQuestionnaire, idx);
                                toast.success("Verdict undone");
                                queryClient.invalidateQueries({ queryKey: ["questionnaire", currentQuestionnaire] });
                              } catch {
                                toast.error("Failed to undo verdict");
                              }
                            }}
                            title="Undo this verdict"
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded cursor-pointer"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!currentQuestionnaire) return;
                              try {
                                await submitDiscrepancyVerdict(currentQuestionnaire, idx, 'base_correct');
                                toast.success("Marked base as correct");
                                queryClient.invalidateQueries({ queryKey: ["questionnaire", currentQuestionnaire] });
                              } catch {
                                toast.error("Failed to submit verdict");
                              }
                            }}
                            title="Base extraction is correct"
                          >
                            Base ✓
                          </button>
                          <button
                            className="px-2 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded cursor-pointer"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!currentQuestionnaire) return;
                              try {
                                await submitDiscrepancyVerdict(currentQuestionnaire, idx, 'vision_correct');
                                toast.success("Updated to Vision value");
                                queryClient.invalidateQueries({ queryKey: ["questionnaire", currentQuestionnaire] });
                              } catch {
                                toast.error("Failed to submit verdict");
                              }
                            }}
                            title="Vision is correct - use this value"
                          >
                            Vision ✓
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-muted">
              <div className="text-emerald-500 text-2xl mb-2">✓</div>
              <div>Vision confirms the base extraction is correct</div>
            </div>
          )}
        </div>
      )}

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
