/**
 * Delete Answers from Passionfruit API
 *
 * ALWAYS shows exactly what will be deleted and asks for confirmation.
 * Designed to be safe - requires explicit user confirmation.
 *
 * Usage:
 *   npx tsx src/pipeline-v2/sync/delete-answers.ts <id1> <id2> ...
 *   npx tsx src/pipeline-v2/sync/delete-answers.ts --all-duplicates
 */

import 'dotenv/config';
import * as readline from 'readline';
import { PassionfruitAPIClient, AnswerResponse } from './api-client.js';

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askConfirmation(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findDuplicates(answers: AnswerResponse[]): Map<string, AnswerResponse[]> {
  const groups = new Map<string, AnswerResponse[]>();

  for (const answer of answers) {
    const normalized = normalizeQuestion(answer.question);
    const existing = groups.get(normalized) || [];
    existing.push(answer);
    groups.set(normalized, existing);
  }

  // Return only groups with more than one answer
  const duplicates = new Map<string, AnswerResponse[]>();
  for (const [question, answerList] of groups.entries()) {
    if (answerList.length > 1) {
      // Sort by ID to keep the oldest (lowest ID) and mark others for deletion
      answerList.sort((a, b) => a.id - b.id);
      duplicates.set(question, answerList);
    }
  }

  return duplicates;
}

async function deleteAnswers(ids: number[]) {
  const rl = createReadlineInterface();

  try {
    console.log('\n🗑️  Delete Answers from Passionfruit API\n');

    const client = new PassionfruitAPIClient();
    console.log(`  Environment: ${client.environment}`);
    console.log(`  API URL: ${client.url}\n`);

    // Fetch details for each ID
    console.log('═'.repeat(70));
    console.log('  ANSWERS TO BE DELETED');
    console.log('═'.repeat(70));

    const answersToDelete: AnswerResponse[] = [];

    for (const id of ids) {
      try {
        const answer = await client.getAnswer(id);
        answersToDelete.push(answer);

        console.log(`\n  ID: ${answer.id}`);
        console.log(`  Q: ${answer.question}`);
        console.log(`  A: ${answer.answer}`);
        if (answer.note) {
          console.log(`  Note: ${answer.note}`);
        }
        console.log(`  Created: ${answer.createdAt}`);
        console.log(`  Linked entities: [${answer.entities.join(', ')}]`);
        console.log(`  Linked evidences: [${answer.evidences.join(', ')}]`);
      } catch (err) {
        console.log(`\n  ⚠️  ID ${id}: Not found or error fetching`);
      }
    }

    if (answersToDelete.length === 0) {
      console.log('\n  No valid answers to delete.\n');
      return;
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`  Total: ${answersToDelete.length} answers will be PERMANENTLY deleted`);
    console.log('═'.repeat(70));

    // Confirmation
    console.log('\n  ⚠️  WARNING: This action cannot be undone!\n');
    const confirmed = await askConfirmation(rl, '  Type "yes" to confirm deletion: ');

    if (!confirmed) {
      console.log('\n  ❌ Deletion cancelled.\n');
      return;
    }

    // Perform deletion
    console.log('\n  Deleting...\n');

    const results = {
      deleted: [] as number[],
      failed: [] as { id: number; error: string }[],
    };

    for (const answer of answersToDelete) {
      try {
        await client.deleteAnswer(answer.id);
        results.deleted.push(answer.id);
        console.log(`  ✅ Deleted ID ${answer.id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.failed.push({ id: answer.id, error: errorMsg });
        console.log(`  ❌ Failed to delete ID ${answer.id}: ${errorMsg}`);
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('  DELETION COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n  Deleted: ${results.deleted.length}`);
    console.log(`  Failed: ${results.failed.length}\n`);

  } finally {
    rl.close();
  }
}

async function deleteAllDuplicates() {
  const rl = createReadlineInterface();

  try {
    console.log('\n🗑️  Delete Duplicate Answers from Passionfruit API\n');

    const client = new PassionfruitAPIClient();
    console.log(`  Environment: ${client.environment}`);
    console.log(`  API URL: ${client.url}\n`);

    // Fetch all answers
    console.log('  Fetching all answers...');
    const answers = await client.listAnswers();
    console.log(`  Found ${answers.length} total answers\n`);

    // Find duplicates
    const duplicateGroups = findDuplicates(answers);

    if (duplicateGroups.size === 0) {
      console.log('  ✅ No duplicates found!\n');
      return;
    }

    // Calculate what will be deleted (keep oldest, delete rest)
    const toDelete: AnswerResponse[] = [];
    const toKeep: AnswerResponse[] = [];

    console.log('═'.repeat(70));
    console.log('  DUPLICATE ANALYSIS');
    console.log('═'.repeat(70));

    let groupNum = 1;
    for (const [_normalized, answerList] of duplicateGroups) {
      const keep = answerList[0]; // Oldest (lowest ID)
      const deleteList = answerList.slice(1);

      toKeep.push(keep);
      toDelete.push(...deleteList);

      console.log(`\n  Group ${groupNum}: "${keep.question.substring(0, 50)}${keep.question.length > 50 ? '...' : ''}"`);
      console.log(`  ─────────────────────────────────────────────────`);
      console.log(`  ✅ KEEP:   ID ${keep.id} (created: ${keep.createdAt})`);
      console.log(`             A: ${keep.answer.substring(0, 60)}${keep.answer.length > 60 ? '...' : ''}`);

      for (const del of deleteList) {
        console.log(`  🗑️  DELETE: ID ${del.id} (created: ${del.createdAt})`);
        console.log(`             A: ${del.answer.substring(0, 60)}${del.answer.length > 60 ? '...' : ''}`);
      }

      groupNum++;
    }

    console.log('\n' + '═'.repeat(70));
    console.log('  SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n  Duplicate groups: ${duplicateGroups.size}`);
    console.log(`  Answers to KEEP: ${toKeep.length}`);
    console.log(`  Answers to DELETE: ${toDelete.length}`);
    console.log('\n  ⚠️  WARNING: This action cannot be undone!\n');

    // Confirmation
    const confirmed = await askConfirmation(rl, `  Type "yes" to delete ${toDelete.length} duplicate answers: `);

    if (!confirmed) {
      console.log('\n  ❌ Deletion cancelled.\n');
      return;
    }

    // Perform deletion
    console.log('\n  Deleting duplicates...\n');

    const results = {
      deleted: [] as number[],
      failed: [] as { id: number; error: string }[],
    };

    for (const answer of toDelete) {
      try {
        await client.deleteAnswer(answer.id);
        results.deleted.push(answer.id);
        console.log(`  ✅ Deleted ID ${answer.id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.failed.push({ id: answer.id, error: errorMsg });
        console.log(`  ❌ Failed to delete ID ${answer.id}: ${errorMsg}`);
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('  DELETION COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n  Deleted: ${results.deleted.length}`);
    console.log(`  Failed: ${results.failed.length}\n`);

  } finally {
    rl.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--all-duplicates')) {
  deleteAllDuplicates().catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
} else if (args.length > 0) {
  const ids = args.map(a => parseInt(a, 10)).filter(n => !isNaN(n));

  if (ids.length === 0) {
    console.log('\nUsage:');
    console.log('  npx tsx src/pipeline-v2/sync/delete-answers.ts <id1> <id2> ...');
    console.log('  npx tsx src/pipeline-v2/sync/delete-answers.ts --all-duplicates');
    console.log('\nFirst list answers to see what exists:');
    console.log('  npx tsx src/pipeline-v2/sync/list-answers.ts');
    console.log('  npx tsx src/pipeline-v2/sync/list-answers.ts --find-duplicates\n');
    process.exit(1);
  }

  deleteAnswers(ids).catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
} else {
  console.log('\nUsage:');
  console.log('  npx tsx src/pipeline-v2/sync/delete-answers.ts <id1> <id2> ...');
  console.log('  npx tsx src/pipeline-v2/sync/delete-answers.ts --all-duplicates');
  console.log('\nFirst list answers to see what exists:');
  console.log('  npx tsx src/pipeline-v2/sync/list-answers.ts');
  console.log('  npx tsx src/pipeline-v2/sync/list-answers.ts --find-duplicates\n');
}
