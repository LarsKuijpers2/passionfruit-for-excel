/**
 * Extraction Comparator
 *
 * Compares Azure and Vision extraction results to provide quality metrics
 * and help users understand the differences between strategies.
 */

import type { IndexedQuestionnaire, IndexedItem, IndexedSection } from './questionnaire-indexer.js';

// =============================================================================
// COMPARISON METRICS
// =============================================================================

export interface ItemMatch {
  /** Azure item ID */
  azureId: string;
  /** Vision item ID */
  visionId: string;
  /** Match confidence (0-1) */
  confidence: number;
  /** Type of match */
  matchType: 'exact' | 'fuzzy' | 'value_only' | 'label_only';
}

export interface ExtractionMetrics {
  /** Total items extracted */
  totalItems: number;
  /** Items with answers */
  answeredItems: number;
  /** Items by level */
  byLevel: {
    standard: number;
    narrative: number;
    product: number;
  };
  /** Items by destination */
  byDestination: {
    answer_library: number;
    company: number;
    product: number;
    exclude: number;
  };
  /** Unique sections */
  sectionCount: number;
  /** Duplicate labels detected */
  duplicateLabels: number;
  /** Average label length (proxy for quality) */
  avgLabelLength: number;
  /** Has entity information */
  hasEntities: boolean;
  /** Has product information */
  hasProducts: boolean;
}

export interface ComparisonResult {
  /** Metrics for Azure extraction */
  azure?: ExtractionMetrics;
  /** Metrics for Vision extraction */
  vision?: ExtractionMetrics;
  /** Items that appear in both extractions */
  matchedItems: ItemMatch[];
  /** Azure items not found in Vision */
  azureOnly: string[];
  /** Vision items not found in Azure */
  visionOnly: string[];
  /** Quality score (0-100) for each strategy */
  qualityScore: {
    azure?: number;
    vision?: number;
  };
  /** Which strategy appears better */
  recommendation: 'azure' | 'vision' | 'both' | 'unclear';
  /** Reasons for recommendation */
  reasons: string[];
}

// =============================================================================
// COMPARATOR CLASS
// =============================================================================

export class ExtractionComparator {
  /**
   * Compare two extraction results
   */
  compare(
    azure?: IndexedQuestionnaire,
    vision?: IndexedQuestionnaire
  ): ComparisonResult {
    const result: ComparisonResult = {
      matchedItems: [],
      azureOnly: [],
      visionOnly: [],
      qualityScore: {},
      recommendation: 'unclear',
      reasons: [],
    };

    // Calculate metrics for each extraction
    if (azure) {
      result.azure = this.calculateMetrics(azure);
      result.qualityScore.azure = this.calculateQualityScore(result.azure);
    }

    if (vision) {
      result.vision = this.calculateMetrics(vision);
      result.qualityScore.vision = this.calculateQualityScore(result.vision);
    }

    // Match items between extractions
    if (azure && vision) {
      const { matched, azureOnly, visionOnly } = this.matchItems(azure, vision);
      result.matchedItems = matched;
      result.azureOnly = azureOnly;
      result.visionOnly = visionOnly;
    }

    // Determine recommendation
    result.recommendation = this.determineRecommendation(result);
    result.reasons = this.generateReasons(result);

    return result;
  }

  /**
   * Calculate metrics for an extraction
   */
  private calculateMetrics(extraction: IndexedQuestionnaire): ExtractionMetrics {
    const allItems = extraction.sections.flatMap((s) => s.items);

    // Count by level
    const byLevel = {
      standard: 0,
      narrative: 0,
      product: 0,
    };

    // Count by destination
    const byDestination = {
      answer_library: 0,
      company: 0,
      product: 0,
      exclude: 0,
    };

    // Track labels for duplicates
    const labelCounts = new Map<string, number>();
    let totalLabelLength = 0;

    for (const item of allItems) {
      // Level counts
      if (item.level === 'standard') byLevel.standard++;
      else if (item.level === 'narrative') byLevel.narrative++;
      else if (item.level === 'product') byLevel.product++;

      // Destination counts
      if (item.destination === 'answer_library') byDestination.answer_library++;
      else if (item.destination === 'company') byDestination.company++;
      else if (item.destination === 'product') byDestination.product++;
      else if (item.destination === 'exclude') byDestination.exclude++;

      // Label tracking
      const normalizedLabel = item.label.toLowerCase().trim();
      labelCounts.set(normalizedLabel, (labelCounts.get(normalizedLabel) || 0) + 1);
      totalLabelLength += item.label.length;
    }

    // Count duplicates
    let duplicateLabels = 0;
    for (const count of labelCounts.values()) {
      if (count > 1) {
        duplicateLabels += count - 1;
      }
    }

    return {
      totalItems: allItems.length,
      answeredItems: allItems.filter((i) => i.value && i.value.trim()).length,
      byLevel,
      byDestination,
      sectionCount: extraction.sections.length,
      duplicateLabels,
      avgLabelLength: allItems.length > 0 ? totalLabelLength / allItems.length : 0,
      hasEntities: extraction.entities.length > 0,
      hasProducts: extraction.products.length > 0,
    };
  }

