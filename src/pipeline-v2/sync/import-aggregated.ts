/**
 * Import Aggregated Customer Data to Answer Library API
 *
 * Reads the aggregated JSON and imports answers directly to the API.
 */

import 'dotenv/config';
import * as fs from 'fs';
import { PassionfruitAPIClient } from './api-client.js';
import type { AggregatedCustomerData } from './aggregate-customer-data.js';

interface SyncResult {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
}

async function importAggregated(
  aggregatedPath: string,
  options: { dryRun?: boolean } = {}
): Promise<SyncResult> {
  const { dryRun = false } = options;

  // Load aggregated data
  const data: AggregatedCustomerData = JSON.parse(
    fs.readFileSync(aggregatedPath, 'utf-8')
  );

  console.log(`\nImporting ${data.answerLibrary.items.length} answers for ${data.customer}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const result: SyncResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Initialize API client
  let client: PassionfruitAPIClient;
  try {
    client = new PassionfruitAPIClient();
    console.log(`API: ${client.url} (${client.environment})\n`);
  } catch (error) {
    console.error('Failed to initialize API client:', error);
    result.errors.push(`API init failed: ${error}`);
    return result;
  }

  // Get existing answers to avoid duplicates
  let existingAnswers: { id: number; question: string }[] = [];
  try {
    console.log('Fetching existing answers...');
    existingAnswers = await client.listAnswers();
    console.log(`Found ${existingAnswers.length} existing answers\n`);
  } catch (error) {
    console.error('Failed to fetch existing answers:', error);
  }

  // Create a set of existing questions for quick lookup
  const existingQuestions = new Set(
    existingAnswers.map(a => a.question.toLowerCase().trim())
  );

  // Process each answer
  const items = data.answerLibrary.items;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const question = item.fullLabel || item.label;
    const answer = item.value;
    const shortQ = question.substring(0, 60) + (question.length > 60 ? '...' : '');

    // Skip if already exists
    if (existingQuestions.has(question.toLowerCase().trim())) {
      console.log(`[${i + 1}/${items.length}] SKIP (exists): "${shortQ}"`);
      result.skipped++;
      continue;
    }

    // Build note with metadata
    const sources = item.sources.join(', ');
    const note = `Topic: ${item.topic} | Section: ${item.section} | Sources: ${sources}`;

    try {
      if (!dryRun) {
        await client.createAnswer({
          question,
          answer,
          note,
          entities: [],
          evidences: [],
        });
        // Add to set to avoid duplicates in same run
        existingQuestions.add(question.toLowerCase().trim());
      }
      console.log(`[${i + 1}/${items.length}] CREATE: "${shortQ}"`);
      result.created++;

      // Rate limiting
      if (!dryRun && i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`[${i + 1}/${items.length}] FAILED: "${shortQ}" - ${error}`);
      result.failed++;
      result.errors.push(`${question.substring(0, 30)}: ${error}`);
    }
  }

  // Save sync log
  if (!dryRun) {
    const logPath = aggregatedPath.replace('-aggregated.json', '-import-log.json');
    const log = {
      customer: data.customer,
      importedAt: new Date().toISOString(),
      result,
    };
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    console.log(`\nImport log saved: ${logPath}`);
  }

  return result;
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Check if first arg is a path or customer folder
  const firstArg = args.find(a => !a.startsWith('--')) || 'kaas-pack';
  let aggregatedPath: string;

  if (firstArg.endsWith('.json')) {
    // Direct path provided
    aggregatedPath = firstArg;
  } else {
    // Customer folder provided
    aggregatedPath = `./customers/${firstArg}/api-ready/${firstArg}-aggregated.json`;
  }

  if (!fs.existsSync(aggregatedPath)) {
    console.error(`Aggregated data not found: ${aggregatedPath}`);
    process.exit(1);
  }

  console.log(`\n=== IMPORT AGGREGATED DATA ===`);
  console.log(`Source: ${aggregatedPath}`);
  if (dryRun) console.log(`Mode: DRY RUN`);

  const result = await importAggregated(aggregatedPath, { dryRun });

  console.log('\n=== IMPORT RESULT ===');
  console.log(`Created: ${result.created}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }
}

main();
