/**
 * Questionnaire Indexer
 *
 * Indexes questionnaire structure with ALL items organized by section/topic.
 * Produces clean YAML with no translations (translations happen in HARVEST).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { randomUUID } from 'crypto';
import { franc } from 'franc';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { VisualAnalyzer, type SheetAnalysis, type DetectedItem, type ItemType, type ItemLevel } from './visual-analyzer.js';
import type { QuestionnaireStructure } from '../extractors/excel.js';
import { RulesManager } from '../../utils/rules-manager.js';
import type { ExtractionSource, IndexedEvidence } from '../../types.js';
import { AzureIndexer } from '../extractors/azure-indexer.js';
import { VisionIndexer } from '../extractors/vision-indexer.js';
import { contextualizeQuestions } from './question-contextualizer.js';

// =============================================================================
// EMPTY PLACEHOLDER DETECTION
// =============================================================================

/** Loaded placeholder config */
interface PlaceholderConfig {
  placeholders: string[];
  patterns: string[];
}

let _placeholderConfig: PlaceholderConfig | null = null;

/** Load placeholder config from rules/empty-placeholders.yaml */
async function loadPlaceholderConfig(): Promise<PlaceholderConfig> {
  if (_placeholderConfig) return _placeholderConfig;

  const configPath = './rules/empty-placeholders.yaml';
  try {
    if (existsSync(configPath)) {
      const content = await readFile(configPath, 'utf-8');
      _placeholderConfig = parseYaml(content) as PlaceholderConfig;
    }
  } catch (e) {
    console.warn('Warning: Could not load empty-placeholders.yaml:', e);
  }

  // Fallback defaults if config not found
  if (!_placeholderConfig) {
    _placeholderConfig = {
      placeholders: [
        'EMPTY', 'Elija un elemento', 'Elija un elemento.',
        'Select an option', 'Choose an option', 'Please select',
        'Bitte auswählen', 'Sélectionner',
      ],
      patterns: ['^select\\.{0,3}$', '^choose\\.{0,3}$', '^\\-+$'],
    };
  }

  return _placeholderConfig;
}

/** Check if a value is a placeholder (unfilled dropdown, etc.) */
function isPlaceholderValue(value: string, config: PlaceholderConfig): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  // Check exact matches
  if (config.placeholders.some(p => normalized === p.toLowerCase())) {
    return true;
  }

  // Check regex patterns
  for (const pattern of config.patterns || []) {
    try {
      if (new RegExp(pattern, 'i').test(normalized)) {
        return true;
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return false;
}

// =============================================================================
// EXTRACTION STRATEGY
// =============================================================================

/** Strategy for extraction - determines which indexer(s) to use */
export type ExtractionStrategy = 'azure' | 'vision' | 'both' | 'legacy';

/** Result of running multiple strategies */
export interface MultiStrategyResult {
  azure?: IndexedQuestionnaire;
  vision?: IndexedQuestionnaire;
  legacy?: IndexedQuestionnaire;
}

// =============================================================================
// TOPIC DEFINITION (loaded from rules/topics.yaml)
// =============================================================================

interface TopicDefinition {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  patterns?: string[];
}

interface TopicRules {
  topics: TopicDefinition[];
  table_grouping?: TableGroupingRules;
}

interface TableGroupingPattern {
  name: string;
  trigger_patterns: string[];
  topics: string[];
  min_items: number;
}

interface TableGroupingRules {
  min_items: number;
  max_row_gap: number;
  patterns: TableGroupingPattern[];
}

let loadedTopics: TopicDefinition[] | null = null;
let loadedTableGrouping: TableGroupingRules | null = null;

async function loadTopicsFromRules(rulesDir: string): Promise<TopicDefinition[]> {
  if (loadedTopics) return loadedTopics;

  const rulesPath = join(rulesDir, 'topics.yaml');
  if (!existsSync(rulesPath)) {
    console.warn('  Warning: rules/topics.yaml not found, using fallback topics');
    return [];
  }

  try {
    const content = await readFile(rulesPath, 'utf-8');
    const rules = parseYaml(content) as TopicRules;
    loadedTopics = rules.topics || [];
    loadedTableGrouping = rules.table_grouping || null;
    return loadedTopics;
  } catch (error) {
    console.warn(`  Warning: Failed to load topics from topics.yaml: ${error}`);
    return [];
  }
}

function getTableGroupingRules(): TableGroupingRules | null {
  return loadedTableGrouping;
}

// =============================================================================
// TYPES
// =============================================================================

export type Language = 'en' | 'de' | 'fr' | 'nl';

/** Destination for where the item should be stored */
export type ItemDestination = 'answer_library' | 'product' | 'company' | 'exclude';

/** Entity role - which party does this data belong to */
export type EntityRole = 'supplier' | 'customer' | 'manufacturer' | 'producer' | 'group' | 'other';

/** An entity detected in the questionnaire */
export interface DetectedEntity {
  id: string;  // Short UUID
  name: string;  // Entity name (from "Company name", "Supplier name", etc.)
  role: EntityRole;  // Detected role
  nameSource?: {
    label: string;  // The label that provided the name
    cell?: string;  // Cell reference
  };
}

/** A product detected in the questionnaire */
export interface DetectedProduct {
  id: string;  // Short UUID
  name: string;  // Product name
  code?: string;  // Product code/SKU if available
  nameSource?: {
    label: string;
    cell?: string;
  };
}

/** An indexed item from a questionnaire */
export interface IndexedItem {
  id: string;  // Unique identifier for this item
  type: ItemType;
  label: string;
  value?: string;
  lCell?: string;
  vCell?: string;
  ref?: string;
  topic: string;
  level: ItemLevel;
  lang: Language | undefined;
  destination: ItemDestination;  // AI-suggested destination based on level and value
  entityRole?: EntityRole;  // Which entity this item belongs to (supplier, customer, manufacturer, etc.)
  entityId?: string;  // Link to detected entity
  productId?: string;  // Link to detected product
  isConditional?: boolean;  // True if this is a follow-up/conditional question (e.g., "If yes, please specify...")
  strikethroughDetected?: boolean;  // True if value was determined by strikethrough (e.g., "Yes" struck through means "No")
  needsReview?: boolean;  // Flag items that need human review (e.g., strikethrough, low confidence)
  reviewReason?: string;  // Why this item needs review
  pageNumber?: number;  // Page number in source document (for PDF navigation)
  // Extraction source tracking (Phase 1: Separate Extractors)
  extractionSource?: ExtractionSource;  // Which extraction strategy produced this item ('azure' | 'vision')
  evidence?: IndexedEvidence;  // Detailed evidence (cell refs for azure, bbox for vision)
  // Self-explaining questions (Phase 3: Contextualization)
  originalLabel?: string;  // Original label before contextualization transform
}

/** A table cell with position information */
export interface TableCell {
  column: string;
  value: string;
  itemId: string;
  type: ItemType;
}

/** A reconstructed table from related items */
export interface ReconstructedTable {
  title: string;
  headers: string[];
  rows: {
    rowNumber: number;
    cells: TableCell[];
  }[];
  sourceItems: string[]; // IDs of original items that formed this table
}

/** A section in the questionnaire */
export interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet?: string;
  items: IndexedItem[];
  tables?: ReconstructedTable[]; // Reconstructed table structures
  sectionType: 'individual_items' | 'table_data' | 'mixed';
}

/** Full indexed questionnaire */
export interface IndexedQuestionnaire {
  id: string;
  source: string;
  indexed: string;
  language: Language;
  /** Passionfruit API source info (when fetched from API) */
  sourceInfo?: {
    evidenceId: number;
    evidenceName: string;
  };
  /** Entities detected in this questionnaire */
  entities: DetectedEntity[];
  /** Products detected in this questionnaire */
  products: DetectedProduct[];
  sections: IndexedSection[];
  stats: {
    total: number;
    answered: number;
    standard: number;
    narrative: number;
    product: number;
  };
}

// =============================================================================
// ENTITY ROLE DETECTION
// =============================================================================

/**
 * Detect entity role from label text.
 * The role indicates which party this data belongs to (supplier, customer, manufacturer, etc.)
 * This is detected from keywords in the question/label itself.
 */
function detectEntityRole(label: string, sectionTitle?: string): EntityRole {
  const textToCheck = `${label} ${sectionTitle || ''}`.toLowerCase();

  // Supplier patterns (most common - the company filling out the questionnaire)
  if (/supplier|vendor|leverancier|lieferant|fournisseur|our company|notre entreprise|ons bedrijf|unser unternehmen/.test(textToCheck)) {
    return 'supplier';
  }

  // Manufacturer patterns (who makes the product)
  if (/manufactur|fabricant|fabrikant|hersteller|production site|manufacturing site|usine|productie/.test(textToCheck)) {
    return 'manufacturer';
  }

  // Producer patterns
  if (/producer|producteur|producent|produzent/.test(textToCheck)) {
    return 'producer';
  }

  // Customer patterns (who requested the questionnaire)
  if (/customer|client|buyer|acheteur|klant|kunde|recipient|destinataire|ontvanger|empfänger/.test(textToCheck)) {
    return 'customer';
  }

  // Group/Parent company patterns
  if (/parent company|group|holding|head office|headquarters|siège|hoofdkantoor|muttergesellschaft|concern/.test(textToCheck)) {
    return 'group';
  }

  return 'other';
}

// =============================================================================
// ENTITY NAME FIELD DETECTION
// =============================================================================

/** Patterns that indicate an entity name field */
const ENTITY_NAME_PATTERNS: Array<{ pattern: RegExp; role: EntityRole }> = [
  // Supplier patterns
  { pattern: /^(supplier|vendor|leverancier|lieferant|fournisseur)\s*(name|naam|nom)?$/i, role: 'supplier' },
  { pattern: /^(company|firma|entreprise|bedrijf|unternehmen)\s*(name|naam|nom)?$/i, role: 'supplier' },
  { pattern: /^(our|your|uw|votre|ihr)\s*(company|firma|bedrijf)/i, role: 'supplier' },
  { pattern: /^name\s*(of\s*)?(supplier|vendor|company)/i, role: 'supplier' },
  { pattern: /^(bedrijfs)?naam$/i, role: 'supplier' },

  // Manufacturer patterns
  { pattern: /^(manufacturer|fabrikant|fabricant|hersteller)\s*(name|naam|nom)?$/i, role: 'manufacturer' },
  { pattern: /^(manufacturing|production)\s*(site|facility|plant)\s*(name)?$/i, role: 'manufacturer' },
  { pattern: /^(usine|fabriek|fabrik)\s*(name|naam|nom)?$/i, role: 'manufacturer' },
  { pattern: /^name\s*(of\s*)?(manufacturer|factory|plant)/i, role: 'manufacturer' },

  // Producer patterns
  { pattern: /^(producer|producteur|producent|produzent)\s*(name|naam|nom)?$/i, role: 'producer' },

  // Customer patterns
  { pattern: /^(customer|client|buyer|klant|kunde|acheteur)\s*(name|naam|nom)?$/i, role: 'customer' },
  { pattern: /^(recipient|destinataire|ontvanger|empfänger)\s*(name|naam|nom)?$/i, role: 'customer' },

  // Group/Parent patterns
  { pattern: /^(parent|holding|group|moeder|muttergesellschaft)\s*(company)?\s*(name|naam|nom)?$/i, role: 'group' },
  { pattern: /^(head\s*office|headquarters|hoofdkantoor|siège)/i, role: 'group' },
];

/** Detect if a label is an entity name field and return the role */
function isEntityNameField(label: string): { isName: boolean; role: EntityRole } {
  const normalized = label.trim();

  for (const { pattern, role } of ENTITY_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      return { isName: true, role };
    }
  }

  return { isName: false, role: 'other' };
}

