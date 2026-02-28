/**
 * Test Pipeline V2
 *
 * Self-contained test script for the new pipeline with metrics.
 * Run: npx ts-node scripts/test-pipeline-v2.ts [customer] [file]
 */

import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface PatternLibrary {
  patterns: Array<{
    id: string;
    name: string;
    detection: {
      headerKeywords?: string[];
      headerKeywordsMatchCount?: number;
      columnCount?: { min: number; max: number };
      noCheckboxHeaders?: boolean;
    };
  }>;
  detectionPriority: string[];
}

interface StageMetrics {
  stage: string;
  durationMs: number;
  success: boolean;
  counts: Record<string, number>;
  rates: Record<string, number>;
}

interface DocumentMetrics {
  source: string;
  customer: string;
  processedAt: string;
  totalDurationMs: number;
  stages: Record<string, StageMetrics>;
  summary: {
    qualityScore: number;
    itemsExtracted: number;
    issueCount: number;
    patterns: string[];
  };
}

// =============================================================================
// PATTERN DETECTION
// =============================================================================

async function loadPatterns(): Promise<PatternLibrary> {
  const content = await readFile('./knowledge/table-patterns.json', 'utf-8');
  return JSON.parse(content);
}

function detectPattern(
  headers: string[],
  columnCount: number,
  patterns: PatternLibrary
): { patternId: string | null; confidence: number } {
  const headersLower = headers.map(h => h.toLowerCase());
  const headersJoined = headersLower.join(' ');

  for (const patternId of patterns.detectionPriority) {
    const pattern = patterns.patterns.find(p => p.id === patternId);
    if (!pattern) continue;

    // Check column count
    if (pattern.detection.columnCount) {
      const { min, max } = pattern.detection.columnCount;
      if (columnCount < min || columnCount > max) continue;
    }

    // Check keywords
    if (pattern.detection.headerKeywords) {
      const keywords = pattern.detection.headerKeywords.map(k => k.toLowerCase());
      const matchCount = keywords.filter(kw =>
        headersLower.some(h => h.includes(kw)) || headersJoined.includes(kw)
      ).length;

      const required = pattern.detection.headerKeywordsMatchCount || 1;
      if (matchCount < required) continue;

      return { patternId, confidence: Math.min(matchCount * 0.2 + 0.3, 1) };
    }

    // Check noCheckboxHeaders
    if (pattern.detection.noCheckboxHeaders) {
      const checkboxKeywords = ['yes', 'no', 'ja', 'nein', 'oui', 'non', 'nee'];
      const hasCheckbox = headersLower.some(h => checkboxKeywords.includes(h.trim()));
      if (hasCheckbox) continue;
      return { patternId, confidence: 0.5 };
    }

    return { patternId, confidence: 0.4 };
  }

  return { patternId: null, confidence: 0 };
}

// =============================================================================
// PIPELINE STAGES
// =============================================================================

