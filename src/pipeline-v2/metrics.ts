/**
 * Pipeline Metrics System
 *
 * Tracks metrics at each pipeline stage for learning and improvement.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface StageMetrics {
  stage: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
  counts: Record<string, number>;
  rates: Record<string, number>;
  flags: string[];
}

export interface DocumentMetrics {
  source: string;
  customer: string;
  documentType: string;
  processedAt: string;
  totalDurationMs: number;

  stages: {
    extract?: StageMetrics;
    structure?: StageMetrics;
    qa?: StageMetrics;
    classify?: StageMetrics;
    validate?: StageMetrics;
    review?: StageMetrics;
  };

  summary: {
    qualityScore: number;
    itemsExtracted: number;
    issueCount: number;
    needsReview: boolean;
    patterns: string[];
  };
}

export interface AggregateMetrics {
  customer: string;
  period: string;
  generatedAt: string;

  volume: {
    documentsProcessed: number;
    itemsExtracted: number;
    tablesAnalyzed: number;
  };

  quality: {
    avgQualityScore: number;
    correctionRate: number;
    autoApproveRate: number;
    avgIssuesPerDoc: number;
  };

  patterns: {
    patternDistribution: Record<string, number>;
    unknownPatternCount: number;
    topUnmatchedHeaders: string[];
  };

  stages: {
    avgExtractionTime: number;
    avgStructureTime: number;
    avgTotalTime: number;
    stageSuccessRates: Record<string, number>;
  };

  learning: {
    correctionsLogged: number;
    newPatternsNeeded: number;
    topCorrectionTypes: Record<string, number>;
  };
}

// =============================================================================
// METRICS COLLECTOR
// =============================================================================

export class MetricsCollector {
  private metrics: DocumentMetrics;
  private currentStage: string | null = null;
  private stageStart: number = 0;

  constructor(source: string, customer: string, documentType: string) {
    this.metrics = {
      source,
      customer,
      documentType,
      processedAt: new Date().toISOString(),
      totalDurationMs: 0,
      stages: {},
      summary: {
        qualityScore: 0,
        itemsExtracted: 0,
        issueCount: 0,
        needsReview: false,
        patterns: [],
      },
    };
  }

  /**
   * Start tracking a stage
   */
  startStage(stage: 'extract' | 'structure' | 'qa' | 'classify' | 'validate' | 'review'): void {
    this.currentStage = stage;
    this.stageStart = Date.now();
  }

  /**
   * Complete a stage with metrics
   */
  completeStage(
    stage: 'extract' | 'structure' | 'qa' | 'classify' | 'validate' | 'review',
    data: {
      success: boolean;
      error?: string;
      counts?: Record<string, number>;
      rates?: Record<string, number>;
      flags?: string[];
    }
  ): void {
    const duration = Date.now() - this.stageStart;

    this.metrics.stages[stage] = {
      stage,
      startedAt: new Date(this.stageStart).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: duration,
      success: data.success,
      error: data.error,
      counts: data.counts || {},
      rates: data.rates || {},
      flags: data.flags || [],
    };

    this.currentStage = null;
  }

  /**
   * Set summary metrics
   */
  setSummary(summary: Partial<DocumentMetrics['summary']>): void {
    this.metrics.summary = { ...this.metrics.summary, ...summary };
  }

  /**
   * Get the collected metrics
   */
  getMetrics(): DocumentMetrics {
    // Calculate total duration
    const stages = Object.values(this.metrics.stages);
    this.metrics.totalDurationMs = stages.reduce((sum, s) => sum + (s?.durationMs || 0), 0);
    return this.metrics;
  }

  /**
   * Save metrics to file
   */
  async save(customersDir: string = './customers'): Promise<string> {
    const metricsDir = join(customersDir, this.metrics.customer, 'metrics');

    if (!existsSync(metricsDir)) {
      await mkdir(metricsDir, { recursive: true });
    }

    // Generate filename from source
    const baseName = this.metrics.source
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .slice(0, 100);

    const filePath = join(metricsDir, `${baseName}.metrics.json`);
    await writeFile(filePath, JSON.stringify(this.metrics, null, 2));

    return filePath;
  }
}

// =============================================================================
// METRICS AGGREGATOR
// =============================================================================