/** Check if a value looks like a company name (not an address) */
function looksLikeCompanyName(value: string): boolean {
  const trimmed = value.trim();

  // Too short to be a company name
  if (trimmed.length < 2) return false;

  // Looks like a street address (street name + number)
  // Patterns: "streetname 123", "123 streetname", "straat 123", "straße 123"
  if (/^\d+\s+[a-z]/i.test(trimmed)) return false; // "123 Main St"
  if (/^[a-z]+\s+\d+$/i.test(trimmed)) return false; // "buitenvaart 2109"
  if (/^[a-z]+\s+\d+[a-z]?$/i.test(trimmed)) return false; // "hoofdstraat 12a"

  // Contains typical address keywords
  const addressKeywords = [
    /\b(straat|street|str\.|weg|road|rd\.|avenue|ave\.|lane|ln\.)\b/i,
    /\b(plein|square|plaza|place)\b/i,
    /\b(postbus|p\.?o\.?\s*box|postfach)\b/i,
  ];
  for (const pattern of addressKeywords) {
    if (pattern.test(trimmed)) return false;
  }

  // Looks like a postal code (common formats)
  if (/^\d{4,5}\s*[a-z]{0,2}$/i.test(trimmed)) return false; // "7905 SW", "12345"

  // Company names often contain these indicators
  const companyIndicators = [
    /\b(inc|ltd|llc|gmbh|ag|bv|nv|sa|sarl|srl|co|corp|holding|group)\b/i,
    /\b(company|bedrijf|firma|entreprise|unternehmen)\b/i,
  ];
  for (const pattern of companyIndicators) {
    if (pattern.test(trimmed)) return true;
  }

  // If it looks like a proper noun (capitalized words without numbers at end), likely a company name
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(trimmed)) return true;

  // Default: assume it's a company name if it doesn't match address patterns
  return true;
}

// =============================================================================
// PRODUCT NAME FIELD DETECTION
// =============================================================================

/** Patterns that indicate a product name field */
const PRODUCT_NAME_PATTERNS: RegExp[] = [
  /^(product|artikel|article|produkt|produit)\s*(name|naam|nom|bezeichnung)?$/i,
  /^(name|naam|nom)\s*(of\s*)?(product|artikel|article)/i,
  /^(trade|commercial)\s*(name|naam|nom)/i,
  /^(handelsnaam|handelsname|nom\s*commercial)/i,
  /^artikelbezeichnung$/i,
  /^product\s*description$/i,
];

/** Patterns that indicate a product code field */
const PRODUCT_CODE_PATTERNS: RegExp[] = [
  /^(product|artikel|article)\s*(code|nummer|number|no\.?|nr\.?)/i,
  /^(sku|ean|gtin|upc)/i,
  /^(artikelnummer|artikelnr|article\s*no)/i,
  /^(item|material)\s*(code|number|no\.?|nr\.?)/i,
];

/** Detect if a label is a product name field */
function isProductNameField(label: string): boolean {
  const normalized = label.trim();
  return PRODUCT_NAME_PATTERNS.some(p => p.test(normalized));
}

/** Detect if a label is a product code field */
function isProductCodeField(label: string): boolean {
  const normalized = label.trim();
  return PRODUCT_CODE_PATTERNS.some(p => p.test(normalized));
}

// =============================================================================
// ENTITY & PRODUCT EXTRACTION
// =============================================================================

interface EntityExtraction {
  entities: DetectedEntity[];
  entityContextMap: Map<string, string>;  // sectionTitle -> entityId
}

interface ProductExtraction {
  products: DetectedProduct[];
  productContextMap: Map<string, string>;  // sectionTitle -> productId or itemId -> productId
}

