/**
 * Rules Loader for Pipeline v2
 *
 * Loads and parses the rules.yaml configuration file.
 */

import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type { RulesConfig, TopicRule, FlagCondition } from './types.js';

const DEFAULT_RULES_PATH = './rules/rules.yaml';

/** Compiled regex patterns for a topic */
export interface CompiledTopicPatterns {
  topicId: string;
  keywords: Set<string>;
  patterns: RegExp[];
}

/** Compiled flag condition patterns */
export interface CompiledFlagCondition extends FlagCondition {
  compiledPatterns?: RegExp[];
}

/** Loaded and compiled rules */
export interface LoadedRules {
  config: RulesConfig;
  topicPatterns: Map<string, CompiledTopicPatterns>;
  flagConditions: CompiledFlagCondition[];
  logOnlyPatterns: RegExp[];
  excludePatterns: RegExp[];
}

/**
 * Load rules from YAML file
 */
export async function loadRules(rulesPath: string = DEFAULT_RULES_PATH): Promise<LoadedRules> {
  const content = await readFile(rulesPath, 'utf-8');
  const config = parseYaml(content) as RulesConfig;

  // Compile topic patterns
  const topicPatterns = new Map<string, CompiledTopicPatterns>();
  for (const topic of config.topics) {
    topicPatterns.set(topic.id, {
      topicId: topic.id,
      keywords: new Set(topic.keywords.map(k => k.toLowerCase())),
      patterns: topic.patterns.map(p => {
        // Remove (?i) prefix if present since we apply 'i' flag anyway
        const cleanPattern = p.replace(/^\(\?i\)/i, '');
        return new RegExp(cleanPattern, 'i');
      }),
    });
  }

  // Compile flag conditions
  const flagConditions: CompiledFlagCondition[] = config.flag_for_review.map(fc => ({
    ...fc,
    compiledPatterns: fc.patterns?.map(p => {
      const cleanPattern = p.replace(/^\(\?i\)/i, '');
      return new RegExp(cleanPattern, 'i');
    }),
  }));

  // Compile log-only patterns
  const logOnlyPatterns = config.log_only_patterns.map(p => {
    const cleanPattern = p.replace(/^\(\?i\)/i, '');
    return new RegExp(cleanPattern, 'i');
  });

  // Compile exclude patterns (placeholders to filter out)
  const excludePatterns = (config.exclude_patterns || []).map(p => {
    const cleanPattern = p.replace(/^\(\?i\)/i, '');
    return new RegExp(cleanPattern, 'i');
  });

  return {
    config,
    topicPatterns,
    flagConditions,
    logOnlyPatterns,
    excludePatterns,
  };
}

/**
 * Get topic by ID
 */
export function getTopicById(rules: LoadedRules, topicId: string): TopicRule | undefined {
  return rules.config.topics.find(t => t.id === topicId);
}

/**
 * Get all topics for a specific destination
 */
export function getTopicsByDestination(
  rules: LoadedRules,
  destination: string
): TopicRule[] {
  return rules.config.topics.filter(t => t.destination === destination);
}

/**
 * Get all entity-level topics
 */
export function getEntityLevelTopics(rules: LoadedRules): TopicRule[] {
  return rules.config.topics.filter(t =>
    t.level.some(l => ['group', 'company', 'site'].includes(l))
  );
}

/**
 * Get all product-level topics
 */
export function getProductLevelTopics(rules: LoadedRules): TopicRule[] {
  return rules.config.topics.filter(t =>
    t.level.some(l => ['product_group', 'product'].includes(l))
  );
}

/**
 * Check if text should be logged only (customer-specific)
 */
export function isLogOnly(rules: LoadedRules, text: string): boolean {
  return rules.logOnlyPatterns.some(p => p.test(text));
}

/**
 * Check if a question should be excluded (placeholder/template text)
 */
export function shouldExclude(rules: LoadedRules, questionText: string, answerText?: string): boolean {
  const qText = questionText.trim();
  const aText = (answerText || '').trim();

  // Check if question matches exclude patterns
  if (rules.excludePatterns.some(p => p.test(qText))) {
    return true;
  }

  // Exclude if question and answer are identical (likely a header/label)
  if (qText && aText && qText === aText) {
    return true;
  }

  // Exclude very short questions that are just labels
  if (qText.length < 5 && !aText) {
    return true;
  }

  return false;
}

/**
 * Get flag reasons for a question/answer
 */
export function getFlagReasons(
  rules: LoadedRules,
  questionText: string,
  answerText: string,
  confidence: number,
  topicMatched: boolean
): string[] {
  const reasons: string[] = [];
  const combinedText = `${questionText} ${answerText}`;

  for (const fc of rules.flagConditions) {
    switch (fc.condition) {
      case 'no_topic_match':
        if (!topicMatched) {
          reasons.push(fc.message);
        }
        break;

      case 'low_confidence':
        if (fc.threshold && confidence < fc.threshold) {
          reasons.push(fc.message);
        }
        break;

      case 'contains_commitment':
      case 'legal_implication':
        if (fc.compiledPatterns?.some(p => p.test(combinedText))) {
          reasons.push(fc.message);
        }
        break;

      // Other conditions are checked elsewhere (new_answer_pattern, conflicting_information)
    }
  }

  return reasons;
}

/**
 * Get answer format for a value
 */
export function detectAnswerFormat(
  rules: LoadedRules,
  answerText: string
): { formatId: string; format: string } | null {
  for (const [formatId, fmt] of Object.entries(rules.config.answer_formats)) {
    if (fmt.patterns) {
      for (const pattern of fmt.patterns) {
        if (new RegExp(pattern, 'i').test(answerText)) {
          return { formatId, format: fmt.format };
        }
      }
    }
  }
  return null;
}