export class MetricsAggregator {
  /**
   * Aggregate metrics for a customer
   */
  async aggregate(customer: string, customersDir: string = './customers'): Promise<AggregateMetrics> {
    const metricsDir = join(customersDir, customer, 'metrics');

    if (!existsSync(metricsDir)) {
      return this.emptyAggregate(customer);
    }

    const { readdir } = await import('fs/promises');
    const files = (await readdir(metricsDir)).filter(f => f.endsWith('.metrics.json'));

    const allMetrics: DocumentMetrics[] = [];
    for (const file of files) {
      const content = await readFile(join(metricsDir, file), 'utf-8');
      allMetrics.push(JSON.parse(content));
    }

    if (allMetrics.length === 0) {
      return this.emptyAggregate(customer);
    }

    // Calculate aggregates
    const patternCounts: Record<string, number> = {};
    let totalItems = 0;
    let totalIssues = 0;
    let totalQuality = 0;
    let totalExtractTime = 0;
    let totalStructureTime = 0;
    let totalTime = 0;

    for (const m of allMetrics) {
      totalItems += m.summary.itemsExtracted;
      totalIssues += m.summary.issueCount;
      totalQuality += m.summary.qualityScore;
      totalTime += m.totalDurationMs;

      if (m.stages.extract) totalExtractTime += m.stages.extract.durationMs;
      if (m.stages.structure) totalStructureTime += m.stages.structure.durationMs;

      for (const pattern of m.summary.patterns) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }

    const n = allMetrics.length;

    return {
      customer,
      period: 'all_time',
      generatedAt: new Date().toISOString(),

      volume: {
        documentsProcessed: n,
        itemsExtracted: totalItems,
        tablesAnalyzed: Object.values(patternCounts).reduce((a, b) => a + b, 0),
      },

      quality: {
        avgQualityScore: Math.round(totalQuality / n),
        correctionRate: 0, // TODO: calculate from corrections
        autoApproveRate: 0, // TODO: calculate from reviews
        avgIssuesPerDoc: Math.round((totalIssues / n) * 10) / 10,
      },

      patterns: {
        patternDistribution: patternCounts,
        unknownPatternCount: patternCounts['UNKNOWN'] || 0,
        topUnmatchedHeaders: [], // TODO: collect from structure stage
      },

      stages: {
        avgExtractionTime: Math.round(totalExtractTime / n),
        avgStructureTime: Math.round(totalStructureTime / n),
        avgTotalTime: Math.round(totalTime / n),
        stageSuccessRates: {
          extract: this.successRate(allMetrics, 'extract'),
          structure: this.successRate(allMetrics, 'structure'),
          qa: this.successRate(allMetrics, 'qa'),
          classify: this.successRate(allMetrics, 'classify'),
          validate: this.successRate(allMetrics, 'validate'),
        },
      },

      learning: {
        correctionsLogged: 0, // TODO: count from corrections dir
        newPatternsNeeded: patternCounts['UNKNOWN'] || 0,
        topCorrectionTypes: {}, // TODO: aggregate from corrections
      },
    };
  }

  private successRate(metrics: DocumentMetrics[], stage: keyof DocumentMetrics['stages']): number {
    const withStage = metrics.filter(m => m.stages[stage]);
    if (withStage.length === 0) return 0;
    const successes = withStage.filter(m => m.stages[stage]?.success).length;
    return Math.round((successes / withStage.length) * 100);
  }

  private emptyAggregate(customer: string): AggregateMetrics {
    return {
      customer,
      period: 'all_time',
      generatedAt: new Date().toISOString(),
      volume: { documentsProcessed: 0, itemsExtracted: 0, tablesAnalyzed: 0 },
      quality: { avgQualityScore: 0, correctionRate: 0, autoApproveRate: 0, avgIssuesPerDoc: 0 },
      patterns: { patternDistribution: {}, unknownPatternCount: 0, topUnmatchedHeaders: [] },
      stages: { avgExtractionTime: 0, avgStructureTime: 0, avgTotalTime: 0, stageSuccessRates: {} },
      learning: { correctionsLogged: 0, newPatternsNeeded: 0, topCorrectionTypes: {} },
    };
  }
}

// =============================================================================
// CLI HELPERS
// =============================================================================

export async function printMetricsSummary(customer: string): Promise<void> {
  const aggregator = new MetricsAggregator();
  const metrics = await aggregator.aggregate(customer);

  console.log('\n📊 PIPELINE METRICS');
  console.log('═'.repeat(60));
  console.log(`Customer: ${customer}`);
  console.log(`Generated: ${metrics.generatedAt}`);

  console.log('\n📦 VOLUME');
  console.log(`   Documents processed: ${metrics.volume.documentsProcessed}`);
  console.log(`   Items extracted: ${metrics.volume.itemsExtracted}`);
  console.log(`   Tables analyzed: ${metrics.volume.tablesAnalyzed}`);

  console.log('\n✅ QUALITY');
  console.log(`   Average quality score: ${metrics.quality.avgQualityScore}/100`);
  console.log(`   Average issues per doc: ${metrics.quality.avgIssuesPerDoc}`);

  console.log('\n🏷️  PATTERNS');
  const patterns = Object.entries(metrics.patterns.patternDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [pattern, count] of patterns) {
    console.log(`   ${pattern}: ${count}`);
  }

  console.log('\n⏱️  TIMING');
  console.log(`   Average extraction: ${metrics.stages.avgExtractionTime}ms`);
  console.log(`   Average structure: ${metrics.stages.avgStructureTime}ms`);
  console.log(`   Average total: ${metrics.stages.avgTotalTime}ms`);

  console.log('\n📈 STAGE SUCCESS RATES');
  for (const [stage, rate] of Object.entries(metrics.stages.stageSuccessRates)) {
    console.log(`   ${stage}: ${rate}%`);
  }

  console.log('\n🧠 LEARNING');
  console.log(`   Corrections logged: ${metrics.learning.correctionsLogged}`);
  console.log(`   New patterns needed: ${metrics.learning.newPatternsNeeded}`);

  console.log('');
}
