/**
 * Prepare Doehler SVZ Location Data for API
 *
 * Takes indexed questionnaires for each production location and prepares
 * them for API import with clear question labels.
 *
 * Each location gets its own API-ready file:
 * - Tomaszow (Poland)
 * - Rijkevorsel (Belgium)
 * - Almonte (Spain)
 */

import * as fs from 'fs';
import * as path from 'path';
import { rephraseLabels, type RephraseInput } from '../src/services/sync/rephrase-labels.js';

// =============================================================================
// TYPES
// =============================================================================

interface IndexedItem {
  id: string;
  type: string;
  label: string;
  value?: string;
  topic: string;
  level: string;
  lang?: string;
  destination: string;
  lCell?: string;
  vCell?: string;
}

interface IndexedSection {
  title: string;
  topic: string;
  rows: string;
  sheet: string;
  items: IndexedItem[];
}

interface IndexedQuestionnaire {
  id: string;
  source: string;
  indexed: string;
  language: string;
  sections: IndexedSection[];
  stats: {
    total: number;
    answered: number;
    standard: number;
    narrative: number;
    product: number;
  };
}

interface APIReadyItem {
  id: string;
  question: string;
  originalLabel: string;
  answer: string;
  topic: string;
  section: string;
  level: 'standard' | 'narrative' | 'product';
  destination: 'answer_library' | 'product' | 'entity' | 'exclude';
  cellRef: string;
  lang: string;
}

interface LocationAPIReady {
  location: string;
  customer: 'Doehler SVZ';
  preparedAt: string;
  sourceFile: string;
  items: APIReadyItem[];
  stats: {
    total: number;
    answered: number;
    forAnswerLibrary: number;
    forProduct: number;
    excluded: number;
    byTopic: Record<string, number>;
  };
}

// =============================================================================
// LOCATION MAPPING
// =============================================================================

const LOCATIONS = [
  {
    file: '220303_Self_assessment_questionnaire_Tomaszow.json',
    name: 'Tomaszow',
    country: 'Poland'
  },
  {
    file: '211216_Self_assessment_questionnaire_Rijkevorsel.json',
    name: 'Rijkevorsel',
    country: 'Belgium'
  },
  {
    file: '211216_Self_assessment_questionnaire_Almonte.json',
    name: 'Almonte',
    country: 'Spain'
  }
];

// =============================================================================
// PROCESSING
// =============================================================================

/**
 * Check if a label is already a clear question
 */
function isAlreadyClearQuestion(label: string): boolean {
  const lower = label.toLowerCase().trim();

  // Ends with question mark
  if (label.trim().endsWith('?')) return true;

  // Starts with question word
  const questionWords = [
    'do you', 'does', 'is ', 'are ', 'have you', 'has ', 'can ', 'will ',
    'what ', 'which ', 'how ', 'where ', 'when ', 'why ', 'who ',
    // Long descriptive questions
    'upon receipt', 'has the organization'
  ];

  if (questionWords.some(w => lower.startsWith(w))) return true;

  // Long enough with question-like structure
  if (label.length > 60 && label.includes('?')) return true;

  return false;
}

/**
 * Process a single indexed questionnaire into API-ready format
 */
