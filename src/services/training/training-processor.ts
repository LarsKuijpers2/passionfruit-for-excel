/**
 * Training Processor
 *
 * Compiles human corrections into training patterns for the indexer.
 * Human-reviewed corrections are the ground truth.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Types for training data
export interface TrainingCorrection {
  itemId: string;
  questionnaireId: string;
  original: {
    destination?: string;
    value?: string;
    label?: string;
  };
  corrected: {
    destination?: string;
    value?: string;
    needs_review?: boolean;
    tag_source?: string;
    note?: string;
  };
  context: {
    label: string;
    lCell?: string;
    vCell?: string;
    section?: string;
  };
  timestamp: string;
}

export interface DestinationPattern {
  pattern: string;           // Label pattern (regex or exact)
  section?: string;          // Section context
  fromDestination: string;   // Original destination
  toDestination: string;     // Corrected destination
  confidence: number;        // Based on # of corrections
  examples: string[];        // Example labels
  notes: string[];           // Human explanations
}

export interface CompiledTraining {
  version: string;
  compiledAt: string;
  customer: string;
  stats: {
    totalCorrections: number;
    destinationChanges: number;
    valueChanges: number;
    questionnairesUsed: number;
    lastCorrectionAt: string;
  };
  destinationPatterns: DestinationPattern[];
  fewShotExamples: Array<{
    context: string;
    label: string;
    section: string;
    originalDestination: string;
    correctDestination: string;
    reasoning: string;
  }>;
  // Labels that should ALWAYS go to specific destinations
  hardRules: Array<{
    labelContains: string;
    destination: string;
    source: 'human_correction';
  }>;
}

export interface TrainingStatus {
  customer: string;
  hasTrainingData: boolean;
  correctionsCount: number;
  lastCorrectionAt: string | null;
  compiledAt: string | null;
  isStale: boolean;  // corrections newer than compiled
  questionnairesWithCorrections: string[];
}

export class TrainingProcessor {
  private customersDir: string;

  constructor(customersDir: string = './customers') {
    this.customersDir = customersDir;
  }

  /**
   * Get training status for a customer
   */
  async getStatus(customer: string): Promise<TrainingStatus> {
    const correctionsPath = join(this.customersDir, customer, 'training-corrections.json');
    const compiledPath = join(this.customersDir, customer, 'compiled-training.json');

    let corrections: TrainingCorrection[] = [];
    let compiled: CompiledTraining | null = null;

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
  async getAllStatus(): Promise<TrainingStatus[]> {
    const statuses: TrainingStatus[] = [];

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
   * Compile training data for a customer
   */
  async compile(customer: string): Promise<CompiledTraining> {
    const correctionsPath = join(this.customersDir, customer, 'training-corrections.json');
    const compiledPath = join(this.customersDir, customer, 'compiled-training.json');

    // Load corrections
    let corrections: TrainingCorrection[] = [];
    if (existsSync(correctionsPath)) {
      const content = await readFile(correctionsPath, 'utf-8');
      corrections = JSON.parse(content);
    }

    // Analyze destination changes
    const destinationChanges = corrections.filter(c =>
      c.original.destination && c.corrected.destination &&
      c.original.destination !== c.corrected.destination
    );

    // Build destination patterns
    const patternMap = new Map<string, {
      fromDestination: string;
      toDestination: string;
      labels: string[];
      sections: string[];
      notes: string[];
    }>();

    for (const c of destinationChanges) {
      const key = `${c.original.destination}→${c.corrected.destination}`;
      const existing = patternMap.get(key) || {
        fromDestination: c.original.destination!,
        toDestination: c.corrected.destination!,
        labels: [],
        sections: [],
        notes: [],
      };

      existing.labels.push(c.context.label);
      if (c.context.section) existing.sections.push(c.context.section);
      if (c.corrected.note) existing.notes.push(c.corrected.note);

      patternMap.set(key, existing);
    }

    // Convert to patterns
    const destinationPatterns: DestinationPattern[] = [];
    for (const [, data] of patternMap) {
      // Find common words in labels for pattern
      const commonPattern = this.findCommonPattern(data.labels);

      destinationPatterns.push({
        pattern: commonPattern,
        section: data.sections.length > 0 ? this.mostCommon(data.sections) : undefined,
        fromDestination: data.fromDestination,
        toDestination: data.toDestination,
        confidence: Math.min(data.labels.length / 5, 1), // More examples = higher confidence
        examples: data.labels.slice(0, 5),
        notes: [...new Set(data.notes)],
      });
    }

    // Generate few-shot examples (most informative corrections)
    const fewShotExamples = destinationChanges
      .filter(c => c.corrected.note) // Prefer ones with notes
      .slice(0, 20)
      .map(c => ({
        context: `Section: ${c.context.section || 'Unknown'}`,
        label: c.context.label,
        section: c.context.section || 'Unknown',
        originalDestination: c.original.destination!,
        correctDestination: c.corrected.destination!,
        reasoning: c.corrected.note || 'Human corrected',
      }));

    // Add examples without notes if we don't have enough
    if (fewShotExamples.length < 10) {
      const additionalExamples = destinationChanges
        .filter(c => !c.corrected.note)
        .slice(0, 10 - fewShotExamples.length)
        .map(c => ({
          context: `Section: ${c.context.section || 'Unknown'}`,
          label: c.context.label,
          section: c.context.section || 'Unknown',
          originalDestination: c.original.destination!,
          correctDestination: c.corrected.destination!,
          reasoning: 'Human corrected',
        }));
      fewShotExamples.push(...additionalExamples);
    }

    // Build hard rules from repeated patterns
    const hardRules: CompiledTraining['hardRules'] = [];
    const labelDestinationCounts = new Map<string, Map<string, number>>();

    for (const c of corrections) {
      if (!c.corrected.destination) continue;

      const label = c.context.label.toLowerCase();
      if (!labelDestinationCounts.has(label)) {
        labelDestinationCounts.set(label, new Map());
      }
      const destCounts = labelDestinationCounts.get(label)!;
      destCounts.set(c.corrected.destination, (destCounts.get(c.corrected.destination) || 0) + 1);
    }

    // Labels corrected to same destination 3+ times become hard rules
    for (const [label, destCounts] of labelDestinationCounts) {
      for (const [dest, count] of destCounts) {
        if (count >= 3) {
          hardRules.push({
            labelContains: label,
            destination: dest,
            source: 'human_correction',
          });
        }
      }
    }

    // Find unique questionnaires
    const questionnairesUsed = [...new Set(corrections.map(c => c.questionnaireId))].length;

    // Find last correction timestamp
    const lastCorrectionAt = corrections.length > 0
      ? corrections.reduce((max, c) => c.timestamp > max ? c.timestamp : max, corrections[0].timestamp)
      : new Date().toISOString();

    const compiled: CompiledTraining = {
      version: '1.0',
      compiledAt: new Date().toISOString(),
      customer,
      stats: {
        totalCorrections: corrections.length,
        destinationChanges: destinationChanges.length,
        valueChanges: corrections.filter(c => c.corrected.value !== undefined).length,
        questionnairesUsed,
        lastCorrectionAt,
      },
      destinationPatterns,
      fewShotExamples,
      hardRules,
    };

    // Save compiled training
    await writeFile(compiledPath, JSON.stringify(compiled, null, 2), 'utf-8');

    console.log(`✅ Compiled training data for ${customer}:`);
    console.log(`   - ${compiled.stats.totalCorrections} corrections`);
    console.log(`   - ${destinationPatterns.length} destination patterns`);
    console.log(`   - ${fewShotExamples.length} few-shot examples`);
    console.log(`   - ${hardRules.length} hard rules`);

    return compiled;
  }

  /**
   * Load compiled training for a customer (for use in indexer)
   */
  async loadCompiled(customer: string): Promise<CompiledTraining | null> {
    const compiledPath = join(this.customersDir, customer, 'compiled-training.json');

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
   * Find common pattern in a list of labels
   */
  private findCommonPattern(labels: string[]): string {
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];

    // Find common prefix
    const sortedLabels = [...labels].sort();
    const first = sortedLabels[0];
    const last = sortedLabels[sortedLabels.length - 1];

    let commonPrefix = '';
    for (let i = 0; i < first.length && i < last.length; i++) {
      if (first[i] === last[i]) {
        commonPrefix += first[i];
      } else {
        break;
      }
    }

    // If common prefix is meaningful (> 10 chars), use it
    if (commonPrefix.length > 10) {
      return commonPrefix.trim() + '...';
    }

    // Otherwise find common words
    const wordSets = labels.map(l =>
      new Set(l.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    );

    const commonWords = [...wordSets[0]].filter(word =>
      wordSets.every(set => set.has(word))
    );

    if (commonWords.length > 0) {
      return `*${commonWords.join('*')}*`;
    }

    return labels[0]; // Fallback to first label
  }

  /**
   * Find most common element in array
   */
  private mostCommon<T>(arr: T[]): T {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let maxItem = arr[0];
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        maxItem = item;
      }
    }
    return maxItem;
  }
}

// Singleton instance
export const trainingProcessor = new TrainingProcessor();
