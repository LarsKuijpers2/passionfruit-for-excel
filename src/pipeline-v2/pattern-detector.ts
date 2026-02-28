/**
 * Pattern Detector
 *
 * Matches table structures against known patterns from table-patterns.json
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

// =============================================================================
// TYPES
// =============================================================================

export interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  frequency: string;
  languages: string[];
  detection: {
    headerKeywords?: string[];
    headerKeywordsMatchCount?: number;
    columnCount?: { min: number; max: number };
    noCheckboxHeaders?: boolean;
    hasMergedCells?: boolean;
    matrixStructure?: boolean;
  };
  columns: Record<string, unknown>;
  extraction: Record<string, unknown>;
  examples: string[];
}

export interface PatternLibrary {
  version: string;
  patterns: PatternDefinition[];
  detectionPriority: string[];
  languageDetection: Record<string, { keywords: string[]; yesNo: Record<string, string> }>;
  documentMappings: Record<string, string>;
}

export interface TableInfo {
  id: string;
  headers: string[];
  columnCount: number;
  hasMergedCells: boolean;
  rowCount: number;
}

export interface PatternMatch {
  patternId: string;
  patternName: string;
  confidence: number;
  matchDetails: string[];
  extraction: Record<string, unknown>;
}

export interface DetectionResult {
  table: TableInfo;
  match: PatternMatch | null;
  language: string;
  suggestions: string[];
}

// =============================================================================
// PATTERN DETECTOR
// =============================================================================

export class PatternDetector {
  private library: PatternLibrary | null = null;

  /**
   * Load pattern library from file
   */
  async load(path: string = './knowledge/table-patterns.json'): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`Pattern library not found: ${path}`);
    }
    const content = await readFile(path, 'utf-8');
    this.library = JSON.parse(content);
  }

  /**
   * Detect pattern for a table
   */
  detect(table: TableInfo): DetectionResult {
    if (!this.library) {
      throw new Error('Pattern library not loaded. Call load() first.');
    }

    const headersLower = table.headers.map(h => h.toLowerCase());
    const headersJoined = headersLower.join(' ');

    // Try each pattern in priority order
    let bestMatch: PatternMatch | null = null;

    for (const patternId of this.library.detectionPriority) {
      const pattern = this.library.patterns.find(p => p.id === patternId);
      if (!pattern) continue;

      const match = this.matchPattern(table, pattern, headersLower, headersJoined);
      if (match && (!bestMatch || match.confidence > bestMatch.confidence)) {
        bestMatch = match;
      }
    }

    // Detect language
    const language = this.detectLanguage(headersLower);

    // Generate suggestions if no match
    const suggestions: string[] = [];
    if (!bestMatch) {
      suggestions.push(`Headers: ${table.headers.slice(0, 4).join(' | ')}`);
      suggestions.push(`Column count: ${table.columnCount}`);
      suggestions.push('Consider adding a new pattern to table-patterns.json');
    }

    return {
      table,
      match: bestMatch,
      language,
      suggestions,
    };
  }

  /**
   * Detect patterns for multiple tables
   */
  detectAll(tables: TableInfo[]): DetectionResult[] {
    return tables.map(t => this.detect(t));
  }

  /**
   * Get statistics about detection results
   */
  getStats(results: DetectionResult[]): {
    total: number;
    matched: number;
    matchRate: number;
    byPattern: Record<string, number>;
    unmatched: Array<{ headers: string[]; columnCount: number }>;
  } {
    const byPattern: Record<string, number> = {};
    const unmatched: Array<{ headers: string[]; columnCount: number }> = [];

    for (const result of results) {
      if (result.match) {
        byPattern[result.match.patternId] = (byPattern[result.match.patternId] || 0) + 1;
      } else {
        unmatched.push({
          headers: result.table.headers,
          columnCount: result.table.columnCount,
        });
      }
    }

    const matched = results.filter(r => r.match).length;

    return {
      total: results.length,
      matched,
      matchRate: results.length > 0 ? Math.round((matched / results.length) * 100) : 0,
      byPattern,
      unmatched: unmatched.slice(0, 10),
    };
  }

  /**
   * Get pattern by ID
   */
  getPattern(patternId: string): PatternDefinition | undefined {
    return this.library?.patterns.find(p => p.id === patternId);
  }

  /**
   * Get all patterns
   */
  getPatterns(): PatternDefinition[] {
    return this.library?.patterns || [];
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private matchPattern(
    table: TableInfo,
    pattern: PatternDefinition,
    headersLower: string[],
    headersJoined: string
  ): PatternMatch | null {
    let score = 0;
    const details: string[] = [];

    // Check column count
    if (pattern.detection.columnCount) {
      const { min, max } = pattern.detection.columnCount;
      if (table.columnCount < min || table.columnCount > max) {
        return null; // Hard fail
      }
      score += 20;
      details.push(`Column count ${table.columnCount} in range [${min}-${max}]`);
    }

    // Check header keywords
    if (pattern.detection.headerKeywords) {
      const keywords = pattern.detection.headerKeywords.map(k => k.toLowerCase());
      const matchedKeywords: string[] = [];

      for (const kw of keywords) {
        if (headersLower.some(h => h.includes(kw)) || headersJoined.includes(kw)) {
          matchedKeywords.push(kw);
        }
      }

      const required = pattern.detection.headerKeywordsMatchCount || 1;
      if (matchedKeywords.length < required) {
        return null; // Hard fail
      }

      score += matchedKeywords.length * 15;
      details.push(`Matched keywords: ${matchedKeywords.join(', ')}`);
    }

    // Check noCheckboxHeaders
    if (pattern.detection.noCheckboxHeaders) {
      const checkboxKeywords = ['yes', 'no', 'ja', 'nein', 'oui', 'non', 'nee', 'n/a'];
      const hasCheckbox = headersLower.some(h => checkboxKeywords.includes(h.trim()));
      if (hasCheckbox) {
        return null; // Hard fail
      }
      score += 10;
      details.push('No checkbox headers');
    }

    // Check merged cells
    if (pattern.detection.hasMergedCells !== undefined) {
      if (pattern.detection.hasMergedCells === table.hasMergedCells) {
        score += 10;
        details.push(`Merged cells: ${table.hasMergedCells}`);
      }
    }

    // Bonus for specific language patterns
    if (pattern.languages.length === 1) {
      score += 5;
    }

    // Normalize confidence to 0-1 range
    const confidence = Math.min(score / 100, 1);

    return {
      patternId: pattern.id,
      patternName: pattern.name,
      confidence,
      matchDetails: details,
      extraction: pattern.extraction,
    };
  }

  private detectLanguage(headersLower: string[]): string {
    if (!this.library) return 'unknown';

    const headersJoined = headersLower.join(' ');
    const scores: Record<string, number> = {};

    for (const [lang, config] of Object.entries(this.library.languageDetection)) {
      scores[lang] = 0;
      for (const kw of config.keywords) {
        if (headersJoined.includes(kw.toLowerCase())) {
          scores[lang]++;
        }
      }
    }

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return 'unknown';

    const [lang] = Object.entries(scores).find(([_, s]) => s === maxScore) || ['unknown'];
    return lang;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load patterns from default location
 */
export async function loadPatterns(): Promise<PatternDetector> {
  const detector = new PatternDetector();
  await detector.load();
  return detector;
}
