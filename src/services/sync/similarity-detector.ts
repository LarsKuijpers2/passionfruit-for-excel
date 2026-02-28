/**
 * Similarity Detector for Aggregated Items
 *
 * Detects similar/related items for grouping in the aggregated library view.
 * Uses Jaccard similarity on normalized word sets to find items that are
 * likely asking the same question but with different wording.
 */

import type { AggregatedItem } from './aggregate-customer-data.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RelatedItemGroup {
  /** Items that appear to be asking the same thing */
  items: AggregatedItem[];
  /** Highest similarity score between items */
  similarity: number;
  /** Whether system suggests merging these */
  suggestedMerge: boolean;
}

export interface GroupedByTopic {
  topic: string;
  /** Standalone items (no similar matches) */
  items: AggregatedItem[];
  /** Groups of similar items */
  relatedGroups: RelatedItemGroup[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Minimum similarity threshold for grouping (0-1) */
const SIMILARITY_THRESHOLD = 0.5;

/** Minimum word length to consider for comparison */
const MIN_WORD_LENGTH = 3;

/** Stopwords to remove for comparison (multilingual) */
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'have', 'has', 'you', 'your',
  'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'or', 'and',
  'be', 'this', 'that', 'it', 'its', 'as', 'was', 'were', 'been', 'being',
  'if', 'then', 'than', 'so', 'such', 'no', 'not', 'only', 'other', 'which',
  'what', 'when', 'where', 'who', 'how', 'why', 'please', 'provide', 'specify',
  // Dutch
  'de', 'het', 'een', 'van', 'en', 'in', 'is', 'op', 'te', 'dat', 'die',
  'voor', 'zijn', 'met', 'als', 'bij', 'ook', 'maar', 'om', 'aan', 'er',
  'naar', 'kan', 'nog', 'wel', 'door', 'moet', 'worden', 'heeft', 'uw', 'u',
  'graag', 'indien', 'bent',
  // German
  'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'sind', 'von', 'mit',
  'auf', 'für', 'an', 'zu', 'in', 'bei', 'haben', 'ihr', 'werden', 'wurde',
  'bitte', 'wenn', 'oder',
  // French
  'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'est', 'sont',
  'en', 'au', 'aux', 'pour', 'avec', 'dans', 'sur', 'par', 'vous', 'votre',
]);

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Normalize a label for comparison by:
 * 1. Converting to lowercase
 * 2. Removing punctuation
 * 3. Splitting into words
 * 4. Filtering out stopwords and short words
 */
export function normalizeForComparison(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .split(/\s+/)              // Split on whitespace
    .filter(word =>
      word.length >= MIN_WORD_LENGTH &&
      !STOPWORDS.has(word)
    );
}

/**
 * Calculate Jaccard similarity between two word sets.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);

  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;

  return union > 0 ? intersection / union : 0;
}

// =============================================================================
// SIMILARITY DETECTION
// =============================================================================

/**
 * Find groups of related items within a list.
 * Items are considered related if:
 * 1. They have the same topic
 * 2. Their labels have high word overlap (Jaccard similarity >= threshold)
 */
export function findRelatedItems(items: AggregatedItem[]): RelatedItemGroup[] {
  const groups: RelatedItemGroup[] = [];
  const processed = new Set<string>();

  // Pre-compute normalized labels for all items
  const normalizedLabels = new Map<string, string[]>();
  for (const item of items) {
    normalizedLabels.set(item.id, normalizeForComparison(item.label));
  }

  for (let i = 0; i < items.length; i++) {
    const itemA = items[i];
    if (processed.has(itemA.id)) continue;

    const wordsA = normalizedLabels.get(itemA.id) || [];
    const related: AggregatedItem[] = [itemA];
    let maxSimilarity = 0;

    for (let j = i + 1; j < items.length; j++) {
      const itemB = items[j];
      if (processed.has(itemB.id)) continue;

      // Must be same topic for consideration
      if (itemA.topic !== itemB.topic) continue;

      const wordsB = normalizedLabels.get(itemB.id) || [];
      const similarity = jaccardSimilarity(wordsA, wordsB);

      if (similarity >= SIMILARITY_THRESHOLD) {
        related.push(itemB);
        processed.add(itemB.id);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
    }

    // Only create a group if we found related items
    if (related.length > 1) {
      groups.push({
        items: related,
        similarity: maxSimilarity,
        suggestedMerge: maxSimilarity >= 0.7  // High similarity suggests merge
      });
      processed.add(itemA.id);
    }
  }

  return groups;
}

/**
 * Group items by topic and detect similar items within each topic.
 * Returns items organized by topic with related groups separated.
 */
export function groupByTopicWithSimilarity(items: AggregatedItem[]): GroupedByTopic[] {
  // First, group by topic
  const byTopic = new Map<string, AggregatedItem[]>();

  for (const item of items) {
    const topic = item.topic || 'other';
    if (!byTopic.has(topic)) {
      byTopic.set(topic, []);
    }
    byTopic.get(topic)!.push(item);
  }

  // For each topic, find related items
  const result: GroupedByTopic[] = [];

  for (const [topic, topicItems] of byTopic) {
    const relatedGroups = findRelatedItems(topicItems);

    // Collect IDs of items that are in related groups
    const inGroups = new Set<string>();
    for (const group of relatedGroups) {
      for (const item of group.items) {
        inGroups.add(item.id);
      }
    }

    // Standalone items are those not in any related group
    const standaloneItems = topicItems.filter(item => !inGroups.has(item.id));

    result.push({
      topic,
      items: standaloneItems,
      relatedGroups
    });
  }

  // Sort by topic name
  result.sort((a, b) => a.topic.localeCompare(b.topic));

  return result;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get statistics about similarity detection results.
 */
export function getSimilarityStats(grouped: GroupedByTopic[]): {
  totalTopics: number;
  standaloneItems: number;
  relatedGroups: number;
  itemsInGroups: number;
  suggestedMerges: number;
} {
  let standaloneItems = 0;
  let relatedGroups = 0;
  let itemsInGroups = 0;
  let suggestedMerges = 0;

  for (const topicGroup of grouped) {
    standaloneItems += topicGroup.items.length;
    relatedGroups += topicGroup.relatedGroups.length;

    for (const group of topicGroup.relatedGroups) {
      itemsInGroups += group.items.length;
      if (group.suggestedMerge) {
        suggestedMerges++;
      }
    }
  }

  return {
    totalTopics: grouped.length,
    standaloneItems,
    relatedGroups,
    itemsInGroups,
    suggestedMerges
  };
}
