/**
 * Questionnaire Schema Exports
 *
 * Standardized schemas for extracting and normalizing data from
 * supplier questionnaires.
 *
 * @see knowledge/questionnaire-schema.md for documentation
 */

// Product-level schema (per-product data)
export {
  PRODUCT_SCHEMA,
  EU_ALLERGENS,
  MICRO_PARAMETERS,
  buildAliasMap,
  normalizeLabel,
  normalizeValue,
  getFieldDefinition,
  getFieldsByCategory,
  getFieldsBySubcategory,
  SCHEMA_SUMMARY
} from './product-schema.js';

export type {
  FieldType,
  FieldDefinition,
  ProductSchema,
  EUAllergen,
  MicroParameter
} from './product-schema.js';

// Entity-level schema (company-wide data)
export {
  ENTITY_SCHEMA,
  buildEntityAliasMap,
  normalizeEntityLabel,
  getEntityFieldDefinition,
  getEntityFieldsByCategory,
  ENTITY_SCHEMA_SUMMARY
} from './entity-schema.js';

export type { EntitySchema } from './entity-schema.js';

// ============================================================================
// SKIP DETECTION
// ============================================================================

/**
 * Values that indicate a question was skipped/not answered
 */
export const SKIP_INDICATORS = [
  '',
  'n/a',
  'na',
  'n.a.',
  '--',
  '-',
  'not applicable',
  'not available',
  'ethical skip',
  'none',
  'geen',
  'non applicable',
  'nicht zutreffend',
  'nicht anwendbar'
];

/**
 * Check if a value indicates a skipped/unanswered question
 */
export function isSkippedValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const normalized = value.toString().toLowerCase().trim();
  return SKIP_INDICATORS.includes(normalized);
}

// ============================================================================
// FIELD STATUS
// ============================================================================

export type FieldStatus = 'answered' | 'skipped' | 'not_asked';

export interface ExtractedField {
  /** Standardized field name from schema */
  canonical: string;
  /** Extracted value (null if skipped) */
  value: string | null;
  /** Field status */
  status: FieldStatus;
  /** Original question text from source */
  originalLabel: string;
  /** Source file name */
  source: string;
  /** Cell reference if from Excel */
  cells?: string;
  /** Level: product or entity */
  level: 'product' | 'entity';
}

export interface ExtractionStats {
  /** Total fields in schema */
  total: number;
  /** Fields present in questionnaire */
  found: number;
  /** Fields with valid answers */
  answered: number;
  /** Fields present but unanswered */
  skipped: number;
  /** Fields not in this questionnaire */
  notAsked: number;
  /** Coverage percentage */
  coveragePct: number;
}

export interface QuestionnaireExtraction {
  /** Source file */
  source: string;
  /** Extraction timestamp */
  extractedAt: string;
  /** Customer identifier */
  customer: string;
  /** Extracted fields */
  fields: ExtractedField[];
  /** Product-level stats */
  productStats: ExtractionStats;
  /** Entity-level stats */
  entityStats: ExtractionStats;
}

// ============================================================================
// COMBINED SCHEMA UTILITIES
// ============================================================================

import { PRODUCT_SCHEMA, buildAliasMap } from './product-schema.js';
import { ENTITY_SCHEMA, buildEntityAliasMap } from './entity-schema.js';

/**
 * Build a combined alias map for both product and entity fields
 */
export function buildCombinedAliasMap(): Map<string, { canonical: string; level: 'product' | 'entity' }> {
  const map = new Map<string, { canonical: string; level: 'product' | 'entity' }>();

  // Add product fields
  for (const field of PRODUCT_SCHEMA.fields) {
    map.set(field.canonical.toLowerCase(), { canonical: field.canonical, level: 'product' });
    for (const alias of field.aliases) {
      map.set(alias.toLowerCase(), { canonical: field.canonical, level: 'product' });
    }
  }

  // Add entity fields (entity takes precedence for duplicates)
  for (const field of ENTITY_SCHEMA.fields) {
    map.set(field.canonical.toLowerCase(), { canonical: field.canonical, level: 'entity' });
    for (const alias of field.aliases) {
      map.set(alias.toLowerCase(), { canonical: field.canonical, level: 'entity' });
    }
  }

  return map;
}

/**
 * Normalize any label to its canonical form, detecting product vs entity level
 */
export function normalizeLabelCombined(
  label: string,
  combinedMap?: Map<string, { canonical: string; level: 'product' | 'entity' }>
): { canonical: string; level: 'product' | 'entity' } | null {
  const map = combinedMap ?? buildCombinedAliasMap();
  return map.get(label.toLowerCase().trim()) ?? null;
}

/**
 * Calculate extraction statistics
 */
export function calculateStats(
  fields: ExtractedField[],
  totalInSchema: number
): ExtractionStats {
  const answered = fields.filter(f => f.status === 'answered').length;
  const skipped = fields.filter(f => f.status === 'skipped').length;
  const found = answered + skipped;
  const notAsked = totalInSchema - found;

  return {
    total: totalInSchema,
    found,
    answered,
    skipped,
    notAsked,
    coveragePct: Math.round((answered / totalInSchema) * 100)
  };
}

// ============================================================================
// SCHEMA TOTALS
// ============================================================================

export const TOTAL_PRODUCT_FIELDS = PRODUCT_SCHEMA.fields.length;
export const TOTAL_ENTITY_FIELDS = ENTITY_SCHEMA.fields.length;
export const TOTAL_SCHEMA_FIELDS = TOTAL_PRODUCT_FIELDS + TOTAL_ENTITY_FIELDS;
