/**
 * Add Aggregated Customer Data to Answer Library
 *
 * Converts grouped/aggregated data to answer-library.yaml format
 * and merges with existing library, deduplicating entries.
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import type { GroupedCustomerData, GroupedItem } from './group-related-items.js';

// =============================================================================
// TYPES
// =============================================================================

interface AnswerLibraryItem {
  id: string;
  type: string;
  label: string;
  value: string;
  lang?: string;
  topic: string;
  level: string;
  entityRole?: string;
  sources?: string[]; // Multiple sources for items found in multiple questionnaires
  source?: {
    file: string;
    sheet?: string;
    lCell?: string;
    vCell?: string;
    harvestedAt: string;
  };
}

interface AnswerLibrary {
  id: string;
  updated: string;
  total: number;
  byTopic: Record<string, AnswerLibraryItem[]>;
  sources?: string[];
}

// =============================================================================
// CONVERSION
// =============================================================================

/**
 * Detect language from text
 */
function detectLanguage(text: string): string {
  // Simple heuristics
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[éèêëàâùûôîç]/i.test(text)) return 'fr';
  if (/[ñáéíóú]/i.test(text)) return 'es';
  if (/\b(the|and|or|is|are|have|has|do|does|yes|no)\b/i.test(text)) return 'en';
  if (/\b(de|het|een|en|of|is|zijn|heeft|ja|nee)\b/i.test(text)) return 'nl';
  return 'en'; // Default
}

/**
 * Determine item type from the data
 */
function determineType(item: GroupedItem): string {
  const value = item.value.toLowerCase();

  if (value === 'yes' || value === 'no' || value === 'n/a') {
    return 'yesno';
  }
  if (item.label.includes('?')) {
    return 'question';
  }
  if (item.followUps && item.followUps.length > 0) {
    return 'question';
  }
  return 'field';
}

/**
 * Generate a short ID from a string
 */
function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Convert grouped item to answer library format
 */
function convertToLibraryItem(item: GroupedItem): AnswerLibraryItem {
  const label = item.fullLabel || item.label;
  const value = item.combinedAnswer || item.value;

  const libraryItem: AnswerLibraryItem = {
    id: generateId(`${label}:${value}`),
    type: determineType(item),
    label: label,
    value: value,
    lang: detectLanguage(label + ' ' + value),
    topic: item.topic,
    level: 'standard',
  };

  // Add sources
  if (item.sources.length > 1) {
    libraryItem.sources = item.sources;
  } else {
    libraryItem.source = {
      file: item.sources[0],
      harvestedAt: new Date().toISOString().split('T')[0],
    };

    // Add cell reference if available
    const cellRef = Object.values(item.cellRefs)[0];
    if (cellRef) {
      const parts = cellRef.split(' → ');
      if (parts.length === 2) {
        libraryItem.source.lCell = parts[0];
        libraryItem.source.vCell = parts[1];
      }
    }
  }

  return libraryItem;
}

/**
 * Merge new items into existing library
 */
function mergeIntoLibrary(
  existing: AnswerLibrary,
  newItems: AnswerLibraryItem[],
  sources: string[]
): AnswerLibrary {
  // Create lookup of existing items by id
  const existingIds = new Set<string>();
  for (const items of Object.values(existing.byTopic)) {
    for (const item of items) {
      existingIds.add(item.id);
    }
  }

  // Add new items
  let added = 0;
  let skipped = 0;

  for (const item of newItems) {
    if (existingIds.has(item.id)) {
      skipped++;
      continue;
    }

    if (!existing.byTopic[item.topic]) {
      existing.byTopic[item.topic] = [];
    }
    existing.byTopic[item.topic].push(item);
    existingIds.add(item.id);
    added++;
  }

  // Update metadata
  existing.updated = new Date().toISOString().split('T')[0];
  existing.total = Array.from(Object.values(existing.byTopic))
    .reduce((sum, items) => sum + items.length, 0);

  // Add sources
  if (!existing.sources) {
    existing.sources = [];
  }
  for (const source of sources) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
  }

  console.log(`Added ${added} new items, skipped ${skipped} duplicates`);

  return existing;
}

// =============================================================================
// MAIN
// =============================================================================

export function addToAnswerLibrary(
  groupedDataPath: string,
  libraryPath: string = './answer-library.yaml'
): void {
  // Load grouped data
  const groupedData: GroupedCustomerData = JSON.parse(
    fs.readFileSync(groupedDataPath, 'utf-8')
  );

  // Load existing library or create new
  let library: AnswerLibrary;
  if (fs.existsSync(libraryPath)) {
    library = yaml.parse(fs.readFileSync(libraryPath, 'utf-8'));
  } else {
    library = {
      id: generateId(new Date().toISOString()),
      updated: new Date().toISOString().split('T')[0],
      total: 0,
      byTopic: {},
    };
  }

  // Convert items
  const newItems = groupedData.answerLibrary.items.map(convertToLibraryItem);

  console.log(`\nConverting ${newItems.length} items from ${groupedData.customer}`);

  // Merge
  library = mergeIntoLibrary(library, newItems, groupedData.questionnaires);

  // Write back
  fs.writeFileSync(libraryPath, yaml.stringify(library, { lineWidth: 0 }));

  console.log(`\nLibrary updated: ${libraryPath}`);
  console.log(`Total items: ${library.total}`);
  console.log(`Topics: ${Object.keys(library.byTopic).length}`);
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const customerFolder = args[0] || 'kaas-pack';
  const groupedPath = `./api-ready/${customerFolder}-grouped.json`;
  const libraryPath = args[1] || './answer-library.yaml';

  if (!fs.existsSync(groupedPath)) {
    console.error(`Grouped data not found: ${groupedPath}`);
    console.error('Run "aggregate" and "group" commands first');
    process.exit(1);
  }

  console.log(`Adding ${customerFolder} data to answer library...`);
  addToAnswerLibrary(groupedPath, libraryPath);
}

// Only run main when executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
