// Questionnaire list item
export interface QuestionnaireListItem {
  name: string;
  displayName: string;
  completed?: boolean;
  feedbackCount?: number;
  customer?: string;
  approvedAt?: string;
  approvedCount?: number;
  apiReadyAt?: string;
  apiReadyCount?: number;
}

// Destination types
export type Destination = 'company' | 'answer_library' | 'product' | 'exclude';

// Indexed item from extraction
export interface IndexedItem {
  id?: string;
  type: string;
  label: string;
  value?: string;
  topic: string;
  level: string;
  lang?: string;
  lCell?: string;
  vCell?: string;
  ref?: string;
  // Destination tagging (from TAG step)
  destination?: Destination | null;
  needs_review?: boolean;
  tag_source?: string;
}

// Indexed section
export interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet: string;
  items: IndexedItem[];
}

// Library item (answer library entry)
export interface LibraryItem {
  id?: string;
  type?: string;
  label: string;
  value: string;
  topic?: string;
  level?: string;
  lang?: string;
  destination?: Destination;
  lCell?: string;
  source?: {
    file: string;
    sheet: string;
  };
}

// Excel cell data (from structure)
export interface ExcelCell {
  ref: string;
  value: string;
  type?: string;
  filled?: boolean;
  role?: 'header' | 'section' | 'label' | 'input' | 'value' | 'empty';
  format?: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    fontColor?: string;
  };
}

// Excel row from API
export interface ExcelSheetRow {
  row: number;
  cells: Record<string, ExcelCell>;
  isEmpty?: boolean;
  rowType?: string;
}

// Excel sheet data (from structure)
export interface ExcelSheet {
  name: string;
  index: number;
  rows: ExcelSheetRow[];
  headers?: string[];
  rowCount: number;
  columnCount: number;
}

// Full questionnaire data (from /api/questionnaire/:id)
export interface QuestionnaireData {
  id: string;
  structure: {
    source: {
      file: string;
      documentType: string;
    };
    sheets: ExcelSheet[];
  };
  indexed: {
    id: string;
    source: string;
    language: string;
    sections: IndexedSection[];
    stats?: {
      total: number;
      answered: number;
    };
  };
  library: {
    id?: string;
    total?: number;
    byTopic?: Record<string, LibraryItem[]>;
  } | LibraryItem[];
  feedback?: FeedbackData | null;
}

// Feedback entry
export interface FeedbackEntry {
  itemId: string;
  panel: 'indexed' | 'library';
  action: 'accepted' | 'rejected';
  reason?: string;
  timestamp: string;
}

// Feedback data from server
export interface FeedbackData {
  meta: {
    source: string;
    questionnaire: string;
  };
  index: FeedbackEntry[];
  library: FeedbackEntry[];
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

// Cell selection for feedback on original panel
export interface CellSelection {
  sheet: string;
  row: number;
  col: number;
  cellRef: string;
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
