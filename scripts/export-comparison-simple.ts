/**
 * Export local answers with comparison to Answer Library (NSLibrary API)
 *
 * Single sheet format grouped by topic:
 * Topic | Question | Answer | Source | In Answer Library
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

interface GroupedItem {
  id: string;
  label: string;
  fullLabel: string;
  value: string;
  topic: string;
  section: string;
  sources: string[];
  cellRefs?: Record<string, string>;
}

interface GroupedData {
  customer: string;
  answerLibrary: {
    items: GroupedItem[];
  };
}

interface APIAnswer {
  id: number;
  question: string;
  answer: string;
}

// Normalize text for comparison
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate word-based similarity (Jaccard)
function calculateSimilarity(a: string, b: string): number {
  const wordsA = normalizeForComparison(a).split(' ').filter(w => w.length > 2);
  const wordsB = normalizeForComparison(b).split(' ').filter(w => w.length > 2);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap++;
  }

  const union = new Set([...setA, ...setB]).size;
  return overlap / union;
}

async function main() {
  const customer = process.argv[2] || 'Doehler Oosterhout';
  const inputPath = `./api-ready/${customer}-grouped.json`;
  const outputPath = `./customers/${customer}/api-ready/${customer.replace(/ /g, '_')}-comparison.xlsx`;

  // Load grouped data
  console.log('Loading grouped data...');
  const data: GroupedData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`Loaded ${data.answerLibrary.items.length} local items`);

  // Fetch API answers
  console.log('\nFetching answers from Answer Library...');
  let apiAnswers: APIAnswer[] = [];
  try {
    const client = new PassionfruitAPIClient();
    console.log(`API: ${client.url}`);
    apiAnswers = await client.listAnswers() as APIAnswer[];
    console.log(`Found ${apiAnswers.length} answers in Answer Library`);
  } catch (error) {
    console.error('Failed to fetch API answers:', error);
    console.log('Continuing without API comparison...');
  }

  // Build comparison data
  console.log('\nComparing...');
  const SIMILARITY_THRESHOLD = 0.5; // 50% similarity to consider "in library"

  interface ComparisonRow {
    id: number;
    topic: string;
    question: string;
    answer: string;
    source: string;
    inNSLibrary: 'YES' | 'NO';
    similarTo: number | null;
  }

  // First pass: build all rows with basic info
  const rows: ComparisonRow[] = [];

  for (let i = 0; i < data.answerLibrary.items.length; i++) {
    const item = data.answerLibrary.items[i];
    const question = item.fullLabel || item.label;

    // Build source string: "questionnaire.xlsx:A1"
    const sourceFile = item.sources[0] || '';
    const cellRef = item.cellRefs?.[sourceFile] || '';
    const source = cellRef ? `${sourceFile}:${cellRef}` : sourceFile;

    // Check if in NS Library (API)
    let inLibrary = false;
    for (const apiAnswer of apiAnswers) {
      const sim = calculateSimilarity(question, apiAnswer.question);
      if (sim >= SIMILARITY_THRESHOLD) {
        inLibrary = true;
        break;
      }
    }

    rows.push({
      id: i + 1, // 1-indexed for Excel
      topic: item.topic || 'other',
      question,
      answer: item.value,
      source,
      inNSLibrary: inLibrary ? 'YES' : 'NO',
      similarTo: null,
    });
  }

  // Second pass: find similar questions within the local list
  console.log('Finding similar questions within the list...');
  const INTERNAL_SIMILARITY_THRESHOLD = 0.6; // 60% for internal duplicates

  for (let i = 0; i < rows.length; i++) {
    // Only look at earlier rows to avoid circular references
    for (let j = 0; j < i; j++) {
      const sim = calculateSimilarity(rows[i].question, rows[j].question);
      if (sim >= INTERNAL_SIMILARITY_THRESHOLD) {
        // Point to the earlier (first) occurrence
        rows[i].similarTo = rows[j].id;
        break; // Only link to one
      }
    }
  }

  // Sort by topic, then by question
  rows.sort((a, b) => {
    if (a.topic !== b.topic) return a.topic.localeCompare(b.topic);
    return a.question.localeCompare(b.question);
  });

  // Count statistics
  const inLibrary = rows.filter(r => r.inNSLibrary === 'YES').length;
  const notInLibrary = rows.filter(r => r.inNSLibrary === 'NO').length;
  const withDuplicates = rows.filter(r => r.similarTo !== null).length;

  console.log(`\nResults:`);
  console.log(`  In NS Library: ${inLibrary}`);
  console.log(`  Not in Library: ${notInLibrary}`);
  console.log(`  Similar to another question: ${withDuplicates}`);

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Create main data sheet
  const sheetRows = rows.map(r => ({
    'ID': r.id,
    'Topic': r.topic,
    'Question': r.question,
    'Answer': r.answer,
    'Source': r.source,
    'In NS Library': r.inNSLibrary,
    'Similar To': r.similarTo || '',
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [
    { wch: 6 },   // ID
    { wch: 20 },  // Topic
    { wch: 70 },  // Question
    { wch: 50 },  // Answer
    { wch: 50 },  // Source
    { wch: 14 },  // In NS Library
    { wch: 10 },  // Similar To
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Comparison');

  // Create summary sheet
  const topicCounts = new Map<string, { total: number; inLibrary: number; notInLibrary: number; duplicates: number }>();
  for (const row of rows) {
    if (!topicCounts.has(row.topic)) {
      topicCounts.set(row.topic, { total: 0, inLibrary: 0, notInLibrary: 0, duplicates: 0 });
    }
    const counts = topicCounts.get(row.topic)!;
    counts.total++;
    if (row.inNSLibrary === 'YES') {
      counts.inLibrary++;
    } else {
      counts.notInLibrary++;
    }
    if (row.similarTo !== null) {
      counts.duplicates++;
    }
  }

  const summaryRows = Array.from(topicCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([topic, counts]) => ({
      'Topic': topic,
      'Total': counts.total,
      'In NS Library': counts.inLibrary,
      'Not in Library': counts.notInLibrary,
      'Duplicates': counts.duplicates,
    }));

  summaryRows.push({
    'Topic': 'TOTAL',
    'Total': rows.length,
    'In NS Library': inLibrary,
    'Not in Library': notInLibrary,
    'Duplicates': withDuplicates,
  });

  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Ensure output directory exists
  const outputDir = `./customers/${customer}/api-ready`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write file
  XLSX.writeFile(wb, outputPath);

  console.log(`\nExported to: ${outputPath}`);
}

main().catch(console.error);