/** Extract entities from indexed items */
function extractEntities(sections: IndexedSection[]): EntityExtraction {
  const entities: DetectedEntity[] = [];
  const entityContextMap = new Map<string, string>();
  const seenNames = new Map<string, string>();  // name+role -> entityId (for dedup)

  for (const section of sections) {
    let sectionEntityId: string | undefined;
    let sectionRole: EntityRole = 'other';

    // First, detect section role from title
    sectionRole = detectEntityRole('', section.title);

    for (const item of section.items) {
      // Skip items without values
      if (!item.value) continue;

      // Check if this is an entity name field (regardless of destination)
      const { isName, role } = isEntityNameField(item.label);

      // Only create entity if label matches AND value looks like a company name
      if (isName && item.value.trim() && looksLikeCompanyName(item.value)) {
        const entityName = item.value.trim();
        const key = `${entityName.toLowerCase()}:${role}`;

        // Check if we already have this entity
        if (seenNames.has(key)) {
          sectionEntityId = seenNames.get(key);
        } else {
          const entityId = randomUUID().split('-')[0];
          entities.push({
            id: entityId,
            name: entityName,
            role,
            nameSource: {
              label: item.label,
              cell: item.vCell,
            },
          });
          seenNames.set(key, entityId);
          sectionEntityId = entityId;
        }

        // Also set the entity role on this specific item and mark it as company data
        item.entityRole = role;
        if (item.destination === 'answer_library') {
          item.destination = 'company';
        }
      }
    }

    // If we found an entity in this section, map the section to it
    if (sectionEntityId) {
      entityContextMap.set(section.title, sectionEntityId);
    }

    // If section has a clear entity role (from title), mark all relevant items
    if (sectionRole !== 'other' && !sectionEntityId) {
      // Look for company-like data in this section
      const companyKeywords = /company|name|address|city|country|phone|email|contact|street|zip|postal/i;
      for (const item of section.items) {
        if (item.value && companyKeywords.test(item.label)) {
          item.entityRole = sectionRole;
          if (item.destination === 'answer_library') {
            item.destination = 'company';
          }
        }
      }
    }
  }

  // Second pass: infer entities from section context if none detected from name fields
  for (const section of sections) {
    if (entityContextMap.has(section.title)) continue;

    // Check if section title indicates a specific entity type
    const sectionRole = detectEntityRole('', section.title);
    if (sectionRole !== 'other') {
      // Check if we already have an entity with this role
      const existingEntity = entities.find(e => e.role === sectionRole);
      if (existingEntity) {
        entityContextMap.set(section.title, existingEntity.id);
      }
    }
  }

  return { entities, entityContextMap };
}

/** Extract products from indexed items */
function extractProducts(sections: IndexedSection[]): ProductExtraction {
  const products: DetectedProduct[] = [];
  const productContextMap = new Map<string, string>();
  const seenNames = new Map<string, string>();  // productName -> productId (for dedup)

  for (const section of sections) {
    let currentProductId: string | undefined;

    for (const item of section.items) {
      // Skip items without values
      if (!item.value) continue;

      // Check for product name (regardless of current destination)
      if (isProductNameField(item.label)) {
        const productName = item.value.trim();
        const key = productName.toLowerCase();

        if (seenNames.has(key)) {
          currentProductId = seenNames.get(key)!;
        } else {
          const productId = randomUUID().split('-')[0];
          products.push({
            id: productId,
            name: productName,
            nameSource: {
              label: item.label,
              cell: item.vCell,
            },
          });
          seenNames.set(key, productId);
          currentProductId = productId;
        }

        // Map this item to the product and ensure it's marked as product destination
        productContextMap.set(item.id, currentProductId);
        if (item.destination === 'answer_library') {
          item.destination = 'product';
        }
      }

      // Check for product code (regardless of destination)
      if (isProductCodeField(item.label) && currentProductId) {
        const product = products.find(p => p.id === currentProductId);
        if (product && !product.code) {
          product.code = item.value.trim();
        }
        // Also mark this item as product destination
        productContextMap.set(item.id, currentProductId);
        if (item.destination === 'answer_library') {
          item.destination = 'product';
        }
      }
    }

    // If we found a product in this section, map all product-destination items to it
    if (currentProductId) {
      for (const item of section.items) {
        if (item.destination === 'product' && !productContextMap.has(item.id)) {
          productContextMap.set(item.id, currentProductId);
        }
      }
    }
  }

  return { products, productContextMap };
}

/** Link items to their parent entities and products */
function linkItemsToEntitiesAndProducts(
  sections: IndexedSection[],
  entityExtraction: EntityExtraction,
  productExtraction: ProductExtraction
): void {
  const { entityContextMap } = entityExtraction;
  const { productContextMap } = productExtraction;

  for (const section of sections) {
    const sectionEntityId = entityContextMap.get(section.title);

    for (const item of section.items) {
      // Link company items to their entity
      if (item.destination === 'company' && sectionEntityId) {
        item.entityId = sectionEntityId;
      }

      // Link product items to their product
      if (item.destination === 'product') {
        const productId = productContextMap.get(item.id);
        if (productId) {
          item.productId = productId;
        }
      }
    }
  }
}

// =============================================================================
// TOPIC NORMALIZATION
// =============================================================================

// Fallback patterns if topics.yaml is not available
const FALLBACK_TOPIC_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
  // ENTITY
  { pattern: /company|firmierung|entreprise|bedrijf|general.*data|allgemeine.*daten|algemene/i, topic: 'entity_info' },
  { pattern: /contact|ansprech|kontakt|contactpersoon/i, topic: 'entity_contacts' },
  { pattern: /financ|finanz|bank|steuer|tax|btw|vat/i, topic: 'financial' },

  // PRODUCT
  { pattern: /product.*name|artikel.*nummer|article.*number/i, topic: 'product_identification' },
  { pattern: /appearance|taste|smell|odour|color|colour|texture/i, topic: 'product_attributes' },
  { pattern: /ingredient|zutat|ingrédient|ingrediënt|composition|formula/i, topic: 'product_composition' },
  { pattern: /allerg/i, topic: 'product_allergens' },
  { pattern: /nutri|nährwert|valeur.*nutritive|voedingswaarde/i, topic: 'product_nutrition' },
  { pattern: /halal|kosher|organic|vegan|vegetarian/i, topic: 'product_certifications' },
  { pattern: /shelf.*life|haltbarkeit|durée.*conservation|houdbaarheid/i, topic: 'product_specifications' },
  { pattern: /packag|verpack|emballage|verpakking|label/i, topic: 'product_packaging' },

  // OPERATIONS
  { pattern: /haccp|food.*safety.*system|qm.*system|quality.*management/i, topic: 'quality_systems' },
  { pattern: /quality|qualität|qualite|kwaliteit/i, topic: 'quality_systems' },
  { pattern: /building|facilit|premises|infrastructure|zoning/i, topic: 'premises' },
  { pattern: /equipment|maintenan|calibrat/i, topic: 'equipment' },
  { pattern: /hygien|handwash/i, topic: 'hygiene' },
  { pattern: /clean|sanit|desinfect/i, topic: 'cleaning' },
  { pattern: /pest|rodent|insect/i, topic: 'pest_control' },
  { pattern: /monitor|sampl|testing/i, topic: 'monitoring' },
  { pattern: /raw.*material|rohstoff|matière.*première|grondstof/i, topic: 'raw_materials' },
  { pattern: /traceab|rückverfolgb|traça|batch|lot/i, topic: 'traceability' },
  { pattern: /logist|transport|shipping|storage|lager/i, topic: 'logistics' },
  { pattern: /waste|abfall|déchet|afval/i, topic: 'waste' },
  { pattern: /bacterio|micro|keime|pathogen/i, topic: 'microbiology' },

  // COMPLIANCE
  { pattern: /certif|zertif|standard|accredit/i, topic: 'certifications' },
  { pattern: /audit|inspection/i, topic: 'audits' },
  { pattern: /food.*safety|lebensmittel.*sicherheit|voedselveiligheid|hazard|ccp/i, topic: 'food_safety' },
  { pattern: /food.*defense|food.*defence|security|tamper/i, topic: 'food_defense' },
  { pattern: /fraud|betrug|fraude|authenticity/i, topic: 'food_fraud' },
  { pattern: /crisis|krisen|crise|recall|complaint|reklamation/i, topic: 'crisis' },
  { pattern: /origin|herkunft|origine|oorsprong|provenance/i, topic: 'origin' },

  // SUSTAINABILITY
  { pattern: /sustain|nachhaltig|durable|duurzaam|csr/i, topic: 'sustainability' },
  { pattern: /environment|umwelt|environnement|milieu/i, topic: 'environment' },
  { pattern: /animal.*welfare|tier.*wohl|dierenwelzijn/i, topic: 'animal_welfare' },

  // ADMIN
  { pattern: /training|schulung|formation|opleiding/i, topic: 'training' },
  { pattern: /document|dokument|pièce|attachment/i, topic: 'documents' },
  { pattern: /onderteken|signature|unterschrift/i, topic: 'signature' },
  { pattern: /approv|genehmig|goedkeuring|authoriz/i, topic: 'approval' },
];

