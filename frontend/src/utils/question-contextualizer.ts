/**
 * QuestionContextualizer - Transform context-less labels into self-explaining questions
 * Frontend version for real-time display in Library panel
 */

// Types used for future extensions
// import type { IndexedItem } from '../types';

/**
 * Patterns for detecting question types from section titles
 */
const SECTION_PATTERNS = {
  doYouHave: /^(?:\d+\.?\d*\s+)?Do you have\s+(.+?)\??$/i,
  doYouIdentify: /^(?:\d+\.?\d*\s+)?Do you identify\s+(.+?)\??$/i,
};

/**
 * Transform a label into a self-explaining question based on section context
 */
export function contextualizeLabel(
  label: string,
  sectionTitle: string,
  value?: string
): { label: string; transformed: boolean } {
  // Skip if already looks like a complete question
  if (label.endsWith('?') || label.toLowerCase().startsWith('do you')) {
    return { label, transformed: false };
  }

  // Skip very long labels
  if (label.length > 100) {
    return { label, transformed: false };
  }

  // Clean up the label - remove leading numbers
  let cleanLabel = label.replace(/^[\d.]+\s*/, '').trim();

  // Check if section is a "Do you have X?" type
  if (SECTION_PATTERNS.doYouHave.test(sectionTitle)) {
    const article = determineArticle(cleanLabel);
    return { label: `Do you have ${article}${cleanLabel}?`, transformed: true };
  }

  // Check if section is a "Do you identify X?" type
  if (SECTION_PATTERNS.doYouIdentify.test(sectionTitle)) {
    return { label: `Do you identify ${cleanLabel}?`, transformed: true };
  }

  // For Yes/No values with policy-like labels
  if ((value?.toLowerCase() === 'yes' || value?.toLowerCase() === 'no') && isPolicyLike(cleanLabel)) {
    const article = determineArticle(cleanLabel);
    return { label: `Do you have ${article}${cleanLabel}?`, transformed: true };
  }

  // For certificate-type values
  if (value?.toLowerCase().includes('certificate')) {
    return { label: `Do you have ${cleanLabel} certification?`, transformed: true };
  }

  return { label, transformed: false };
}

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
 * Contextualize items for display in library panel
 * Returns items with transformed labels and original label preserved
 */
export function contextualizeItems(
  items: Array<{ label: string; value?: string; id?: string; destination?: string; topic?: string; lCell?: string }>,
  sectionMap: Map<string, string>  // itemId -> sectionTitle
): Array<typeof items[0] & { originalLabel?: string; contextualizedLabel: string }> {
  return items.map(item => {
    const sectionTitle = sectionMap.get(item.id || '') || '';
    const result = contextualizeLabel(item.label, sectionTitle, item.value);
    
    return {
      ...item,
      originalLabel: result.transformed ? item.label : undefined,
      contextualizedLabel: result.label,
    };
  });
}