async function processLocation(
  indexedPath: string,
  locationName: string
): Promise<LocationAPIReady> {
  console.log(`\nProcessing ${locationName}...`);

  const content = fs.readFileSync(indexedPath, 'utf-8');
  const indexed: IndexedQuestionnaire = JSON.parse(content);

  // Collect all items that have answers
  const rawItems: Array<{
    item: IndexedItem;
    section: string;
  }> = [];

  for (const section of indexed.sections) {
    for (const item of section.items) {
      // Skip items without values
      if (!item.value || item.value.trim() === '') continue;

      // Skip excluded items
      if (item.destination === 'exclude') continue;

      rawItems.push({
        item,
        section: section.title
      });
    }
  }

  console.log(`  Found ${rawItems.length} items with answers`);

  // Identify items that need label rephrasing
  const needsRephrasing: RephraseInput[] = [];
  const itemsNeedingRephrase: number[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const { item, section } = rawItems[i];
    if (!isAlreadyClearQuestion(item.label)) {
      needsRephrasing.push({
        label: item.label,
        section,
        topic: item.topic,
        lang: item.lang || 'en'
      });
      itemsNeedingRephrase.push(i);
    }
  }

  console.log(`  ${itemsNeedingRephrase.length} labels need rephrasing`);

  // Rephrase labels using Claude
  const rephrasedMap = new Map<number, string>();

  if (needsRephrasing.length > 0) {
    console.log(`  Rephrasing labels with Claude...`);
    const results = await rephraseLabels(needsRephrasing);

    for (let i = 0; i < results.length; i++) {
      const originalIdx = itemsNeedingRephrase[i];
      if (results[i].wasChanged) {
        rephrasedMap.set(originalIdx, results[i].rephrased);
      }
    }
    console.log(`  Rephrased ${rephrasedMap.size} labels`);
  }

  // Build API-ready items
  const apiItems: APIReadyItem[] = [];
  const byTopic: Record<string, number> = {};

  for (let i = 0; i < rawItems.length; i++) {
    const { item, section } = rawItems[i];

    // Get question text (rephrased or original)
    const question = rephrasedMap.get(i) || item.label;

    // Map destination
    let destination: APIReadyItem['destination'] = 'answer_library';
    if (item.destination === 'product') destination = 'product';
    if (item.destination === 'entity') destination = 'entity';
    if (item.destination === 'exclude') destination = 'exclude';

    // Map level
    let level: APIReadyItem['level'] = 'standard';
    if (item.level === 'narrative') level = 'narrative';
    if (item.level === 'product') level = 'product';

    apiItems.push({
      id: item.id,
      question,
      originalLabel: item.label,
      answer: item.value!,
      topic: item.topic,
      section,
      level,
      destination,
      cellRef: `${item.lCell || ''} → ${item.vCell || ''}`,
      lang: item.lang || 'en'
    });

    // Count by topic
    byTopic[item.topic] = (byTopic[item.topic] || 0) + 1;
  }

  // Calculate stats
  const forAnswerLibrary = apiItems.filter(i => i.destination === 'answer_library').length;
  const forProduct = apiItems.filter(i => i.destination === 'product').length;
  const excluded = apiItems.filter(i => i.destination === 'exclude').length;

  return {
    location: locationName,
    customer: 'Doehler SVZ',
    preparedAt: new Date().toISOString(),
    sourceFile: indexed.source,
    items: apiItems,
    stats: {
      total: apiItems.length,
      answered: apiItems.length,
      forAnswerLibrary,
      forProduct,
      excluded,
      byTopic
    }
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const customer = 'Doehler SVZ';
  const indexedDir = `./customers/${customer}/indexed`;
  const apiReadyDir = `./customers/${customer}/api-ready`;

  // Ensure output directory exists
  if (!fs.existsSync(apiReadyDir)) {
    fs.mkdirSync(apiReadyDir, { recursive: true });
  }

  console.log(`\n=== Preparing ${customer} Location Data for API ===\n`);

  for (const location of LOCATIONS) {
    const indexedPath = path.join(indexedDir, location.file);

    if (!fs.existsSync(indexedPath)) {
      console.warn(`⚠️  Indexed file not found: ${indexedPath}`);
      continue;
    }

    try {
      const apiReady = await processLocation(indexedPath, location.name);

      // Write output
      const outputFile = `${location.name.toLowerCase()}-api-ready.json`;
      const outputPath = path.join(apiReadyDir, outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(apiReady, null, 2));

      console.log(`\n✅ ${location.name} (${location.country})`);
      console.log(`   Total items: ${apiReady.stats.total}`);
      console.log(`   For answer library: ${apiReady.stats.forAnswerLibrary}`);
      console.log(`   For product: ${apiReady.stats.forProduct}`);
      console.log(`   Saved to: ${outputPath}`);

      // Show top topics
      const topTopics = Object.entries(apiReady.stats.byTopic)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      console.log(`   Top topics: ${topTopics.map(([t, c]) => `${t}(${c})`).join(', ')}`);

    } catch (error) {
      console.error(`❌ Error processing ${location.name}:`, error);
    }
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