async function runPipeline(
  customer: string,
  structureFile: string
): Promise<DocumentMetrics> {
  const startTime = Date.now();
  const patterns = await loadPatterns();

  const metrics: DocumentMetrics = {
    source: structureFile,
    customer,
    processedAt: new Date().toISOString(),
    totalDurationMs: 0,
    stages: {},
    summary: {
      qualityScore: 100,
      itemsExtracted: 0,
      issueCount: 0,
      patterns: [],
    },
  };

  // Stage 1: Load structure (extraction already done)
  const extractStart = Date.now();
  const structurePath = join('./customers', customer, 'structure', structureFile);
  const structure = JSON.parse(await readFile(structurePath, 'utf-8'));

  metrics.stages.extract = {
    stage: 'extract',
    durationMs: Date.now() - extractStart,
    success: true,
    counts: {
      sheets: structure.sheets?.length || 0,
      rows: structure.sheets?.reduce((s: number, sh: any) => s + (sh.rows?.length || 0), 0) || 0,
    },
    rates: {},
  };

  // Stage 2: Structure analysis
  const structureStart = Date.now();
  const detectedPatterns: string[] = [];
  let matchedTables = 0;
  let totalTables = 0;

  for (const sheet of structure.sheets || []) {
    const headerRows = (sheet.rows || []).filter((r: any) => r.rowType === 'header');

    for (const headerRow of headerRows) {
      const cells = Object.values(headerRow.cells || {}) as any[];
      const filledCells = cells.filter(c => c.filled && c.value?.trim());

      if (filledCells.length < 2) continue;
      totalTables++;

      const headers = filledCells.map(c => c.value?.trim() || '');
      const { patternId, confidence } = detectPattern(headers, filledCells.length, patterns);

      if (patternId) {
        matchedTables++;
        if (!detectedPatterns.includes(patternId)) {
          detectedPatterns.push(patternId);
        }
      }
    }
  }

  metrics.stages.structure = {
    stage: 'structure',
    durationMs: Date.now() - structureStart,
    success: true,
    counts: {
      totalTables,
      matchedTables,
      unmatchedTables: totalTables - matchedTables,
    },
    rates: {
      matchRate: totalTables > 0 ? Math.round((matchedTables / totalTables) * 100) : 0,
    },
  };
  metrics.summary.patterns = detectedPatterns;

  // Stage 3: Q&A extraction (simplified)
  const qaStart = Date.now();
  let itemsExtracted = 0;
  let rowsWithData = 0;

  for (const sheet of structure.sheets || []) {
    const dataRows = (sheet.rows || []).filter((r: any) => r.rowType === 'data');
    for (const row of dataRows) {
      const cells = Object.values(row.cells || {}) as any[];
      const filledCells = cells.filter(c => c.filled && c.value?.trim());
      if (filledCells.length >= 2) {
        itemsExtracted++;
        rowsWithData++;
      }
    }
  }

  metrics.stages.qa = {
    stage: 'qa',
    durationMs: Date.now() - qaStart,
    success: true,
    counts: {
      itemsExtracted,
      rowsWithData,
    },
    rates: {},
  };
  metrics.summary.itemsExtracted = itemsExtracted;

  // Stage 4: Validation
  const validateStart = Date.now();
  let issueCount = 0;
  let qualityScore = 100;

  // Penalize for unmatched tables
  if (totalTables > 0) {
    const unmatchedRate = (totalTables - matchedTables) / totalTables;
    qualityScore -= Math.round(unmatchedRate * 20);
    issueCount += totalTables - matchedTables;
  }

  // Penalize for low item count
  if (itemsExtracted < 10) {
    qualityScore -= 10;
    issueCount++;
  }

  metrics.stages.validate = {
    stage: 'validate',
    durationMs: Date.now() - validateStart,
    success: true,
    counts: {
      issueCount,
    },
    rates: {
      qualityScore: Math.max(0, qualityScore),
    },
  };
  metrics.summary.qualityScore = Math.max(0, qualityScore);
  metrics.summary.issueCount = issueCount;

  metrics.totalDurationMs = Date.now() - startTime;

  return metrics;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const customer = process.argv[2] || 'beneo';
  const specificFile = process.argv[3];

  console.log('\n🚀 Pipeline V2 Test\n');
  console.log('═'.repeat(60));

  // Get structure files
  const structureDir = join('./customers', customer, 'structure');
  if (!existsSync(structureDir)) {
    console.error(`No structure directory found for customer: ${customer}`);
    process.exit(1);
  }

  let files = (await readdir(structureDir)).filter(f => f.endsWith('.json'));

  if (specificFile) {
    files = files.filter(f => f.includes(specificFile));
  } else {
    files = files.slice(0, 5); // Process first 5 for testing
  }

  console.log(`Processing ${files.length} files for customer: ${customer}\n`);

  const allMetrics: DocumentMetrics[] = [];

  for (const file of files) {
    console.log(`\n📄 ${file.slice(0, 60)}...`);
    console.log('─'.repeat(60));

    const metrics = await runPipeline(customer, file);
    allMetrics.push(metrics);

    // Print stage results
    const e = metrics.stages.extract;
    console.log(`   EXTRACT: ${e?.counts.sheets} sheets, ${e?.counts.rows} rows (${e?.durationMs}ms)`);

    const s = metrics.stages.structure;
    console.log(`   STRUCTURE: ${s?.counts.matchedTables}/${s?.counts.totalTables} tables matched (${s?.rates.matchRate}%) (${s?.durationMs}ms)`);
    if (metrics.summary.patterns.length > 0) {
      console.log(`      Patterns: ${metrics.summary.patterns.join(', ')}`);
    }

    const q = metrics.stages.qa;
    console.log(`   Q&A: ${q?.counts.itemsExtracted} items extracted (${q?.durationMs}ms)`);

    const v = metrics.stages.validate;
    console.log(`   VALIDATE: score=${v?.rates.qualityScore}, issues=${v?.counts.issueCount} (${v?.durationMs}ms)`);

    console.log(`   ⏱️  Total: ${metrics.totalDurationMs}ms`);

    // Save metrics
    const metricsDir = join('./customers', customer, 'metrics');
    if (!existsSync(metricsDir)) {
      await mkdir(metricsDir, { recursive: true });
    }
    const metricsFile = join(metricsDir, file.replace('.json', '.metrics.json'));
    await writeFile(metricsFile, JSON.stringify(metrics, null, 2));
  }

  // Aggregate summary
  console.log('\n' + '═'.repeat(60));
  console.log('AGGREGATE METRICS');
  console.log('═'.repeat(60));

  const totalItems = allMetrics.reduce((s, m) => s + m.summary.itemsExtracted, 0);
  const avgQuality = Math.round(allMetrics.reduce((s, m) => s + m.summary.qualityScore, 0) / allMetrics.length);
  const avgTime = Math.round(allMetrics.reduce((s, m) => s + m.totalDurationMs, 0) / allMetrics.length);

  const patternCounts: Record<string, number> = {};
  for (const m of allMetrics) {
    for (const p of m.summary.patterns) {
      patternCounts[p] = (patternCounts[p] || 0) + 1;
    }
  }

  console.log(`\nDocuments processed: ${allMetrics.length}`);
  console.log(`Total items extracted: ${totalItems}`);
  console.log(`Average quality score: ${avgQuality}/100`);
  console.log(`Average processing time: ${avgTime}ms`);

  console.log('\nPattern distribution:');
  for (const [pattern, count] of Object.entries(patternCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${pattern}: ${count} files`);
  }

  console.log('\n✅ Metrics saved to customers/' + customer + '/metrics/\n');
}

main().catch(console.error);
