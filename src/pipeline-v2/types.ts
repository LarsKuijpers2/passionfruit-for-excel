/**
 * Types for the Questionnaire Extraction Pipeline v2
 */

// =============================================================================
// ENUMS & LITERALS
// =============================================================================

/** Entity hierarchy levels */
export type EntityLevel = 'group' | 'company' | 'site' | 'product_group' | 'product';

/** Destination for extracted data */
export type Destination = 'answer_library' | 'entity_db' | 'product_spec' | 'evidence_ref' | 'log_only';

/** Evidence types that can support an answer */
export type EvidenceType =
  | 'specification'
  | 'certificate'
  | 'procedure'
  | 'policy'
  | 'statement'
  | 'declaration'
  | 'report'
  | 'questionnaire'
  | 'reference'
  | null;

/** Confidence levels */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Review status */
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'modified';

// =============================================================================
// RULES TYPES (loaded from rules.yaml)
// =============================================================================

/** Topic definition from rules.yaml */
export interface TopicRule {
  id: string;
  name: string;
  description: string;
  level: EntityLevel[];
  destination: Destination;
  evidence_type: EvidenceType;
  reusable: boolean;
  never_answer_library?: boolean;
  keywords: string[];
  patterns: string[];
  extract_fields?: string[];
}

/** Flag condition from rules.yaml */
export interface FlagCondition {
  condition: string;
  message: string;
  threshold?: number;
  patterns?: string[];
}

/** Answer format from rules.yaml */
export interface AnswerFormat {
  patterns?: string[];
  format: string;
}

/** Complete rules configuration */
export interface RulesConfig {
  version: string;
  topics: TopicRule[];
  routing: {
    entity_level: Record<string, Destination>;
    product_level: Record<string, Destination>;
  };
  flag_for_review: FlagCondition[];
  answer_formats: Record<string, AnswerFormat>;
  log_only_patterns: string[];
  exclude_patterns: string[];
}

// =============================================================================
// EXTRACTION TYPES
// =============================================================================

/** Metadata about the questionnaire */
export interface QuestionnaireMetadata {
  /** Original filename */
  filename: string;
  /** Customer/company name (extracted or from filename) */
  customer?: string;
  /** Product(s) mentioned */
  products?: string[];
  /** Date received or extracted */
  date?: string;
  /** Questionnaire version if detected */
  version?: string;
  /** Total sheets/sections */
  sheetCount: number;
  /** Processing timestamp */
  processedAt: string;
}

/** A section/chapter in the questionnaire */
export interface QuestionnaireSection {
  /** Section ID (e.g., "1", "2.1", "A") */
  id: string;
  /** Section title */
  title: string;
  /** Parent section ID if nested */
  parentId?: string;
  /** Sheet name in Excel */
  sheetName: string;
  /** Starting row number */
  startRow: number;
  /** Ending row number */
  endRow: number;
  /** Questions in this section */
  questions: ExtractedQuestion[];
}

/** A single extracted question-answer pair */
export interface ExtractedQuestion {
  /** Unique ID for this Q&A */
  id: string;
  /** Section this belongs to */
  sectionId: string;
  /** Original question text */
  questionText: string;
  /** Original answer text */
  answerText: string;
  /** Cell reference for question */
  questionCell: string;
  /** Cell reference for answer */
  answerCell: string;
  /** Any comments/notes */
  notes?: string;
  /** Is this a conditional question? */
  isConditional?: boolean;
  /** Condition text if conditional */
  conditionText?: string;
  /** Row number in source */
  rowNumber: number;
}

/** Classification result for a question */
export interface ClassificationResult {
  /** Matched topic ID */
  topicId: string;
  /** Topic name for display */
  topicName: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Confidence level */
  confidenceLevel: ConfidenceLevel;
  /** Destination for this data */
  destination: Destination;
  /** Entity level */
  entityLevel: EntityLevel;
  /** Evidence type if applicable */
  evidenceType: EvidenceType;
  /** Whether this can be reused */
  isReusable: boolean;
  /** Flag reasons if any */
  flagReasons: string[];
  /** How the classification was made */
  classificationMethod: 'keyword' | 'pattern' | 'bedrock' | 'fallback';
}

