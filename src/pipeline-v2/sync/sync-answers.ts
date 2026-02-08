/**
 * Sync Answers to Passionfruit API
 *
 * Reads the prepared answers preview and syncs to the API.
 * Supports both create and update operations.
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PassionfruitAPIClient } from './api-client.js';
import { recordAnswerSyncs } from './sync-log.js';

interface PreparedAnswer {
  action: 'create' | 'update';
  existingId?: number;
  localId: string;
  question: string;
  answer: string;
  note: string;
  source: {
    file: string;
    lCell: string;
    vCell: string;
    harvestedAt: string;
  };
  metadata: {
    type: string;
    level: string;
    topic: string;
    lang?: string;
  };
}

interface PreparedAnswersOutput {
  summary: {
    total: number;
    toCreate: number;
    toUpdate: number;
    skipped: number;
  };
  answers: PreparedAnswer[];
  skipped: Array<{
    localId: string;
    question: string;
    reason: string;
  }>;
}

interface SyncResult {
  syncedAt: string;
  environment: string;
  results: {
    created: Array<{
      localId: string;
      apiId: number;
      question: string;
    }>;
    updated: Array<{
      localId: string;
      apiId: number;
      question: string;
    }>;
    failed: Array<{
      localId: string;
      question: string;
      error: string;
    }>;
  };
}

async function loadPreparedAnswers(path: string = './api-ready/answers-preview.yaml'): Promise<PreparedAnswersOutput> {
  const content = await readFile(path, 'utf-8');
  return parseYaml(content);
}

async function syncAnswers(): Promise<SyncResult> {
  console.log('\n🔄 Syncing answers to Passionfruit API...\n');

  // Load prepared answers
  const prepared = await loadPreparedAnswers();
  console.log(`  Loaded ${prepared.answers.length} answers to sync`);
  console.log(`  - To create: ${prepared.summary.toCreate}`);
  console.log(`  - To update: ${prepared.summary.toUpdate}`);

  // Initialize client
  const client = new PassionfruitAPIClient();
  console.log(`\n  Environment: ${client.environment}`);
  console.log(`  API URL: ${client.url}\n`);

  const result: SyncResult = {
    syncedAt: new Date().toISOString(),
    environment: client.environment,
    results: {
      created: [],
      updated: [],
      failed: [],
    },
  };

  // Process each answer
  for (const answer of prepared.answers) {
    const shortQ = answer.question.substring(0, 50) + (answer.question.length > 50 ? '...' : '');

    try {
      if (answer.action === 'create') {
        console.log(`  ➕ Creating: ${shortQ}`);

        const response = await client.createAnswer({
          question: answer.question,
          answer: answer.answer,
          note: answer.note,
          entities: [],
          evidences: [],
        });

        result.results.created.push({
          localId: answer.localId,
          apiId: response.id,
          question: answer.question,
        });

        console.log(`     ✓ Created with ID ${response.id}`);

      } else if (answer.action === 'update' && answer.existingId) {
        console.log(`  ✏️  Updating #${answer.existingId}: ${shortQ}`);

        const response = await client.updateAnswer(answer.existingId, {
          question: answer.question,
          answer: answer.answer,
          note: answer.note,
        });

        result.results.updated.push({
          localId: answer.localId,
          apiId: response.id,
          question: answer.question,
        });

        console.log(`     ✓ Updated ID ${response.id}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`     ✗ Failed: ${errorMessage}`);

      result.results.failed.push({
        localId: answer.localId,
        question: answer.question,
        error: errorMessage,
      });
    }
  }

  return result;
}

async function main() {
  try {
    const result = await syncAnswers();

    console.log('\n' + '═'.repeat(60));
    console.log('  SYNC COMPLETE');
    console.log('═'.repeat(60));

    console.log(`\n  Environment: ${result.environment}`);
    console.log(`  Synced at:   ${result.syncedAt}`);

    console.log(`\n  Results:`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Created:     ${result.results.created.length}`);
    console.log(`  Updated:     ${result.results.updated.length}`);
    console.log(`  Failed:      ${result.results.failed.length}`);

    if (result.results.created.length > 0) {
      console.log('\n  === CREATED ===');
      for (const item of result.results.created) {
        console.log(`  - ID ${item.apiId}: ${item.question.substring(0, 50)}...`);
      }
    }

    if (result.results.updated.length > 0) {
      console.log('\n  === UPDATED ===');
      for (const item of result.results.updated) {
        console.log(`  - ID ${item.apiId}: ${item.question.substring(0, 50)}...`);
      }
    }

    if (result.results.failed.length > 0) {
      console.log('\n  === FAILED ===');
      for (const item of result.results.failed) {
        console.log(`  - ${item.question.substring(0, 40)}...`);
        console.log(`    Error: ${item.error}`);
      }
    }

    // Save sync result
    await writeFile('./api-ready/answers-sync-result.yaml', stringifyYaml(result, { lineWidth: 0 }), 'utf-8');

    // Record to sync log for future reference
    const syncRecords = [
      ...result.results.created.map(r => ({ ...r, action: 'create' as const })),
      ...result.results.updated.map(r => ({ ...r, action: 'update' as const })),
    ];
    if (syncRecords.length > 0) {
      await recordAnswerSyncs(syncRecords, result.environment);
      console.log(`\n  📝 Recorded ${syncRecords.length} syncs to sync-log.yaml`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('  Saved to: ./api-ready/answers-sync-result.yaml');
    console.log('  Sync log: ./api-ready/sync-log.yaml');
    console.log('═'.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
