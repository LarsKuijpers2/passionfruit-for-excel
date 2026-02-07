/**
 * Source Storage System
 *
 * Stores questionnaire indexes as searchable sources.
 * Used to find and reuse data when filling new questionnaires.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { QuestionnaireIndex, LabeledField } from './questionnaire-index.js';

const DEFAULT_SOURCES_DIR = './sources';

/** Search result from source storage */
export interface SourceSearchResult {
  /** Source questionnaire filename */
  sourceFile: string;
  /** Customer name */
  customer?: string;
  /** Matching fields */
  matches: LabeledField[];
  /** Relevance score */
  score: number;
}

/** Source storage manager */
export class SourceStorage {
  private sourcesDir: string;
  private cache: Map<string, QuestionnaireIndex> = new Map();

  constructor(sourcesDir: string = DEFAULT_SOURCES_DIR) {
    this.sourcesDir = sourcesDir;
  }

  /**
   * Save a questionnaire index as a source
   */
  async save(index: QuestionnaireIndex): Promise<string> {
    await mkdir(this.sourcesDir, { recursive: true });

    // Create filename from source
    const safeName = index.source.filename
      .replace(/\.[^.]+$/, '') // Remove extension
      .replace(/[^a-zA-Z0-9-_]/g, '_'); // Sanitize

    const filename = `${safeName}.yaml`;
    const filepath = join(this.sourcesDir, filename);

    // Convert to YAML and save
    const yaml = stringifyYaml(index, { lineWidth: 0 });
    await writeFile(filepath, yaml, 'utf-8');

    // Update cache
    this.cache.set(filename, index);

    return filepath;
  }

  /**
   * Load a source by filename
   */
  async load(filename: string): Promise<QuestionnaireIndex | null> {
    // Check cache
    if (this.cache.has(filename)) {
      return this.cache.get(filename)!;
    }

    try {
      const filepath = join(this.sourcesDir, filename);
      const content = await readFile(filepath, 'utf-8');
      const index = parseYaml(content) as QuestionnaireIndex;

      // Cache it
      this.cache.set(filename, index);

      return index;
    } catch {
      return null;
    }
  }

  /**
   * Load all sources
   */
  async loadAll(): Promise<QuestionnaireIndex[]> {
    try {
      await mkdir(this.sourcesDir, { recursive: true });
      const files = await readdir(this.sourcesDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));

      const indexes: QuestionnaireIndex[] = [];
      for (const file of yamlFiles) {
        const index = await this.load(file);
        if (index) indexes.push(index);
      }

      return indexes;
    } catch {
      return [];
    }
  }

  /**
   * Search sources for matching content
   */
  async search(query: string): Promise<SourceSearchResult[]> {
    const sources = await this.loadAll();
    const results: SourceSearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const source of sources) {
      const matches: LabeledField[] = [];

      for (const field of source.fields) {
        const questionMatch = field.questionText.toLowerCase().includes(queryLower);
        const answerMatch = field.answerText.toLowerCase().includes(queryLower);
        const topicMatch = field.topic.toLowerCase().includes(queryLower);

        if (questionMatch || answerMatch || topicMatch) {
          matches.push(field);
        }
      }

      if (matches.length > 0) {
        results.push({
          sourceFile: source.source.filename,
          customer: source.source.customer,
          matches,
          score: matches.length,
        });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Search by topic
   */
  async searchByTopic(topic: string): Promise<SourceSearchResult[]> {
    const sources = await this.loadAll();
    const results: SourceSearchResult[] = [];
    const topicLower = topic.toLowerCase();

    for (const source of sources) {
      const matches = source.fields.filter(f =>
        f.topic.toLowerCase().includes(topicLower) && f.isFilled
      );

      if (matches.length > 0) {
        results.push({
          sourceFile: source.source.filename,
          customer: source.source.customer,
          matches,
          score: matches.length,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Search for filled fields by value type
   */
  async searchByValueType(valueType: string): Promise<SourceSearchResult[]> {
    const sources = await this.loadAll();
    const results: SourceSearchResult[] = [];

    for (const source of sources) {
      const matches = source.fields.filter(f =>
        f.valueType === valueType && f.isFilled
      );

      if (matches.length > 0) {
        results.push({
          sourceFile: source.source.filename,
          customer: source.source.customer,
          matches,
          score: matches.length,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get all narratives (Answer Library candidates)
   */
  async getNarratives(): Promise<SourceSearchResult[]> {
    const sources = await this.loadAll();
    const results: SourceSearchResult[] = [];

    for (const source of sources) {
      const matches = source.fields.filter(f => f.isNarrative && f.isFilled);

      if (matches.length > 0) {
        results.push({
          sourceFile: source.source.filename,
          customer: source.source.customer,
          matches,
          score: matches.length,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get summary of all sources
   */
  async getSummary(): Promise<{
    totalSources: number;
    totalFields: number;
    filledFields: number;
    narrativeFields: number;
    topicsCovered: string[];
    sourcesList: Array<{
      filename: string;
      customer?: string;
      fields: number;
      filled: number;
      topics: string[];
    }>;
  }> {
    const sources = await this.loadAll();

    let totalFields = 0;
    let filledFields = 0;
    let narrativeFields = 0;
    const allTopics = new Set<string>();
    const sourcesList: Array<{
      filename: string;
      customer?: string;
      fields: number;
      filled: number;
      topics: string[];
    }> = [];

    for (const source of sources) {
      totalFields += source.summary.totalFields;
      filledFields += source.summary.filledFields;
      narrativeFields += source.summary.narrativeFields;
      source.summary.topicsCovered.forEach(t => allTopics.add(t));

      sourcesList.push({
        filename: source.source.filename,
        customer: source.source.customer,
        fields: source.summary.totalFields,
        filled: source.summary.filledFields,
        topics: source.summary.topicsCovered,
      });
    }

    return {
      totalSources: sources.length,
      totalFields,
      filledFields,
      narrativeFields,
      topicsCovered: [...allTopics].sort(),
      sourcesList,
    };
  }
}
