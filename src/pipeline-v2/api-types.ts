/**
 * API Types for Passionfruit Integration
 *
 * Defines types for preparing pipeline data for the Passionfruit API.
 * - Entities: Company/supplier information
 * - Answers: Q&A with extraction metadata
 * - Evidence: Questionnaire files with indexed data
 * - Narratives: Descriptive content for search
 */

import type { ItemType, ItemLevel } from './visual-analyzer.js';
import type { Language, IndexedQuestionnaire } from './questionnaire-indexer.js';

// =============================================================================
// EXTRACTION METADATA
// =============================================================================

/** Extraction metadata for answers (proposed new API field) */
export interface ExtractionMetadata {
  /** Item type (field, text, yesno, choice, table, etc.) */
  type: ItemType;
  /** Reusability level */
  level: ItemLevel;
  /** Content language */
  lang?: Language;
  /** Normalized topic */
  topic: string;
  /** Label cell reference */
  lCell?: string;
  /** Value cell reference */
  vCell?: string;
  /** Table/range reference */
  ref?: string;
  /** Source provenance */
  source: {
    file: string;
    sheet?: string;
    harvestedAt: string;
  };
  /** Extraction confidence */
  confidence?: number;
}

// =============================================================================
// ANSWERS
// =============================================================================

/** Answer with metadata for API */
export interface APIAnswer {
  /** Local ID (before API sync) */
  id: string;
  /** The question/label */
  question: string;
  /** The answer/value */
  answer: string;
  /** User-facing note (optional) */
  note?: string;
  /** Extraction metadata (proposed new API field) */
  extractionMetadata: ExtractionMetadata;
  /** Linked entity IDs (after API sync) */
  entityIds?: number[];
  /** Linked evidence IDs (after API sync) */
  evidenceIds?: number[];
}

// =============================================================================
// ENTITIES
// =============================================================================

/**
 * Passionfruit API Entity Structure
 *
 * The entity has TWO levels of fields:
 *
 * 1. TOP-LEVEL FIELDS (Company Information section in UI):
 *    - name (entity name - required)
 *    - email, phone, website, street, city, zipCode, country
 *
 * 2. DATA OBJECT (Additional Fields section in UI):
 *    - Key-value pairs for anything else
 *    - contacts[], certifications[], activities[], etc.
 */

/** Top-level entity fields for Passionfruit API */
export interface APIEntityFields {
  /** Entity name (required) */
  name: string;
  /** Parent entity ID (null for root) */
  parentId?: number | null;
  /** Email address */
  email?: string;
  /** Phone number */
  phone?: string;
  /** Website URL */
  website?: string;
  /** Street address */
  street?: string;
  /** City */
  city?: string;
  /** ZIP/Postal code */
  zipCode?: string;
  /** Country */
  country?: string;
}

/**
 * Additional data stored in entity.data object
 *
 * IMPORTANT: Only flat key-value pairs are supported.
 * No nested objects or arrays - use separate keys instead:
 * - contacts_name, contacts_role (not contacts: [{...}])
 * - certification_type, certification_number (not certifications: [{...}])
 */
export interface EntityAdditionalData {
  // Contact info (flat keys)
  contacts_name?: string;
  contacts_role?: string;
  contacts_email?: string;
  contacts_phone?: string;

  // Certification info (flat keys)
  certification_type?: string;
  certification_number?: string;
  certification_validUntil?: string;

  // Business info
  activities?: string;  // Comma-separated string
  employees?: string;
  turnover?: string;

  // Registration numbers
  egNumber?: string;
  kvkNumber?: string;
  vatNumber?: string;

  // Flexible additional data (flat key-value only)
  [key: string]: string | undefined;
}

/** Full entity for Passionfruit API */
export interface APIEntity extends APIEntityFields {
  /** Additional key-value data */
  data?: EntityAdditionalData;
}

/** Extracted entity data from questionnaire (before mapping to API structure) */
export interface ExtractedEntityData {
  // Will be mapped to top-level fields
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  street?: string;
  city?: string;
  zipCode?: string;
  country?: string;

