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

export interface VisionDiscrepancy {
  itemId: string;
  label: string;
  baseValue: string | null;      // What base extraction found
  visionValue: string;           // What Vision sees
  matchScore: number;
  visionQuestion: string;
  type: 'mismatch' | 'missing_in_base' | 'missing_in_vision';
  reviewed?: boolean;            // Human has reviewed this
  verdict?: 'base_correct' | 'vision_correct' | 'both_wrong';
}

export interface ValidationResult {
  totalItems: number;
  matchedCorrectly: number;      // Vision confirms base extraction
  discrepancies: VisionDiscrepancy[];  // Differences to review
  missingInVision: number;       // Items Vision couldn't find
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
  typeFilter?: string[],
  sectionHint?: string
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

    let score = overlap / Math.max(qWords.size, lWords.size);

    // Position-based scoring boost
    if (visionRow.rowNum && item.lCell) {
      // Extract row number from cell reference (e.g., "A5" -> 5)
      const itemRowMatch = item.lCell.match(/\d+/);
      if (itemRowMatch) {
        const itemRow = parseInt(itemRowMatch[0], 10);
        // If row numbers are close (within 3 rows), boost score
        const rowDiff = Math.abs(visionRow.rowNum - itemRow);
        if (rowDiff === 0) {
          score += 0.2; // Exact row match
        } else if (rowDiff <= 3) {
          score += 0.1; // Close row match
        }
      }
    }

    // Section hint matching - prefer items from the same section
    if (sectionHint && item.topic) {
      const normalizedSection = sectionHint.toLowerCase();
      const normalizedTopic = item.topic.toLowerCase();
      if (normalizedSection.includes(normalizedTopic) || normalizedTopic.includes(normalizedSection)) {
        score += 0.1; // Same section boost
      }
    }

    // Cap score at 1.0
    score = Math.min(score, 1.0);

    if (score > (bestMatch?.score || 0.3)) {
      bestMatch = { item, score };
    }
  }

  return bestMatch;
}

/**
 * Check if this looks like a cell misread (PDF extraction grabbed wrong cell)
 *
 * Heuristics:
 * - Label mentions "supplier/company/manufacturer" but base value looks like a product
 * - Vision value looks more appropriate for the label
 */
