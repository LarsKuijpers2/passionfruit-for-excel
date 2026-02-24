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
export type Destination = 'company' | 'answer_library' | 'product' | 'questionnaire' | 'exclude';

// Entity role - which party does this data belong to
export type EntityRole = 'supplier' | 'customer' | 'manufacturer' | 'producer' | 'group' | 'other';

// An entity detected in the questionnaire
export interface DetectedEntity {
  id: string;  // Short UUID
  name: string;  // Entity name
  role: EntityRole;  // Detected role
  nameSource?: {
    label: string;
    cell?: string;
  };
}

// A product detected in the questionnaire
export interface DetectedProduct {
  id: string;  // Short UUID
  name: string;  // Product name
  code?: string;  // Product code/SKU if available
  nameSource?: {
    label: string;
    cell?: string;
  };
}

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
  // Item-level notes
  note?: string;
  // Entity role (supplier, customer, manufacturer, etc.)
  entityRole?: EntityRole;
  // Link to parent entity
  entityId?: string;
  // Link to parent product
  productId?: string;
}

// Table cell with position information
export interface TableCell {
  column: string;
  value: string;
  itemId: string;
  type: string;
  cellRef?: string;
}

// Reconstructed table from related items
export interface ReconstructedTable {
  title: string;
  headers: string[];
  rows: {
    rowNumber: number;
    cells: TableCell[];
  }[];
  sourceItems: string[]; // IDs of original items that formed this table
}

// Indexed section
export interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet: string;
  items: IndexedItem[];
  tables?: ReconstructedTable[]; // Reconstructed table structures
  sectionType?: 'individual_items' | 'table_data' | 'mixed';
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
    // Merge info
    isMerged?: boolean;
    mergeRange?: string;
    isMergeOrigin?: boolean;
  };
}

// Merged cell range
export interface MergedRange {
  range: string;
  start: string;
  end: string;
  startRow: number;
  endRow: number;
  startCol: string;
  endCol: string;
  value?: string;
}

// Excel row from API
export interface ExcelSheetRow {
  row: number;
  cells: Record<string, ExcelCell>;
  isEmpty?: boolean;
  rowType?: string;
  /** Section title extracted from markdown headings (for header rows) */
  sectionTitle?: string;
}

// Excel sheet data (from structure)
export interface ExcelSheet {
  name: string;
  index: number;
  rows: ExcelSheetRow[];
  mergedRanges?: MergedRange[];
  headers?: string[];
  rowCount: number;
  columnCount: number;
}

// Page dimensions for PDF documents
export interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
}

// Text content from Azure Document Intelligence
export interface TextContent {
  markdown?: string;
  paragraphs?: Array<{
    content: string;
    pageNumber?: number;
    boundingBox?: number[];
  }>;
  lines?: Array<{
    content: string;
    pageNumber?: number;
    boundingBox?: number[];
  }>;
  keyValuePairs?: Array<{
    key: string;
    value: string;
    pageNumber?: number;
  }>;
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
    pages?: PageInfo[];
    textContent?: TextContent;
  };
  indexed: {
    id: string;
    source: string;
    language: string;
    /** Entities detected in this questionnaire */
    entities?: DetectedEntity[];
    /** Products detected in this questionnaire */
    products?: DetectedProduct[];
    sections: IndexedSection[];
    stats?: {
      total: number;
      answered: number;
    };
    meta?: {
      notes?: string;
      notesUpdatedAt?: string;
    };
    visionValidation?: VisionValidation;
    visionCorrection?: VisionCorrection;
  };
  library: {
    id?: string;
    total?: number;
    byTopic?: Record<string, LibraryItem[]>;
  } | LibraryItem[];
  feedback?: FeedbackData | null;
}

// Vision discrepancy (difference between base extraction and what Vision sees)
export interface VisionDiscrepancy {
  itemId: string;
  label: string;
  baseValue: string | null;      // What base extraction found
  visionValue: string;           // What Vision sees
  matchScore: number;
  visionQuestion: string;
  type: 'mismatch' | 'missing_in_base' | 'missing_in_vision';
  reviewed?: boolean;
  verdict?: 'base_correct' | 'vision_correct' | 'both_wrong';
}

