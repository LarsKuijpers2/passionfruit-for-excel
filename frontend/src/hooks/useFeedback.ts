import { useState, useCallback } from 'react';
import type { FeedbackEntry } from '../types';

interface UseFeedbackReturn {
  pendingFeedback: FeedbackEntry[];
  getReviewStatus: (itemId: string) => 'accepted' | 'rejected' | undefined;
  handleAccept: (panel: 'indexed' | 'library', itemId: string) => void;
  handleReject: (panel: 'indexed' | 'library', itemId: string, reason?: string) => void;
  resetFeedback: (itemId: string) => void;
  clearPendingFeedback: () => void;
}

export function useFeedback(): UseFeedbackReturn {
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackEntry[]>([]);

  const getReviewStatus = useCallback(
    (itemId: string): 'accepted' | 'rejected' | undefined => {
      const pending = pendingFeedback.find((f) => f.itemId === itemId);
      return pending?.action;
    },
    [pendingFeedback]
  );

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

  const resetFeedback = useCallback((itemId: string) => {
    setPendingFeedback((prev) => prev.filter((f) => f.itemId !== itemId));
  }, []);

  const clearPendingFeedback = useCallback(() => {
    setPendingFeedback([]);
  }, []);

  return {
    pendingFeedback,
    getReviewStatus,
    handleAccept,
    handleReject,
    resetFeedback,
    clearPendingFeedback,
  };
}
