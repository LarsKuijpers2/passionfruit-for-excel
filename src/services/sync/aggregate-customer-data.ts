/**
 * Aggregate Customer Data for API Import
 *
 * Loads all approved exports for a customer, deduplicates items,
 * and tracks which questionnaires each item appears in.
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface ExportedItem {
  label: string;
  value: string;
  cells: string;
  section: string;
  topic: string;
  destination: string;
  source: string;
  approvedAt: string;
  entityRole?: string;
}

interface ExportMeta {
  source: string;
  exportedAt: string;
  version: string;
}

interface ExportFile {
  meta: ExportMeta;
  items: ExportedItem[];
}

/** Aggregated item with multiple sources */
export interface AggregatedItem {
  /** Unique ID based on normalized label+value */
  id: string;
  /** The question/label */
  label: string;
  /** Full label with section context (for short labels) */
  fullLabel: string;
  /** Normalized label for matching */
  normalizedLabel: string;
  /** The answer/value */
  value: string;
  /** Topic classification */
  topic: string;
  /** Section (from first occurrence) */
  section: string;
  /** Destination (answer_library, company, product) */
  destination: string;
  /** List of source questionnaires */
  sources: string[];
  /** First approval timestamp */
  firstApprovedAt: string;
  /** Last approval timestamp */
  lastApprovedAt: string;
  /** Cell references per source */
  cellRefs: Record<string, string>;
  /** Entity role (supplier, customer, manufacturer, etc.) */
  entityRole?: string;
}

/** Aggregated customer data */
export interface AggregatedCustomerData {
  /** Customer folder name */
  customer: string;
  /** When aggregated */
  aggregatedAt: string;
  /** Source questionnaires */
  questionnaires: string[];
  /** Aggregated answer library items */
  answerLibrary: {
    total: number;
    unique: number;
    duplicates: number;
    items: AggregatedItem[];
  };
  /** Aggregated entity data */
  entityData: {
    total: number;
    unique: number;
    duplicates: number;
    items: AggregatedItem[];
  };
  /** Statistics */
  stats: {
    byTopic: Record<string, number>;
    bySource: Record<string, number>;
    multiSourceItems: number;
  };
}

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize a label for comparison
 * - Lowercase
 * - Remove extra whitespace
 * - Remove punctuation
 * - Handle multilingual labels (e.g., "German / English")
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Normalize a value for comparison
 * - Trim whitespace
 * - Handle yes/no variations
 */
function normalizeValue(value: string): string {
  const lower = value.toLowerCase().trim();

  // Normalize yes/no variations
  if (['ja-yes', 'oui/yes', 'ja', 'yes', 'oui'].includes(lower)) {
    return 'yes';
  }
  if (['nein-no', 'non/no', 'nein', 'no', 'non'].includes(lower)) {
    return 'no';
  }
  if (['n/a', 'n.a.', 'na', 'not applicable'].includes(lower)) {
    return 'N/A';
  }

  return value.trim();
}

/**
 * Generate a unique ID for an item based on label and value
 */
