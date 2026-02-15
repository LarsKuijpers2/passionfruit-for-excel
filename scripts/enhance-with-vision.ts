#!/usr/bin/env npx tsx
/**
 * Enhance indexed questionnaire with Claude Vision results
 *
 * For PDFs with strikethrough Yes/No formatting, Claude Vision can
 * detect the correct answers while Azure DI only extracts text.
 *
 * Usage:
 *   npx tsx scripts/enhance-with-vision.ts <indexed-file> <pdf-file>
 */

import { readFile, writeFile } from 'fs/promises';
import { extractPdfWithClaudeVision, type TableRow } from '../src/services/extractors/claude-vision.js';

interface IndexedItem {
  id: string;
  type: string;
  label: string;
  value?: string;
  topic?: string;
  level?: string;
  lang?: string;
  destination?: string;
  lCell?: string;
  vCell?: string;
}

interface IndexedSection {
  title: string;
  topic?: string;
  sheet?: string;
  items: IndexedItem[];
}

interface IndexedQuestionnaire {
  id: string;
  source: string;
  indexed: string;
  language?: string;
  sections: IndexedSection[];
  stats?: {
    total: number;
    answered: number;
    standard: number;
    narrative: number;
    product: number;
  };
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

function findBestMatch(visionRow: TableRow, items: IndexedItem[]): IndexedItem | null {
  const normalizedQuestion = normalizeQuestion(visionRow.question);

  let bestMatch: IndexedItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    if (item.type !== 'yesno') continue;

    const normalizedLabel = normalizeQuestion(item.label);

    // Simple word overlap scoring
    const qWords = new Set(normalizedQuestion.split(' '));
    const lWords = new Set(normalizedLabel.split(' '));

    let overlap = 0;
    for (const word of qWords) {
      if (lWords.has(word) && word.length > 2) overlap++;
    }

    const score = overlap / Math.max(qWords.size, lWords.size);

    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch;
}

async function enhance(indexedPath: string, pdfPath: string) {
  console.log('Loading indexed questionnaire...');
  const indexed: IndexedQuestionnaire = JSON.parse(await readFile(indexedPath, 'utf-8'));

  console.log('Extracting with Claude Vision...');
  const vision = await extractPdfWithClaudeVision(pdfPath);

  console.log(`\nFound ${vision.tables.length} sections from Vision\n`);

  // Build a flat list of all yesno items
  const allItems: IndexedItem[] = [];
  for (const section of indexed.sections) {
    allItems.push(...section.items);
  }

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const table of vision.tables) {
    console.log(`Processing: ${table.section}`);

    for (const row of table.rows) {
      // Skip rows without a clear answer
      if (!row.yes && !row.no && !row.na) continue;

      const match = findBestMatch(row, allItems);

      if (match) {
        const oldValue = match.value;
        const newValue = row.yes ? 'Yes' : row.no ? 'No' : row.na ? 'N/A' : undefined;

        if (newValue && oldValue !== newValue) {
          match.value = newValue;
          updatedCount++;
          console.log(`  ✅ Updated: "${match.label.slice(0, 40)}..." → ${newValue}`);
        }
      } else {
        notFoundCount++;
      }
    }
  }

  // Recalculate stats
  let answered = 0;
  for (const section of indexed.sections) {
    for (const item of section.items) {
      if (item.value && item.value !== 'EMPTY' && item.value !== '') {
        answered++;
      }
    }
  }

  if (indexed.stats) {
    indexed.stats.answered = answered;
  }

  // Save updated file
  await writeFile(indexedPath, JSON.stringify(indexed, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Updated: ${updatedCount} items`);
  console.log(`Not matched: ${notFoundCount} vision rows`);
  console.log(`Total answered: ${answered}/${indexed.stats?.total || allItems.length}`);
  console.log(`${'═'.repeat(50)}\n`);

  console.log(`✅ Saved to ${indexedPath}`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: npx tsx scripts/enhance-with-vision.ts <indexed-json> <pdf-file>');
  process.exit(1);
}

enhance(args[0], args[1]).catch(console.error);
