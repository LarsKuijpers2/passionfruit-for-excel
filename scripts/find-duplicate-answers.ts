/**
 * Find duplicate answers in the Passionfruit API
 * Exports results to Excel-compatible CSV
 */

import 'dotenv/config';
import { writeFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

interface Answer {
  id: number;
  question: string;
  answer: string;
  note?: string;
  evidences: number[];
}

interface DuplicateGroup {
  questions: string[];
  answers: Answer[];
  similarity: number;
}

// Simple similarity score based on common words
function calculateSimilarity(q1: string, q2: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const words1 = new Set(normalize(q1));
  const words2 = new Set(normalize(q2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;
}

// Check if questions are semantically similar
function areSimilar(q1: string, q2: string, threshold = 0.5): boolean {
  // Exact match
  if (q1.toLowerCase().trim() === q2.toLowerCase().trim()) return true;

  // Check similarity score
  return calculateSimilarity(q1, q2) >= threshold;
}

async function findDuplicates() {
  const client = new PassionfruitAPIClient();

  console.log('\nFetching all answers from API...');
  const answers = await client.listAnswers();
  console.log(`Found ${answers.length} answers\n`);

  // Find potential duplicates
  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < answers.length; i++) {
    if (processed.has(answers[i].id)) continue;

    const group: Answer[] = [answers[i]];
    processed.add(answers[i].id);

    for (let j = i + 1; j < answers.length; j++) {
      if (processed.has(answers[j].id)) continue;

      if (areSimilar(answers[i].question, answers[j].question)) {
        group.push(answers[j]);
        processed.add(answers[j].id);
      }
    }

    if (group.length > 1) {
      duplicateGroups.push({
        questions: group.map(a => a.question),
        answers: group,
        similarity: group.length > 1 ? calculateSimilarity(group[0].question, group[1].question) : 1,
      });
    }
  }

  console.log(`Found ${duplicateGroups.length} groups of potential duplicates\n`);

  // Sort by number of duplicates (descending)
  duplicateGroups.sort((a, b) => b.answers.length - a.answers.length);

  // Show summary
  for (const group of duplicateGroups.slice(0, 10)) {
    console.log(`Group (${group.answers.length} items, similarity: ${(group.similarity * 100).toFixed(0)}%):`);
    for (const a of group.answers) {
      console.log(`  [${a.id}] ${a.question.slice(0, 60)}...`);
      console.log(`       → ${a.answer.slice(0, 50)}...`);
    }
    console.log('');
  }

  if (duplicateGroups.length > 10) {
    console.log(`... and ${duplicateGroups.length - 10} more groups\n`);
  }

  // Export to CSV for Excel
  const csvRows: string[] = [];
  csvRows.push(['Group', 'ID', 'Question', 'Answer', 'Evidences', 'Similarity'].join('\t'));

  let groupNum = 1;
  for (const group of duplicateGroups) {
    for (const a of group.answers) {
      csvRows.push([
        groupNum.toString(),
        a.id.toString(),
        `"${a.question.replace(/"/g, '""')}"`,
        `"${a.answer.replace(/"/g, '""')}"`,
        a.evidences.join(','),
        (group.similarity * 100).toFixed(0) + '%',
      ].join('\t'));
    }
    groupNum++;
  }

  // Also add non-duplicates for reference
  const duplicateIds = new Set(duplicateGroups.flatMap(g => g.answers.map(a => a.id)));
  const unique = answers.filter(a => !duplicateIds.has(a.id));

  for (const a of unique) {
    csvRows.push([
      'unique',
      a.id.toString(),
      `"${a.question.replace(/"/g, '""')}"`,
      `"${a.answer.replace(/"/g, '""')}"`,
      a.evidences.join(','),
      '-',
    ].join('\t'));
  }

  const csvPath = './customers/Doehler Oosterhout/duplicate-analysis.tsv';
  await writeFile(csvPath, csvRows.join('\n'));
  console.log(`\nExported to: ${csvPath}`);
  console.log('(Tab-separated file - open in Excel)\n');

  // Summary stats
  console.log('Summary:');
  console.log(`  Total answers: ${answers.length}`);
  console.log(`  Duplicate groups: ${duplicateGroups.length}`);
  console.log(`  Answers in duplicate groups: ${duplicateGroups.reduce((sum, g) => sum + g.answers.length, 0)}`);
  console.log(`  Unique answers: ${unique.length}`);
}

findDuplicates().catch(console.error);
