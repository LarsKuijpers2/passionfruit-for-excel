/**
 * Prepare Customer Data for API Import
 *
 * Takes aggregated customer data and prepares it for Passionfruit API import:
 * - Converts to API format
 * - Generates import preview
 * - Tracks sources for each item
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AggregatedCustomerData, AggregatedItem } from './aggregate-customer-data.js';
import type { APIAnswer, APIEntity, ExtractionMetadata, ExtractedEntityData } from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

interface APIReadyAnswer {
  /** Local ID */
  localId: string;
  /** Question text */
  question: string;
  /** Answer text */
  answer: string;
  /** Topic classification */
  topic: string;
  /** Source questionnaires */
  sources: string[];
  /** Section (from first occurrence) */
  section: string;
  /** Sync action */
  action: 'create' | 'update' | 'skip';
  /** Existing API ID if updating */
  apiId?: number;
}

interface APIReadyEntity {
  /** Entity name */
  name: string;
  /** Top-level fields */
  fields: {
    email?: string;
    phone?: string;
    website?: string;
    street?: string;
    city?: string;
    zipCode?: string;
    country?: string;
  };
  /** Additional data fields */
  data: Record<string, string>;
  /** Field sources */
  fieldSources: Record<string, string[]>;
}

interface CustomerImportPreview {
  /** Customer name */
  customer: string;
  /** When prepared */
  preparedAt: string;
  /** Source questionnaires */
  questionnaires: string[];
  /** Entity data */
  entity: APIReadyEntity;
  /** Answers ready for import */
  answers: APIReadyAnswer[];
  /** Statistics */
  stats: {
    totalAnswers: number;
    toCreate: number;
    toUpdate: number;
    toSkip: number;
    byTopic: Record<string, number>;
  };
}

// =============================================================================
// ENTITY FIELD MAPPING
// =============================================================================

/** Patterns for extracting entity top-level fields */
const ENTITY_FIELD_PATTERNS: Record<string, RegExp[]> = {
  name: [
    /^(company\s*name|bedrijfsnaam|supplier\s*name|company\s*production\s*plant)$/i,
  ],
  email: [
    /^(e-?mail|general\s*e-?mail|email\s*address)$/i,
    /^(supplier\s*email|contact\s*email)$/i,
  ],
  phone: [
    /^(phone|telefoon|telefoonnummer|supplier\s*phone)$/i,
  ],
  website: [
    /^website$/i,
  ],
  street: [
    /^(street|adres|address|straat|supplier\s*address)$/i,
  ],
  city: [
    /^(city|plaats|stad)$/i,
  ],
  zipCode: [
    /^(postal\s*code|postcode|zip\s*code|plz)$/i,
  ],
  country: [
    /^(country|land|pays)$/i,
  ],
};

/**
 * Parse combined location string like "7905 SW Hoogeveen, Nederland"
 */
function parseLocation(location: string): { zipCode?: string; city?: string; country?: string } {
  const result: { zipCode?: string; city?: string; country?: string } = {};

  // Try to match Dutch format: "7905 SW Hoogeveen, Nederland"
  const dutchMatch = location.match(/^(\d{4}\s*\w{2})\s+([^,]+),?\s*(.*)$/);
  if (dutchMatch) {
    result.zipCode = dutchMatch[1];
    result.city = dutchMatch[2].trim();
    if (dutchMatch[3]) {
      result.country = dutchMatch[3].trim();
    }
    return result;
  }

  // Try generic format with comma separator
  const parts = location.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    result.city = parts[0];
    result.country = parts[parts.length - 1];
  }

  return result;
}

/**
 * Map entity items to API structure
 */
