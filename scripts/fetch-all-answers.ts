/**
 * Fetch ALL answers from API (with pagination)
 * Compare Version 7 with existing and export to Excel
 */

import 'dotenv/config';
import { writeFile } from 'fs/promises';
import { getApiBaseUrl, getApiKey } from '../src/config/environments.js';
import { getValidAccessToken, hasRefreshToken } from '../src/config/token-manager.js';

const VERSION7_EVIDENCE_ID = 1852;

interface Answer {
  id: number;
  question: string;
  answer: string;
  note?: string;
  evidences?: number[];
}

async function fetchAllAnswers(): Promise<Answer[]> {
  const baseUrl = getApiBaseUrl();
  let token = getApiKey();

  if (hasRefreshToken()) {
    token = await getValidAccessToken();
  }

  const allAnswers: Answer[] = [];
  let page = 1;
  const pageSize = 100;
  let total = 0;

  console.log('Fetching all answers from API...');

  do {
    const response = await fetch(`${baseUrl}/api/v2/answers/?page=${page}&pageSize=${pageSize}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();

    if (data.items) {
      allAnswers.push(...data.items);
      total = data.total || allAnswers.length;
      console.log(`  Page ${page}: ${data.items.length} items (total: ${total})`);
    } else if (Array.isArray(data)) {
      allAnswers.push(...data);
      break; // No pagination
    }

    page++;
  } while (allAnswers.length < total);

  console.log(`\nFetched ${allAnswers.length} total answers\n`);
  return allAnswers;
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

async function compareAnswers() {
  const allAnswers = await fetchAllAnswers();

  // Analyze ID ranges to understand what was pushed when
  const sortedById = [...allAnswers].sort((a, b) => a.id - b.id);
  const minId = sortedById[0]?.id;
  const maxId = sortedById[sortedById.length - 1]?.id;

  console.log(`ID range: ${minId} - ${maxId}`);
  console.log(`Total answers: ${allAnswers.length}`);

  // Group by date
  const byDate = new Map<string, Answer[]>();
  for (const a of allAnswers) {
    const date = (a as any).createdAt?.split('T')[0] || 'unknown';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(a);
  }

  console.log('\nAnswers by creation date:');
  for (const [date, answers] of byDate) {
    const ids = answers.map(a => a.id).sort((a, b) => a - b);
    console.log(`  ${date}: ${answers.length} answers (IDs ${ids[0]} - ${ids[ids.length - 1]})`);
  }

  // For comparison, use the original 10 answers (lowest IDs) vs the rest
  // Based on earlier output, original 10 had IDs around 3166-3175
  // Let's assume IDs < 2951 are "existing" (before Version 7 push)
  const cutoffId = 2951; // First Version 7 answer ID
  const version7Answers = allAnswers.filter(a => a.id >= cutoffId);
  const existingAnswers = allAnswers.filter(a => a.id < cutoffId);

  console.log(`\nUsing ID cutoff: ${cutoffId}`);
  console.log(`Assuming IDs >= ${cutoffId} are Version 7 answers`);

  console.log(`Version 7 answers (evidence ${VERSION7_EVIDENCE_ID}): ${version7Answers.length}`);
  console.log(`Existing NS library answers: ${existingAnswers.length}\n`);

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
  console.log('Top 10 matches:');
  for (const m of matches.slice(0, 10)) {
    console.log(`\n[${(m.similarity * 100).toFixed(0)}% match]`);
    console.log(`  EXISTING [${m.existing.id}]: ${m.existing.question.slice(0, 60)}...`);
    console.log(`  VERSION7 [${m.version7.id}]: ${m.version7.question.slice(0, 60)}...`);
  }

  // Export to TSV for Excel
  const tsvRows: string[] = [];
  tsvRows.push([
    'Similarity',
    'Existing ID',
    'Existing Question',
    'Existing Answer',
    'Version7 ID',
    'Version7 Question',
    'Version7 Answer',
    'Same Answer?',
    'Action',
  ].join('\t'));

  for (const m of matches) {
    const sameAnswer = m.existing.answer.toLowerCase().trim() === m.version7.answer.toLowerCase().trim();
    tsvRows.push([
      (m.similarity * 100).toFixed(0) + '%',
      m.existing.id.toString(),
      m.existing.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.existing.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.version7.id.toString(),
      m.version7.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
      m.version7.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
      sameAnswer ? 'YES' : 'NO',
      '', // Action column
    ].join('\t'));
  }

  const tsvPath = './customers/Doehler Oosterhout/version7-vs-existing.tsv';
  await writeFile(tsvPath, tsvRows.join('\n'));
  console.log(`\n\nExported to: ${tsvPath}`);
  console.log('(Tab-separated file - open in Excel)\n');

  // Summary
  console.log('Summary:');
  console.log(`  Total answers in API: ${allAnswers.length}`);
  console.log(`  Existing answers: ${existingAnswers.length}`);
  console.log(`  Version 7 answers: ${version7Answers.length}`);
  console.log(`  Potential duplicates: ${matches.length}`);
  console.log(`  Same answer content: ${matches.filter(m => m.existing.answer.toLowerCase().trim() === m.version7.answer.toLowerCase().trim()).length}`);
}

compareAnswers().catch(console.error);
