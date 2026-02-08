/**
 * List Answers from Passionfruit API
 *
 * Fetches all answers and displays them for review.
 * Useful for identifying duplicates before deletion.
 *
 * Usage:
 *   npx tsx src/pipeline-v2/sync/list-answers.ts
 *   npx tsx src/pipeline-v2/sync/list-answers.ts --find-duplicates
 *   npx tsx src/pipeline-v2/sync/list-answers.ts --search "company name"
 */

import 'dotenv/config';
import { PassionfruitAPIClient, AnswerResponse } from './api-client.js';

interface DuplicateGroup {
  question: string;
  answers: AnswerResponse[];
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findDuplicates(answers: AnswerResponse[]): DuplicateGroup[] {
  const groups = new Map<string, AnswerResponse[]>();

  for (const answer of answers) {
    const normalized = normalizeQuestion(answer.question);
    const existing = groups.get(normalized) || [];
    existing.push(answer);
    groups.set(normalized, existing);
  }

  // Return only groups with more than one answer (duplicates)
  const duplicates: DuplicateGroup[] = [];
  for (const [question, answerList] of groups.entries()) {
    if (answerList.length > 1) {
      duplicates.push({
        question: answerList[0].question, // Use original casing
        answers: answerList,
      });
    }
  }

  // Sort by count descending
  return duplicates.sort((a, b) => b.answers.length - a.answers.length);
}

async function listAnswers(options: { findDuplicates?: boolean; search?: string }) {
  console.log('\n📋 Fetching answers from Passionfruit API...\n');

  const client = new PassionfruitAPIClient();
  console.log(`  Environment: ${client.environment}`);
  console.log(`  API URL: ${client.url}\n`);

  let answers: AnswerResponse[];

  if (options.search && options.search.length >= 5) {
    console.log(`  Searching for: "${options.search}"\n`);
    answers = await client.searchAnswers(options.search);
  } else {
    answers = await client.listAnswers();
  }

  console.log(`  Total answers: ${answers.length}\n`);

  if (options.findDuplicates) {
    const duplicates = findDuplicates(answers);

    if (duplicates.length === 0) {
      console.log('  ✅ No duplicates found!\n');
      return;
    }

    console.log('═'.repeat(70));
    console.log('  DUPLICATE ANSWERS FOUND');
    console.log('═'.repeat(70));
    console.log(`\n  Found ${duplicates.length} groups of duplicate questions:\n`);

    for (let i = 0; i < duplicates.length; i++) {
      const group = duplicates[i];
      console.log('─'.repeat(70));
      console.log(`  Group ${i + 1}: "${group.question.substring(0, 60)}${group.question.length > 60 ? '...' : ''}"`);
      console.log(`  Count: ${group.answers.length} duplicates\n`);

      for (const answer of group.answers) {
        console.log(`    ID: ${answer.id}`);
        console.log(`    Answer: ${answer.answer.substring(0, 80)}${answer.answer.length > 80 ? '...' : ''}`);
        console.log(`    Created: ${answer.createdAt}`);
        console.log(`    Entities: [${answer.entities.join(', ')}]`);
        console.log('');
      }
    }

    console.log('─'.repeat(70));
    console.log(`\n  To delete duplicates, use:`);
    console.log(`  npx tsx src/pipeline-v2/sync/delete-answers.ts <id1> <id2> ...`);
    console.log('');

  } else {
    // List all answers
    console.log('═'.repeat(70));
    console.log('  ALL ANSWERS');
    console.log('═'.repeat(70));

    for (const answer of answers) {
      console.log(`\n  ID: ${answer.id}`);
      console.log(`  Q: ${answer.question.substring(0, 70)}${answer.question.length > 70 ? '...' : ''}`);
      console.log(`  A: ${answer.answer.substring(0, 70)}${answer.answer.length > 70 ? '...' : ''}`);
      if (answer.note) {
        console.log(`  Note: ${answer.note.substring(0, 50)}${answer.note.length > 50 ? '...' : ''}`);
      }
      console.log(`  Created: ${answer.createdAt}`);
      console.log(`  Entities: [${answer.entities.join(', ')}]`);
    }

    console.log('\n' + '═'.repeat(70));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const findDuplicates = args.includes('--find-duplicates');
const searchIndex = args.indexOf('--search');
const search = searchIndex !== -1 ? args[searchIndex + 1] : undefined;

listAnswers({ findDuplicates, search }).catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