function generateItemId(normalizedLabel: string, normalizedValue: string): string {
  const combined = `${normalizedLabel}:${normalizedValue.toLowerCase()}`;
  // Simple hash for uniqueness
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Create a full label with section context for short/ambiguous labels
 *
 * Short labels like "RTRS - MB" need section context to be meaningful.
 * This creates "Soy Deforestation-Free Certificates: RTRS - MB"
 */
function createFullLabel(label: string, section: string, topic?: string): string {
  // Patterns that indicate the label is self-explanatory
  const selfExplanatoryPatterns = [
    /^(do you|have you|is the|are you|does|can you|what|which|how|why)/i,
    /^(ist|haben sie|sind sie|gibt es|können sie|welche|wie|warum)/i,
    /\?$/, // Questions are usually self-explanatory
  ];

  // Known certification/standard labels that are self-explanatory
  const certificationLabels = [
    'halal', 'kosher', 'organic', 'rspo', 'gmp', 'qs', 'vlog',
    'iso 9001', 'iso 14001', 'iso 22000', 'iso 45001', 'iso 50001',
    'brc', 'ifs', 'fssc', 'haccp', 'sedex', 'ecovadis',
  ];

  const labelLower = label.toLowerCase();
  const isCertificationLabel = certificationLabels.some(cert => labelLower === cert || labelLower.startsWith(cert + ' '));

  const isSelfExplanatory = selfExplanatoryPatterns.some(p => p.test(label));
  const isShort = label.length < 40;
  const hasOnlyAbbreviations = /^[A-Z0-9\s\-\/]+$/.test(label); // Like "RTRS - MB"

  // Skip prefix for certification labels - they're self-explanatory
  if (isCertificationLabel) {
    return label;
  }

  // Add section context if label is short/ambiguous
  if (!isSelfExplanatory && (isShort || hasOnlyAbbreviations)) {
    // Clean up section name (remove trailing numbers, clean up)
    const cleanSection = section
      .replace(/\s*\d+$/, '') // Remove trailing numbers
      .trim();

    // Don't repeat if label already contains section info
    if (!label.toLowerCase().includes(cleanSection.toLowerCase().substring(0, 10))) {
      return `${cleanSection}: ${label}`;
    }
  }

  return label;
}

// =============================================================================
// AGGREGATION
// =============================================================================

/**
 * Load a JSON export file
 */
function loadExportFile(filePath: string): ExportFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to load ${filePath}:`, error);
    return null;
  }
}

/**
 * Aggregate items from multiple files, deduplicating and tracking sources
 */
function aggregateItems(
  items: ExportedItem[],
  existingMap: Map<string, AggregatedItem>
): Map<string, AggregatedItem> {
  for (const item of items) {
    const normalizedLabel = normalizeLabel(item.label);
    const normalizedValue = normalizeValue(item.value);
    const id = generateItemId(normalizedLabel, normalizedValue);

    const existing = existingMap.get(id);
    if (existing) {
      // Add source if not already present
      if (!existing.sources.includes(item.source)) {
        existing.sources.push(item.source);
      }
      // Update cell refs
      existing.cellRefs[item.source] = item.cells;
      // Update timestamps
      if (item.approvedAt < existing.firstApprovedAt) {
        existing.firstApprovedAt = item.approvedAt;
      }
      if (item.approvedAt > existing.lastApprovedAt) {
        existing.lastApprovedAt = item.approvedAt;
      }
    } else {
      // New item
      const fullLabel = createFullLabel(item.label, item.section);
      existingMap.set(id, {
        id,
        label: item.label,
        fullLabel,
        normalizedLabel,
        value: normalizedValue,
        topic: item.topic,
        section: item.section,
        destination: item.destination,
        sources: [item.source],
        firstApprovedAt: item.approvedAt,
        lastApprovedAt: item.approvedAt,
        cellRefs: { [item.source]: item.cells },
        ...(item.entityRole ? { entityRole: item.entityRole } : {}),
      });
    }
  }

  return existingMap;
}

/**
 * Load a grouped export file (new format with company, library, product, etc.)
 */
interface GroupedExportFile {
  meta: {
    questionnaire: string;
    source: string;
    customer: string;
    exportedAt: string;
  };
  company?: ExportedItem[];
  library?: ExportedItem[];
  product?: ExportedItem[];
  questionnaire?: ExportedItem[];
  exclude?: ExportedItem[];
  stats?: Record<string, number>;
}

function loadGroupedExportFile(filePath: string): GroupedExportFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to load ${filePath}:`, error);
    return null;
  }
}

/**
 * Aggregate all data for a customer
 */
