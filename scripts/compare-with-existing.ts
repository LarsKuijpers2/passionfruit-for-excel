/**
 * Compare Version 7 answers with existing NS library answers
 * Find potential duplicates and export to Excel
 */

import 'dotenv/config';
import { writeFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

const VERSION7_EVIDENCE_ID = 1852;

interface Answer {
  id: number;
  question: string;
  answer: string;
  note?: string;
  evidences: number[];
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

async function compareAnswers() {
  const client = new PassionfruitAPIClient();

  console.log('\nFetching all answers from API...');
  const allAnswers = await client.listAnswers();
  console.log(`Total answers in API: ${allAnswers.length}\n`);

  // Separate Version 7 answers from existing ones
  const version7Answers = allAnswers.filter(a => (a.evidences || []).includes(VERSION7_EVIDENCE_ID));
  const existingAnswers = allAnswers.filter(a => !(a.evidences || []).includes(VERSION7_EVIDENCE_ID));

  console.log(`Version 7 answers (evidence ${VERSION7_EVIDENCE_ID}): ${version7Answers.length}`);
  console.log(`Existing NS library answers: ${existingAnswers.length}\n`);

  // Show what's in the existing answers
  console.log('\nExisting answers in NS library:');
  for (const a of existingAnswers.slice(0, 15)) {
    console.log(`  [${a.id}] ${a.question.slice(0, 60)}...`);
    console.log(`       evidences: ${(a.evidences || []).join(', ') || 'none'}`);
  }

  if (existingAnswers.length === 0) {
    console.log('No existing answers to compare with!');
    return;
  }

  // Find matches between Version 7 and existing
  const matches: Array<{
    existing: Answer;
    version7: Answer;
    similarity: number;
  }> = [];

  for (const existing of existingAnswers) {
    for (const v7 of version7Answers) {
      const similarity = calculateSimilarity(existing.question, v7.question);
      if (similarity >= 0.4) {
        matches.push({ existing, version7: v7, similarity });
      }
    }
  }

  // Sort by similarity (highest first)
  matches.sort((a, b) => b.similarity - a.similarity);

  console.log(`Found ${matches.length} potential matches\n`);

  // Show top matches
  console.log('Top matches:');
  for (const m of matches.slice(0, 10)) {
    console.log(`\n[${(m.similarity * 100).toFixed(0)}% match]`);
    console.log(`  EXISTING: ${m.existing.question.slice(0, 70)}...`);
    console.log(`       → ${m.existing.answer.slice(0, 50)}...`);
    console.log(`  VERSION7: ${m.version7.question.slice(0, 70)}...`);
    console.log(`       → ${m.version7.answer.slice(0, 50)}...`);
  }

  // Export to TSV for Excel
  const tsvRows: string[] = [];
  tsvRows.push([
    'Similarity',
    'Existing ID',
    'Existing Question',
    'Existing Answer',
    'Existing Evidences',
    'Version7 ID',
    'Version7 Question',
    'Version7 Answer',
    'Action',
  ].join('\t'));

  for (const m of matches) {
    tsvRows.push([
      (m.similarity * 100).toFixed(0) + '%',
      m.existing.id.toString(),
      m.existing.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.existing.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
      (m.existing.evidences || []).join(','),
      m.version7.id.toString(),
      m.version7.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.version7.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
      '', // Action column
    ].join('\t'));
  }

  // Also list existing answers that have NO match in Version 7
  const matchedExistingIds = new Set(matches.map(m => m.existing.id));
  const unmatchedExisting = existingAnswers.filter(a => !matchedExistingIds.has(a.id));

  if (unmatchedExisting.length > 0) {
    tsvRows.push(''); // Empty row
    tsvRows.push(['--- EXISTING ANSWERS WITH NO VERSION 7 MATCH ---'].join('\t'));
    for (const a of unmatchedExisting) {
      tsvRows.push([
        'no match',
        a.id.toString(),
        a.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
        a.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
        (a.evidences || []).join(','),
        '',
        '',
        '',
        '',
      ].join('\t'));
    }
  }

  const tsvPath = './customers/Doehler Oosterhout/version7-vs-existing.tsv';
  await writeFile(tsvPath, tsvRows.join('\n'));
  console.log(`\n\nExported to: ${tsvPath}`);
  console.log('(Tab-separated file - open in Excel)\n');

  // Summary
  console.log('Summary:');
  console.log(`  Existing answers: ${existingAnswers.length}`);
  console.log(`  Version 7 answers: ${version7Answers.length}`);
  console.log(`  Potential matches: ${matches.length}`);
  console.log(`  Unmatched existing: ${unmatchedExisting.length}`);
}

compareAnswers().catch(console.error);
