/**
 * Structure Training Processor
 *
 * Compiles human corrections to extraction/structure data into training patterns.
 * These corrections fix Azure Document Intelligence errors:
 * - OCR mistakes (character substitutions, missing text)
 * - Missed content (paragraphs, cells)
 * - Incorrect cell merging/splitting
 *
 * Human-reviewed corrections are the ground truth.
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Types for structure correction data
export interface StructureCorrection {
  questionnaireId: string;
  sheetName: string;
  cellRef: string;
  rowNum: number;
  original: string;
  corrected: string;
  timestamp: string;
}

export interface OCRPattern {
  /** Original incorrect text pattern */
  wrongPattern: string;
  /** Corrected text */
  correction: string;
  /** How many times this was corrected */
  count: number;
  /** Example contexts where this occurred */
  examples: Array<{
    questionnaire: string;
    cell: string;
    fullOriginal: string;
    fullCorrected: string;
  }>;
  /** Confidence based on repetition */
  confidence: number;
}

export interface CellPattern {
  /** Cell reference pattern (e.g., "B*" for column B) */
  cellPattern: string;
  /** Row range where corrections occur */
  rowRange?: { min: number; max: number };
  /** Common correction type */
  correctionType: 'ocr_fix' | 'content_add' | 'content_remove' | 'reformat';
  /** Frequency */
  count: number;
}

export interface CompiledStructureTraining {
  version: string;
  compiledAt: string;
  customer: string;
  stats: {
    totalCorrections: number;
    ocrFixes: number;
    contentAdditions: number;
    contentRemovals: number;
    questionnairesUsed: number;
    lastCorrectionAt: string;
  };
  /** OCR error patterns that can be auto-corrected */
  ocrPatterns: OCRPattern[];
  /** Cell-level patterns for flagging uncertain areas */
  cellPatterns: CellPattern[];
  /** Specific substitution rules (exact match → replacement) */
  substitutionRules: Array<{
    find: string;
    replace: string;
    count: number;
    source: 'human_correction';
  }>;
}

export interface StructureTrainingStatus {
  customer: string;
  hasTrainingData: boolean;
  correctionsCount: number;
  lastCorrectionAt: string | null;
  compiledAt: string | null;
  isStale: boolean;
  questionnairesWithCorrections: string[];
}

export class StructureTrainingProcessor {
  private customersDir: string;

  constructor(customersDir: string = './customers') {
    this.customersDir = customersDir;
  }

  /**
   * Get training status for a customer
   */
  async getStatus(customer: string): Promise<StructureTrainingStatus> {
    const correctionsPath = join(this.customersDir, customer, 'structure-corrections.json');
    const compiledPath = join(this.customersDir, customer, 'compiled-structure-training.json');

    let corrections: StructureCorrection[] = [];
    let compiled: CompiledStructureTraining | null = null;

    // Load corrections
    if (existsSync(correctionsPath)) {
      try {
        const content = await readFile(correctionsPath, 'utf-8');
        corrections = JSON.parse(content);
      } catch {
        corrections = [];
      }
    }

    // Load compiled training
    if (existsSync(compiledPath)) {
      try {
        const content = await readFile(compiledPath, 'utf-8');
        compiled = JSON.parse(content);
      } catch {
        compiled = null;
      }
    }

    // Find last correction timestamp
    const lastCorrectionAt = corrections.length > 0
      ? corrections.reduce((max, c) => c.timestamp > max ? c.timestamp : max, corrections[0].timestamp)
      : null;

    // Check if compiled is stale
    const isStale = !!(
      lastCorrectionAt &&
      (!compiled || lastCorrectionAt > compiled.compiledAt)
    );

    // Get unique questionnaires
    const questionnairesWithCorrections = [...new Set(corrections.map(c => c.questionnaireId))];

    return {
      customer,
      hasTrainingData: corrections.length > 0,
      correctionsCount: corrections.length,
      lastCorrectionAt,
      compiledAt: compiled?.compiledAt || null,
      isStale,
      questionnairesWithCorrections,
    };
  }