  /**
   * Calculate quality score (0-100)
   */
  private calculateQualityScore(metrics: ExtractionMetrics): number {
    let score = 50; // Base score

    // More items = better (up to a point)
    if (metrics.totalItems > 10) score += 10;
    if (metrics.totalItems > 50) score += 5;
    if (metrics.totalItems > 100) score += 5;

    // Answered items ratio
    const answerRatio = metrics.totalItems > 0 ? metrics.answeredItems / metrics.totalItems : 0;
    score += answerRatio * 10;

    // Penalize duplicates
    const duplicateRatio = metrics.totalItems > 0 ? metrics.duplicateLabels / metrics.totalItems : 0;
    score -= duplicateRatio * 20;

    // Reward entities and products detection
    if (metrics.hasEntities) score += 5;
    if (metrics.hasProducts) score += 5;

    // Penalize very short average labels (likely truncated/missing)
    if (metrics.avgLabelLength < 10) score -= 10;
    else if (metrics.avgLabelLength > 20) score += 5;

    // Reward good section structure
    if (metrics.sectionCount >= 3) score += 5;
    if (metrics.sectionCount >= 10) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Match items between Azure and Vision extractions
   */
  private matchItems(
    azure: IndexedQuestionnaire,
    vision: IndexedQuestionnaire
  ): {
    matched: ItemMatch[];
    azureOnly: string[];
    visionOnly: string[];
  } {
    const azureItems = azure.sections.flatMap((s) => s.items);
    const visionItems = vision.sections.flatMap((s) => s.items);

    const matched: ItemMatch[] = [];
    const matchedAzureIds = new Set<string>();
    const matchedVisionIds = new Set<string>();

    // Try to match items
    for (const azureItem of azureItems) {
      let bestMatch: { visionItem: IndexedItem; confidence: number; type: ItemMatch['matchType'] } | null = null;

      for (const visionItem of visionItems) {
        if (matchedVisionIds.has(visionItem.id)) continue;

        const match = this.calculateItemMatch(azureItem, visionItem);
        if (match.confidence > 0.5 && (!bestMatch || match.confidence > bestMatch.confidence)) {
          bestMatch = { visionItem, ...match };
        }
      }

      if (bestMatch) {
        matched.push({
          azureId: azureItem.id,
          visionId: bestMatch.visionItem.id,
          confidence: bestMatch.confidence,
          matchType: bestMatch.type,
        });
        matchedAzureIds.add(azureItem.id);
        matchedVisionIds.add(bestMatch.visionItem.id);
      }
    }

    const azureOnly = azureItems.filter((i) => !matchedAzureIds.has(i.id)).map((i) => i.id);
    const visionOnly = visionItems.filter((i) => !matchedVisionIds.has(i.id)).map((i) => i.id);

    return { matched, azureOnly, visionOnly };
  }

  /**
   * Calculate match between two items
   */
  private calculateItemMatch(
    azure: IndexedItem,
    vision: IndexedItem
  ): { confidence: number; type: ItemMatch['matchType'] } {
    const azureLabel = azure.label.toLowerCase().trim();
    const visionLabel = vision.label.toLowerCase().trim();
    const azureValue = (azure.value || '').toLowerCase().trim();
    const visionValue = (vision.value || '').toLowerCase().trim();

    // Exact match
    if (azureLabel === visionLabel && azureValue === visionValue) {
      return { confidence: 1.0, type: 'exact' };
    }

    // Fuzzy label match
    const labelSimilarity = this.stringSimilarity(azureLabel, visionLabel);
    const valueSimilarity = this.stringSimilarity(azureValue, visionValue);

    if (labelSimilarity > 0.8 && valueSimilarity > 0.8) {
      return { confidence: (labelSimilarity + valueSimilarity) / 2, type: 'fuzzy' };
    }

    // Value only match (different labels, same value)
    if (valueSimilarity > 0.9 && visionValue.length > 5) {
      return { confidence: valueSimilarity * 0.7, type: 'value_only' };
    }

    // Label only match (same label, different value)
    if (labelSimilarity > 0.9) {
      return { confidence: labelSimilarity * 0.6, type: 'label_only' };
    }

    return { confidence: 0, type: 'fuzzy' };
  }

  /**
   * Simple string similarity (Jaccard-like)
   */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Determine recommendation based on comparison
   */
  private determineRecommendation(result: ComparisonResult): ComparisonResult['recommendation'] {
    const azureScore = result.qualityScore.azure || 0;
    const visionScore = result.qualityScore.vision || 0;

    // If only one exists, recommend it
    if (result.azure && !result.vision) return 'azure';
    if (!result.azure && result.vision) return 'vision';
    if (!result.azure && !result.vision) return 'unclear';

    // If scores are close, recommend based on item count
    if (Math.abs(azureScore - visionScore) < 10) {
      const azureItems = result.azure?.totalItems || 0;
      const visionItems = result.vision?.totalItems || 0;

      // If item counts are similar, recommend both
      if (Math.abs(azureItems - visionItems) < azureItems * 0.2) {
        return 'both';
      }

      // Otherwise recommend the one with more items
      return azureItems > visionItems ? 'azure' : 'vision';
    }

    // Recommend higher score
    return azureScore > visionScore ? 'azure' : 'vision';
  }

  /**
   * Generate human-readable reasons for recommendation
   */
  private generateReasons(result: ComparisonResult): string[] {
    const reasons: string[] = [];

    if (!result.azure && !result.vision) {
      reasons.push('No extraction results available');
      return reasons;
    }

    if (!result.azure) {
      reasons.push('Azure extraction not available');
      return reasons;
    }

    if (!result.vision) {
      reasons.push('Vision extraction not available');
      return reasons;
    }

    const azureMetrics = result.azure;
    const visionMetrics = result.vision;

    // Compare item counts
    const itemDiff = azureMetrics.totalItems - visionMetrics.totalItems;
    if (Math.abs(itemDiff) > 10) {
      if (itemDiff > 0) {
        reasons.push(`Azure extracted ${itemDiff} more items`);
      } else {
        reasons.push(`Vision extracted ${-itemDiff} more items`);
      }
    }

    // Compare answered items
    const answerDiff = azureMetrics.answeredItems - visionMetrics.answeredItems;
    if (Math.abs(answerDiff) > 5) {
      if (answerDiff > 0) {
        reasons.push(`Azure has ${answerDiff} more answered items`);
      } else {
        reasons.push(`Vision has ${-answerDiff} more answered items`);
      }
    }

    // Compare duplicates
    if (azureMetrics.duplicateLabels > visionMetrics.duplicateLabels + 5) {
      reasons.push(`Azure has ${azureMetrics.duplicateLabels - visionMetrics.duplicateLabels} more duplicate labels`);
    } else if (visionMetrics.duplicateLabels > azureMetrics.duplicateLabels + 5) {
      reasons.push(`Vision has ${visionMetrics.duplicateLabels - azureMetrics.duplicateLabels} more duplicate labels`);
    }

    // Compare quality scores
    const scoreDiff = (result.qualityScore.azure || 0) - (result.qualityScore.vision || 0);
    if (Math.abs(scoreDiff) > 10) {
      reasons.push(`Quality score: Azure ${result.qualityScore.azure}, Vision ${result.qualityScore.vision}`);
    }

    // Note overlap
    const overlapRatio =
      result.matchedItems.length /
      Math.max(azureMetrics.totalItems, visionMetrics.totalItems, 1);
    if (overlapRatio > 0.5) {
      reasons.push(`${Math.round(overlapRatio * 100)}% overlap between extractions`);
    } else if (overlapRatio < 0.2) {
      reasons.push(`Only ${Math.round(overlapRatio * 100)}% overlap - extractions found different content`);
    }

    if (reasons.length === 0) {
      reasons.push('Both extractions are similar in quality');
    }

    return reasons;
  }
}
