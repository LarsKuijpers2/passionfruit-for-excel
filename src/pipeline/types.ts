/**
 * Types for the Questionnaire Extraction Pipeline
 */

/** Three categorisation buckets */
export type Category = 'EntityDB' | 'Procedures' | 'Product';

/** Confidence levels */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** Supported file types */
export type FileType = 'xlsx' | 'xls' | 'pdf' | 'docx';

/** Extracted Q&A pair before categorisation */
export interface RawQAPair {
  /** Source sheet or section name */
  sheet: string;
  /** Raw question text as it appears in the source */
  questionText: string;
  /** Raw answer text as it appears in the source */
  answerText: string;
  /** Raw notes/comments text */
  notesText: string;
  /** Cell reference for the question (e.g., "Sheet1!A5") */
  questionCell: string;
  /** Cell reference for the answer (e.g., "Sheet1!B5") */
  answerCell: string;
  /** Cell reference for any comment */
  commentCell: string;
  /** Section header this Q&A belongs to, if detected */
  sectionHeader?: string;
  /** Whether this is a conditional question */
  isConditional?: boolean;
  /** Condition text (e.g., "If Q2.1 = yes") */
  conditionText?: string;
  /** Multi-column identifier (e.g., "Plant 1", "Person 2") */
  multiColumnId?: string;
}

/** Categorised Q&A pair with language split */
export interface CategorisedQAPair {
  /** Sequential row number */
  rowNumber: number;
  /** Source sheet name */
  sheet: string;
  /** Assigned category */
  category: Category;
  /** German question text */
  questionDE: string;
  /** English question text */
  questionEN: string;
  /** German answer text */
  answerDE: string;
  /** English answer text */
  answerEN: string;
  /** German notes */
  notesDE: string;
  /** English notes */
  notesEN: string;
  /** Cell reference for question in source */
  questionCell: string;
  /** Cell reference for answer in source */
  answerCell: string;
  /** Cell reference for comment in source */
  commentCell: string;
  /** Confidence score 0.0 - 1.0 */
  confidence: number;
  /** Confidence level */
  confidenceLevel: ConfidenceLevel;
  /** Reason for low confidence (if applicable) */
  flagReason?: string;
  /** Suggested action for reviewer (if flagged) */
  suggestedAction?: string;
}

/** Result of processing a single file */
export interface FileProcessingResult {
  /** Source file path */
  sourceFile: string;
  /** Source file name */
  sourceFileName: string;
  /** Output file path */
  outputFile: string;
  /** Whether processing succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** All categorised Q&A pairs */
  pairs: CategorisedQAPair[];
  /** Processing statistics */
  stats: ProcessingStats;
  /** Timestamp of processing */
  timestamp: string;
}

/** Processing statistics for a single file */
export interface ProcessingStats {
  totalPairs: number;
  entityDBCount: number;
  proceduresCount: number;
  productCount: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  blankAnswers: number;
  languagesDetected: string[];
  sheetsProcessed: number;
  processingTimeMs: number;
}

/** Batch processing summary */
export interface BatchSummary {
  /** Total files processed */
  totalFiles: number;
  /** Files processed successfully */
  successCount: number;
  /** Files that failed */
  failedCount: number;
  /** Per-file results */
  results: FileProcessingResult[];
  /** Aggregate statistics */
  aggregateStats: {
    totalPairs: number;
    entityDBCount: number;
    proceduresCount: number;
    productCount: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
  /** Batch processing timestamp */
  timestamp: string;
  /** Total processing time in ms */
  totalTimeMs: number;
}

/** Content extracted from any supported file type */
export interface ExtractedContent {
  /** File type that was read */
  fileType: FileType;
  /** File name */
  fileName: string;
  /** Extracted sheets/sections */
  sheets: ExtractedSheet[];
}

/** A single sheet or section from an extracted file */
export interface ExtractedSheet {
  /** Sheet/section name */
  name: string;
  /** Extracted rows of data */
  rows: ExtractedRow[];
  /** Whether the sheet is protected */
  isProtected?: boolean;
}

/** A single row of extracted data */
export interface ExtractedRow {
  /** Row number in the source */
  rowNumber: number;
  /** Cell values keyed by column letter or index */
  cells: Map<string, ExtractedCell>;
}

/** A single cell from the extracted data */
export interface ExtractedCell {
  /** Cell address (e.g., "A5") */
  address: string;
  /** Cell value */
  value: string;
  /** Whether this cell is likely a label/question */
  isLabel: boolean;
  /** Whether this cell is likely an input/answer */
  isInput: boolean;
  /** Whether this cell is a section header */
  isSectionHeader: boolean;
  /** Whether the cell is bold */
  isBold: boolean;
  /** Whether the cell is part of a merge */
  isMerged: boolean;
  /** Merge range if applicable */
  mergeRange?: string;
  /** Cell comment text */
  comment?: string;
}

/** Pipeline processing options */
export interface PipelineOptions {
  /** Input directory (default: ./incoming/) */
  inputDir: string;
  /** Output directory (default: ./extracted/) */
  outputDir: string;
  /** Failed files directory (default: ./failed/) */
  failedDir: string;
  /** Logs directory (default: ./logs/) */
  logsDir: string;
  /** Whether to use Claude API for categorisation/translation */
  useClaudeAPI: boolean;
  /** Anthropic API key */
  anthropicApiKey?: string;
  /** Whether this is a dry run */
  dryRun: boolean;
}
