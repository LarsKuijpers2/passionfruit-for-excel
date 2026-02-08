/**
 * Rules Manager
 *
 * Loads and applies review rules to INDEX and HARVEST steps.
 * Rules are generated from human feedback in the review interface.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';

// =============================================================================
// TYPES
// =============================================================================

export interface ExcludeRule {
  label: string;
  cells?: string;
  topic?: string;
  reason?: string;
  reviewedAt?: string;
}

export interface CorrectionRule {
  match: {
    label: string;
    cells?: string;
    topic?: string;
  };
  correct: {
    label?: string;
    value?: string;
  };
  reviewedAt?: string;
}

export interface IndexRules {
  version: string;
  updatedAt?: string;
  exclude: ExcludeRule[];
  corrections: CorrectionRule[];
}

export interface HarvestRules {
  version: string;
  updatedAt?: string;
  exclude: ExcludeRule[];
  corrections: CorrectionRule[];
}

// =============================================================================
// RULES MANAGER
// =============================================================================

export class RulesManager {
  private rulesDir: string;
  private indexRules: IndexRules | null = null;
  private harvestRules: HarvestRules | null = null;

  constructor(rulesDir: string = './rules') {
    this.rulesDir = rulesDir;
  }

  /**
   * Load index rules
   */
  async loadIndexRules(): Promise<IndexRules> {
    if (this.indexRules) return this.indexRules;

    const filepath = `${this.rulesDir}/index-rules.yaml`;

    if (!existsSync(filepath)) {
      this.indexRules = { version: '1.0', exclude: [], corrections: [] };
      return this.indexRules;
    }

    try {
      const content = await readFile(filepath, 'utf-8');
      this.indexRules = parseYaml(content) as IndexRules;

      // Ensure arrays exist
      this.indexRules.exclude = this.indexRules.exclude || [];
      this.indexRules.corrections = this.indexRules.corrections || [];

      return this.indexRules;
    } catch (error) {
      console.warn(`Failed to load index rules: ${error}`);
      this.indexRules = { version: '1.0', exclude: [], corrections: [] };
      return this.indexRules;
    }
  }

  /**
   * Load harvest rules
   */
  async loadHarvestRules(): Promise<HarvestRules> {
    if (this.harvestRules) return this.harvestRules;

    const filepath = `${this.rulesDir}/harvest-rules.yaml`;

    if (!existsSync(filepath)) {
      this.harvestRules = { version: '1.0', exclude: [], corrections: [] };
      return this.harvestRules;
    }

    try {
      const content = await readFile(filepath, 'utf-8');
      this.harvestRules = parseYaml(content) as HarvestRules;

      // Ensure arrays exist
      this.harvestRules.exclude = this.harvestRules.exclude || [];
      this.harvestRules.corrections = this.harvestRules.corrections || [];

      return this.harvestRules;
    } catch (error) {
      console.warn(`Failed to load harvest rules: ${error}`);
      this.harvestRules = { version: '1.0', exclude: [], corrections: [] };
      return this.harvestRules;
    }
  }

  /**
   * Check if an item should be excluded from INDEX
   */
  shouldExcludeFromIndex(item: { label: string; lCell?: string; vCell?: string; ref?: string }): boolean {
    if (!this.indexRules) return false;

    const itemCells = [item.lCell, item.vCell, item.ref].filter(Boolean).join(',');

    for (const rule of this.indexRules.exclude) {
      // Match by label (case-insensitive, partial match)
      const labelMatch = this.normalizeForMatching(item.label).includes(
        this.normalizeForMatching(rule.label)
      );

      // Match by cells if specified
      const cellsMatch = !rule.cells || this.cellsOverlap(itemCells, rule.cells);

      if (labelMatch && cellsMatch) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an item should be excluded from HARVEST
   */
  shouldExcludeFromHarvest(item: { label: string; topic?: string }): boolean {
    if (!this.harvestRules) return false;

    for (const rule of this.harvestRules.exclude) {
      // Match by label
      const labelMatch = this.normalizeForMatching(item.label).includes(
        this.normalizeForMatching(rule.label)
      );

      // Match by topic if specified
      const topicMatch = !rule.topic || item.topic === rule.topic;

      if (labelMatch && topicMatch) {
        return true;
      }
    }

    return false;
  }

  /**
   * Apply corrections to an indexed item
   */
  applyIndexCorrections<T extends { label: string; value?: string; lCell?: string; vCell?: string }>(
    item: T
  ): T {
    if (!this.indexRules) return item;

    const itemCells = [item.lCell, item.vCell].filter(Boolean).join(',');

    for (const rule of this.indexRules.corrections) {
      // Match by label
      const labelMatch = this.normalizeForMatching(item.label).includes(
        this.normalizeForMatching(rule.match.label)
      );

      // Match by cells if specified
      const cellsMatch = !rule.match.cells || this.cellsOverlap(itemCells, rule.match.cells);

      if (labelMatch && cellsMatch) {
        // Apply corrections
        const corrected = { ...item };
        if (rule.correct.label) corrected.label = rule.correct.label;
        if (rule.correct.value) corrected.value = rule.correct.value;
        return corrected;
      }
    }

    return item;
  }

  /**
   * Apply corrections to a harvested item
   */
  applyHarvestCorrections<T extends { label: string; value: string; topic: string }>(
    item: T
  ): T {
    if (!this.harvestRules) return item;

    for (const rule of this.harvestRules.corrections) {
      // Match by label
      const labelMatch = this.normalizeForMatching(item.label).includes(
        this.normalizeForMatching(rule.match.label)
      );

      // Match by topic if specified
      const topicMatch = !rule.match.topic || item.topic === rule.match.topic;

      if (labelMatch && topicMatch) {
        // Apply corrections
        const corrected = { ...item };
        if (rule.correct.label) corrected.label = rule.correct.label;
        if (rule.correct.value) corrected.value = rule.correct.value;
        return corrected;
      }
    }

    return item;
  }

  /**
   * Get stats about loaded rules
   */
  getStats(): { index: { exclude: number; corrections: number }; harvest: { exclude: number; corrections: number } } {
    return {
      index: {
        exclude: this.indexRules?.exclude.length || 0,
        corrections: this.indexRules?.corrections.length || 0,
      },
      harvest: {
        exclude: this.harvestRules?.exclude.length || 0,
        corrections: this.harvestRules?.corrections.length || 0,
      },
    };
  }

  /**
   * Normalize text for matching
   */
  private normalizeForMatching(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if two cell references overlap
   */
  private cellsOverlap(cells1: string, cells2: string): boolean {
    if (!cells1 || !cells2) return false;

    const arr1 = cells1.split(',').map(c => c.trim());
    const set2 = new Set(cells2.split(',').map(c => c.trim()));

    for (let i = 0; i < arr1.length; i++) {
      if (set2.has(arr1[i])) return true;
    }

    return false;
  }
}