export function aggregateCustomerData(customerFolder: string): AggregatedCustomerData {
  // Try new path structure first: customers/<customer>/approved
  let approvedExportsDir = path.resolve('./customers', customerFolder, 'approved');

  // Fall back to legacy path: approved-exports/<customer>
  if (!fs.existsSync(approvedExportsDir)) {
    approvedExportsDir = path.resolve('./approved-exports', customerFolder);
  }

  if (!fs.existsSync(approvedExportsDir)) {
    throw new Error(`Customer folder not found. Tried:\n  - ./customers/${customerFolder}/approved\n  - ./approved-exports/${customerFolder}`);
  }

  // Find all JSON files (new format) or folders (legacy format)
  const entries = fs.readdirSync(approvedExportsDir);
  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  const questionnaireFolders = entries.filter(
    (f) => !f.endsWith('.json') && fs.statSync(path.join(approvedExportsDir, f)).isDirectory()
  );

  const answerLibraryMap = new Map<string, AggregatedItem>();
  const entityDataMap = new Map<string, AggregatedItem>();

  let totalAnswerLibraryItems = 0;
  let totalEntityItems = 0;
  const questionnaires: string[] = [];

  // Process JSON files (new format: grouped by destination)
  if (jsonFiles.length > 0) {
    console.log(`Found ${jsonFiles.length} questionnaires for ${customerFolder}`);

    for (const jsonFile of jsonFiles) {
      const filePath = path.join(approvedExportsDir, jsonFile);
      const data = loadGroupedExportFile(filePath);
      if (!data || !data.meta) continue;

      const source = data.meta.source || jsonFile;
      const exportedAt = data.meta.exportedAt || new Date().toISOString();
      questionnaires.push(data.meta.questionnaire || jsonFile.replace('.json', ''));

      // Convert grouped items to ExportedItem format and aggregate
      const convertItems = (items: any[], destination: string): ExportedItem[] => {
        return (items || []).map((item) => ({
          label: item.label,
          value: item.value || '',
          cells: item.lCell ? `${item.lCell}:${item.vCell || ''}` : '',
          section: item.section || '',
          topic: item.topic || 'other',
          destination,
          source,
          approvedAt: exportedAt,
          ...(item.entityRole ? { entityRole: item.entityRole } : {}),
        }));
      };

      // Library items -> Answer Library
      const libraryItems = convertItems(data.library || [], 'answer_library');
      totalAnswerLibraryItems += libraryItems.length;
      aggregateItems(libraryItems, answerLibraryMap);

      // Company items -> Entity Data
      const companyItems = convertItems(data.company || [], 'company');
      totalEntityItems += companyItems.length;
      aggregateItems(companyItems, entityDataMap);

      // Product items -> Entity Data (product-specific)
      const productItems = convertItems(data.product || [], 'product');
      totalEntityItems += productItems.length;
      aggregateItems(productItems, entityDataMap);
    }
  }

  // Also process questionnaire folders (legacy format)
  if (questionnaireFolders.length > 0) {
    console.log(`Found ${questionnaireFolders.length} legacy questionnaire folders for ${customerFolder}`);

    for (const qFolder of questionnaireFolders) {
      const qPath = path.join(approvedExportsDir, qFolder);
      questionnaires.push(qFolder);

      // Load answer-library.json
      const answerLibraryPath = path.join(qPath, 'answer-library.json');
      if (fs.existsSync(answerLibraryPath)) {
        const answerLibrary = loadExportFile(answerLibraryPath);
        if (answerLibrary) {
          totalAnswerLibraryItems += answerLibrary.items.length;
          aggregateItems(answerLibrary.items, answerLibraryMap);
        }
      }

      // Load entity-db.json
      const entityDbPath = path.join(qPath, 'entity-db.json');
      if (fs.existsSync(entityDbPath)) {
        const entityDb = loadExportFile(entityDbPath);
        if (entityDb) {
          totalEntityItems += entityDb.items.length;
          aggregateItems(entityDb.items, entityDataMap);
        }
      }
    }
  }

  if (questionnaires.length === 0) {
    console.log(`Found 0 questionnaires for ${customerFolder}`);
  }

  // Convert maps to arrays
  const answerLibraryItems = Array.from(answerLibraryMap.values());
  const entityDataItems = Array.from(entityDataMap.values());

  // Calculate statistics
  const byTopic: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let multiSourceItems = 0;

  for (const item of [...answerLibraryItems, ...entityDataItems]) {
    // Count by topic
    byTopic[item.topic] = (byTopic[item.topic] || 0) + 1;

    // Count by source
    for (const source of item.sources) {
      bySource[source] = (bySource[source] || 0) + 1;
    }

    // Count multi-source items
    if (item.sources.length > 1) {
      multiSourceItems++;
    }
  }

  return {
    customer: customerFolder,
    aggregatedAt: new Date().toISOString(),
    questionnaires,
    answerLibrary: {
      total: totalAnswerLibraryItems,
      unique: answerLibraryItems.length,
      duplicates: totalAnswerLibraryItems - answerLibraryItems.length,
      items: answerLibraryItems,
    },
    entityData: {
      total: totalEntityItems,
      unique: entityDataItems.length,
      duplicates: totalEntityItems - entityDataItems.length,
      items: entityDataItems,
    },
    stats: {
      byTopic,
      bySource,
      multiSourceItems,
    },
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const customerFolder = args[0] || 'kaas-pack';
  // Output to customers/<customer>/api-ready/ folder
  const outputPath = args[1] || `./customers/${customerFolder}/api-ready/${customerFolder}-aggregated.json`;

  console.log(`\nAggregating data for customer: ${customerFolder}\n`);

  try {
    const data = aggregateCustomerData(customerFolder);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

    // Print summary
    console.log('\n=== AGGREGATION SUMMARY ===\n');
    console.log(`Customer: ${data.customer}`);
    console.log(`Questionnaires: ${data.questionnaires.length}`);
    data.questionnaires.forEach((q) => console.log(`  - ${q}`));

    console.log('\nAnswer Library:');
    console.log(`  Total items: ${data.answerLibrary.total}`);
    console.log(`  Unique items: ${data.answerLibrary.unique}`);
    console.log(`  Duplicates removed: ${data.answerLibrary.duplicates}`);

    console.log('\nEntity Data:');
    console.log(`  Total items: ${data.entityData.total}`);
    console.log(`  Unique items: ${data.entityData.unique}`);
    console.log(`  Duplicates removed: ${data.entityData.duplicates}`);

    console.log('\nItems appearing in multiple questionnaires:', data.stats.multiSourceItems);

    console.log('\nBy Topic:');
    Object.entries(data.stats.byTopic)
      .sort((a, b) => b[1] - a[1])
      .forEach(([topic, count]) => {
        console.log(`  ${topic}: ${count}`);
      });

    console.log(`\nOutput written to: ${outputPath}`);

    // Show items with multiple sources
    const multiSourceAnswers = data.answerLibrary.items.filter((i) => i.sources.length > 1);
    const multiSourceEntity = data.entityData.items.filter((i) => i.sources.length > 1);

    if (multiSourceAnswers.length > 0) {
      console.log('\n=== ANSWER LIBRARY: ITEMS FROM MULTIPLE QUESTIONNAIRES ===\n');
      for (const item of multiSourceAnswers.slice(0, 10)) {
        console.log(`"${item.label.substring(0, 60)}..."`);
        console.log(`  Value: ${item.value.substring(0, 40)}${item.value.length > 40 ? '...' : ''}`);
        console.log(`  Sources: ${item.sources.join(', ')}`);
        console.log();
      }
      if (multiSourceAnswers.length > 10) {
        console.log(`... and ${multiSourceAnswers.length - 10} more`);
      }
    }

    if (multiSourceEntity.length > 0) {
      console.log('\n=== ENTITY DATA: ITEMS FROM MULTIPLE QUESTIONNAIRES ===\n');
      for (const item of multiSourceEntity.slice(0, 10)) {
        console.log(`"${item.label}"`);
        console.log(`  Value: ${item.value}`);
        console.log(`  Sources: ${item.sources.join(', ')}`);
        console.log();
      }
      if (multiSourceEntity.length > 10) {
        console.log(`... and ${multiSourceEntity.length - 10} more`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
