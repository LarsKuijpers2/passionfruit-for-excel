import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchHealth,
  fetchQuestionnaires,
  fetchQuestionnaire,
  submitFeedback,
  completeReview,
} from './api';
import type {
  Tab,
  PanelType,
  IndexedItem,
  LibraryItem,
  FeedbackEntry,
} from './types';
import { TabBar } from './components/TabBar';
import { OriginalPanel } from './components/OriginalPanel';
import { IndexedPanel } from './components/IndexedPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { CommandPalette } from './components/CommandPalette';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  // UI State
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [currentQuestionnaire, setCurrentQuestionnaire] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [visiblePanels, setVisiblePanels] = useState<Set<PanelType>>(
    new Set(['original', 'indexed', 'library'])
  );
  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  // Selection state
  const [selectedPanel, setSelectedPanel] = useState<'indexed' | 'library' | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Feedback state (pending changes)
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackEntry[]>([]);

  // Health check
  const { data: healthData } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
    retry: false,
  });

  // Questionnaire list
  const { data: questionnairesData } = useQuery({
    queryKey: ['questionnaires'],
    queryFn: fetchQuestionnaires,
  });

  // Current questionnaire data
  const { data: questionnaireData, isLoading: questionnaireLoading } = useQuery({
    queryKey: ['questionnaire', currentQuestionnaire],
    queryFn: () => fetchQuestionnaire(currentQuestionnaire!),
    enabled: !!currentQuestionnaire,
  });

  // Feedback mutation
  const feedbackMutation = useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: FeedbackEntry[] }) =>
      submitFeedback(id, feedback),
    onSuccess: () => {
      if (currentQuestionnaire) {
        queryClient.invalidateQueries({ queryKey: ['questionnaire', currentQuestionnaire] });
      }
      setPendingFeedback([]);
    },
  });

  // Complete review mutation
  const completeMutation = useMutation({
    mutationFn: (id: string) => completeReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      if (currentQuestionnaire) {
        // Mark tab as completed
        setOpenTabs((tabs) =>
          tabs.map((t) =>
            t.name === currentQuestionnaire ? { ...t, completed: true } : t
          )
        );
      }
    },
  });

  // Check URL for questionnaire parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      openTab(q);
    }
  }, []);

  // Set active sheet when questionnaire data loads
  useEffect(() => {
    if (questionnaireData?.sheets?.length && !activeSheet) {
      setActiveSheet(questionnaireData.sheets[0].name);
    }
  }, [questionnaireData, activeSheet]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (selectedItems.size > 0) {
          setCommandPaletteOpen(true);
        }
      }

      // Escape to close command palette or clear selection
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (selectedItems.size > 0) {
          setSelectedItems(new Set());
          setSelectedPanel(null);
        }
      }

      // R to toggle review mode
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !commandPaletteOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          setReviewMode((prev) => !prev);
        }
      }

      // B to toggle sidebar
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !commandPaletteOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          setSidebarOpen((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, commandPaletteOpen]);

  // Tab management
  const openTab = useCallback((name: string) => {
    const questionnaire = questionnairesData?.questionnaires.find((q) => q.name === name);
    if (!questionnaire) return;

    setOpenTabs((tabs) => {
      if (tabs.some((t) => t.name === name)) return tabs;
      return [
        ...tabs,
        {
          name: questionnaire.name,
          displayName: questionnaire.displayName,
          completed: questionnaire.completed,
        },
      ];
    });

    setCurrentQuestionnaire(name);
    setActiveSheet(null); // Reset sheet selection
    setSidebarOpen(false);

    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('q', name);
    window.history.pushState({}, '', url.toString());
  }, [questionnairesData]);

  const closeTab = useCallback((index: number) => {
    setOpenTabs((tabs) => {
      const newTabs = [...tabs];
      const closedTab = newTabs.splice(index, 1)[0];

      if (closedTab.name === currentQuestionnaire) {
        if (newTabs.length > 0) {
          const nextIndex = Math.min(index, newTabs.length - 1);
          setCurrentQuestionnaire(newTabs[nextIndex].name);
        } else {
          setCurrentQuestionnaire(null);
          window.history.pushState({}, '', window.location.pathname);
        }
      }

      return newTabs;
    });
  }, [currentQuestionnaire]);

  const switchTab = useCallback((name: string) => {
    if (name === currentQuestionnaire) return;
    setCurrentQuestionnaire(name);
    setActiveSheet(null);

    const url = new URL(window.location.href);
    url.searchParams.set('q', name);
    window.history.pushState({}, '', url.toString());
  }, [currentQuestionnaire]);

  // Panel toggle
  const togglePanel = useCallback((panel: PanelType) => {
    setVisiblePanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        next.delete(panel);
      } else {
        next.add(panel);
      }
      return next;
    });
  }, []);

  // Item selection
  const handleItemSelect = useCallback(
    (panel: 'indexed' | 'library', itemId: string, multiSelect: boolean) => {
      if (selectedPanel && selectedPanel !== panel) {
        // Switching panels - clear selection
        setSelectedPanel(panel);
        setSelectedItems(new Set([itemId]));
        return;
      }

      setSelectedPanel(panel);
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (multiSelect) {
          if (next.has(itemId)) {
            next.delete(itemId);
          } else {
            next.add(itemId);
          }
        } else {
          if (next.has(itemId) && next.size === 1) {
            next.clear();
          } else {
            next.clear();
            next.add(itemId);
          }
        }
        return next;
      });
    },
    [selectedPanel]
  );

  // Review actions
  const handleAccept = useCallback((panel: 'indexed' | 'library', itemId: string) => {
    const entry: FeedbackEntry = {
      itemId,
      panel,
      action: 'accepted',
      timestamp: new Date().toISOString(),
    };
    setPendingFeedback((prev) => [...prev.filter((f) => f.itemId !== itemId), entry]);
  }, []);

  const handleReject = useCallback((panel: 'indexed' | 'library', itemId: string, reason?: string) => {
    const entry: FeedbackEntry = {
      itemId,
      panel,
      action: 'rejected',
      reason,
      timestamp: new Date().toISOString(),
    };
    setPendingFeedback((prev) => [...prev.filter((f) => f.itemId !== itemId), entry]);
  }, []);

  // Get review status for an item (from pending feedback or existing data)
  const getReviewStatus = useCallback(
    (itemId: string): 'accepted' | 'rejected' | undefined => {
      const pending = pendingFeedback.find((f) => f.itemId === itemId);
      if (pending) return pending.action;
      return undefined;
    },
    [pendingFeedback]
  );

  // Complete review
  const handleCompleteReview = useCallback(() => {
    if (!currentQuestionnaire) return;

    // First submit pending feedback
    if (pendingFeedback.length > 0) {
      feedbackMutation.mutate({ id: currentQuestionnaire, feedback: pendingFeedback });
    }

    // Then mark as complete
    completeMutation.mutate(currentQuestionnaire);
  }, [currentQuestionnaire, pendingFeedback, feedbackMutation, completeMutation]);

  // Command palette apply
  const handleCommandPaletteApply = useCallback(
    (updates: { action?: 'accept' | 'reject' | 'reset'; reason?: string }) => {
      if (!selectedPanel) return;

      selectedItems.forEach((itemId) => {
        if (updates.action === 'accept') {
          handleAccept(selectedPanel, itemId);
        } else if (updates.action === 'reject') {
          handleReject(selectedPanel, itemId, updates.reason);
        } else if (updates.action === 'reset') {
          setPendingFeedback((prev) => prev.filter((f) => f.itemId !== itemId));
        }
      });

      setCommandPaletteOpen(false);
      setSelectedItems(new Set());
      setSelectedPanel(null);
    },
    [selectedPanel, selectedItems, handleAccept, handleReject]
  );

  // Get all items for the selected panel
  const getSelectedItemsData = useCallback((): (IndexedItem | LibraryItem)[] => {
    if (!questionnaireData || !selectedPanel) return [];

    if (selectedPanel === 'indexed') {
      const allItems: IndexedItem[] = [];
      questionnaireData.indexed?.sections?.forEach((section) => {
        allItems.push(...section.items);
      });
      return allItems.filter((item) => selectedItems.has(item.id));
    } else {
      return (questionnaireData.library || []).filter((item) =>
        selectedItems.has(item.id)
      );
    }
  }, [questionnaireData, selectedPanel, selectedItems]);

  const serverConnected = !!healthData;
  const questionnaires = questionnairesData?.questionnaires || [];

  // Welcome screen if no questionnaire selected
  if (!currentQuestionnaire) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 p-10">
        <h1 className="text-2xl font-semibold">Passionfruit Review</h1>
        <p className="text-muted-foreground max-w-[400px] text-center">
          Select a questionnaire to review its indexed structure and harvested library
          items.
        </p>
        <div className="flex flex-col gap-2 max-w-[500px] w-full max-h-[400px] overflow-y-auto">
          {questionnaires.map((q) => (
            <div
              key={q.name}
              className="flex justify-between items-center py-3 px-4 bg-card border border-border rounded cursor-pointer transition-all duration-150 hover:bg-accent hover:border-muted-foreground"
              onClick={() => openTab(q.name)}
            >
              <span className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                {q.displayName}
              </span>
              {q.feedbackCount ? (
                <span className="text-xs text-muted-foreground">{q.feedbackCount} items</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Loading state
  if (questionnaireLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="loading-spinner" />
        <div className="text-muted-foreground">Loading questionnaire...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <TabBar
        tabs={openTabs}
        currentTab={currentQuestionnaire}
        questionnaires={questionnaires}
        serverConnected={serverConnected}
        reviewMode={reviewMode}
        feedbackCount={pendingFeedback.length}
        theme={theme}
        onSidebarToggle={() => setSidebarOpen((prev) => !prev)}
        onTabClick={switchTab}
        onTabClose={closeTab}
        onAddTab={openTab}
        onReviewToggle={() => setReviewMode((prev) => !prev)}
        onComplete={handleCompleteReview}
        onThemeChange={setTheme}
      />

      {/* Sidebar overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-[99] transition-all duration-200 ${
          sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-10 bottom-10 w-[300px] bg-card border-r border-border flex flex-col z-[100] transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="py-3 px-4 border-b border-border font-medium text-[13px]">
          Questionnaires
        </div>
        <div className="flex-1 overflow-y-auto">
          {questionnaires.map((q) => (
            <div
              key={q.name}
              className={`flex items-center py-2.5 px-4 cursor-pointer transition-colors duration-150 border-b border-border gap-2 hover:bg-muted ${
                currentQuestionnaire === q.name ? 'bg-accent border-l-2 border-l-foreground' : ''
              }`}
              onClick={() => openTab(q.name)}
            >
              {q.completed && <span className="text-green-500 text-sm">&#10003;</span>}
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
                {q.displayName}
              </span>
              {q.feedbackCount ? (
                <span className="text-[11px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                  {q.feedbackCount}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Sheet tabs */}
      <div className="flex items-center gap-0.5 px-4 bg-card border-b border-border h-9 overflow-x-auto scrollbar-none">
        {questionnaireData?.sheets?.map((sheet) => (
          <button
            key={sheet.name}
            className={`px-3.5 py-1.5 bg-transparent border-0 border-b-2 border-transparent rounded-none text-xs font-medium text-muted-foreground cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-foreground hover:bg-white/[0.03] ${
              activeSheet === sheet.name ? 'text-foreground border-b-foreground bg-transparent' : ''
            }`}
            onClick={() => setActiveSheet(sheet.name)}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      {/* Panel headers */}
      <div className="flex bg-card border-b border-border">
        <div
          className={`flex-1 py-2 px-4 flex justify-between items-center font-medium text-[13px] border-r border-border cursor-pointer transition-all duration-150 hover:bg-muted ${
            visiblePanels.has('original') ? 'bg-white/5 border-b-2 border-b-foreground' : 'opacity-50'
          }`}
          onClick={() => togglePanel('original')}
        >
          <span className={`w-4 h-4 flex items-center justify-center mr-2 ${visiblePanels.has('original') ? 'opacity-100' : 'opacity-50'}`}>
            &#9679;
          </span>
          <span>Original Questionnaire</span>
        </div>
        <div
          className={`flex-1 py-2 px-4 flex justify-between items-center font-medium text-[13px] border-r border-border cursor-pointer transition-all duration-150 hover:bg-muted ${
            visiblePanels.has('indexed') ? 'bg-white/5 border-b-2 border-b-foreground' : 'opacity-50'
          }`}
          onClick={() => togglePanel('indexed')}
        >
          <span className={`w-4 h-4 flex items-center justify-center mr-2 ${visiblePanels.has('indexed') ? 'opacity-100' : 'opacity-50'}`}>
            &#9679;
          </span>
          <span>Extraction</span>
        </div>
        <div
          className={`flex-1 py-2 px-4 flex justify-between items-center font-medium text-[13px] cursor-pointer transition-all duration-150 hover:bg-muted ${
            visiblePanels.has('library') ? 'bg-white/5 border-b-2 border-b-foreground' : 'opacity-50'
          }`}
          onClick={() => togglePanel('library')}
        >
          <span className={`w-4 h-4 flex items-center justify-center mr-2 ${visiblePanels.has('library') ? 'opacity-100' : 'opacity-50'}`}>
            &#9679;
          </span>
          <span>Save as</span>
        </div>
      </div>

      {/* Main panels */}
      <div className="flex flex-1 overflow-hidden">
        <OriginalPanel
          visible={visiblePanels.has('original')}
          sheet={questionnaireData?.sheets?.find((s) => s.name === activeSheet)}
        />
        <IndexedPanel
          visible={visiblePanels.has('indexed')}
          sections={questionnaireData?.indexed?.sections || []}
          selectedItems={selectedPanel === 'indexed' ? selectedItems : new Set()}
          reviewMode={reviewMode}
          getReviewStatus={getReviewStatus}
          onItemSelect={(id, multi) => handleItemSelect('indexed', id, multi)}
          onAccept={(id) => handleAccept('indexed', id)}
          onReject={(id, reason) => handleReject('indexed', id, reason)}
        />
        <LibraryPanel
          visible={visiblePanels.has('library')}
          items={questionnaireData?.library || []}
          selectedItems={selectedPanel === 'library' ? selectedItems : new Set()}
          reviewMode={reviewMode}
          getReviewStatus={getReviewStatus}
          onItemSelect={(id, multi) => handleItemSelect('library', id, multi)}
          onAccept={(id) => handleAccept('library', id)}
          onReject={(id, reason) => handleReject('library', id, reason)}
        />
      </div>

      {/* Stats bar */}
      <div className="flex justify-between items-center py-2 px-5 bg-card border-t border-border text-xs text-muted-foreground">
        <div className="flex gap-4">
          {questionnaireData?.indexed?.sections && (
            <span>
              {questionnaireData.indexed.sections.reduce(
                (acc, s) => acc + s.items.length,
                0
              )}{' '}
              indexed items
            </span>
          )}
          {questionnaireData?.library && (
            <span>{questionnaireData.library.length} library items</span>
          )}
        </div>
        <div className="flex gap-4">
          {pendingFeedback.length > 0 && (
            <span>{pendingFeedback.length} pending changes</span>
          )}
        </div>
      </div>

      {/* Selection badge */}
      {selectedItems.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-card border border-border text-foreground py-2 px-4 rounded-full text-[13px] font-medium flex items-center gap-3 shadow-lg z-[1000]">
          <span>
            {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} selected
          </span>
          <kbd className="bg-muted px-1.5 py-0.5 rounded text-[11px]">&#8984;K</kbd> to edit
        </div>
      )}

      {/* Command palette */}
      <CommandPalette
        visible={commandPaletteOpen}
        selectedCount={selectedItems.size}
        selectedItems={getSelectedItemsData()}
        panel={selectedPanel}
        onClose={() => setCommandPaletteOpen(false)}
        onApply={handleCommandPaletteApply}
      />
    </div>
  );
}
