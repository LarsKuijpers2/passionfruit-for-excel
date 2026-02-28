/**
 * Export Grouped Answers to Excel by Topic with API Comparison
 *
 * Shows local answers alongside similar API answers for easy comparison.
 * Groups similar answers together and labels them as:
 * - "EXACTLY THE SAME" - Same question and answer
 * - "SIMILAR QUESTION" - Similar question (>40% match)
 * - "UNIQUE" - No similar question in API
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
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
}

interface GroupedData {
  customer: string;
  answerLibrary: {
    items: GroupedItem[];
  };
}

interface ProductItem {
  id: string;
  label: string;
  value: string;
  topic: string;
  section: string;
  lCell?: string;
  vCell?: string;
}

interface ApprovedFile {
  meta?: { source?: string };
  product?: ProductItem[];
}

interface APIAnswer {
  id: number;
  question: string;
  answer: string;
  note?: string;
  entities: any[];
  evidences: any[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
}

// Normalize text for comparison (same as compare-api)
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity (same as compare-api)
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

  // Jaccard-like similarity
  const union = new Set([...setA, ...setB]).size;
  return overlap / union;
}

async function main() {
  const customer = process.argv[2] || 'Doehler Oosterhout';
  const inputPath = `./api-ready/${customer}-grouped.json`;
  const outputPath = `./customers/${customer}/api-ready/${customer.replace(/ /g, '_')}-curated-with-api.xlsx`;
  const threshold = 0.4; // 40% similarity threshold

  // Load grouped data
  console.log('Loading grouped data...');
  const data: GroupedData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`Loaded ${data.answerLibrary.items.length} local items`);

  // Load product data from approved questionnaires
  console.log('\nLoading product data from approved questionnaires...');
  const approvedDir = `./customers/${customer}/approved`;
  const productData: Array<ProductItem & { source: string }> = [];

  if (fs.existsSync(approvedDir)) {
    const approvedFiles = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
    for (const file of approvedFiles) {
      try {
        const approved: ApprovedFile = JSON.parse(fs.readFileSync(path.join(approvedDir, file), 'utf-8'));
        const source = approved.meta?.source || file.replace('.json', '');
        if (approved.product && approved.product.length > 0) {
          for (const item of approved.product) {
            productData.push({ ...item, source });
          }
        }
      } catch (e) {
        console.error(`  Failed to load ${file}:`, e);
      }
    }
  }
  console.log(`Found ${productData.length} product items from ${new Set(productData.map(p => p.source)).size} questionnaires`);

  // Fetch API answers (only from before today)
  console.log('\nFetching existing API answers (before today)...');
  let apiAnswers: APIAnswer[] = [];
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  try {
    const client = new PassionfruitAPIClient();
    console.log(`API: ${client.url}`);
    const allAnswers = await client.listAnswers() as APIAnswer[];

    // Filter to only answers created before today
    apiAnswers = allAnswers.filter(a => {
      const createdDate = (a.createdAt || a.created_at)?.split('T')[0];
      return createdDate && createdDate < today;
    });

    console.log(`Found ${allAnswers.length} total answers in API`);
    console.log(`Filtered to ${apiAnswers.length} answers from before ${today}`);
  } catch (error) {
    console.error('Failed to fetch API answers:', error);
    console.log('Continuing without API comparison...');
  }

  // Find matches for each local item
  console.log('\nAnalyzing similarities...');
  interface MatchResult {
    item: GroupedItem;
    apiMatches: Array<{ apiAnswer: APIAnswer; similarity: number; sameAnswer: boolean }>;
    bestSimilarity: number;
    status: 'EXACTLY THE SAME' | 'SIMILAR QUESTION' | 'UNIQUE';
  }

  const matches: MatchResult[] = [];
  for (const item of data.answerLibrary.items) {
    const question = item.fullLabel || item.label;

    // Find all similar API answers
    const apiMatches: Array<{ apiAnswer: APIAnswer; similarity: number; sameAnswer: boolean }> = [];

    for (const apiAnswer of apiAnswers) {
      const sim = calculateSimilarity(question, apiAnswer.question);
      if (sim >= threshold) {
        const sameAnswer = normalizeForComparison(item.value) === normalizeForComparison(apiAnswer.answer);
        apiMatches.push({ apiAnswer, similarity: sim, sameAnswer });
      }
    }

    // Sort by similarity descending
    apiMatches.sort((a, b) => b.similarity - a.similarity);

    const bestSimilarity = apiMatches.length > 0 ? apiMatches[0].similarity : 0;
    const hasExactMatch = apiMatches.some(m => m.similarity >= 0.95 && m.sameAnswer);

    let status: 'EXACTLY THE SAME' | 'SIMILAR QUESTION' | 'UNIQUE';
    if (hasExactMatch) {
      status = 'EXACTLY THE SAME';
    } else if (apiMatches.length > 0) {
      status = 'SIMILAR QUESTION';
    } else {
      status = 'UNIQUE';
    }

    matches.push({
      item,
      apiMatches,
      bestSimilarity,
      status,
    });
  }

  // Count statistics
  const exactSame = matches.filter(m => m.status === 'EXACTLY THE SAME').length;
  const similar = matches.filter(m => m.status === 'SIMILAR QUESTION').length;
  const unique = matches.filter(m => m.status === 'UNIQUE').length;

  console.log(`\nMatch statistics:`);
  console.log(`  EXACTLY THE SAME: ${exactSame}`);
  console.log(`  SIMILAR QUESTION: ${similar}`);
  console.log(`  UNIQUE: ${unique}`);

  // Group items by topic
  const byTopic = new Map<string, MatchResult[]>();
  for (const match of matches) {
    const topic = match.item.topic || 'other';
    if (!byTopic.has(topic)) {
      byTopic.set(topic, []);
    }
    byTopic.get(topic)!.push(match);
  }

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Create summary sheet first
  const sortedTopics = Array.from(byTopic.keys()).sort();
  const summaryRows = sortedTopics.map(topic => {
    const topicMatches = byTopic.get(topic)!;
    return {
      'Topic': topic,
      'Total': topicMatches.length,
      'Exactly Same': topicMatches.filter(m => m.status === 'EXACTLY THE SAME').length,
      'Similar': topicMatches.filter(m => m.status === 'SIMILAR QUESTION').length,
      'Unique': topicMatches.filter(m => m.status === 'UNIQUE').length,
    };
  });
  summaryRows.push({
    'Topic': 'TOTAL',
    'Total': matches.length,
    'Exactly Same': exactSame,
    'Similar': similar,
    'Unique': unique,
  });
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 25 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Create Product Data sheet - database format: products as rows, fields as columns
  if (productData.length > 0) {
    // Collect all unique field names (labels) as column headers
    const allFields = [...new Set(productData.map(p => p.label))];

    // Header row: Product Name + all field columns
    const headers = ['Product Name', ...allFields];

    // Empty rows ready for product data entry
    const productRows: Record<string, any>[] = [];

    // Check if we have any specific product mentioned
    const productSupplied = productData.find(p => p.label === 'Product Supplied' && p.value);
    if (productSupplied) {
      // Add row for this product
      const row: Record<string, any> = { 'Product Name': productSupplied.value };
      for (const field of allFields) {
        row[field] = field === 'Product Supplied' ? productSupplied.value : '';
      }
      productRows.push(row);
    }

    // Add empty rows for new products
    for (let i = 0; i < 5; i++) {
      const emptyRow: Record<string, any> = { 'Product Name': '' };
      for (const field of allFields) {
        emptyRow[field] = '';
      }
      productRows.push(emptyRow);
    }

    const productWs = XLSX.utils.json_to_sheet(productRows, { header: headers });
    // Set column widths
    const productCols = [{ wch: 45 }]; // Product Name column
    for (const _ of allFields) {
      productCols.push({ wch: 25 });
    }
    productWs['!cols'] = productCols;
    XLSX.utils.book_append_sheet(wb, productWs, 'Product Data');
    console.log(`Added Product Data sheet: ${allFields.length} field columns, ready for product rows`);
  }

  // Create API Answers reference sheet
  if (apiAnswers.length > 0) {
    const apiRows = apiAnswers.map(a => ({
      'API ID': a.id,
      'Question': a.question,
      'Answer': a.answer,
      'Note': a.note || '',
      'Created': (a.createdAt || a.created_at || '').split('T')[0],
      'Evidences': (a.evidences || []).map((e: any) => typeof e === 'object' ? e.id : e).join(', '),
    }));
    const apiWs = XLSX.utils.json_to_sheet(apiRows);
    apiWs['!cols'] = [
      { wch: 8 },   // API ID
      { wch: 80 },  // Question
      { wch: 50 },  // Answer
      { wch: 30 },  // Note
      { wch: 12 },  // Created
      { wch: 15 },  // Evidences
    ];
    XLSX.utils.book_append_sheet(wb, apiWs, 'Existing API Answers');
  }

  // Create a sheet for each topic with grouped similar answers
  for (const topic of sortedTopics) {
    const topicMatches = byTopic.get(topic)!;

    // Sort by status: EXACTLY THE SAME first, then SIMILAR, then UNIQUE
    topicMatches.sort((a, b) => {
      const statusOrder = { 'EXACTLY THE SAME': 0, 'SIMILAR QUESTION': 1, 'UNIQUE': 2 };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    // Build rows with similar answers grouped under each local answer
    const rows: Record<string, any>[] = [];

    for (const m of topicMatches) {
      const simPercent = m.bestSimilarity > 0 ? Math.round(m.bestSimilarity * 100) : '';

      // Add the local answer row
      rows.push({
        'Status': m.status,
        'Similarity': simPercent ? `${simPercent}%` : '',
        'Source': 'LOCAL',
        'Question': m.item.fullLabel || m.item.label,
        'Answer': m.item.value,
        'API ID': '',
        'Same Answer?': '',
        'Section': m.item.section,
        'Sources': m.item.sources.join(', '),
      });

      // Add all similar API answers underneath
      for (const apiMatch of m.apiMatches) {
        rows.push({
          'Status': '',  // Empty to show it's part of the group above
          'Similarity': `${Math.round(apiMatch.similarity * 100)}%`,
          'Source': 'API',
          'Question': apiMatch.apiAnswer.question,
          'Answer': apiMatch.apiAnswer.answer,
          'API ID': apiMatch.apiAnswer.id,
          'Same Answer?': apiMatch.sameAnswer ? 'YES' : 'NO',
          'Section': '',
          'Sources': '',
        });
      }

      // Add empty row between groups for readability
      if (m.apiMatches.length > 0) {
        rows.push({
          'Status': '',
          'Similarity': '',
          'Source': '',
          'Question': '',
          'Answer': '',
          'API ID': '',
          'Same Answer?': '',
          'Section': '',
          'Sources': '',
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 18 },  // Status
      { wch: 10 },  // Similarity
      { wch: 8 },   // Source
      { wch: 60 },  // Question
      { wch: 40 },  // Answer
      { wch: 8 },   // API ID
      { wch: 12 },  // Same Answer?
      { wch: 25 },  // Section
      { wch: 30 },  // Sources
    ];

    const sheetName = topic.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Ensure output directory exists
  const outputDir = `./customers/${customer}/api-ready`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write file
  XLSX.writeFile(wb, outputPath);

  console.log(`\n✅ Exported to: ${outputPath}`);
  console.log(`\nSheets: Summary + Existing API Answers + ${sortedTopics.length} topic sheets`);
  console.log(`\nFormat: Each local answer shows its status (EXACTLY THE SAME / SIMILAR QUESTION / UNIQUE)`);
  console.log(`Similar API answers are listed directly below each local answer for easy comparison.`);
}

main().catch(console.error);
