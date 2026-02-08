/**
 * Answer Harvester
 *
 * Extracts standard + narrative level items for the reusable answer library.
 * These are company-wide answers that can be auto-filled in future questionnaires.
 *
 * This is where translations and enrichment happen (not in INDEX).
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { randomUUID } from 'crypto';
import type { IndexedQuestionnaire, IndexedItem, IndexedSection, Language } from './questionnaire-indexer.js';
import type { ItemType, ItemLevel } from './visual-analyzer.js';
import { RulesManager } from './rules/rules-manager.js';

// =============================================================================
// TYPES
// =============================================================================

/** A harvested item for the answer library */
export interface HarvestedItem {
  id: string;
  type: ItemType;
  /** The label/question */
  label: string;
  /** English translation of label (for matching) */
  labelEN?: string;
  /** The value/answer */
  value: string;
  /** Language of the content */
  lang?: Language;
  /** Normalized topic */
  topic: string;
  /** Level: standard or narrative */
  level: 'standard' | 'narrative';
  /** Source provenance */
  source: {
    file: string;
    lCell: string;
    vCell?: string;
    ref?: string;
    harvestedAt: string;
  };
}

/** The answer library */
export interface AnswerLibrary {
  id: string;
  updated: string;
  total: number;
  /** Items grouped by topic */
  byTopic: Record<string, HarvestedItem[]>;
  /** Source files that contributed */
  sources: string[];
}

// =============================================================================
// ANSWER HARVESTER
// =============================================================================

export class AnswerHarvester {
  private indexedDir: string;
  private libraryPath: string;
  private rulesManager: RulesManager;
  private rulesLoaded: boolean = false;

  constructor(indexedDir: string = './indexed', libraryPath: string = './answer-library.yaml', rulesDir: string = './rules') {
    this.indexedDir = indexedDir;
    this.libraryPath = libraryPath;
    this.rulesManager = new RulesManager(rulesDir);
  }

  /**
   * Harvest reusable items from an indexed questionnaire
   */
  async harvest(indexedFile: string): Promise<HarvestedItem[]> {
    // Load rules once
    if (!this.rulesLoaded) {
      await this.rulesManager.loadHarvestRules();
      const ruleStats = this.rulesManager.getStats();
      if (ruleStats.harvest.exclude > 0 || ruleStats.harvest.corrections > 0) {
        console.log(`  Loaded ${ruleStats.harvest.exclude} exclude + ${ruleStats.harvest.corrections} correction rules`);
      }
      this.rulesLoaded = true;
    }

    const filepath = join(this.indexedDir, indexedFile);
    const content = await readFile(filepath, 'utf-8');
    const indexed: IndexedQuestionnaire = parseYaml(content);

    const harvested: HarvestedItem[] = [];

    for (const section of indexed.sections) {
      for (const item of section.items) {
        // Only harvest standard and narrative items that have values
        if (item.level === 'product' || !item.value) {
          continue;
        }

        // Skip very short values
        if (item.value.trim().length < 1) {
          continue;
        }

        // Check if item should be excluded by rules
        if (this.rulesManager.shouldExcludeFromHarvest({
          label: item.label,
          topic: section.topic,
        })) {
          continue; // Skip excluded items
        }

        let harvestedItem: HarvestedItem = {
          id: randomUUID().split('-')[0],
          type: item.type,
          label: item.label,
          value: item.value,
          lang: item.lang,
          topic: section.topic,
          level: item.level as 'standard' | 'narrative',
          source: {
            file: indexed.source,
            lCell: item.lCell || '',
            vCell: item.vCell,
            ref: item.ref,
            harvestedAt: new Date().toISOString().split('T')[0],
          },
        };

        // Apply corrections from rules
        harvestedItem = this.rulesManager.applyHarvestCorrections(harvestedItem);

        harvested.push(harvestedItem);
      }
    }

    return harvested;
  }

  /**
   * Harvest from all indexed questionnaires and merge into library
   */
  async harvestAll(): Promise<AnswerLibrary> {
    const files = await readdir(this.indexedDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));

    const allItems: HarvestedItem[] = [];
    const sources: string[] = [];

    for (const file of yamlFiles) {
      console.log(`  Harvesting: ${file}...`);
      const harvested = await this.harvest(file);
      allItems.push(...harvested);

      if (harvested.length > 0) {
        const content = await readFile(join(this.indexedDir, file), 'utf-8');
        const indexed: IndexedQuestionnaire = parseYaml(content);
        sources.push(indexed.source);
      }

      console.log(`    Found ${harvested.length} reusable items`);
    }

    // Deduplicate items (same label + similar value = keep first)
    const deduped = this.deduplicateItems(allItems);

    // Group by topic
    const byTopic: Record<string, HarvestedItem[]> = {};
    for (const item of deduped) {
      if (!byTopic[item.topic]) {
        byTopic[item.topic] = [];
      }
      byTopic[item.topic].push(item);
    }

    return {
      id: randomUUID().split('-')[0],
      updated: new Date().toISOString().split('T')[0],
      total: deduped.length,
      byTopic,
      sources,
    };
  }

  /**
   * Deduplicate items - keep first occurrence for similar labels
   */
  private deduplicateItems(items: HarvestedItem[]): HarvestedItem[] {
    const seen = new Map<string, HarvestedItem>();

    for (const item of items) {
      // Create a normalized key for matching
      const key = this.normalizeForMatching(item.label);

      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }

    return Array.from(seen.values());
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
   * Save the answer library
   */
  async saveLibrary(library: AnswerLibrary): Promise<string> {
    const dir = join(this.libraryPath, '..');
    await mkdir(dir, { recursive: true });

    await writeFile(this.libraryPath, stringifyYaml(library, { lineWidth: 0 }), 'utf-8');

    return this.libraryPath;
  }

  /**
   * Load existing library (for merging)
   */
  async loadLibrary(): Promise<AnswerLibrary | null> {
    try {
      const content = await readFile(this.libraryPath, 'utf-8');
      return parseYaml(content);
    } catch {
      return null;
    }
  }
}