// Vision validation results
export interface VisionValidation {
  validatedAt: string;
  totalItems: number;
  matchedCorrectly: number;
  discrepancies: VisionDiscrepancy[];
  missingInVision: number;
}

// Vision correction (auto-applied corrections)
export interface VisionCorrectionItem {
  itemId: string;
  oldValue: string;
  newValue: string;
  matchScore: number;
}

export interface VisionCorrection {
  correctedAt: string;
  totalItems: number;
  matchedCorrectly: number;
  correctedCount: number;
  corrections: VisionCorrectionItem[];
  remainingDiscrepancies: VisionDiscrepancy[];
  missingInVision: number;
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

export type PanelType = 'original' | 'indexed' | 'library' | 'visualqa';

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

// =============================================================================
// AGGREGATED LIBRARY TYPES
// =============================================================================

/** An item in the aggregated answer library */
export interface AggregatedLibraryItem {
  id: string;
  label: string;
  /** AI-rephrased human-readable question */
  rephrasedQuestion?: string;
  fullLabel?: string;
  normalizedLabel?: string;
  value: string;
  topic: string;
  section: string;
  destination: Destination;
  /** Questionnaires this item appears in */
  sources: string[];
  firstApprovedAt?: string;
  lastApprovedAt?: string;
  /** Cell references per questionnaire */
  cellRefs: Record<string, string>;
  /** Entity role (supplier, customer, manufacturer, etc.) */
  entityRole?: EntityRole;
  /** Link to parent entity */
  entityId?: string;
  /** Link to parent product */
  productId?: string;
}

/** A group of similar/related items */
export interface RelatedItemGroup {
  items: AggregatedLibraryItem[];
  similarity: number;
  suggestedMerge: boolean;
}

/** Items grouped by topic with similarity detection */
export interface GroupedByTopic {
  topic: string;
  /** Standalone items (no similar matches) */
  items: AggregatedLibraryItem[];
  /** Groups of similar items that might be duplicates */
  relatedGroups: RelatedItemGroup[];
}

/** Full aggregated library response from API */
export interface AggregatedLibraryData {
  customer: string;
  aggregatedAt: string;
  questionnaires: string[];
  totalItems: number;
  uniqueItems: number;
  /** Library items grouped by topic */
  groups: GroupedByTopic[];
  /** Company-level items */
  company: {
    count: number;
    items: AggregatedLibraryItem[];
  };
  /** Product-level items */
  product: {
    count: number;
    items: AggregatedLibraryItem[];
  };
  /** Questionnaire metadata items */
  questionnaire: {
    count: number;
    items: AggregatedLibraryItem[];
  };
  /** Excluded items */
  excluded: {
    count: number;
    items: AggregatedLibraryItem[];
  };
  /** Statistics */
  stats: {
    totalTopics: number;
    standaloneItems: number;
    relatedGroups: number;
    itemsInGroups: number;
    suggestedMerges: number;
    company: number;
    product: number;
    questionnaire: number;
    excluded: number;
  };
}

// =============================================================================
// STANDARD QUESTIONS
// =============================================================================

/** A library match for a standard question */
export interface StandardQuestionMatch {
  label: string;
  value: string;
  sources: string[];
}

/** A standard question with its answer and sources */
export interface StandardQuestion {
  id: string;
  question: string;
  suggestedAnswer: string | null;
  sources: string[];
  libraryMatches: StandardQuestionMatch[];
}

/** A section of standard questions */
export interface StandardQuestionSection {
  section: string;
  questions: StandardQuestion[];
}

/** Full standard questions response from API */
export interface StandardQuestionsData {
  customer: string;
  generatedAt: string;
  totalQuestions: number;
  sections: StandardQuestionSection[];
}

// =============================================================================
// CURATED LIBRARY TYPES
// =============================================================================

/** A curated question with grouped answers */
export interface CuratedQuestion {
  question: string;
  answer: string;
  originalLabels: string[];
  sources: string[];
}

/** A topic with curated questions */
export interface CuratedTopic {
  topic: string;
  topicLabel: string;
  questions: CuratedQuestion[];
}

/** Full curated library response from API */
export interface CuratedLibraryData {
  customer: string;
  generatedAt: string;
  company: CuratedTopic[];
  answer_library: CuratedTopic[];
}