function mapEntityItems(items: AggregatedItem[]): APIReadyEntity {
  const fields: APIReadyEntity['fields'] = {};
  const data: Record<string, string> = {};
  const fieldSources: Record<string, string[]> = {};
  let entityName = 'Unknown';

  for (const item of items) {
    const normalizedLabel = item.label.toLowerCase().trim();

    // Check for top-level field matches
    let matched = false;
    for (const [field, patterns] of Object.entries(ENTITY_FIELD_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(item.label)) {
          if (field === 'name') {
            entityName = item.value;
          } else {
            (fields as any)[field] = item.value;
          }
          fieldSources[field] = item.sources;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    // Handle combined location field
    if (!matched && /postcode.*plaats.*land|location/i.test(item.label)) {
      const parsed = parseLocation(item.value);
      if (parsed.zipCode && !fields.zipCode) {
        fields.zipCode = parsed.zipCode;
        fieldSources['zipCode'] = item.sources;
      }
      if (parsed.city && !fields.city) {
        fields.city = parsed.city;
        fieldSources['city'] = item.sources;
      }
      if (parsed.country && !fields.country) {
        fields.country = parsed.country;
        fieldSources['country'] = item.sources;
      }
      matched = true;
    }

    // Put remaining items in data object
    if (!matched) {
      // Use a clean key for the data object
      const cleanKey = item.label
        .replace(/\s+/g, ' ')
        .trim();
      data[cleanKey] = item.value;
      fieldSources[cleanKey] = item.sources;
    }
  }

  return {
    name: entityName,
    fields,
    data,
    fieldSources,
  };
}

/**
 * Map answer items to API format
 */
function mapAnswerItems(items: AggregatedItem[]): APIReadyAnswer[] {
  return items.map(item => ({
    localId: item.id,
    question: (item as any).fullLabel || item.label, // Use fullLabel if available
    answer: item.value,
    topic: item.topic,
    sources: item.sources,
    section: item.section,
    action: 'create' as const,
  }));
}

// =============================================================================
// MAIN
// =============================================================================

export function prepareCustomerImport(aggregatedDataPath: string): CustomerImportPreview {
  // Load aggregated data
  const content = fs.readFileSync(aggregatedDataPath, 'utf-8');
  const aggregated: AggregatedCustomerData = JSON.parse(content);

  // Map entity data
  const entity = mapEntityItems(aggregated.entityData.items);

  // Map answer items
  const answers = mapAnswerItems(aggregated.answerLibrary.items);

  // Calculate statistics
  const byTopic: Record<string, number> = {};
  for (const answer of answers) {
    byTopic[answer.topic] = (byTopic[answer.topic] || 0) + 1;
  }

  return {
    customer: aggregated.customer,
    preparedAt: new Date().toISOString(),
    questionnaires: aggregated.questionnaires,
    entity,
    answers,
    stats: {
      totalAnswers: answers.length,
      toCreate: answers.filter(a => a.action === 'create').length,
      toUpdate: answers.filter(a => a.action === 'update').length,
      toSkip: answers.filter(a => a.action === 'skip').length,
      byTopic,
    },
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const customerFolder = args[0] || 'kaas-pack';
  // Use customers/<customer>/api-ready/ folder
  const apiReadyDir = `./customers/${customerFolder}/api-ready`;
  const aggregatedPath = `${apiReadyDir}/${customerFolder}-aggregated.json`;
  const outputPath = `${apiReadyDir}/${customerFolder}-import-preview.json`;

  if (!fs.existsSync(aggregatedPath)) {
    console.error(`Aggregated data not found at ${aggregatedPath}`);
    console.error('Run aggregate-customer-data.ts first');
    process.exit(1);
  }

  console.log(`\nPreparing import for customer: ${customerFolder}\n`);

  const preview = prepareCustomerImport(aggregatedPath);

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(preview, null, 2));

  // Print summary
  console.log('=== IMPORT PREVIEW ===\n');
  console.log(`Customer: ${preview.customer}`);
  console.log(`Questionnaires: ${preview.questionnaires.length}`);

  console.log('\nEntity:');
  console.log(`  Name: ${preview.entity.name}`);
  console.log(`  Top-level fields: ${Object.keys(preview.entity.fields).length}`);
  for (const [field, value] of Object.entries(preview.entity.fields)) {
    console.log(`    ${field}: ${value}`);
  }
  console.log(`  Additional data fields: ${Object.keys(preview.entity.data).length}`);

  console.log('\nAnswers:');
  console.log(`  Total: ${preview.stats.totalAnswers}`);
  console.log(`  To create: ${preview.stats.toCreate}`);
  console.log(`  To update: ${preview.stats.toUpdate}`);
  console.log(`  To skip: ${preview.stats.toSkip}`);

  console.log('\nBy Topic:');
  Object.entries(preview.stats.byTopic)
    .sort((a, b) => b[1] - a[1])
    .forEach(([topic, count]) => {
      console.log(`  ${topic}: ${count}`);
    });

  console.log(`\nOutput written to: ${outputPath}`);

  // Show some sample answers
  console.log('\n=== SAMPLE ANSWERS ===\n');
  for (const answer of preview.answers.slice(0, 5)) {
    console.log(`Q: ${answer.question.substring(0, 70)}${answer.question.length > 70 ? '...' : ''}`);
    console.log(`A: ${answer.answer.substring(0, 50)}${answer.answer.length > 50 ? '...' : ''}`);
    console.log(`Topic: ${answer.topic} | Sources: ${answer.sources.join(', ')}`);
    console.log();
  }

  // Show entity data fields
  console.log('\n=== ENTITY ADDITIONAL DATA ===\n');
  const dataEntries = Object.entries(preview.entity.data);
  for (const [key, value] of dataEntries.slice(0, 10)) {
    const sources = preview.entity.fieldSources[key] || [];
    console.log(`${key}:`);
    console.log(`  Value: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
    console.log(`  Sources: ${sources.join(', ')}`);
  }
  if (dataEntries.length > 10) {
    console.log(`\n... and ${dataEntries.length - 10} more fields`);
  }
}

// Only run main when executed directly (not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
