/**
 * Sync Full Excel to Answer Library
 *
 * - Updates 10 yellow answers (customer corrections)
 * - Adds 564 new items
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const toUpdate = JSON.parse(await readFile('customers/Doehler Oosterhout/full-items-to-update.json', 'utf-8'));
  const toAdd = JSON.parse(await readFile('customers/Doehler Oosterhout/full-items-to-add.json', 'utf-8'));

  // Only update yellow items (customer's intentional changes)
  const yellowUpdates = toUpdate.filter((item: any) => item.isYellow);

  console.log(`\n=== ANSWER LIBRARY SYNC ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Yellow updates: ${yellowUpdates.length}`);
  console.log(`New items to add: ${toAdd.length}`);

  if (dryRun) {
    console.log('\n--- Yellow Updates ---');
    yellowUpdates.forEach((item: any, i: number) => {
      console.log(`${i+1}. ID ${item.apiId}: ${item.question.slice(0, 50)}...`);
      console.log(`   Old: "${item.currentAnswer.slice(0, 40)}..."`);
      console.log(`   New: "${item.newAnswer.slice(0, 40)}..."`);
    });
    console.log('\nDry run - no changes made.');
    return;
  }

  const client = new PassionfruitAPIClient();
  console.log(`\nConnected to: ${client.url}\n`);

  const results = { updated: 0, added: 0, errors: [] as string[] };

  // Updates (only yellow)
  console.log('--- UPDATING YELLOW ANSWERS ---');
  for (let i = 0; i < yellowUpdates.length; i++) {
    const item = yellowUpdates[i];
    try {
      const current = await client.getAnswer(item.apiId);
      await client.updateAnswer(item.apiId, {
        question: current.question,
        answer: item.newAnswer,
        entities: current.entities,
        evidences: current.evidences,
      });
      results.updated++;
      console.log(`✓ Updated ID ${item.apiId}: ${item.question.slice(0, 50)}...`);
      await new Promise(r => setTimeout(r, 100));
    } catch (e: any) {
      results.errors.push(`Update ${item.apiId}: ${e.message}`);
      console.log(`✗ Failed ID ${item.apiId}: ${e.message}`);
    }
  }

  // Adds
  console.log('\n--- ADDING NEW ANSWERS ---');
  const startTime = Date.now();
  for (let i = 0; i < toAdd.length; i++) {
    const item = toAdd[i];
    try {
      await client.createAnswer({
        question: item.question,
        answer: item.answer,
        entities: [],
        evidences: [],
      });
      results.added++;
      if (results.added % 50 === 0 || results.added === toAdd.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`Added: ${results.added}/${toAdd.length} (${elapsed}s)`);
      }
      await new Promise(r => setTimeout(r, 50));
    } catch (e: any) {
      results.errors.push(`Add "${item.question.slice(0,30)}...": ${e.message}`);
    }
  }

  console.log('\n=== DONE ===');
  console.log(`Updated: ${results.updated}/${yellowUpdates.length}`);
  console.log(`Added: ${results.added}/${toAdd.length}`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${results.errors.length}`);
    results.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(`customers/Doehler Oosterhout/sync-results-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved.`);
}

main().catch(console.error);
