// Questionnaire list item
export interface QuestionnaireListItem {
  name: string;
  displayName: string;
  completed?: boolean;
  feedbackCount?: number;
}

// Cell reference in Excel
export interface CellRef {
  sheet: string;
  row: number;
  col: number;
}

// Indexed item from extraction
export interface IndexedItem {
  id: string;
  label: string;
  value: string;
  section: string;
  topic?: string;
  level?: 'entity' | 'product';
  ref?: CellRef;
  reviewStatus?: 'accepted' | 'rejected';
  rejectReason?: string;
}

// Library item (answer library entry)
export interface LibraryItem {
  id: string;
  label: string;
  value: string;
  topic?: string;
  dataSource?: 'answer_library' | 'entities' | 'products';
  reviewStatus?: 'accepted' | 'rejected';
  rejectReason?: string;
}

// Excel cell data
export interface ExcelCell {
  value: string;
  row: number;
  col: number;
  bold?: boolean;
  italic?: boolean;
  merged?: boolean;
  mergedHidden?: boolean;
  type?: 'header' | 'label' | 'section' | 'value';
}

// Excel sheet data
export interface ExcelSheet {
  name: string;
  rows: ExcelCell[][];
}

// Full questionnaire data (from /api/questionnaire/:id)
export interface QuestionnaireData {
  name: string;
  displayName: string;
  sheets: ExcelSheet[];
  indexed: {
    sections: {
      name: string;
      items: IndexedItem[];
    }[];
  };
  library: LibraryItem[];
  feedback?: FeedbackEntry[];
}

// Feedback entry
export interface FeedbackEntry {
  itemId: string;
  panel: 'indexed' | 'library';
  action: 'accepted' | 'rejected';
  reason?: string;
  timestamp: string;
}

// API response types
export interface QuestionnairesResponse {
  questionnaires: QuestionnaireListItem[];
}

export interface HealthResponse {
  status: 'ok';
}

// UI State types
export interface Tab {
  name: string;
  displayName: string;
  completed?: boolean;
}

export type PanelType = 'original' | 'indexed' | 'library';

export interface SelectionState {
  panel: 'indexed' | 'library';
  itemIds: Set<string>;
}

// Cell selection for feedback on original panel
export interface CellSelection {
  sheet: string;
  row: number;
  col: number;
  cellRef: string; // e.g., "A1"
  value: string;
}

// Cell feedback types
export type CellFeedbackType =
  | 'mark_as_question'
  | 'mark_as_answer'
  | 'mark_as_section'
  | 'mark_as_header'
  | 'exclude'
  | 'correct_topic';

export interface CellFeedback {
  cellRef: string;
  sheet: string;
  feedbackType: CellFeedbackType;
  topic?: string;
  reason?: string;
  timestamp: string;
}
