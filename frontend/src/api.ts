import type {
  QuestionnairesResponse,
  QuestionnaireData,
  HealthResponse,
  FeedbackEntry,
  AggregatedLibraryData,
  StandardQuestionsData,
  CuratedLibraryData,
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

// Fetch pipeline data for a customer
export async function fetchPipeline(customer: string): Promise<PipelineData> {
  const res = await fetch(`${API_BASE}/api/pipeline/${encodeURIComponent(customer)}`);
  if (!res.ok) throw new Error(`Failed to fetch pipeline: ${customer}`);
  return res.json();
}

export interface PipelineData {
  customer?: string;
  supplier?: {
    id: string;
    name: string;
    address?: string;
    role?: string;
  };
  products?: Array<{
    id: string;
    name: string;
    variants?: Array<{ id: string; name: string }>;
  }>;
  questionnaires: Array<{
    file: string;
    requestedBy?: string;
    type?: 'product' | 'supplier';
    product?: string | null;
    status: 'incoming' | 'stored' | 'indexed' | 'reviewed' | 'approved';
    entities?: Array<{ name: string; role: string }>;
    understanding?: {
      summary?: string;
      topics?: string[];
      needsReview?: string[];
    };
  }>;
  counts: {
    incoming: number;
    stored: number;
    indexed: number;
    reviewed: number;
    approved: number;
  };
  pipelineSteps?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
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

// Save structure changes (split view edits)
export async function saveStructure(
  questionnaireId: string,
  sheet: unknown
): Promise<{ success: boolean; path: string }> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/structure`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet }),
    }
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to save structure (${res.status})`);
  }
  return res.json();
}

// =============================================================================
// AGGREGATED LIBRARY API
// =============================================================================

// Get aggregated answer library for a customer
export async function fetchAggregatedLibrary(
  customer: string
): Promise<AggregatedLibraryData> {
  const res = await fetch(
    `${API_BASE}/api/aggregated-library/${encodeURIComponent(customer)}`
  );
  if (!res.ok) throw new Error('Failed to fetch aggregated library');
  return res.json();
}

// Merge similar items in the aggregated library
export async function mergeLibraryItems(
  customer: string,
  itemIds: string[],
  keepId: string,
  mergedLabel?: string
): Promise<{ success: boolean; merged: number; result: any }> {
  const res = await fetch(
    `${API_BASE}/api/aggregated-library/${encodeURIComponent(customer)}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, keepId, mergedLabel }),
    }
  );
  if (!res.ok) throw new Error('Failed to merge library items');
  return res.json();
}

// Get standard questions for a customer
export async function fetchStandardQuestions(
  customer: string
): Promise<StandardQuestionsData> {
  const res = await fetch(
    `${API_BASE}/api/standard-questions/${encodeURIComponent(customer)}`
  );
  if (!res.ok) throw new Error('Failed to fetch standard questions');
  return res.json();
}

// Get curated library for a customer
export async function fetchCuratedLibrary(
  customer: string
): Promise<CuratedLibraryData> {
  const res = await fetch(
    `${API_BASE}/api/curated-library/${encodeURIComponent(customer)}`
  );
  if (!res.ok) throw new Error('Failed to fetch curated library');
  return res.json();
}

// =============================================================================
// VISION VALIDATION API
// =============================================================================

// Submit verdict for a Vision discrepancy
export async function submitDiscrepancyVerdict(
  questionnaireId: string,
  discrepancyIndex: number,
  verdict: 'base_correct' | 'vision_correct'
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/vision-validation/verdict`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discrepancyIndex, verdict }),
    }
  );
  if (!res.ok) throw new Error('Failed to submit verdict');
  return res.json();
}

// Undo verdict for a Vision discrepancy
export async function undoDiscrepancyVerdict(
  questionnaireId: string,
  discrepancyIndex: number
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/vision-validation/undo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discrepancyIndex }),
    }
  );
  if (!res.ok) throw new Error('Failed to undo verdict');
  return res.json();
}

// =============================================================================
// ANNOTATION API
// =============================================================================

export interface AnnotatedTable {
  id: string;
  pageNumber: number;
  title?: string;
  headers: string[];
  rows: Array<Array<{ value: string; isHeader?: boolean; isEdited?: boolean; originalValue?: string }>>;
  notes?: string;
  createdAt?: string;
  isNew?: boolean;
}

// Save page annotation for training data
export async function saveAnnotation(
  questionnaireId: string,
  pageNumber: number,
  tables: AnnotatedTable[],
  notes: string,
  customer?: string
): Promise<{ success: boolean; path: string; tableCount: number }> {
  const res = await fetch(
    `${API_BASE}/api/questionnaire/${encodeURIComponent(questionnaireId)}/annotate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber, tables, notes, customer }),
    }
  );
  if (!res.ok) throw new Error('Failed to save annotation');
  return res.json();
}

// =============================================================================
// TRAINING DATA API
// =============================================================================

export interface TrainingStatus {
  customer: string;
  hasTrainingData: boolean;
  correctionsCount: number;
  lastCorrectionAt: string | null;
  compiledAt: string | null;
  isStale: boolean;
  questionnairesWithCorrections: string[];
}

export interface CompiledTraining {
  version: string;
  compiledAt: string;
  customer: string;
  stats: {
    totalCorrections: number;
    destinationChanges: number;
    valueChanges: number;
    questionnairesUsed: number;
    lastCorrectionAt: string;
  };
  destinationPatterns: Array<{
    pattern: string;
    section?: string;
    fromDestination: string;
    toDestination: string;
    confidence: number;
    examples: string[];
    notes: string[];
  }>;
  fewShotExamples: Array<{
    context: string;
    label: string;
    section: string;
    originalDestination: string;
    correctDestination: string;
    reasoning: string;
  }>;
  hardRules: Array<{
    labelContains: string;
    destination: string;
    source: 'human_correction';
  }>;
}

// Get training status for all customers
export async function fetchAllTrainingStatus(): Promise<{ statuses: TrainingStatus[] }> {
  const res = await fetch(`${API_BASE}/api/training/status`);
  if (!res.ok) throw new Error('Failed to fetch training status');
  return res.json();
}

// Get training status for a specific customer
export async function fetchTrainingStatus(customer: string): Promise<TrainingStatus> {
  const res = await fetch(`${API_BASE}/api/training/status/${encodeURIComponent(customer)}`);
  if (!res.ok) throw new Error('Failed to fetch training status');
  return res.json();
}

// Compile training data for a customer
export async function compileTraining(customer: string): Promise<{
  success: boolean;
  stats: CompiledTraining['stats'];
  patternsCount: number;
  examplesCount: number;
  rulesCount: number;
}> {
  const res = await fetch(`${API_BASE}/api/training/compile/${encodeURIComponent(customer)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to compile training data');
  return res.json();
}

// Get compiled training data for a customer
export async function fetchCompiledTraining(customer: string): Promise<CompiledTraining> {
  const res = await fetch(`${API_BASE}/api/training/compiled/${encodeURIComponent(customer)}`);
  if (!res.ok) throw new Error('Failed to fetch compiled training');
  return res.json();
}