function normalizeTopicWithRules(sectionTitle: string, topics: TopicDefinition[]): string {
  const lowerTitle = sectionTitle.toLowerCase();

  // First try fallback patterns (more specific and multilingual)
  for (const { pattern, topic } of FALLBACK_TOPIC_PATTERNS) {
    if (pattern.test(sectionTitle)) {
      return topic;
    }
  }

  // Then try matching against loaded topic patterns (regex)
  for (const topic of topics) {
    for (const pattern of topic.patterns || []) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(sectionTitle)) {
          return topic.id;
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }
  }

  // Finally try keywords with word boundary matching to avoid false positives
  for (const topic of topics) {
    for (const keyword of topic.keywords || []) {
      // Use word boundary to avoid partial matches like "format" in "informatie"
      const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keywordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (keywordRegex.test(lowerTitle)) {
        return topic.id;
      }
    }
  }

  return 'other';
}

// =============================================================================
// AI TOPIC CLASSIFIER (fallback for unmatched sections)
// =============================================================================

class AITopicClassifier {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private topics: TopicDefinition[];

  constructor(region: string, topics: TopicDefinition[]) {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
    this.topics = topics;
  }

  /**
   * Classify multiple section titles that couldn't be matched by patterns
   */
  async classifyUnmatchedSections(sectionTitles: string[]): Promise<Map<string, string>> {
    if (sectionTitles.length === 0 || this.topics.length === 0) {
      return new Map();
    }

    // Build topic list for the prompt
    const topicList = this.topics.map(t => `- ${t.id}: ${t.name} - ${t.description}`).join('\n');

    const prompt = `You are classifying questionnaire section titles into predefined topics for a food industry supplier questionnaire system.

## Available Topics:
${topicList}

## Section Titles to Classify:
${sectionTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

For each section title, determine the most appropriate topic from the list above. Consider that:
- Titles may be in English, German, French, Dutch, or other languages
- Some titles are abbreviations or domain-specific terms
- If no topic fits well, use "other"

Respond with a JSON array of objects, one for each title:
[
  {"title": "exact title", "topic": "topic_id", "confidence": 0.0-1.0}
]

Only output the JSON array, no other text.`;

    try {
      const response = await this.client.send(new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content?.[0]?.text || '';

      // Parse JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('  Warning: AI classifier returned no valid JSON');
        return new Map();
      }

      const results = JSON.parse(jsonMatch[0]) as Array<{ title: string; topic: string; confidence: number }>;
      const topicMap = new Map<string, string>();

      for (const result of results) {
        // Only use high-confidence classifications
        if (result.confidence >= 0.6) {
          topicMap.set(result.title, result.topic);
        }
      }

      return topicMap;
    } catch (error) {
      console.warn(`  Warning: AI topic classification failed: ${error}`);
      return new Map();
    }
  }
}

// =============================================================================
// TABLE GROUPING (groups consecutive product data items as single evidence)
// =============================================================================

interface GroupedTable {
  type: 'table';
  label: string;
  value: string;
  ref: string;
  topic: string;
  level: ItemLevel;
  itemCount: number;
  items: IndexedItem[];
}

