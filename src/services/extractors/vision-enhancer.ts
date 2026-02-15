/**
 * Vision Enhancer
 *
 * Enhances indexed questionnaires with Claude Vision results.
 * Particularly useful for PDFs with strikethrough Yes/No formatting
 * that Azure Document Intelligence cannot detect.
 */

import { readFile, writeFile } from 'fs/promises';
import { extractPdfWithClaudeVision, type TableRow } from './claude-vision.js';

// =============================================================================
// TYPES
// =============================================================================

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

export interface EnhanceResult {
  updatedCount: number;
  notMatchedCount: number;
  newAnswered: number;
  totalItems: number;
}

// =============================================================================
// MATCHING LOGIC
// =============================================================================

function normalizeQuestion(q: string): string {
  return q.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

interface MatchResult {
  item: IndexedItem;
  score: number;
}

function findBestMatch(
  visionRow: TableRow,
  items: IndexedItem[],
  typeFilter?: string[]
): MatchResult | null {
  const normalizedQuestion = normalizeQuestion(visionRow.question);

  let bestMatch: MatchResult | null = null;

  for (const item of items) {
    // Apply type filter if specified
    if (typeFilter && !typeFilter.includes(item.type)) continue;

    const normalizedLabel = normalizeQuestion(item.label);

    // Simple word overlap scoring
    const qWords = new Set(normalizedQuestion.split(' '));
    const lWords = new Set(normalizedLabel.split(' '));

    let overlap = 0;
    for (const word of qWords) {
      if (lWords.has(word) && word.length > 2) overlap++;
    }

    const score = overlap / Math.max(qWords.size, lWords.size);

    if (score > (bestMatch?.score || 0.3)) {
      bestMatch = { item, score };
    }
  }

  return bestMatch;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Enhance an indexed questionnaire with Claude Vision results
 *
 * @param indexedPath Path to the indexed JSON file
 * @param pdfPath Path to the original PDF file
 * @returns Enhancement statistics
 */
export async function enhanceWithVision(
  indexedPath: string,
  pdfPath: string
): Promise<EnhanceResult> {
  // Load indexed questionnaire
  const indexed: IndexedQuestionnaire = JSON.parse(await readFile(indexedPath, 'utf-8'));

  // Extract with Claude Vision
  const vision = await extractPdfWithClaudeVision(pdfPath);

  // Build a flat list of all items
  const allItems: IndexedItem[] = [];
  for (const section of indexed.sections) {
    allItems.push(...section.items);
  }

  let updatedCount = 0;
  let notMatchedCount = 0;
  let commentsAdded = 0;

  for (const table of vision.tables) {
    for (const row of table.rows) {
      const hasYesNo = row.yes || row.no || row.na;
      const hasFieldValue = row.fieldValue && row.fieldValue.trim();
      const hasComment = row.comment && row.comment.trim();

      // Try to match Yes/No answers
      if (hasYesNo) {
        const match = findBestMatch(row, allItems, ['yesno']);

        if (match) {
          const oldValue = match.item.value;
          const newValue = row.yes ? 'Yes' : row.no ? 'No' : row.na ? 'N/A' : undefined;

          if (newValue && oldValue !== newValue) {
            match.item.value = newValue;
            updatedCount++;
          }
        } else {
          notMatchedCount++;
        }
      }

      // Try to match field values (for non-Yes/No fields)
      if (hasFieldValue) {
        const match = findBestMatch(row, allItems, ['field', 'text', 'choice']);

        if (match && !match.item.value) {
          match.item.value = row.fieldValue!.trim();
          updatedCount++;
        }
      }

      // Try to add comments to matching items
      if (hasComment && !hasFieldValue) {
        // Find items that might need this comment
        const match = findBestMatch(row, allItems);

        if (match && match.item.value) {
          // If item already has a value but no detailed comment, we could append
          // For now, just count that we found comments
          commentsAdded++;
        }
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

  return {
    updatedCount,
    notMatchedCount,
    newAnswered: answered,
    totalItems: indexed.stats?.total || allItems.length,
  };
}
