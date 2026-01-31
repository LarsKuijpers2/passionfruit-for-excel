/**
 * Types for Passionfruit Excel integration
 */

export interface CellData {
  address: string;
  value: string | number | boolean | Date | null;
  formula?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'formula' | 'empty';
  style?: CellStyle;
}

export interface CellStyle {
  fill?: string;
  font?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    size?: number;
  };
  border?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

export interface SheetData {
  name: string;
  cells: Map<string, CellData>;
  dimensions: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
  mergedCells: string[];
}

export interface WorkbookData {
  filename: string;
  sheets: SheetData[];
  activeSheet: string;
}

export interface ExcelModification {
  sheet: string;
  cell: string;
  value: string | number | boolean | Date;
  previousValue?: string | number | boolean | Date | null;
}

export interface AnalysisResult {
  answer: string;
  citations: CellCitation[];
  modifications?: ExcelModification[];
}

export interface CellCitation {
  sheet: string;
  cell: string;
  value: string | number | boolean | Date | null;
  context: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PassfruitConfig {
  /** AWS region for Bedrock (default: eu-central-1) */
  region?: string;
  /** Model ID to use */
  model?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Anthropic API key (for Anthropic API web search - not used with Bedrock) */
  anthropicApiKey?: string;
  /** Tavily Search API key (for Bedrock web search) */
  tavilyApiKey?: string;
  /** Web search configuration */
  webSearch?: WebSearchConfig;
}

export interface ClaudeSkillResponse {
  content: Array<{
    type: string;
    text?: string;
    file_id?: string;
  }>;
  stop_reason: string;
  container?: {
    id: string;
  };
}

// ============================================
// Enhanced Question/Answer Detection Types
// ============================================

/**
 * Data validation information from Excel
 */
export interface DataValidation {
  type: 'list' | 'whole' | 'decimal' | 'date' | 'textLength' | 'custom' | 'none';
  options?: string[];  // For list/dropdown validation
  allowBlank?: boolean;
  formula1?: string;   // Validation formula
  formula2?: string;   // For between/notBetween operators
}

/**
 * Detailed border information for a cell
 */
export interface BorderInfo {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  all: boolean;  // Has border on all sides (typical input cell indicator)
}

/**
 * Merge cell information
 */
export interface MergeInfo {
  isMerged: boolean;
  isMaster: boolean;     // Is this the top-left cell of the merge?
  masterCell: string;    // Address of master cell (e.g., "H22")
  range: string;         // Full range (e.g., "H22:K22")
  rowSpan: number;
  colSpan: number;
}

/**
 * Enhanced cell data with all detection signals
 */
export interface EnhancedCellData extends CellData {
  dataValidation?: DataValidation;
  protection?: {
    locked: boolean;
    hidden: boolean;
  };
  comment?: string;
  namedRanges?: string[];  // Cell may be part of multiple named ranges
  borders: BorderInfo;
  mergeInfo?: MergeInfo;
  // Computed detection hints
  isLikelyLabel: boolean;   // Ends with ":" or "?", text content, etc.
  isLikelyInput: boolean;   // Has validation, color, border, unlocked, etc.
  inputScore: number;       // 0-1 score for likelihood of being an input cell
}

/**
 * Enhanced sheet data with full extraction
 */
export interface EnhancedSheetData extends Omit<SheetData, 'cells'> {
  cells: Map<string, EnhancedCellData>;
  isProtected: boolean;
  namedRanges: Map<string, string>;  // name -> range (e.g., "GroupName" -> "H43:K43")
}

/**
 * Enhanced workbook data
 */
export interface EnhancedWorkbookData extends Omit<WorkbookData, 'sheets'> {
  sheets: EnhancedSheetData[];
}

/**
 * Answer cell type classification
 */
export type AnswerType =
  | 'text'        // Free text input
  | 'number'      // Numeric input
  | 'date'        // Date input (single cell or DD/MM/YYYY parts)
  | 'date-parts'  // Split date fields (separate DD, MM, YYYY cells)
  | 'dropdown'    // List/dropdown selection
  | 'checkbox'    // Yes/No or checkbox
  | 'signature'   // Signature area (usually large merged cell)
  | 'unknown';

/**
 * Detected question-answer pair
 */
export interface DetectedQAPair {
  id: string;
  question: {
    cell: string;
    text: string;
    sheet: string;
  };
  answer: {
    cells: string[];      // Can be multiple cells (e.g., DD/MM/YYYY split)
    range?: string;       // If a contiguous range like "H22:K22"
    type: AnswerType;
    currentValue?: string | number | boolean | Date | null;
  };
  confidence: number;     // 0.0 - 1.0
  detectionSignals: string[];  // Which signals triggered this detection
}

/**
 * Detected section (group of related Q&A pairs)
 */
export interface DetectedSection {
  id: string;
  name: string;
  headerCell?: string;
  headerRange?: string;
  pairs: DetectedQAPair[];
  sheet: string;
}

/**
 * Full questionnaire structure detection result
 */
export interface QuestionnaireStructure {
  sections: DetectedSection[];
  ungroupedPairs: DetectedQAPair[];  // Pairs not belonging to any section
  stats: {
    totalPairs: number;
    highConfidence: number;    // >= 0.70
    mediumConfidence: number;  // 0.40 - 0.69
    lowConfidence: number;     // < 0.40
    averageConfidence: number;
  };
  lowConfidencePairs: DetectedQAPair[];  // Items needing human review
}

/**
 * User confirmation for low-confidence detections
 */
export interface ConfirmationResult {
  pairId: string;
  confirmed: boolean;
  correctedAnswer?: {
    cells: string[];
    range?: string;
  };
}

// ============================================
// Web Search Tool Types (Claude's native web search)
// ============================================

/**
 * User location for localizing search results
 */
export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

/**
 * Configuration for Claude's built-in web search tool
 */
export interface WebSearchConfig {
  /** Enable web search (requires Anthropic API, not Bedrock) */
  enabled: boolean;
  /** Maximum number of searches per request */
  maxUses?: number;
  /** Only include results from these domains */
  allowedDomains?: string[];
  /** Never include results from these domains */
  blockedDomains?: string[];
  /** Localize search results based on user location */
  userLocation?: UserLocation;
}

/**
 * Web search result from Claude's response or external search API
 */
export interface WebSearchResult {
  url: string;
  title: string;
  snippet?: string;
  pageAge?: string;
  age?: string;  // Alternative age field from some APIs
}

/**
 * Citation from web search results
 */
export interface WebSearchCitation {
  url: string;
  title: string;
  citedText: string;
}

/**
 * Extracted web search information from Claude's response
 */
export interface WebSearchInfo {
  searchQueries: string[];
  searchResults: WebSearchResult[];
  citations: WebSearchCitation[];
}

// ============================================
// Memory Service Types (Supermemory Integration)
// ============================================

/**
 * Configuration for memory service
 */
export interface MemoryConfig {
  /** Supermemory API key */
  apiKey: string;
  /** User ID for memory isolation */
  userId?: string;
  /** Project ID for grouping memories */
  projectId?: string;
}

/**
 * Memory search result
 */
export interface MemorySearchResult {
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Conversation context for memory storage
 */
export interface ConversationContext {
  workbookName: string;
  topic: string;
  keyPoints: string[];
  modifications: Array<{
    cell: string;
    oldValue: string | number | null;
    newValue: string | number;
  }>;
}
