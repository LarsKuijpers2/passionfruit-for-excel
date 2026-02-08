/**
 * Feedback Store
 *
 * Stores human feedback on extractions for learning.
 * Feedback is used to improve future extraction prompts.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { randomUUID } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export type Verdict = 'correct' | 'wrong' | 'edited' | 'skipped';

export type WrongReason =
  | 'not_a_question'      // This is not a valid item
  | 'wrong_pairing'       // Label matched to wrong value
  | 'should_be_table'     // Should be part of a table, not individual
  | 'wrong_boundaries'    // Section boundaries are wrong
  | 'wrong_topic'         // Classified under wrong topic
  | 'wrong_level'         // standard/narrative/product classification wrong
  | 'wrong_type'          // Item type (field/text/yesno etc) wrong
  | 'duplicate'           // Already captured elsewhere
  | 'irrelevant'          // Not useful to extract
  | 'other';

export interface ExtractionFeedback {
  id: string;

  // Source info
  source: {
    file: string;
    sheet: string;
    cells: string;  // e.g., "A10" or "A10:E25" for tables
  };

  // What was extracted
  extracted: {
    type: string;  // field, text, yesno, table, etc.
    label: string;
    value?: string;
    topic: string;
    level: string;  // standard, narrative, product
  };

  // Human feedback
  verdict: Verdict;

  // If edited, the corrected version
  corrected?: {
    type?: string;
    label?: string;
    value?: string;
    topic?: string;
    level?: string;
  };

  // If wrong, the reason
  wrongReason?: WrongReason;
  wrongNote?: string;

  // Metadata
  reviewer?: string;
  reviewedAt: string;
}

export interface SectionFeedback {
  id: string;

  // Source
  source: {
    file: string;
    sheet: string;
  };

  // Detected section
  detected: {
    title: string;
    rows: string;  // e.g., "8-17"
    topic?: string;
  };

  // Feedback
  verdict: Verdict;

  // If edited
  corrected?: {
    title?: string;
    rows?: string;
    topic?: string;
  };

  wrongReason?: 'wrong_boundaries' | 'not_a_section' | 'merge_with_other' | 'split_needed' | 'other';
  wrongNote?: string;

  reviewedAt: string;
}

export interface FeedbackStore {
  version: string;
  updatedAt: string;

  // Section-level feedback
  sections: SectionFeedback[];

  // Extraction-level feedback
  extractions: ExtractionFeedback[];

  // Summary stats
  stats: {
    totalReviewed: number;
    correct: number;
    wrong: number;
    edited: number;
    skipped: number;
  };
}

// =============================================================================
// FEEDBACK MANAGER
// =============================================================================

export class FeedbackManager {
  private storePath: string;
  private store: FeedbackStore | null = null;

  constructor(storePath: string = './feedback/feedback.yaml') {
    this.storePath = storePath;
  }

  /**
   * Load or create feedback store
   */
  async load(): Promise<FeedbackStore> {
    if (this.store) return this.store;

    try {
      const content = await readFile(this.storePath, 'utf-8');
      this.store = parseYaml(content);
    } catch {
      // Create new store
      this.store = {
        version: '2.0',
        updatedAt: new Date().toISOString(),
        sections: [],
        extractions: [],
        stats: {
          totalReviewed: 0,
          correct: 0,
          wrong: 0,
          edited: 0,
          skipped: 0,
        },
      };
    }

    return this.store!;
  }

  /**
   * Save feedback store
   */
  async save(): Promise<void> {
    if (!this.store) return;

    this.store.updatedAt = new Date().toISOString();

    // Ensure directory exists
    const dir = join(this.storePath, '..');
    await mkdir(dir, { recursive: true });

    await writeFile(this.storePath, stringifyYaml(this.store, { lineWidth: 0 }), 'utf-8');
  }

  /**
   * Add section feedback
   */
  async addSectionFeedback(feedback: Omit<SectionFeedback, 'id' | 'reviewedAt'>): Promise<string> {
    const store = await this.load();

    const id = randomUUID().split('-')[0];
    const full: SectionFeedback = {
      ...feedback,
      id,
      reviewedAt: new Date().toISOString().split('T')[0],
    };

    store.sections.push(full);
    this.updateStats(feedback.verdict);

    await this.save();
    return id;
  }

  /**
   * Add extraction feedback
   */
  async addExtractionFeedback(feedback: Omit<ExtractionFeedback, 'id' | 'reviewedAt'>): Promise<string> {
    const store = await this.load();

    const id = randomUUID().split('-')[0];
    const full: ExtractionFeedback = {
      ...feedback,
      id,
      reviewedAt: new Date().toISOString().split('T')[0],
    };

    store.extractions.push(full);
    this.updateStats(feedback.verdict);

    await this.save();
    return id;
  }

  /**
   * Update stats
   */
  private updateStats(verdict: Verdict): void {
    if (!this.store) return;

    this.store.stats.totalReviewed++;

    switch (verdict) {
      case 'correct':
        this.store.stats.correct++;
        break;
      case 'wrong':
        this.store.stats.wrong++;
        break;
      case 'edited':
        this.store.stats.edited++;
        break;
      case 'skipped':
        this.store.stats.skipped++;
        break;
    }
  }

  /**
   * Get gold examples (correct + edited) for prompts
   */
  async getGoldExamples(limit: number = 10): Promise<ExtractionFeedback[]> {
    const store = await this.load();

    return store.extractions
      .filter(e => e.verdict === 'correct' || e.verdict === 'edited')
      .slice(-limit);  // Most recent
  }

  /**
   * Get negative examples for prompts
   */
  async getNegativeExamples(limit: number = 5): Promise<ExtractionFeedback[]> {
    const store = await this.load();

    return store.extractions
      .filter(e => e.verdict === 'wrong')
      .slice(-limit);
  }

  /**
   * Get examples for a specific topic
   */
  async getExamplesForTopic(topic: string, limit: number = 5): Promise<ExtractionFeedback[]> {
    const store = await this.load();

    return store.extractions
      .filter(e =>
        (e.verdict === 'correct' || e.verdict === 'edited') &&
        (e.extracted.topic === topic || e.corrected?.topic === topic)
      )
      .slice(-limit);
  }

  /**
   * Get stats
   */
  async getStats(): Promise<FeedbackStore['stats']> {
    const store = await this.load();
    return store.stats;
  }

  /**
   * Check if already reviewed
   */
  async isReviewed(file: string, sheet: string, cells: string): Promise<boolean> {
    const store = await this.load();

    return store.extractions.some(e =>
      e.source.file === file &&
      e.source.sheet === sheet &&
      e.source.cells === cells
    );
  }
}