/** Fully classified question ready for output */
export interface ClassifiedQuestion extends ExtractedQuestion {
  /** Classification result */
  classification: ClassificationResult;
  /** German text (if detected/translated) */
  questionDE?: string;
  questionEN?: string;
  answerDE?: string;
  answerEN?: string;
}

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/** Summary statistics for output */
export interface ExtractionSummary {
  totalQuestions: number;
  byDestination: Record<Destination, number>;
  byTopic: Record<string, number>;
  flaggedForReview: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
}

/** Complete extraction result */
export interface ExtractionResult {
  /** Questionnaire metadata */
  metadata: QuestionnaireMetadata;
  /** Extracted sections */
  sections: QuestionnaireSection[];
  /** All classified questions */
  questions: ClassifiedQuestion[];
  /** Summary statistics */
  summary: ExtractionSummary;
  /** Processing timestamp */
  processedAt: string;
}

// =============================================================================
// ANSWER LIBRARY TYPES
// =============================================================================

/** An approved answer in the Answer Library */
export interface ApprovedAnswer {
  /** Unique ID */
  id: string;
  /** Topic this answer belongs to */
  topicId: string;
  /** Question patterns this matches */
  questionPatterns: string[];
  /** Example questions this was used for */
  exampleQuestions: string[];
  /** The approved answer text (DE) */
  answerDE: string;
  /** The approved answer text (EN) */
  answerEN: string;
  /** Source questionnaire this was approved from */
  sourceFile: string;
  /** Who approved this */
  approvedBy: string;
  /** When it was approved */
  approvedAt: string;
  /** How many times this has been reused */
  reuseCount: number;
  /** Last time this was used */
  lastUsedAt?: string;
  /** Notes from reviewer */
  reviewNotes?: string;
}

/** Answer Library structure */
export interface AnswerLibrary {
  version: string;
  lastUpdated: string;
  answers: ApprovedAnswer[];
}

// =============================================================================
// REVIEW TYPES
// =============================================================================

/** Item flagged for review */
export interface ReviewItem {
  /** Question ID */
  questionId: string;
  /** The classified question */
  question: ClassifiedQuestion;
  /** Why it was flagged */
  flagReasons: string[];
  /** Suggested action */
  suggestedAction: string;
  /** Review status */
  status: ReviewStatus;
  /** Reviewer notes */
  reviewerNotes?: string;
  /** Modified classification if changed */
  modifiedClassification?: Partial<ClassificationResult>;
  /** Modified answer if edited */
  modifiedAnswer?: string;
}

/** Review session for a questionnaire */
export interface ReviewSession {
  /** Source file */
  sourceFile: string;
  /** Started at */
  startedAt: string;
  /** Completed at */
  completedAt?: string;
  /** Items to review */
  items: ReviewItem[];
  /** Reviewer name */
  reviewer?: string;
}

// =============================================================================
// PIPELINE OPTIONS
// =============================================================================

/** Pipeline v2 options */
export interface PipelineV2Options {
  /** Input directory */
  inputDir: string;
  /** Output directory for review files */
  reviewDir: string;
  /** Directory for approved extractions */
  approvedDir: string;
  /** Answer library directory */
  answerLibraryDir: string;
  /** Rules file path */
  rulesFile: string;
  /** Logs directory */
  logsDir: string;
  /** AWS region for Bedrock */
  awsRegion: string;
  /** Bedrock model ID */
  bedrockModel?: string;
  /** Use Bedrock for classification */
  useBedrock: boolean;
  /** Dry run mode */
  dryRun: boolean;
}
