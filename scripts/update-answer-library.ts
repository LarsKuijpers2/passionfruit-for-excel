/**
 * Update Answer Library from Excel Review
 *
 * This script:
 * 1. Updates existing answers that need correction (10 items)
 * 2. Adds new answers to the library (43 items)
 *
 * Run with --dry-run to see what would be done without making changes.
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

interface UpdateItem {
  apiId: number;
  excelId: number;
  question: string;
  currentAnswer: string;
  newAnswer: string;
}

interface AddItem {
  excelId: number;
  topic: string;
  question: string;
  answer: string;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const updatesOnly = process.argv.includes('--updates-only');
  const addsOnly = process.argv.includes('--adds-only');

  console.log('\n========================================');
  console.log('  Answer Library Update Script');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log('');

  const toUpdate: UpdateItem[] = JSON.parse(
    await readFile('customers/Doehler Oosterhout/items-to-update.json', 'utf-8')
  );
  const toAdd: AddItem[] = JSON.parse(
    await readFile('customers/Doehler Oosterhout/unique-items-to-add.json', 'utf-8')
  );

  console.log(`Items to UPDATE: ${toUpdate.length}`);
  console.log(`Items to ADD: ${toAdd.length}`);
  console.log('');

  if (dryRun) {
    console.log('=== DRY RUN - Would make the following changes ===\n');

    if (!addsOnly) {
      console.log('--- UPDATES ---');
      toUpdate.forEach((item, i) => {
        console.log(`${i + 1}. API ID ${item.apiId}:`);
        console.log(`   Q: ${item.question.slice(0, 60)}...`);
        console.log(`   OLD: "${item.currentAnswer.slice(0, 50)}"`);
        console.log(`   NEW: "${item.newAnswer.slice(0, 50)}"`);
      });
    }

    if (!updatesOnly) {
      console.log('\n--- ADDS ---');
      toAdd.forEach((item, i) => {
        console.log(`${i + 1}. [${item.topic}] ${item.question.slice(0, 50)}...`);
        console.log(`   A: "${item.answer.slice(0, 50)}"`);
      });
    }

    console.log('\n=== End DRY RUN ===');
    console.log('To apply changes, run without --dry-run flag.');
    return;
  }

  const client = new PassionfruitAPIClient();
  console.log('Connected to:', client.url);
  console.log('');

  const results = {
    updated: [] as { id: number; question: string }[],
    updateFailed: [] as { id: number; error: string }[],
    added: [] as { id: number; question: string }[],
    addFailed: [] as { question: string; error: string }[],
  };

  // === UPDATES ===
  if (!addsOnly && toUpdate.length > 0) {
    console.log('=== UPDATING EXISTING ANSWERS ===\n');

    for (const item of toUpdate) {
      try {
        console.log(`Updating ID ${item.apiId}...`);

        // Get current answer to preserve entities/evidences
        const current = await client.getAnswer(item.apiId);

        await client.updateAnswer(item.apiId, {
          question: current.question, // Keep original question
          answer: item.newAnswer,
          entities: current.entities,
          evidences: current.evidences,
        });

        results.updated.push({ id: item.apiId, question: item.question });
        console.log(`  ✓ Updated: ${item.question.slice(0, 50)}...`);

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        results.updateFailed.push({ id: item.apiId, error: err.message });
        console.log(`  ✗ FAILED: ${err.message}`);
      }
    }
  }

  // === ADDS ===
  if (!updatesOnly && toAdd.length > 0) {
    console.log('\n=== ADDING NEW ANSWERS ===\n');

    for (const item of toAdd) {
      try {
        console.log(`Adding: ${item.question.slice(0, 50)}...`);

        const result = await client.createAnswer({
          question: item.question,
          answer: item.answer,
          entities: [],
          evidences: [],
        });

        results.added.push({ id: result.id, question: item.question });
        console.log(`  ✓ Created with ID ${result.id}`);

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        results.addFailed.push({ question: item.question, error: err.message });
        console.log(`  ✗ FAILED: ${err.message}`);
      }
    }
  }

  // === SUMMARY ===
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  console.log(`Updates successful: ${results.updated.length}/${toUpdate.length}`);
  console.log(`Adds successful: ${results.added.length}/${toAdd.length}`);

  if (results.updateFailed.length > 0) {
    console.log(`\nUpdate failures:`);
    results.updateFailed.forEach(f => console.log(`  - ID ${f.id}: ${f.error}`));
  }

  if (results.addFailed.length > 0) {
    console.log(`\nAdd failures:`);
    results.addFailed.forEach(f => console.log(`  - ${f.question.slice(0, 40)}...: ${f.error}`));
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(
    `customers/Doehler Oosterhout/update-results-${timestamp}.json`,
    JSON.stringify(results, null, 2)
  );
  console.log(`\nResults saved to: customers/Doehler Oosterhout/update-results-${timestamp}.json`);
}

main().catch(console.error);