  // Raw location (needs parsing into city/zipCode/country)
  location?: string;
  // Raw address (maps to street)
  address?: string;

  // Will go into data object
  contacts?: Array<{
    name: string;
    role?: string;
    email?: string;
    phone?: string;
  }>;
  certifications?: Array<{
    type: string;
    number?: string;
    validUntil?: string;
    body?: string;
  }>;
  activities?: string[];
  employees?: string;
  turnover?: string;
  egNumber?: string;
  kvkNumber?: string;
  vatNumber?: string;
  fax?: string;

  // Flexible additional data
  [key: string]: any;
}

/** Source reference for an extracted field */
export interface FieldSource {
  /** Field name in entity */
  field: string;
  /** Cell reference */
  cell: string;
  /** Extracted value */
  value: string;
  /** Original label */
  label?: string;
  /** Confidence score */
  confidence?: number;
}

/** Entity extraction per questionnaire */
export interface QuestionnaireEntityExtraction {
  /** Extraction ID */
  id: string;
  /** Source questionnaire filename */
  source: string;
  /** When first extracted */
  extractedAt: string;
  /** When last updated */
  updatedAt: string;
  /** Extracted entity data */
  data: ExtractedEntityData;
  /** Source references for each field */
  sources: FieldSource[];
}

/** Entity for Passionfruit API */
export interface APIEntity {
  name: string;
  data: ExtractedEntityData;
}

// =============================================================================
// EVIDENCE
// =============================================================================

/** Evidence metadata for API upload */
export interface APIEvidence {
  /** Questionnaire filename */
  name: string;
  /** Classification (e.g., "supplier_questionnaire") */
  classification?: string;
  /** Basic metadata */
  metadata: {
    customer?: string;
    language: Language;
    extractedAt: string;
  };
  /** AI-extracted metadata */
  extractedMetadata: {
    questionnaire: {
      id: string;
      sections: number;
      items: number;
      answered: number;
      standard: number;
      narrative: number;
      product: number;
    };
    indexed: IndexedQuestionnaire;
  };
  /** Linked entity IDs (after upload) */
  entityIds?: number[];
}

// =============================================================================
// NARRATIVES
// =============================================================================

/** Narrative with English translation for search */
export interface NarrativeContent {
  /** Narrative ID */
  id: string;
  /** Original text */
  originalText: string;
  /** Original language */
  originalLang?: Language;
  /** English translation for search */
  textEN: string;
  /** Normalized topic */
  topic: string;
  /** The question/label that prompted this */
  context: string;
  /** Source provenance */
  source: {
    file: string;
    section: string;
    cell: string;
  };
}

// =============================================================================
// EXTRACTION OUTPUT
// =============================================================================

/** Complete extraction output for a questionnaire */
export interface QuestionnaireExtraction {
  /** Source questionnaire */
  source: string;
  /** When extracted */
  extractedAt: string;
  /** Extracted entity data */
  entity: QuestionnaireEntityExtraction;
  /** Answers with metadata */
  answers: APIAnswer[];
  /** Narratives with translations */
  narratives: NarrativeContent[];
  /** Evidence metadata */
  evidence: APIEvidence;
}

// =============================================================================
// API-READY OUTPUT
// =============================================================================

/** Merged data ready for API sync */
export interface APIReadyData {
  /** When prepared */
  preparedAt: string;
  /** Merged entity from all questionnaires */
  entity: ExtractedEntityData;
  /** All answers */
  answers: APIAnswer[];
  /** All narratives */
  narratives: NarrativeContent[];
  /** All evidences */
  evidences: APIEvidence[];
  /** Source questionnaires */
  sources: string[];
}

/** Sync status tracking */
export interface SyncStatus {
  /** Last sync attempt */
  lastSync?: string;
  /** Entity sync status */
  entity?: {
    synced: boolean;
    apiId?: number;
    syncedAt?: string;
  };
  /** Answer sync status by ID */
  answers: Record<string, {
    synced: boolean;
    apiId?: number;
    syncedAt?: string;
  }>;
  /** Evidence sync status by filename */
  evidences: Record<string, {
    synced: boolean;
    apiId?: number;
    syncedAt?: string;
  }>;
}
