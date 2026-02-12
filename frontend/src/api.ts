import type {
  QuestionnairesResponse,
  QuestionnaireData,
  HealthResponse,
  FeedbackEntry,
} from './types';

const API_BASE = '';

// Health check
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error('Server not healthy');
  return res.json();
}

// List all questionnaires
export async function fetchQuestionnaires(): Promise<QuestionnairesResponse> {
  const res = await fetch(`${API_BASE}/api/questionnaires`);
  if (!res.ok) throw new Error('Failed to fetch questionnaires');
  return res.json();
}

// Get single questionnaire data
export async function fetchQuestionnaire(id: string): Promise<QuestionnaireData> {
  const res = await fetch(`${API_BASE}/api/questionnaire/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch questionnaire: ${id}`);
  return res.json();
}

// Submit feedback for items
export async function submitFeedback(
  questionnaireId: string,
  feedback: FeedbackEntry[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/feedback/${encodeURIComponent(questionnaireId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) throw new Error('Failed to submit feedback');
}

// Complete review for a questionnaire
export async function completeReview(questionnaireId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/complete/${encodeURIComponent(questionnaireId)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to complete review');
}

// Update item properties (label, value, section, topic, etc.)
export async function updateItem(
  questionnaireId: string,
  panel: 'indexed' | 'library',
  itemId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/${panel}/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error('Failed to update item');
}

// Bulk update items
export async function bulkUpdateItems(
  questionnaireId: string,
  panel: 'indexed' | 'library',
  itemIds: string[],
  updates: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/${panel}/bulk`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, updates }),
    }
  );
  if (!res.ok) throw new Error('Failed to bulk update items');
}

// Export items grouped by destination
export async function exportGrouped(
  questionnaireId: string
): Promise<{ success: boolean; path: string; stats: { company: number; library: number; product: number; questionnaire: number; exclude: number; total: number } }> {
  const res = await fetch(
    `${API_BASE}/api/export-grouped/${encodeURIComponent(questionnaireId)}`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Failed to export grouped data');
  return res.json();
}

// Save notes for a questionnaire
export async function saveNotes(
  questionnaireId: string,
  notes: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    }
  );
  if (!res.ok) throw new Error('Failed to save notes');
}