function isLikelyCellMisread(label: string, baseValue: string, visionValue: string): boolean {
  const labelLower = label.toLowerCase();
  const baseLower = baseValue.toLowerCase();
  const visionLower = visionValue.toLowerCase();

  // Company/supplier name field patterns
  const isCompanyField = /\b(supplier|company|manufacturer|vendor|producer|firm|enterprise)\s*(name)?\b/i.test(labelLower);

  if (isCompanyField) {
    // Check if Vision value looks like a company name (has legal entity suffix)
    const visionLooksLikeCompany = /\b(gmbh|ag|bv|nv|inc|ltd|llc|corp|sa|sarl|srl|co\.?|holding|group)\b/i.test(visionLower);
    // Check if base value looks like a product code/name (alphanumeric with dashes)
    const baseLooksLikeProduct = /^[A-Z0-9-]+$/i.test(baseValue.trim()) ||
                                  /\b(isomalt|maltitol|xylitol|sorbitol|mannitol)\b/i.test(baseLower);

    if (visionLooksLikeCompany && baseLooksLikeProduct) {
      return true;
    }
  }

  // Product name field patterns
  const isProductField = /\b(product|material|article|item)\s*(name|description)?\b/i.test(labelLower);

  if (isProductField) {
    // Check if base value looks like a company name instead of a product
    const baseLooksLikeCompany = /\b(gmbh|ag|bv|nv|inc|ltd|llc|corp|sa|sarl|srl)\b/i.test(baseLower);
    const visionLooksLikeProduct = /\b(isomalt|maltitol|xylitol|sorbitol|mannitol|powder|liquid|granule)\b/i.test(visionLower) ||
                                    /^[A-Z0-9-]+$/i.test(visionValue.trim());

    if (baseLooksLikeCompany && visionLooksLikeProduct) {
      return true;
    }
  }

  // Default: don't auto-correct unless we're confident
  return false;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Validate indexed questionnaire against Claude Vision
 *
 * Vision acts as a QA tool - it looks at the PDF like a human would
 * and flags any discrepancies with the base extraction for review.
 * It does NOT auto-fix anything.
 *
 * @param indexedPath Path to the indexed JSON file
 * @param pdfPath Path to the original PDF file
 * @returns Validation results with discrepancies to review
 */
export async function validateWithVision(
  indexedPath: string,
  pdfPath: string
): Promise<ValidationResult> {
  // Load indexed questionnaire
  const indexed: IndexedQuestionnaire = JSON.parse(await readFile(indexedPath, 'utf-8'));

  // Build a flat list of all items
  const allItems: IndexedItem[] = [];
  for (const section of indexed.sections) {
    allItems.push(...section.items);
  }

  // Extract with Claude Vision (sees the PDF like a human)
  const vision = await extractPdfWithClaudeVision(pdfPath);

  const discrepancies: VisionDiscrepancy[] = [];
  let matchedCorrectly = 0;
  const matchedItemIds = new Set<string>();

  for (const table of vision.tables) {
    for (const row of table.rows) {
      const hasYesNo = row.yes || row.no || row.na;
      const hasFieldValue = row.fieldValue && row.fieldValue.trim();

      // Compare Yes/No answers
      if (hasYesNo) {
        const match = findBestMatch(row, allItems, ['yesno'], table.section);

        if (match && match.score >= 0.5) {
          matchedItemIds.add(match.item.id);
          const baseValue = match.item.value;
          const visionValue = row.yes ? 'Yes' : row.no ? 'No' : row.na ? 'N/A' : '';

          if (baseValue === visionValue) {
            // Vision confirms base extraction is correct
            matchedCorrectly++;
          } else {
            // Discrepancy found - flag for review
            discrepancies.push({
              itemId: match.item.id,
              label: match.item.label,
              baseValue: baseValue || null,
              visionValue,
              matchScore: match.score,
              visionQuestion: row.question,
              type: baseValue ? 'mismatch' : 'missing_in_base',
            });
          }
        }
      }

      // Compare field values
      if (hasFieldValue) {
        const match = findBestMatch(row, allItems, ['field', 'text', 'choice'], table.section);

        if (match && match.score >= 0.5) {
          matchedItemIds.add(match.item.id);
          const baseValue = match.item.value;
          const visionValue = row.fieldValue!.trim();

          // Normalize for comparison (trim, lowercase)
          const baseNorm = (baseValue || '').toLowerCase().trim();
          const visionNorm = visionValue.toLowerCase().trim();

          if (baseNorm === visionNorm || baseValue === visionValue) {
            matchedCorrectly++;
          } else if (!baseValue && visionValue) {
            // Base missed this, Vision found it
            discrepancies.push({
              itemId: match.item.id,
              label: match.item.label,
              baseValue: null,
              visionValue,
              matchScore: match.score,
              visionQuestion: row.question,
              type: 'missing_in_base',
            });
          } else if (baseValue && baseValue !== visionValue) {
            // Values differ
            discrepancies.push({
              itemId: match.item.id,
              label: match.item.label,
              baseValue,
              visionValue,
              matchScore: match.score,
              visionQuestion: row.question,
              type: 'mismatch',
            });
          }
        }
      }
    }
  }

  // Count items Vision couldn't find/match
  const missingInVision = allItems.length - matchedItemIds.size;

  // Store validation results in the indexed file for review
  (indexed as any).visionValidation = {
    validatedAt: new Date().toISOString(),
    totalItems: allItems.length,
    matchedCorrectly,
    discrepancies,
    missingInVision,
  };

  // Save updated file (no values changed, just validation data added)
  await writeFile(indexedPath, JSON.stringify(indexed, null, 2));

  return {
    totalItems: allItems.length,
    matchedCorrectly,
    discrepancies,
    missingInVision,
  };
}

/**
 * Correct indexed questionnaire using Claude Vision
 *
 * Unlike validateWithVision which only flags discrepancies,
 * this function auto-applies Vision corrections for Yes/No questions
 * when the match confidence is high enough.
 *
 * @param indexedPath Path to the indexed JSON file
 * @param pdfPath Path to the original PDF file
 * @param minMatchScore Minimum match score to auto-correct (default 0.6)
 * @returns Correction results
 */
export async function correctWithVision(
  indexedPath: string,
  pdfPath: string,
  minMatchScore: number = 0.6
): Promise<ValidationResult & { correctedCount: number }> {
  // Load indexed questionnaire
  const indexed: IndexedQuestionnaire = JSON.parse(await readFile(indexedPath, 'utf-8'));

  // Build a map of items by ID for quick lookup
  const itemsById = new Map<string, IndexedItem>();
  const allItems: IndexedItem[] = [];
  for (const section of indexed.sections) {
    for (const item of section.items) {
      itemsById.set(item.id, item);
      allItems.push(item);
    }
  }

  // Extract with Claude Vision
  const vision = await extractPdfWithClaudeVision(pdfPath);

  const discrepancies: VisionDiscrepancy[] = [];
  const corrections: Array<{ itemId: string; oldValue: string; newValue: string; matchScore: number }> = [];
  let matchedCorrectly = 0;
  let correctedCount = 0;
  const matchedItemIds = new Set<string>();

  for (const table of vision.tables) {
    for (const row of table.rows) {
      const hasYesNo = row.yes || row.no || row.na;

      // Auto-correct Yes/No answers
      if (hasYesNo) {
        const match = findBestMatch(row, allItems, ['yesno'], table.section);

        if (match && match.score >= minMatchScore) {
          matchedItemIds.add(match.item.id);
          const baseValue = match.item.value;
          const visionValue = row.yes ? 'Yes' : row.no ? 'No' : row.na ? 'N/A' : '';

          if (baseValue === visionValue) {
            matchedCorrectly++;
          } else {
            // Auto-correct: apply Vision value
            const item = itemsById.get(match.item.id);
            if (item) {
              corrections.push({
                itemId: item.id,
                oldValue: item.value || '',
                newValue: visionValue,
                matchScore: match.score,
              });
              item.value = visionValue;
              correctedCount++;
              matchedCorrectly++; // Now it matches
            }
          }
        }
      }

      // For field values, auto-correct when match score is high and values are clearly different
      const hasFieldValue = row.fieldValue && row.fieldValue.trim();
      if (hasFieldValue) {
        const match = findBestMatch(row, allItems, ['field', 'text', 'choice'], table.section);

        if (match && match.score >= 0.5) {
          matchedItemIds.add(match.item.id);
          const baseValue = match.item.value;
          const visionValue = row.fieldValue!.trim();
          const baseNorm = (baseValue || '').toLowerCase().trim();
          const visionNorm = visionValue.toLowerCase().trim();

          if (baseNorm === visionNorm || baseValue === visionValue) {
            matchedCorrectly++;
          } else {
            // Check if this is a clear mismatch that should be auto-corrected
            // Auto-correct if values are completely different AND this looks like a cell misread
            const isCellMisread = baseValue ? isLikelyCellMisread(match.item.label, baseValue, visionValue) : false;
            const valuesAreDifferent = baseValue &&
              visionValue &&
              !baseNorm.includes(visionNorm) &&
              !visionNorm.includes(baseNorm);

            // Lower threshold (0.5) when cell misread is strongly indicated
            // Higher threshold (0.7) for uncertain cases
            const shouldAutoCorrect = valuesAreDifferent &&
              ((isCellMisread && match.score >= 0.5) || match.score >= 0.7);

            if (shouldAutoCorrect) {
              // Auto-correct: apply Vision value
              const item = itemsById.get(match.item.id);
              if (item) {
                corrections.push({
                  itemId: item.id,
                  oldValue: item.value || '',
                  newValue: visionValue,
                  matchScore: match.score,
                });
                item.value = visionValue;
                correctedCount++;
                matchedCorrectly++;
              }
            } else {
              // Flag for manual review
              discrepancies.push({
                itemId: match.item.id,
                label: match.item.label,
                baseValue: baseValue || null,
                visionValue,
                matchScore: match.score,
                visionQuestion: row.question,
                type: baseValue ? 'mismatch' : 'missing_in_base',
              });
            }
          }
        }
      }
    }
  }

  const missingInVision = allItems.length - matchedItemIds.size;

  // Store correction info
  (indexed as any).visionCorrection = {
    correctedAt: new Date().toISOString(),
    totalItems: allItems.length,
    matchedCorrectly,
    correctedCount,
    corrections,
    remainingDiscrepancies: discrepancies,
    missingInVision,
  };

  // Save corrected file
  await writeFile(indexedPath, JSON.stringify(indexed, null, 2));

  return {
    totalItems: allItems.length,
    matchedCorrectly,
    discrepancies,
    missingInVision,
    correctedCount,
  };
}

// Keep old function name for backwards compatibility but redirect to validation
export async function enhanceWithVision(
  indexedPath: string,
  pdfPath: string
): Promise<ValidationResult> {
  return validateWithVision(indexedPath, pdfPath);
}
