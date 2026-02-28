/**
 * Compare local Version 7 questionnaire with existing API answers
 * Export matches to Excel
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

interface LocalItem {
  id: string;
  label: string;
  value: string;
  section: string;
}

interface APIAnswer {
  id: number;
  question: string;
  answer: string;
}

function calculateSimilarity(q1: string, q2: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const words1 = new Set(normalize(q1));
  const words2 = new Set(normalize(q2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;
}

async function compare() {
  // Load local Version 7 questionnaire
  const indexedPath = './customers/Doehler Oosterhout/indexed/Version_7_Standard_Questionnaire_for_Customers_Oosterhout__1_.json';
  const data = JSON.parse(await readFile(indexedPath, 'utf-8'));

  const localItems: LocalItem[] = [];
  for (const section of data.sections) {
    for (const item of section.items) {
      if (item.label && item.value) {
        localItems.push({
          id: item.id,
          label: item.label,
          value: item.value,
          section: section.title,
        });
      }
    }
  }

  console.log(`\nLocal Version 7 items: ${localItems.length}`);

  // Fetch existing answers from API
  const client = new PassionfruitAPIClient();
  const apiAnswers = await client.listAnswers();

  // Deduplicate by ID (API returns duplicates due to pagination bug)
  const uniqueAnswers = new Map<number, APIAnswer>();
  for (const a of apiAnswers) {
    uniqueAnswers.set(a.id, a);
  }
  const existingAnswers = Array.from(uniqueAnswers.values());

  console.log(`Existing API answers: ${existingAnswers.length}`);

  // Find matches
  const matches: Array<{
    existing: APIAnswer;
    local: LocalItem;
    similarity: number;
  }> = [];

  for (const existing of existingAnswers) {
    for (const local of localItems) {
      const similarity = calculateSimilarity(existing.question, local.label);
      if (similarity >= 0.4) {
        matches.push({ existing, local, similarity });
      }
    }
  }

  // Sort by similarity
  matches.sort((a, b) => b.similarity - a.similarity);

  console.log(`\nFound ${matches.length} potential matches\n`);

  // Show matches
  console.log('Matches:');
  for (const m of matches) {
    console.log(`\n[${(m.similarity * 100).toFixed(0)}% match]`);
    console.log(`  API [${m.existing.id}]: ${m.existing.question.slice(0, 60)}...`);
    console.log(`       Answer: ${m.existing.answer.slice(0, 50)}...`);
    console.log(`  V7 [${m.local.section}]: ${m.local.label.slice(0, 60)}...`);
    console.log(`       Answer: ${m.local.value.slice(0, 50)}...`);
  }

  // Export to TSV
  const tsvRows: string[] = [];
  tsvRows.push([
    'Similarity',
    'API ID',
    'API Question',
    'API Answer',
    'V7 Section',
    'V7 Question',
    'V7 Answer',
    'Same Answer?',
    'Action',
  ].join('\t'));

  for (const m of matches) {
    const sameAnswer = m.existing.answer.toLowerCase().trim() === m.local.value.toLowerCase().trim();
    tsvRows.push([
      (m.similarity * 100).toFixed(0) + '%',
      m.existing.id.toString(),
      m.existing.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.existing.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.local.section,
      m.local.label.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.local.value.replace(/\t/g, ' ').replace(/\n/g, ' '),
      sameAnswer ? 'YES' : 'NO',
      '',
    ].join('\t'));
  }

  // Add unmatched API answers
  const matchedApiIds = new Set(matches.map(m => m.existing.id));
  const unmatchedApi = existingAnswers.filter(a => !matchedApiIds.has(a.id));

  if (unmatchedApi.length > 0) {
    tsvRows.push('');
    tsvRows.push('--- API ANSWERS NOT IN VERSION 7 ---');
    for (const a of unmatchedApi) {
      tsvRows.push([
        'no match',
        a.id.toString(),
        a.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
        a.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
        '',
        '',
        '',
        '',
        '',
      ].join('\t'));
    }
  }

  const tsvPath = './customers/Doehler Oosterhout/version7-vs-api.tsv';
  await writeFile(tsvPath, tsvRows.join('\n'));
  console.log(`\n\nExported to: ${tsvPath}`);

  // Summary
  console.log('\nSummary:');
  console.log(`  Local V7 items: ${localItems.length}`);
  console.log(`  API answers: ${existingAnswers.length}`);
  console.log(`  Matches found: ${matches.length}`);
  console.log(`  Same answer content: ${matches.filter(m => m.existing.answer.toLowerCase().trim() === m.local.value.toLowerCase().trim()).length}`);
  console.log(`  Unmatched API: ${unmatchedApi.length}`);
}

compare().catch(console.error);
