/**
 * Sync Aggregated Customer Data to NSLibrary via API
 *
 * Takes the grouped data and uploads answers to the Passionfruit API NSLibrary.
 */

import 'dotenv/config';
import * as fs from 'fs';
import { PassionfruitAPIClient, AnswerResponse } from './api-client.js';
import type { GroupedCustomerData, GroupedItem } from './group-related-items.js';

// =============================================================================
// TYPES
// =============================================================================

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface SyncLog {
  customer: string;
  syncedAt: string;
  environment: string;
  entityId?: number;
  answers: Record<string, {
    localId: string;
    apiId: number;
    action: 'created' | 'updated' | 'skipped';
  }>;
}

// =============================================================================
// SYNC LOGIC
// =============================================================================

/**
 * Find existing answer by question text
 */
async function findExistingAnswer(
  client: PassionfruitAPIClient,
  question: string,
  existingAnswers: AnswerResponse[]
): Promise<AnswerResponse | null> {
  // Normalize for comparison
  const normalizedQuestion = question.toLowerCase().trim();

  return existingAnswers.find(a =>
    a.question.toLowerCase().trim() === normalizedQuestion
  ) || null;
}

/**
 * Sync answers to API
 */
export async function syncToNSLibrary(
  groupedDataPath: string,
  options: {
    dryRun?: boolean;
    entityId?: number;
    batchSize?: number;
  } = {}
): Promise<SyncResult> {
  const { dryRun = false, entityId, batchSize = 10 } = options;

  // Load grouped data
  const data: GroupedCustomerData = JSON.parse(
    fs.readFileSync(groupedDataPath, 'utf-8')
  );

  console.log(`\nSyncing ${data.answerLibrary.items.length} answers for ${data.customer}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (dryRun) {
    console.log('=== DRY RUN - No changes will be made ===\n');
  }

  const result: SyncResult = {
    created: 0,
    updated: 0,
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

  // Get existing answers for deduplication
  let existingAnswers: AnswerResponse[] = [];
  try {
    console.log('Fetching existing answers...');
    existingAnswers = await client.listAnswers();
    console.log(`Found ${existingAnswers.length} existing answers\n`);
  } catch (error) {
    console.error('Failed to fetch existing answers:', error);
    result.errors.push(`Fetch existing failed: ${error}`);
    return result;
  }

  // Sync log for tracking
  const syncLog: SyncLog = {
    customer: data.customer,
    syncedAt: new Date().toISOString(),
    environment: client.environment,
    entityId,
    answers: {},
  };

  // Process answers in batches
  const items = data.answerLibrary.items;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const question = item.fullLabel || item.label;
    const answer = item.combinedAnswer || item.value;

    // Build note with sources
    const sources = item.sources.join(', ');
    const note = `Topic: ${item.topic} | Sources: ${sources}`;

    try {
      // Check if already exists
      const existing = await findExistingAnswer(client, question, existingAnswers);

      if (existing) {
        // Check if answer is different
        if (existing.answer === answer) {
          console.log(`[${i + 1}/${items.length}] SKIP: "${question.substring(0, 50)}..." (exists)`);
          result.skipped++;
          syncLog.answers[item.id] = {
            localId: item.id,
            apiId: existing.id,
            action: 'skipped',
          };
          continue;
        }

        // Update existing
        if (!dryRun) {
          const updated = await client.updateAnswer(existing.id, {
            question,
            answer,
            note,
            entities: entityId ? [entityId] : existing.entities,
          });
          syncLog.answers[item.id] = {
            localId: item.id,
            apiId: updated.id,
            action: 'updated',
          };
        }
        console.log(`[${i + 1}/${items.length}] UPDATE: "${question.substring(0, 50)}..."`);
        result.updated++;
      } else {
        // Create new
        if (!dryRun) {
          const created = await client.createAnswer({
            question,
            answer,
            note,
            entities: entityId ? [entityId] : [],
          });
          syncLog.answers[item.id] = {
            localId: item.id,
            apiId: created.id,
            action: 'created',
          };
          // Add to existing for future deduplication
          existingAnswers.push(created);
        }
        console.log(`[${i + 1}/${items.length}] CREATE: "${question.substring(0, 50)}..."`);
        result.created++;
      }

      // Rate limiting - small delay between requests
      if (!dryRun && i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`[${i + 1}/${items.length}] FAILED: "${question.substring(0, 50)}..." - ${error}`);
      result.failed++;
      result.errors.push(`${question.substring(0, 30)}: ${error}`);
    }
  }

  // Save sync log
  if (!dryRun) {
    const logPath = `./customers/${data.customer}/api-ready/${data.customer}-sync-log.json`;
    fs.writeFileSync(logPath, JSON.stringify(syncLog, null, 2));
    console.log(`\nSync log saved: ${logPath}`);
  }

  return result;
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const customerFolder = args[0] || 'kaas-pack';
  const dryRun = args.includes('--dry-run');
  const entityIdArg = args.find(a => a.startsWith('--entity='));
  const entityId = entityIdArg ? parseInt(entityIdArg.split('=')[1]) : undefined;

  // Use customers/<customer>/api-ready/ folder
  const groupedPath = `./customers/${customerFolder}/api-ready/${customerFolder}-grouped.json`;

  if (!fs.existsSync(groupedPath)) {
    console.error(`Grouped data not found: ${groupedPath}`);
    console.error('Run "aggregate" and "group" commands first');
    process.exit(1);
  }

  console.log(`\n=== SYNC TO NSLIBRARY ===`);
  console.log(`Customer: ${customerFolder}`);
  if (entityId) console.log(`Entity ID: ${entityId}`);
  if (dryRun) console.log(`Mode: DRY RUN`);

  const result = await syncToNSLibrary(groupedPath, { dryRun, entityId });

  console.log('\n=== SYNC RESULT ===');
  console.log(`Created: ${result.created}`);
  console.log(`Updated: ${result.updated}`);
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

// Only run main when executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