  /**
   * Get training status for all customers
   */
  async getAllStatus(): Promise<StructureTrainingStatus[]> {
    const statuses: StructureTrainingStatus[] = [];

    if (!existsSync(this.customersDir)) {
      return statuses;
    }

    const entries = await readdir(this.customersDir, { withFileTypes: true });
    const customers = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    for (const customer of customers) {
      const status = await this.getStatus(customer);
      if (status.hasTrainingData) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * Compile structure training data for a customer
   */
  async compile(customer: string): Promise<CompiledStructureTraining> {
    const correctionsPath = join(this.customersDir, customer, 'structure-corrections.json');
    const compiledPath = join(this.customersDir, customer, 'compiled-structure-training.json');

    // Load corrections
    let corrections: StructureCorrection[] = [];
    if (existsSync(correctionsPath)) {
      const content = await readFile(correctionsPath, 'utf-8');
      corrections = JSON.parse(content);
    }

    // Classify corrections
    const ocrFixes: StructureCorrection[] = [];
    const contentAdditions: StructureCorrection[] = [];
    const contentRemovals: StructureCorrection[] = [];

    for (const c of corrections) {
      const origLen = c.original.trim().length;
      const corrLen = c.corrected.trim().length;

      if (origLen === 0 && corrLen > 0) {
        // Content was missing, now added
        contentAdditions.push(c);
      } else if (origLen > 0 && corrLen === 0) {
        // Content was incorrect, removed
        contentRemovals.push(c);
      } else {
        // Text was changed - likely OCR fix
        ocrFixes.push(c);
      }
    }

    // Build OCR patterns from repeated corrections
    const ocrPatternMap = new Map<string, {
      correction: string;
      count: number;
      examples: OCRPattern['examples'];
    }>();

    for (const c of ocrFixes) {
      // Find the specific difference (for short texts)
      const diff = this.findDifference(c.original, c.corrected);
      if (diff) {
        const key = `${diff.wrong}→${diff.right}`;
        const existing = ocrPatternMap.get(key) || {
          correction: diff.right,
          count: 0,
          examples: [],
        };
        existing.count++;
        if (existing.examples.length < 5) {
          existing.examples.push({
            questionnaire: c.questionnaireId,
            cell: c.cellRef,
            fullOriginal: c.original,
            fullCorrected: c.corrected,
          });
        }
        ocrPatternMap.set(key, existing);
      }
    }

    // Convert to OCR patterns
    const ocrPatterns: OCRPattern[] = [];
    for (const [key, data] of ocrPatternMap) {
      const [wrongPattern] = key.split('→');
      ocrPatterns.push({
        wrongPattern,
        correction: data.correction,
        count: data.count,
        examples: data.examples,
        confidence: Math.min(data.count / 3, 1), // 3+ occurrences = high confidence
      });
    }

    // Sort by count (most common first)
    ocrPatterns.sort((a, b) => b.count - a.count);

    // Build cell patterns
    const cellPatternMap = new Map<string, {
      rowNums: number[];
      correctionType: CellPattern['correctionType'];
      count: number;
    }>();

    for (const c of corrections) {
      // Extract column from cell ref (e.g., "B10" → "B")
      const colMatch = c.cellRef.match(/^([A-Z]+)/);
      if (colMatch) {
        const col = colMatch[1];
        const type = contentAdditions.includes(c) ? 'content_add' :
                     contentRemovals.includes(c) ? 'content_remove' : 'ocr_fix';
        const key = `${col}:${type}`;
        const existing = cellPatternMap.get(key) || {
          rowNums: [],
          correctionType: type,
          count: 0,
        };
        existing.rowNums.push(c.rowNum);
        existing.count++;
        cellPatternMap.set(key, existing);
      }
    }

    // Convert to cell patterns
    const cellPatterns: CellPattern[] = [];
    for (const [key, data] of cellPatternMap) {
      const [col] = key.split(':');
      const minRow = Math.min(...data.rowNums);
      const maxRow = Math.max(...data.rowNums);
      cellPatterns.push({
        cellPattern: `${col}*`,
        rowRange: data.rowNums.length > 1 ? { min: minRow, max: maxRow } : undefined,
        correctionType: data.correctionType,
        count: data.count,
      });
    }

    // Build substitution rules (exact replacements that appear multiple times)
    const substitutionMap = new Map<string, number>();
    for (const c of ocrFixes) {
      if (c.original.length < 50 && c.corrected.length < 50) {
        const key = `${c.original}|||${c.corrected}`;
        substitutionMap.set(key, (substitutionMap.get(key) || 0) + 1);
      }
    }

    const substitutionRules: CompiledStructureTraining['substitutionRules'] = [];
    for (const [key, count] of substitutionMap) {
      if (count >= 2) { // At least 2 occurrences
        const [find, replace] = key.split('|||');
        substitutionRules.push({
          find,
          replace,
          count,
          source: 'human_correction',
        });
      }
    }

    // Sort by count
    substitutionRules.sort((a, b) => b.count - a.count);

    // Find unique questionnaires
    const questionnairesUsed = [...new Set(corrections.map(c => c.questionnaireId))].length;

    // Find last correction timestamp
    const lastCorrectionAt = corrections.length > 0
      ? corrections.reduce((max, c) => c.timestamp > max ? c.timestamp : max, corrections[0].timestamp)
      : new Date().toISOString();

    const compiled: CompiledStructureTraining = {
      version: '1.0',
      compiledAt: new Date().toISOString(),
      customer,
      stats: {
        totalCorrections: corrections.length,
        ocrFixes: ocrFixes.length,
        contentAdditions: contentAdditions.length,
        contentRemovals: contentRemovals.length,
        questionnairesUsed,
        lastCorrectionAt,
      },
      ocrPatterns,
      cellPatterns,
      substitutionRules,
    };

    // Save compiled training
    await writeFile(compiledPath, JSON.stringify(compiled, null, 2), 'utf-8');

    console.log(`✅ Compiled structure training data for ${customer}:`);
    console.log(`   - ${compiled.stats.totalCorrections} corrections`);
    console.log(`   - ${compiled.stats.ocrFixes} OCR fixes`);
    console.log(`   - ${compiled.stats.contentAdditions} content additions`);
    console.log(`   - ${compiled.stats.contentRemovals} content removals`);
    console.log(`   - ${ocrPatterns.length} OCR patterns`);
    console.log(`   - ${substitutionRules.length} substitution rules`);

    return compiled;
  }

  /**
   * Load compiled structure training for a customer
   */
  async loadCompiled(customer: string): Promise<CompiledStructureTraining | null> {
    const compiledPath = join(this.customersDir, customer, 'compiled-structure-training.json');

    if (!existsSync(compiledPath)) {
      return null;
    }

    try {
      const content = await readFile(compiledPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Apply compiled training to correct extracted text
   */
  applyCorrections(text: string, training: CompiledStructureTraining): {
    corrected: string;
    changes: Array<{ from: string; to: string; rule: string }>;
  } {
    let corrected = text;
    const changes: Array<{ from: string; to: string; rule: string }> = [];

    // Apply substitution rules (highest confidence, exact matches)
    for (const rule of training.substitutionRules) {
      if (corrected.includes(rule.find)) {
        const from = rule.find;
        corrected = corrected.replace(new RegExp(this.escapeRegex(rule.find), 'g'), rule.replace);
        changes.push({ from, to: rule.replace, rule: `substitution:${rule.count}x` });
      }
    }

    // Apply high-confidence OCR patterns
    for (const pattern of training.ocrPatterns) {
      if (pattern.confidence >= 0.7 && corrected.includes(pattern.wrongPattern)) {
        const from = pattern.wrongPattern;
        corrected = corrected.replace(
          new RegExp(this.escapeRegex(pattern.wrongPattern), 'g'),
          pattern.correction
        );
        changes.push({ from, to: pattern.correction, rule: `ocr_pattern:${pattern.count}x` });
      }
    }

    return { corrected, changes };
  }

  /**
   * Find the minimal difference between two strings
   */
  private findDifference(original: string, corrected: string): { wrong: string; right: string } | null {
    // Simple case: find common prefix and suffix
    let prefixLen = 0;
    while (prefixLen < original.length && prefixLen < corrected.length &&
           original[prefixLen] === corrected[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (suffixLen < original.length - prefixLen &&
           suffixLen < corrected.length - prefixLen &&
           original[original.length - 1 - suffixLen] === corrected[corrected.length - 1 - suffixLen]) {
      suffixLen++;
    }

    const wrong = original.slice(prefixLen, original.length - suffixLen);
    const right = corrected.slice(prefixLen, corrected.length - suffixLen);

    // Only return if the difference is reasonable (not entire string)
    if (wrong.length > 0 && wrong.length < original.length * 0.5) {
      return { wrong, right };
    }

    return null;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Singleton instance
export const structureTrainingProcessor = new StructureTrainingProcessor();
