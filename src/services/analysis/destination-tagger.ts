/**
 * Destination Tagger
 *
 * Assigns destinations to indexed items based on rules.
 * Items that don't match any rule get needs_review = true.
 *
 * Flow:
 * 1. Check pattern_overrides (regex on label)
 * 2. Check topic_destinations (topic → destination mapping)
 * 3. No match → needs_review = true
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'yaml';
import { getCustomerPaths, getRulesFile } from '../../utils/customer-paths.js';
import type { CompiledTraining } from '../training/training-processor.js';

// =============================================================================
// TYPES
// =============================================================================

export type Destination = 'company' | 'answer_library' | 'product' | 'exclude';

export interface TagRules {
  version: string;
  pattern_overrides: Array<{
    pattern: string;
    destination: Destination;
  }>;
  topic_destinations: Record<string, Destination>;
}

export interface TaggedItem {
  /** Destination assigned by rules */
  destination: Destination | null;
  /** True if no rule matched - needs human review */
  needs_review: boolean;
  /** Which rule matched: "pattern:<regex>", "topic:<topic>", or "no_match" */
  tag_source: string;
}

export interface IndexedItem {
  type: string;
  label: string;
  value?: string;
  topic?: string;
  level?: string;
  section?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface IndexedQuestionnaire {
  questionnaire: string;
  sourceFile?: string;
  indexedAt?: string;
  sections: Array<{
    title: string;
    topic?: string;
    items: IndexedItem[];
  }>;
}

// =============================================================================
// TRAINING DATA LOADING
// =============================================================================

async function loadCompiledTraining(customer?: string): Promise<CompiledTraining | null> {
  if (!customer) return null;

  const compiledPath = join(process.cwd(), 'customers', customer, 'compiled-training.json');
  if (!existsSync(compiledPath)) {
    return null;
  }

  try {
    const content = await readFile(compiledPath, 'utf-8');
    return JSON.parse(content) as CompiledTraining;
  } catch (error) {
    console.warn(`Failed to load compiled training for ${customer}:`, error);
    return null;
  }
}

// =============================================================================
// RULES LOADING
// =============================================================================

async function loadTagRules(customer?: string): Promise<TagRules> {
  // Try customer-specific rules first
  if (customer) {
    const customerRulesPath = getRulesFile('tag-rules.yaml', customer);
    if (customerRulesPath) {
      try {
        const content = await readFile(customerRulesPath, 'utf-8');
        return yaml.parse(content) as TagRules;
      } catch {
        // Fall through to global rules
      }
    }
  }

  // Load global rules
  const globalRulesPath = join(process.cwd(), 'rules', 'tag-rules.yaml');
  try {
    const content = await readFile(globalRulesPath, 'utf-8');
    return yaml.parse(content) as TagRules;
  } catch (error) {
    console.error('Failed to load tag-rules.yaml:', error);
    // Return minimal default rules
    return {
      version: '1.0',
      pattern_overrides: [],
      topic_destinations: {},
    };
  }
}

// =============================================================================
// TAGGING LOGIC
// =============================================================================

function tagItem(
  item: IndexedItem,
  rules: TagRules,
  training: CompiledTraining | null
): TaggedItem {
  const label = item.label?.toLowerCase() || '';
  const topic = item.topic?.toLowerCase() || '';

  // 1. Check hard rules from compiled training (HIGHEST PRIORITY - human corrections)
  // Hard rules are created when a label has been corrected to same destination 3+ times
  if (training?.hardRules) {
    for (const rule of training.hardRules) {
      if (label.includes(rule.labelContains.toLowerCase())) {
        return {
          destination: rule.destination as Destination,
          needs_review: false,
          tag_source: `training:hard_rule:${rule.labelContains}`,
        };
      }
    }
  }

  // 2. Check destination patterns from compiled training (learned from corrections)
  if (training?.destinationPatterns) {
    for (const pattern of training.destinationPatterns) {
      // High confidence patterns (many examples) don't need review
      if (pattern.confidence >= 0.6) {
        try {
          // Pattern could be "label*word*pattern" format or exact match
          const patternRegex = pattern.pattern.includes('*')
            ? new RegExp(pattern.pattern.replace(/\*/g, '.*'), 'i')
            : new RegExp(pattern.pattern, 'i');

          if (patternRegex.test(label)) {
            return {
              destination: pattern.toDestination as Destination,
              needs_review: false,
              tag_source: `training:pattern:${pattern.pattern}`,
            };
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }
  }

  // 3. Check pattern overrides from tag-rules.yaml
  for (const override of rules.pattern_overrides) {
    try {
      const regex = new RegExp(override.pattern, 'i');
      if (regex.test(label)) {
        return {
          destination: override.destination,
          needs_review: false,
          tag_source: `pattern:${override.pattern}`,
        };
      }
    } catch {
      // Invalid regex, skip
      console.warn(`Invalid regex in pattern_overrides: ${override.pattern}`);
    }
  }

  // 4. Check topic destinations
  if (topic && rules.topic_destinations[topic]) {
    return {
      destination: rules.topic_destinations[topic],
      needs_review: false,
      tag_source: `topic:${topic}`,
    };
  }

  // 5. No match - needs review
  return {
    destination: null,
    needs_review: true,
    tag_source: 'no_match',
  };
}

// =============================================================================
// MAIN TAGGER
// =============================================================================

export interface TagResult {
  questionnaire: string;
  totalItems: number;
  tagged: number;
  needsReview: number;
  excluded: number;
  byDestination: Record<string, number>;
  /** How many items were tagged using training data (hard rules + patterns) */
  taggedByTraining: number;
  /** Whether training data was used */
  usedTraining: boolean;
}

export async function tagQuestionnaire(
  indexedPath: string,
  customer?: string
): Promise<TagResult> {
  // Load rules
  const rules = await loadTagRules(customer);

  // Load compiled training data (human corrections = ground truth)
  const training = await loadCompiledTraining(customer);
  if (training) {
    console.log(`  Using training data: ${training.stats.totalCorrections} corrections, ${training.hardRules.length} hard rules`);
  }

  // Load indexed questionnaire (JSON or YAML)
  const content = await readFile(indexedPath, 'utf-8');
  const isJson = indexedPath.endsWith('.json');
  const indexed: IndexedQuestionnaire = isJson ? JSON.parse(content) : yaml.parse(content);

  // Stats
  const result: TagResult = {
    questionnaire: indexed.questionnaire,
    totalItems: 0,
    tagged: 0,
    needsReview: 0,
    excluded: 0,
    byDestination: {},
    taggedByTraining: 0,
    usedTraining: training !== null,
  };

  // Tag each item
  for (const section of indexed.sections) {
    for (const item of section.items) {
      result.totalItems++;

      const tag = tagItem(item, rules, training);

      // Add tag info to item
      (item as IndexedItem & TaggedItem).destination = tag.destination;
      (item as IndexedItem & TaggedItem).needs_review = tag.needs_review;
      (item as IndexedItem & TaggedItem).tag_source = tag.tag_source;

      // Update stats
      if (tag.needs_review) {
        result.needsReview++;
      } else if (tag.destination === 'exclude') {
        result.excluded++;
      } else {
        result.tagged++;
        const dest = tag.destination || 'unknown';
        result.byDestination[dest] = (result.byDestination[dest] || 0) + 1;

        // Track training-based tags
        if (tag.tag_source.startsWith('training:')) {
          result.taggedByTraining++;
        }
      }
    }
  }

  // Save updated file
  indexed.indexedAt = new Date().toISOString();
  await writeFile(indexedPath, isJson ? JSON.stringify(indexed, null, 2) : yaml.stringify(indexed), 'utf-8');

  return result;
}

export async function tagAllQuestionnaires(customer?: string): Promise<TagResult[]> {
  const { indexed: indexedDir } = customer
    ? getCustomerPaths(customer)
    : { indexed: join(process.cwd(), 'indexed') };

  const { readdir } = await import('fs/promises');
  const files = await readdir(indexedDir);
  const indexedFiles = files.filter((f) => f.endsWith('.json') || f.endsWith('.yaml'));

  const results: TagResult[] = [];

  for (const file of indexedFiles) {
    const filePath = join(indexedDir, file);
    console.log(`Tagging: ${file}`);
    const result = await tagQuestionnaire(filePath, customer);
    results.push(result);

    const trainingInfo = result.usedTraining ? `, Training-based: ${result.taggedByTraining}` : '';
    console.log(`  Total: ${result.totalItems}, Tagged: ${result.tagged}${trainingInfo}, Needs Review: ${result.needsReview}, Excluded: ${result.excluded}`);
  }

  return results;
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const customerIdx = args.indexOf('--customer');
  const customer = customerIdx !== -1 ? args[customerIdx + 1] : undefined;

  const fileArg = args.find((a) => !a.startsWith('--') && a !== customer);

  if (fileArg) {
    // Tag single file
    tagQuestionnaire(fileArg, customer)
      .then((result) => {
        console.log('\nTagging complete:');
        console.log(`  Total items: ${result.totalItems}`);
        console.log(`  Tagged: ${result.tagged}`);
        if (result.usedTraining) {
          console.log(`  Tagged by training: ${result.taggedByTraining}`);
        }
        console.log(`  Needs review: ${result.needsReview}`);
        console.log(`  Excluded: ${result.excluded}`);
        console.log('\nBy destination:');
        for (const [dest, count] of Object.entries(result.byDestination)) {
          console.log(`  ${dest}: ${count}`);
        }
      })
      .catch(console.error);
  } else {
    // Tag all
    tagAllQuestionnaires(customer)
      .then((results) => {
        console.log('\n=== Summary ===');
        const totals = results.reduce(
          (acc, r) => ({
            items: acc.items + r.totalItems,
            tagged: acc.tagged + r.tagged,
            review: acc.review + r.needsReview,
            excluded: acc.excluded + r.excluded,
            trainingBased: acc.trainingBased + r.taggedByTraining,
            usedTraining: acc.usedTraining || r.usedTraining,
          }),
          { items: 0, tagged: 0, review: 0, excluded: 0, trainingBased: 0, usedTraining: false }
        );
        console.log(`Total items: ${totals.items}`);
        console.log(`Tagged: ${totals.tagged}`);
        if (totals.usedTraining) {
          console.log(`Tagged by training: ${totals.trainingBased}`);
        }
        console.log(`Needs review: ${totals.review}`);
        console.log(`Excluded: ${totals.excluded}`);
      })
      .catch(console.error);
  }
}
