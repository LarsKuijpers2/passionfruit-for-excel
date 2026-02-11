import { useState, useCallback, useEffect } from 'react';
import type { Tab, QuestionnaireListItem } from '../types';

interface UseTabsReturn {
  openTabs: Tab[];
  currentQuestionnaire: string | null;
  openTab: (name: string) => void;
  closeTab: (index: number) => void;
  switchTab: (name: string) => void;
  markCompleted: (name: string) => void;
}

export function useTabs(questionnaires: QuestionnaireListItem[]): UseTabsReturn {
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [currentQuestionnaire, setCurrentQuestionnaire] = useState<string | null>(null);

  // Check URL for questionnaire parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q && questionnaires.length > 0) {
      const questionnaire = questionnaires.find((qst) => qst.name === q);
      if (questionnaire) {
        setOpenTabs((tabs) => {
          if (tabs.some((t) => t.name === q)) return tabs;
          return [...tabs, {
            name: questionnaire.name,
            displayName: questionnaire.displayName,
            completed: questionnaire.completed,
          }];
        });
        setCurrentQuestionnaire(q);
      }
    }
  }, [questionnaires]);

  const openTab = useCallback((name: string) => {
    const questionnaire = questionnaires.find((q) => q.name === name);
    if (!questionnaire) return;

    setOpenTabs((tabs) => {
      if (tabs.some((t) => t.name === name)) return tabs;
      return [...tabs, {
        name: questionnaire.name,
        displayName: questionnaire.displayName,
        completed: questionnaire.completed,
      }];
    });

    setCurrentQuestionnaire(name);

    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('q', name);
    window.history.pushState({}, '', url.toString());
  }, [questionnaires]);

  const closeTab = useCallback((index: number) => {
    setOpenTabs((tabs) => {
      const newTabs = [...tabs];
      const closedTab = newTabs.splice(index, 1)[0];

      if (closedTab.name === currentQuestionnaire) {
        if (newTabs.length > 0) {
          const nextIndex = Math.min(index, newTabs.length - 1);
          setCurrentQuestionnaire(newTabs[nextIndex].name);
          const url = new URL(window.location.href);
          url.searchParams.set('q', newTabs[nextIndex].name);
          window.history.pushState({}, '', url.toString());
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

    const url = new URL(window.location.href);
    url.searchParams.set('q', name);
    window.history.pushState({}, '', url.toString());
  }, [currentQuestionnaire]);

  const markCompleted = useCallback((name: string) => {
    setOpenTabs((tabs) =>
      tabs.map((t) => (t.name === name ? { ...t, completed: true } : t))
    );
  }, []);

  return {
    openTabs,
    currentQuestionnaire,
    openTab,
    closeTab,
    switchTab,
    markCompleted,
  };
}
