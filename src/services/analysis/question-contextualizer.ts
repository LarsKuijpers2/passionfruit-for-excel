/**
 * QuestionContextualizer - Transform context-less labels into self-explaining questions
 *
 * Purpose: Labels like "Product Identification Policy" are meaningless in isolation.
 * This service transforms them into complete questions like
 * "Do you have a Product Identification Policy?" using section context.
 */

import type { IndexedSection, IndexedItem } from './questionnaire-indexer.js';

export interface ContextualizedItem extends IndexedItem {
  originalLabel?: string;
}

export interface ContextualizationResult {
  sections: IndexedSection[];
  stats: {
    totalItems: number;
    transformed: number;
    unchanged: number;
  };
}

/**
 * Patterns for detecting question types from section titles
 */
const SECTION_PATTERNS = {
  // "Do you have X?" sections - items are sub-policies/features
  doYouHave: /^(?:\d+\.?\d*\s+)?Do you have\s+(.+?)\??$/i,
  // "Do you identify X?" sections
  doYouIdentify: /^(?:\d+\.?\d*\s+)?Do you identify\s+(.+?)\??$/i,
};

/**
 * Transform a single item label based on section context
 */
function transformLabel(item: IndexedItem, sectionTitle: string): { label: string; transformed: boolean } {
  const originalLabel = item.label;

  // Skip if already looks like a complete question
  if (originalLabel.endsWith('?') || originalLabel.toLowerCase().startsWith('do you')) {
    return { label: originalLabel, transformed: false };
  }

  // Skip very long labels (likely already descriptive)
  if (originalLabel.length > 100) {
    return { label: originalLabel, transformed: false };
  }

  // Clean up the label - remove leading numbers like "4.6.1"
  let cleanLabel = originalLabel.replace(/^[\d.]+\s*/, '').trim();

  // Check if section is a "Do you have X?" type
  const doYouHaveMatch = sectionTitle.match(SECTION_PATTERNS.doYouHave);
  if (doYouHaveMatch) {
    const article = determineArticle(cleanLabel);
    return { label: `Do you have ${article}${cleanLabel}?`, transformed: true };
  }

  // Check if section is a "Do you identify X?" type
  const doYouIdentifyMatch = sectionTitle.match(SECTION_PATTERNS.doYouIdentify);
  if (doYouIdentifyMatch) {
    return { label: `Do you identify ${cleanLabel}?`, transformed: true };
  }

  // For Yes/No type values with policy-like labels
  if ((item.value?.toLowerCase() === 'yes' || item.value?.toLowerCase() === 'no') && isPolicyLike(cleanLabel)) {
    const article = determineArticle(cleanLabel);
    return { label: `Do you have ${article}${cleanLabel}?`, transformed: true };
  }

  // For certificate-type values
  if (item.value?.toLowerCase().includes('certificate')) {
    return { label: `Do you have ${cleanLabel} certification?`, transformed: true };
  }

  return { label: originalLabel, transformed: false };
}

/**
 * Determine if "a" or "an" should be used
 */
function determineArticle(label: string): string {
  const lowerLabel = label.toLowerCase();
  
  // Don't add article for plural or proper nouns
  if (lowerLabel.endsWith('s') && !lowerLabel.endsWith('ss')) return '';
  if (isProperNoun(label)) return '';
  if (/^(any|all|your|the|a|an)\s/i.test(label)) return '';

  const firstChar = label.charAt(0).toLowerCase();
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  return vowels.includes(firstChar) ? 'an ' : 'a ';
}

function isProperNoun(label: string): boolean {
  const properNouns = ['kosher', 'halal', 'organic', 'gmo', 'brc', 'ifs', 'iso', 'haccp', 'fssc', 'sqf', 'gfsi'];
  return properNouns.some(noun => label.toLowerCase().startsWith(noun));
}

function isPolicyLike(label: string): boolean {
  const indicators = ['policy', 'program', 'procedure', 'system', 'plan', 'certification', 'audit', 'standard', 'management', 'control'];
  return indicators.some(ind => label.toLowerCase().includes(ind));
}

/**
 * Main function: Transform all items in sections to have self-explaining labels
 */
export function contextualizeQuestions(sections: IndexedSection[]): ContextualizationResult {
  let totalItems = 0;
  let transformed = 0;

  const contextualizedSections = sections.map(section => {
    const contextualizedItems = section.items.map(item => {
      totalItems++;
      const result = transformLabel(item, section.title);

      if (result.transformed) {
        transformed++;
        return {
          ...item,
          originalLabel: item.label,
          label: result.label,
        } as ContextualizedItem;
      }
      // Always preserve original label even when not transformed
      return { ...item, originalLabel: item.originalLabel || item.label } as ContextualizedItem;
    });

    return { ...section, items: contextualizedItems };
  });

  return {
    sections: contextualizedSections,
    stats: { totalItems, transformed, unchanged: totalItems - transformed },
  };
}

/**
 * Contextualize a single item (for real-time preview)
 */
export function contextualizeItem(item: IndexedItem, sectionTitle: string): ContextualizedItem {
  const result = transformLabel(item, sectionTitle);
  if (result.transformed) {
    return { ...item, originalLabel: item.label, label: result.label };
  }
  // Always preserve original label even when not transformed
  return { ...item, originalLabel: item.originalLabel || item.label };
}