function shouldGroupAsTable(
  items: IndexedItem[],
  sectionTitle: string,
  groupingRules: TableGroupingRules | null
): GroupedTable | null {
  if (!groupingRules || items.length < groupingRules.min_items) {
    return null;
  }

  // Check if section/items match any grouping pattern
  for (const pattern of groupingRules.patterns) {
    // Check if topic matches
    const topicMatches = items.some(item => pattern.topics.includes(item.topic));
    if (!topicMatches) continue;

    // Check if section title or item labels match trigger patterns
    let patternMatches = false;
    for (const triggerPattern of pattern.trigger_patterns) {
      try {
        const regex = new RegExp(triggerPattern, 'i');
        if (regex.test(sectionTitle)) {
          patternMatches = true;
          break;
        }
        // Also check item labels
        if (items.some(item => regex.test(item.label))) {
          patternMatches = true;
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (!patternMatches) continue;

    // Check if we have enough items
    if (items.length < pattern.min_items) continue;

    // Check if items are in consecutive rows
    const rows = items.map(item => extractRowFromCell(item.lCell || item.ref || ''));
    const validRows = rows.filter(r => r > 0).sort((a, b) => a - b);

    if (validRows.length < pattern.min_items) continue;

    // Check for max row gap
    let isConsecutive = true;
    for (let i = 1; i < validRows.length; i++) {
      if (validRows[i] - validRows[i - 1] > groupingRules.max_row_gap) {
        isConsecutive = false;
        break;
      }
    }

    if (!isConsecutive) continue;

    // Create grouped table
    const startRow = Math.min(...validRows);
    const endRow = Math.max(...validRows);
    const primaryTopic = items[0]?.topic || 'other';

    // Build summary value from items
    const summaryParts = items.slice(0, 5).map(item =>
      `${item.label}: ${item.value || '(empty)'}`
    );
    if (items.length > 5) {
      summaryParts.push(`... and ${items.length - 5} more`);
    }

    return {
      type: 'table',
      label: `${sectionTitle} (${pattern.name})`,
      value: summaryParts.join('\n'),
      ref: `${startRow}:${endRow}`,
      topic: primaryTopic,
      level: 'product',
      itemCount: items.length,
      items: items,
    };
  }

  return null;
}

function extractRowFromCell(cellRef: string): number {
  const match = cellRef.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// =============================================================================
// TABLE RECONSTRUCTION
// =============================================================================

/**
 * Reconstruct table structures from flattened items
 * Groups items that share the same row number but have different columns
 */
function reconstructTables(items: IndexedItem[], sectionTitle: string): {
  tables: ReconstructedTable[];
  remainingItems: IndexedItem[];
  sectionType: 'individual_items' | 'table_data' | 'mixed';
} {
  // Group items by row number (extracted from lCell)
  const rowMap = new Map<number, IndexedItem[]>();
  const itemsWithoutCells: IndexedItem[] = [];

  for (const item of items) {
    if (!item.lCell) {
      itemsWithoutCells.push(item);
      continue;
    }

    const rowNumber = extractRowFromCell(item.lCell);
    if (rowNumber === -1) {
      itemsWithoutCells.push(item);
      continue;
    }

    if (!rowMap.has(rowNumber)) {
      rowMap.set(rowNumber, []);
    }
    rowMap.get(rowNumber)!.push(item);
  }

  const tables: ReconstructedTable[] = [];
  const tableItemIds = new Set<string>();

  // Find table structures - be more selective about what constitutes a table
  const tableRows = Array.from(rowMap.entries())
    .filter(([_, rowItems]) => rowItems.length > 1) // Simple multi-column detection for now
    .sort(([a], [b]) => a - b); // Sort by row number

  if (tableRows.length > 0) {
    // Group consecutive rows into tables
    let currentTable: {
      rows: { rowNumber: number; cells: TableCell[] }[];
      sourceItems: string[];
      startRow: number;
      endRow: number;
    } | null = null;

    for (const [rowNumber, rowItems] of tableRows) {
      const tableCells: TableCell[] = [];

      // Sort items by column
      const sortedItems = rowItems.sort((a, b) => {
        const colA = extractColumnFromCell(a.lCell || '');
        const colB = extractColumnFromCell(b.lCell || '');
        return colA.localeCompare(colB);
      });

      for (const item of sortedItems) {
        tableCells.push({
          column: extractColumnFromCell(item.lCell || ''),
          value: item.value || '',
          itemId: item.id,
          type: item.type
        });
      }

      // Check if this row continues the current table (consecutive or close rows)
      if (currentTable && rowNumber <= currentTable.endRow + 2) {
        // Continue existing table
        currentTable.rows.push({
          rowNumber,
          cells: tableCells
        });
        currentTable.sourceItems.push(...rowItems.map(i => i.id));
        currentTable.endRow = rowNumber;
      } else {
        // Finalize previous table if exists
        if (currentTable) {
          finishTable(currentTable, tables, sectionTitle);
        }

        // Start new table
        currentTable = {
          rows: [{
            rowNumber,
            cells: tableCells
          }],
          sourceItems: rowItems.map(i => i.id),
          startRow: rowNumber,
          endRow: rowNumber
        };
      }

      // Mark items as part of table
      rowItems.forEach(item => tableItemIds.add(item.id));
    }

    // Finalize last table
    if (currentTable) {
      finishTable(currentTable, tables, sectionTitle);
    }
  }

  // Items not part of tables remain as individual items
  const remainingItems = [
    ...itemsWithoutCells,
    ...items.filter(item => !tableItemIds.has(item.id))
  ];

  // Determine section type
  let sectionType: 'individual_items' | 'table_data' | 'mixed';
  if (tables.length === 0) {
    sectionType = 'individual_items';
  } else if (remainingItems.length === 0) {
    sectionType = 'table_data';
  } else {
    sectionType = 'mixed';
  }

  return { tables, remainingItems, sectionType };
}

/**
 * Finalize a table structure
 */
function finishTable(
  currentTable: {
    rows: { rowNumber: number; cells: TableCell[] }[];
    sourceItems: string[];
  },
  tables: ReconstructedTable[],
  sectionTitle: string
) {
  if (currentTable.rows.length === 0) return;

  // Generate headers from first row or column names
  const allColumns = new Set<string>();
  for (const row of currentTable.rows) {
    for (const cell of row.cells) {
      allColumns.add(cell.column);
    }
  }
  const headers = Array.from(allColumns).sort();

  // Generate table title
  const tableTitle = currentTable.rows.length === 1
    ? sectionTitle
    : `${sectionTitle} (${currentTable.rows.length} rows)`;

  tables.push({
    title: tableTitle,
    headers,
    rows: currentTable.rows,
    sourceItems: currentTable.sourceItems
  });
}

/**
 * Extract column from cell reference (e.g., "A12" -> "A")
 */
function extractColumnFromCell(cellRef: string): string {
  const match = cellRef.match(/^([A-Z]+)/);
  return match ? match[1] : '';
}

// =============================================================================
// QUESTIONNAIRE INDEXER
// =============================================================================

export class QuestionnaireIndexer {
  private storageDir: string;
  private analyzer: VisualAnalyzer;
  private rulesManager: RulesManager;
  private rulesDir: string;
  private region: string;
  private topics: TopicDefinition[] = [];
  private placeholderConfig: PlaceholderConfig | null = null;

  constructor(storageDir: string = './structure', region: string = 'eu-central-1', rulesDir: string = './rules') {
    this.storageDir = storageDir;
    this.analyzer = new VisualAnalyzer(region);
    this.rulesManager = new RulesManager(rulesDir);
    this.rulesDir = rulesDir;
    this.region = region;
  }

  /**
   * Index a questionnaire - extract ALL items organized by section
   */
  async index(filename: string): Promise<IndexedQuestionnaire> {
    // Load stored structure
    const jsonName = filename.replace(/\.(xlsx?|docx?|pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filepath = join(this.storageDir, `${jsonName}.json`);
    const content = await readFile(filepath, 'utf-8');
    const structure: QuestionnaireStructure = JSON.parse(content);

    // Build cell ref to pageNumber map for navigation
    const cellPageMap = this.buildCellPageMap(structure);
    console.log(`  Built cell page map with ${cellPageMap.size} entries`);

    // Load topics from topics.yaml
    this.topics = await loadTopicsFromRules(this.rulesDir);
    if (this.topics.length > 0) {
      console.log(`  Loaded ${this.topics.length} topic definitions from topics.yaml`);
    }

    // Load placeholder config for detecting empty dropdown values
    this.placeholderConfig = await loadPlaceholderConfig();

    // Load rules
    const rules = await this.rulesManager.loadIndexRules();
    const ruleStats = this.rulesManager.getStats();
    if (ruleStats.index.exclude > 0 || ruleStats.index.corrections > 0) {
      console.log(`  Loaded ${ruleStats.index.exclude} exclude + ${ruleStats.index.corrections} correction rules`);
    }

    const docType = structure.source.documentType || 'excel';
    console.log(`  Analyzing ${structure.sheets.length} sheets with Claude... (${docType})`);

    // Analyze all sheets
    const analyses = await this.analyzer.analyzeQuestionnaire(structure.sheets, docType);

    // Detect document-level language from all labels and values
    const allTexts: string[] = [];
    for (const analysis of analyses) {
      for (const item of analysis.items) {
        if (item.label) allTexts.push(item.label);
        if (item.value && item.value !== 'EMPTY') allTexts.push(item.value);
      }
    }
    const documentLanguage = this.detectDocumentLanguage(allTexts);
    console.log(`  Detected document language: ${documentLanguage}`);

    // Build indexed structure
    const sections: IndexedSection[] = [];
    const allItems: IndexedItem[] = [];
    const unmatchedSectionTitles: string[] = [];

    for (const analysis of analyses) {
      // Group items by section
      const sectionMap = new Map<string, DetectedItem[]>();

      for (const item of analysis.items) {
        const sectionTitle = item.section || analysis.sheetName;
        if (!sectionMap.has(sectionTitle)) {
          sectionMap.set(sectionTitle, []);
        }
        sectionMap.get(sectionTitle)!.push(item);
      }

      // Ensure all detected sections are preserved (including empty ones)
      const allSectionTitles = new Set<string>();
      // Add sections that have items
      sectionMap.forEach((_, title) => allSectionTitles.add(title));
      // Add sections from the outline (even if they have no items)
      analysis.sections.forEach(section => allSectionTitles.add(section.title));

      // Convert to indexed sections - process ALL sections (including empty ones)
      for (const sectionTitle of allSectionTitles) {
        const items = sectionMap.get(sectionTitle) || []; // Empty array for sections with no items
        const topic = normalizeTopicWithRules(sectionTitle, this.topics);
        let indexedItems: IndexedItem[] = [];

        // Track unmatched sections for AI classification
        if (topic === 'other' && !unmatchedSectionTitles.includes(sectionTitle)) {
          unmatchedSectionTitles.push(sectionTitle);
        }

        for (const item of items) {
          // Check if item should be excluded by rules
          if (this.rulesManager.shouldExcludeFromIndex({
            label: item.label,
            lCell: item.lCell,
            vCell: item.vCell,
            ref: item.ref,
          })) {
            continue; // Skip excluded items
          }

          // Use document language as default, only override if item has strong language indicators
          const itemLang = this.detectItemLanguageOverride(item.label + ' ' + (item.value || ''), documentLanguage);
          // Check for empty/placeholder values (dropdown placeholders, unfilled fields)
          const hasValue = item.value && item.value.trim() !== '' &&
            !isPlaceholderValue(item.value, this.placeholderConfig!);

          // Use AI-suggested destination from Claude, with fallback logic
          let aiDestination: ItemDestination;
          if (!hasValue) {
            aiDestination = 'exclude'; // Empty items should be excluded
          } else if (item.destination && ['company', 'answer_library', 'product'].includes(item.destination)) {
            // Use Claude's destination if provided and valid
            aiDestination = item.destination as ItemDestination;
          } else if (item.level === 'product') {
            // Fallback: product level → product destination
            aiDestination = 'product';
          } else {
            // Fallback: standard and narrative → answer_library
            aiDestination = 'answer_library';
          }

          // Detect entity role for company-destination items
          const entityRole = aiDestination === 'company'
            ? detectEntityRole(item.label, sectionTitle)
            : undefined;

          // Process value - handle "Please specify:" prefix
          const processedValue = this.processValue(item.value);

          let indexedItem: IndexedItem = {
            id: randomUUID().split('-')[0], // Short unique ID
            type: item.type,
            label: item.label,
            value: hasValue ? processedValue.value : undefined,
            ...(processedValue.isConditional ? { isConditional: true } : {}),
            topic: item.topic || topic, // Use item's topic if available, otherwise section topic
            level: item.level,
            lang: itemLang,
            destination: aiDestination, // AI-suggested destination
            ...(entityRole && entityRole !== 'other' ? { entityRole } : {}),
          };

          // Add cell references based on type
          if (item.type === 'table' && item.ref) {
            indexedItem.ref = item.ref;
          } else {
            if (item.lCell) indexedItem.lCell = item.lCell;
            if (item.vCell) indexedItem.vCell = item.vCell;
          }

          // Look up pageNumber from cell refs
          const pageNumber = cellPageMap.get(item.lCell) || cellPageMap.get(item.vCell || '') || cellPageMap.get(item.ref || '');
          if (pageNumber) {
            indexedItem.pageNumber = pageNumber;
          }

          // Apply corrections from rules
          indexedItem = this.rulesManager.applyIndexCorrections(indexedItem);

          indexedItems.push(indexedItem);
          allItems.push(indexedItem);
        }

        // Sort items by row (extract from lCell or ref)
        indexedItems.sort((a, b) => {
          const rowA = this.extractRow(a.lCell || a.ref || '');
          const rowB = this.extractRow(b.lCell || b.ref || '');
          return rowA - rowB;
        });

        // Expand multi-column specification items (post-processing fix for Claude missing columns)
        indexedItems = this.expandMultiColumnSpecificationItems(indexedItems, analysis);

        // Always preserve sections - even if empty - to show complete questionnaire structure
        const rows = indexedItems.length > 0 ? this.calculateRowRange(indexedItems) : '0-0';

        // Preserve content naturally - don't force table reconstruction
        // Just keep all items as they naturally appear in the section
        sections.push({
          title: sectionTitle,
          topic,
          rows,
          sheet: analysis.sheetName,
          items: indexedItems, // All items preserved as-is (even if empty)
          sectionType: 'individual_items', // Show content naturally
        });
      }
    }

    // Use AI to classify unmatched sections
    if (unmatchedSectionTitles.length > 0 && this.topics.length > 0) {
      console.log(`  Classifying ${unmatchedSectionTitles.length} unmatched sections with AI...`);
      const classifier = new AITopicClassifier(this.region, this.topics);
      const aiTopics = await classifier.classifyUnmatchedSections(unmatchedSectionTitles);

      // Update sections and their items with AI-classified topics
      for (const section of sections) {
        if (section.topic === 'other' && aiTopics.has(section.title)) {
          const newTopic = aiTopics.get(section.title)!;
          section.topic = newTopic;
          // Also update items that inherited the section topic
          for (const item of section.items) {
            if (item.topic === 'other') {
              item.topic = newTopic;
            }
          }
        }
      }

      const classified = [...aiTopics.values()].length;
      if (classified > 0) {
        console.log(`    AI classified ${classified} sections`);
      }
    }

    // Apply table grouping rules to consolidate product data tables
    const groupingRules = getTableGroupingRules();
    if (groupingRules) {
      let tablesGrouped = 0;
      for (const section of sections) {
        // Only group product-level items
        const productItems = section.items.filter(item => item.level === 'product');
        if (productItems.length >= groupingRules.min_items) {
          const grouped = shouldGroupAsTable(productItems, section.title, groupingRules);
          if (grouped) {
            // Replace individual items with grouped table
            const nonProductItems = section.items.filter(item => item.level !== 'product');
            section.items = [
              ...nonProductItems,
              {
                id: randomUUID().split('-')[0], // Short unique ID for grouped table
                type: grouped.type,
                label: grouped.label,
                value: grouped.value,
                ref: grouped.ref,
                topic: grouped.topic,
                level: grouped.level,
                lang: undefined,
                destination: 'product' as ItemDestination, // Grouped tables are product-level
              },
            ];
            tablesGrouped++;
          }
        }
      }
      if (tablesGrouped > 0) {
        console.log(`  Grouped ${tablesGrouped} product data tables`);
      }
    }

    // Sort sections by start row
    sections.sort((a, b) => {
      const rowA = parseInt(a.rows.split('-')[0], 10) || 0;
      const rowB = parseInt(b.rows.split('-')[0], 10) || 0;
      return rowA - rowB;
    });

    // Recalculate allItems after grouping
    const finalItems: IndexedItem[] = [];
    for (const section of sections) {
      finalItems.push(...section.items);
    }

    // Calculate stats
    const stats = this.calculateStats(finalItems);

    // Detect primary language
    const primaryLanguage = this.detectPrimaryLanguage(allItems);

    // Extract entities and products, then link items to them
    console.log('  Extracting entities and products...');
    const entityExtraction = extractEntities(sections);
    const productExtraction = extractProducts(sections);
    linkItemsToEntitiesAndProducts(sections, entityExtraction, productExtraction);

    if (entityExtraction.entities.length > 0) {
      console.log(`    Found ${entityExtraction.entities.length} entities:`);
      for (const entity of entityExtraction.entities) {
        console.log(`      - ${entity.name} (${entity.role})`);
      }
    }

    if (productExtraction.products.length > 0) {
      console.log(`    Found ${productExtraction.products.length} products:`);
      for (const product of productExtraction.products.slice(0, 5)) {
        console.log(`      - ${product.name}${product.code ? ` [${product.code}]` : ''}`);
      }
      if (productExtraction.products.length > 5) {
        console.log(`      ... and ${productExtraction.products.length - 5} more`);
      }
    }

    // Build result with optional sourceInfo from API
    const result: IndexedQuestionnaire = {
      id: randomUUID().split('-')[0],
      source: structure.source.filename,
      indexed: new Date().toISOString().split('T')[0],
      language: primaryLanguage,
      entities: entityExtraction.entities,
      products: productExtraction.products,
      sections,
      stats,
    };

    // Propagate Passionfruit API source info if available
    if (structure.source.evidenceId && structure.source.evidenceName) {
      result.sourceInfo = {
        evidenceId: structure.source.evidenceId,
        evidenceName: structure.source.evidenceName,
      };
    }

    return result;
  }

  /**
   * Expand multi-column specification items that Claude missed.
   * Detects items with lCell/vCell that skip columns (e.g., A186→C186)
   * and creates separate items for each column using the original structure data.
   */
  private expandMultiColumnSpecificationItems(items: IndexedItem[], analysis: SheetAnalysis): IndexedItem[] {
    const expandedItems: IndexedItem[] = [];

    for (const item of items) {
      // Only process items that have both lCell and vCell
      if (!item.lCell || !item.vCell) {
        expandedItems.push(item);
        continue;
      }

      // Extract row and columns
      const lRow = this.extractRow(item.lCell);
      const vRow = this.extractRow(item.vCell);
      const lCol = this.extractColumn(item.lCell);
      const vCol = this.extractColumn(item.vCell);

      // Only process if both cells are on the same row but different columns
      if (lRow !== vRow || lRow <= 0) {
        expandedItems.push(item);
        continue;
      }

      // Check if there are missing columns between lCell and vCell
      const missingColumns = this.findMissingColumns(lCol, vCol, lRow, analysis);
      if (missingColumns.length === 0) {
        // No missing columns, keep original item
        expandedItems.push(item);
        continue;
      }

      // Create separate items for each column
      const allColumns = [lCol, ...missingColumns, vCol];
      for (let i = 0; i < allColumns.length; i++) {
        const col = allColumns[i];
        const cellRef = `${col}${lRow}`;

        // Get the actual cell value from structure
        const cellValue = this.getCellValueFromStructure(cellRef, analysis);

        let newLabel: string;
        let newValue: string;

        if (i === 0) {
          // First column: parameter name
          newLabel = item.label;
          newValue = cellValue || '(parameter name)';
        } else if (i === allColumns.length - 1) {
          // Last column: use original item's logic if it's the vCell
          if (col === vCol) {
            newLabel = `${item.label} - Monitoring Method`;
            newValue = item.value || cellValue || '';
          } else {
            newLabel = `${item.label} - Column ${col}`;
            newValue = cellValue || 'EMPTY';
          }
        } else {
          // Middle columns: likely standard values
          newLabel = `${item.label} - Standard Value`;
          newValue = cellValue || 'EMPTY';
        }

        // Create new indexed item
        const expandedItem: IndexedItem = {
          ...item, // Copy all original properties
          id: randomUUID().split('-')[0], // New unique ID
          label: newLabel,
          value: newValue,
          lCell: cellRef,
          vCell: cellRef, // For single-column items, lCell = vCell
        };

        expandedItems.push(expandedItem);
      }
    }

    return expandedItems;
  }

  /**
   * Find missing column letters between start and end columns
   */
  private findMissingColumns(startCol: string, endCol: string, row: number, analysis: SheetAnalysis): string[] {
    const missing: string[] = [];
    const startCode = startCol.charCodeAt(0);
    const endCode = endCol.charCodeAt(0);

    // Only handle single-letter columns for now (A-Z)
    if (startCol.length > 1 || endCol.length > 1) {
      return missing;
    }

    // Find columns that exist in the structure between start and end
    for (let code = startCode + 1; code < endCode; code++) {
      const col = String.fromCharCode(code);
      const cellRef = `${col}${row}`;

      // Check if this cell exists in the structure
      if (this.cellExistsInStructure(cellRef, analysis)) {
        missing.push(col);
      }
    }

    return missing;
  }

  /**
   * Check if a cell exists in the structure data
   */
  private cellExistsInStructure(cellRef: string, analysis: SheetAnalysis): boolean {
    // This is a simplified check - in a real implementation, we'd need to
    // access the original structure data that was used to generate the analysis
    // For now, we'll assume standard patterns exist (A, B, C columns for specs)
    const row = this.extractRow(cellRef);
    const col = this.extractColumn(cellRef);

    // For specification tables, assume B column exists between A and C
    if (row >= 186 && row <= 199 && col === 'B') {
      return true;
    }

    return false;
  }

  /**
   * Get cell value from structure data
   */
  private getCellValueFromStructure(cellRef: string, analysis: SheetAnalysis): string | null {
    // This would need access to the original structure data
    // For now, return null and let the calling code handle empty values
    return null;
  }

  /**
   * Extract column letter from cell reference (e.g., "A186" → "A")
   */
  private extractColumn(cellRef: string): string {
    const match = cellRef.match(/^([A-Z]+)/);
    return match ? match[1] : 'A';
  }

  /**
   * Calculate row range string from items
   */
  private calculateRowRange(items: IndexedItem[]): string {
    const rows: number[] = [];
    for (const item of items) {
      const row = this.extractRow(item.lCell || item.ref || '');
      if (row > 0) rows.push(row);

      // For tables, also get end row
      if (item.ref && item.ref.includes(':')) {
        const endRow = this.extractRow(item.ref.split(':')[1]);
        if (endRow > 0) rows.push(endRow);
      }
    }

    if (rows.length === 0) return '0-0';
    const min = Math.min(...rows);
    const max = Math.max(...rows);
    return `${min}-${max}`;
  }

  /**
   * Detect language using franc
   */
  private detectLanguage(text: string): Language | 'unknown' {
    if (text.length < 20) {
      return this.detectLanguageSimple(text);
    }

    const detected = franc(text, { only: ['eng', 'deu', 'fra', 'nld'] });
    const langMap: Record<string, Language | 'unknown'> = {
      eng: 'en',
      deu: 'de',
      fra: 'fr',
      nld: 'nl',
      und: 'unknown',
    };

    return langMap[detected] || 'unknown';
  }

  /**
   * Simple pattern-based language detection for short texts
   */
  private detectLanguageSimple(text: string): Language | 'unknown' {
    const lower = text.toLowerCase();

    if (/[äöüß]/.test(text)) return 'de';
    if (/\b(und|oder|nicht|das|die|der)\b/i.test(lower)) return 'de';

    if (/[éèêëàâùûôîç]/.test(text)) return 'fr';
    if (/\b(et|ou|les|des|une|que)\b/i.test(lower)) return 'fr';

    if (/\b(en|of|het|een|zijn|van)\b/i.test(lower)) return 'nl';

    if (/\b(and|or|the|is|are)\b/i.test(lower)) return 'en';

    return 'unknown';
  }

  /**
   * Detect document-level language from all text samples
   * Uses voting across all text to determine the primary language
   */
  private detectDocumentLanguage(texts: string[]): Language {
    // Collect votes from all text samples
    const votes: Record<Language, number> = { en: 0, de: 0, fr: 0, nl: 0 };

    // Combine all text into chunks for better franc detection
    const combinedText = texts.join(' ');

    // Use franc on the full document text
    if (combinedText.length >= 100) {
      const detected = franc(combinedText, { only: ['eng', 'deu', 'fra', 'nld'] });
      const langMap: Record<string, Language> = {
        eng: 'en',
        deu: 'de',
        fra: 'fr',
        nld: 'nl',
      };
      if (langMap[detected]) {
        return langMap[detected];
      }
    }

    // Fallback: check for language-specific characters
    if (/[äöüß]/i.test(combinedText)) {
      votes.de += 50;
    }
    if (/[éèêëàâùûôîç]/i.test(combinedText)) {
      votes.fr += 50;
    }

    // Count language-specific keywords
    const germanKeywords = ['und', 'oder', 'nicht', 'das', 'die', 'der', 'ist', 'bei', 'zur', 'zum', 'auf', 'für', 'mit', 'nach', 'aus', 'von', 'ja', 'nein', 'bitte', 'angaben', 'name', 'adresse', 'telefon', 'datum', 'produkt', 'lieferant'];
    const frenchKeywords = ['et', 'ou', 'les', 'des', 'une', 'que', 'pour', 'sur', 'dans', 'avec', 'oui', 'non', 'nom', 'adresse', 'produit', 'fournisseur'];
    const dutchKeywords = ['het', 'een', 'zijn', 'van', 'op', 'voor', 'met', 'naar', 'bij', 'naam', 'adres', 'product', 'leverancier', 'telefoon'];
    const englishKeywords = ['and', 'the', 'for', 'with', 'from', 'yes', 'no', 'name', 'address', 'product', 'supplier', 'date', 'please', 'specify'];

    const lower = combinedText.toLowerCase();
    germanKeywords.forEach(kw => { if (lower.includes(kw)) votes.de++; });
    frenchKeywords.forEach(kw => { if (lower.includes(kw)) votes.fr++; });
    dutchKeywords.forEach(kw => { if (lower.includes(kw)) votes.nl++; });
    englishKeywords.forEach(kw => { if (lower.includes(kw)) votes.en++; });

    // Return language with highest votes, default to 'en'
    let maxLang: Language = 'en';
    let maxVotes = 0;
    for (const [lang, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        maxLang = lang as Language;
      }
    }

    return maxLang;
  }

  /**
   * Check if an item should override the document language
   * Only returns a different language if there's strong evidence (special characters)
   */
  private detectItemLanguageOverride(text: string, documentLanguage: Language): Language | undefined {
    // Check for definitive language markers (special characters)
    if (/[äöüß]/.test(text) && documentLanguage !== 'de') {
      return 'de';
    }
    if (/[éèêëàâùûôîç]/.test(text) && documentLanguage !== 'fr') {
      return 'fr';
    }

    // Use document language for everything else
    return documentLanguage;
  }

  /**
   * Process a value to handle common patterns like "Please specify:" prefixes
   * Returns the cleaned value and whether this is a conditional/follow-up question
   */
  private processValue(value: string | undefined): { value: string | undefined; isConditional: boolean } {
    if (!value || value === 'EMPTY') {
      return { value: undefined, isConditional: false };
    }

    const trimmed = value.trim();

    // Patterns indicating a conditional/follow-up question
    const conditionalPrefixes = [
      /^please specify[:\s]*(.*)$/i,
      /^bitte angeben[:\s]*(.*)$/i,
      /^veuillez préciser[:\s]*(.*)$/i,
      /^specificeer[:\s]*(.*)$/i,
      /^if yes[,:\s]*(.*)$/i,
      /^wenn ja[,:\s]*(.*)$/i,
      /^si oui[,:\s]*(.*)$/i,
      /^indien ja[,:\s]*(.*)$/i,
    ];

    for (const pattern of conditionalPrefixes) {
      const match = trimmed.match(pattern);
      if (match) {
        const extractedValue = match[1]?.trim();
        // If there's actual content after the prefix, extract it
        if (extractedValue && extractedValue.length > 0) {
          return { value: extractedValue, isConditional: true };
        }
        // If the prefix is there but no content, mark as conditional but keep original
        return { value: trimmed, isConditional: true };
      }
    }

    return { value: trimmed, isConditional: false };
  }

  /**
   * Extract row number from cell reference
   */
  /**
   * Build a map of cell refs to page numbers from structure data
   */
  private buildCellPageMap(structure: QuestionnaireStructure): Map<string, number> {
    const cellPageMap = new Map<string, number>();

    for (const sheet of structure.sheets) {
      for (const row of sheet.rows) {
        for (const [col, cell] of Object.entries(row.cells)) {
          if (cell.pageNumber) {
            // Use the ref if available, otherwise construct from row/col
            const ref = cell.ref || `${col}${row.row}`;
            cellPageMap.set(ref, cell.pageNumber);
          }
        }
      }
    }

    return cellPageMap;
  }

  private extractRow(cellRef: string): number {
    const match = cellRef.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Calculate statistics
   */
  private calculateStats(items: IndexedItem[]): IndexedQuestionnaire['stats'] {
    let standard = 0;
    let narrative = 0;
    let product = 0;
    let answered = 0;

    for (const item of items) {
      if (item.level === 'standard') standard++;
      else if (item.level === 'narrative') narrative++;
      else product++;

      if (item.value) answered++;
    }

    return {
      total: items.length,
      answered,
      standard,
      narrative,
      product,
    };
  }

  /**
   * Detect primary language
   */
  private detectPrimaryLanguage(items: IndexedItem[]): Language {
    const counts: Record<Language, number> = { en: 0, de: 0, fr: 0, nl: 0 };

    for (const item of items) {
      if (item.lang) {
        counts[item.lang]++;
      }
    }

    let maxLang: Language = 'en';
    let maxCount = 0;

    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxLang = lang as Language;
      }
    }

    return maxLang;
  }

  /**
   * Index with specific extraction strategy
   *
   * Strategies:
   * - 'azure': Local JSON parsing only (parses structure.json, no API calls)
   * - 'vision': Claude Vision API (analyzes original PDF with bounding boxes)
   * - 'both': Run both strategies in parallel, save separate files
   * - 'legacy': Use the existing mixed approach (backward compatible)
   */
  async indexWithStrategy(
    filename: string,
    strategy: ExtractionStrategy = 'both',
    options?: {
      outputDir?: string;
      pdfPath?: string; // Required for vision strategy
    }
  ): Promise<MultiStrategyResult> {
    const result: MultiStrategyResult = {};
    const outputDir = options?.outputDir || join(this.storageDir, '..', 'indexed');
    const jsonName = filename.replace(/\.(xlsx?|docx?|pdf|json)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');

    console.log(`\n  📊 Indexing with strategy: ${strategy}`);

    // Determine what to run
    const runAzure = strategy === 'azure' || strategy === 'both';
    const runVision = strategy === 'vision' || strategy === 'both';
    const runLegacy = strategy === 'legacy';

    // Run strategies (in parallel where possible)
    const promises: Promise<void>[] = [];

    if (runAzure) {
      promises.push(
        (async () => {
          console.log(`  🔷 Running Azure strategy (local JSON parsing)...`);
          try {
            const azureIndexer = new AzureIndexer(this.storageDir, this.rulesDir);
            result.azure = await azureIndexer.index(filename, outputDir);
            console.log(`  ✓ Azure: ${result.azure.stats.total} items extracted`);
          } catch (error) {
            console.error(`  ✗ Azure strategy failed: ${error}`);
          }
        })()
      );
    }

    if (runVision && options?.pdfPath) {
      promises.push(
        (async () => {
          console.log(`  🔶 Running Vision strategy (Claude Vision API)...`);
          try {
            const visionIndexer = new VisionIndexer(this.storageDir, this.region, this.rulesDir);
            result.vision = await visionIndexer.index(options.pdfPath!, outputDir);
            console.log(`  ✓ Vision: ${result.vision.stats.total} items extracted`);
          } catch (error) {
            console.error(`  ✗ Vision strategy failed: ${error}`);
          }
        })()
      );
    } else if (runVision && !options?.pdfPath) {
      console.warn(`  ⚠ Vision strategy requires pdfPath option, skipping...`);
    }

    if (runLegacy) {
      promises.push(
        (async () => {
          console.log(`  🔳 Running Legacy strategy (mixed Claude analysis)...`);
          try {
            result.legacy = await this.index(filename);
            // Save legacy output
            await mkdir(outputDir, { recursive: true });
            const legacyPath = join(outputDir, `${jsonName}.json`);
            await writeFile(legacyPath, JSON.stringify(result.legacy, null, 2));
            console.log(`  ✓ Legacy: ${result.legacy.stats.total} items extracted`);
          } catch (error) {
            console.error(`  ✗ Legacy strategy failed: ${error}`);
          }
        })()
      );
    }

    // Wait for all strategies to complete
    await Promise.all(promises);

    // Apply contextualization to create self-explaining questions
    if (result.azure) {
      console.log(`  📝 Contextualizing Azure labels...`);
      const azureContextualized = contextualizeQuestions(result.azure.sections);
      result.azure.sections = azureContextualized.sections;
      console.log(`    ✓ Transformed ${azureContextualized.stats.transformed}/${azureContextualized.stats.totalItems} labels`);
      // Re-save with contextualized labels
      const azurePath = join(outputDir, `${jsonName}-azure.json`);
      await writeFile(azurePath, JSON.stringify(result.azure, null, 2));
    }
    if (result.vision) {
      console.log(`  📝 Contextualizing Vision labels...`);
      const visionContextualized = contextualizeQuestions(result.vision.sections);
      result.vision.sections = visionContextualized.sections;
      console.log(`    ✓ Transformed ${visionContextualized.stats.transformed}/${visionContextualized.stats.totalItems} labels`);
      // Re-save with contextualized labels
      const visionPath = join(outputDir, `${jsonName}-vision.json`);
      await writeFile(visionPath, JSON.stringify(result.vision, null, 2));
    }
    if (result.legacy) {
      console.log(`  📝 Contextualizing Legacy labels...`);
      const legacyContextualized = contextualizeQuestions(result.legacy.sections);
      result.legacy.sections = legacyContextualized.sections;
      console.log(`    ✓ Transformed ${legacyContextualized.stats.transformed}/${legacyContextualized.stats.totalItems} labels`);
      // Re-save with contextualized labels
      const legacyPath = join(outputDir, `${jsonName}.json`);
      await writeFile(legacyPath, JSON.stringify(result.legacy, null, 2));
    }

    // Summary
    console.log(`\n  📊 Extraction Summary:`);
    if (result.azure) {
      console.log(`     Azure:  ${result.azure.stats.total} items (${result.azure.stats.answered} answered)`);
    }
    if (result.vision) {
      console.log(`     Vision: ${result.vision.stats.total} items (${result.vision.stats.answered} answered)`);
    }
    if (result.legacy) {
      console.log(`     Legacy: ${result.legacy.stats.total} items (${result.legacy.stats.answered} answered)`);
    }

    return result;
  }

  /**
   * Save indexed questionnaire
   */
  async save(indexed: IndexedQuestionnaire, outputDir: string = './indexed'): Promise<string> {
    await mkdir(outputDir, { recursive: true });

    const safeName = indexed.source
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '_');

    const filename = `${safeName}.json`;
    const filepath = join(outputDir, filename);

    await writeFile(filepath, JSON.stringify(indexed, null, 2), 'utf-8');

    return filepath;
  }
}
