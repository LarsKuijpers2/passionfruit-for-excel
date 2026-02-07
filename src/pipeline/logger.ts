/**
 * Structured logging for the questionnaire extraction pipeline.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { FileProcessingResult, BatchSummary } from './types.js';

export class PipelineLogger {
  private logsDir: string;
  private logEntries: string[] = [];

  constructor(logsDir: string) {
    this.logsDir = logsDir;
  }

  /** Log an informational message */
  info(message: string): void {
    const entry = `[${new Date().toISOString()}] INFO  ${message}`;
    this.logEntries.push(entry);
    console.log(entry);
  }

  /** Log a warning */
  warn(message: string): void {
    const entry = `[${new Date().toISOString()}] WARN  ${message}`;
    this.logEntries.push(entry);
    console.warn(entry);
  }

  /** Log an error */
  error(message: string): void {
    const entry = `[${new Date().toISOString()}] ERROR ${message}`;
    this.logEntries.push(entry);
    console.error(entry);
  }

  /** Log a file processing result summary */
  logFileResult(result: FileProcessingResult): void {
    if (result.success) {
      this.info(
        `Processed: ${result.sourceFileName} → ${result.pairs.length} Q&A pairs ` +
        `(EntityDB: ${result.stats.entityDBCount}, ` +
        `Procedures: ${result.stats.proceduresCount}, ` +
        `Product: ${result.stats.productCount}, ` +
        `Flagged: ${result.stats.lowConfidence})`
      );
    } else {
      this.error(`Failed: ${result.sourceFileName} — ${result.error}`);
    }
  }

  /** Log a batch summary */
  logBatchSummary(summary: BatchSummary): void {
    this.info('');
    this.info('═══════════════════════════════════════════════');
    this.info('  BATCH PROCESSING SUMMARY');
    this.info('═══════════════════════════════════════════════');
    this.info(`  Total files:     ${summary.totalFiles}`);
    this.info(`  Successful:      ${summary.successCount}`);
    this.info(`  Failed:          ${summary.failedCount}`);
    this.info(`  Total Q&A pairs: ${summary.aggregateStats.totalPairs}`);
    this.info(`    EntityDB:      ${summary.aggregateStats.entityDBCount}`);
    this.info(`    Procedures:    ${summary.aggregateStats.proceduresCount}`);
    this.info(`    Product:       ${summary.aggregateStats.productCount}`);
    this.info(`  Confidence:`);
    this.info(`    HIGH:          ${summary.aggregateStats.highConfidence}`);
    this.info(`    MEDIUM:        ${summary.aggregateStats.mediumConfidence}`);
    this.info(`    LOW:           ${summary.aggregateStats.lowConfidence}`);
    this.info(`  Total time:      ${summary.totalTimeMs}ms`);
    this.info('═══════════════════════════════════════════════');
  }

  /** Write batch log file */
  async writeBatchLog(batchId: string): Promise<string> {
    await mkdir(this.logsDir, { recursive: true });

    const logPath = join(this.logsDir, `batch-${batchId}.log`);
    await writeFile(logPath, this.logEntries.join('\n') + '\n', 'utf-8');
    return logPath;
  }

  /** Write batch summary JSON */
  async writeSummaryJson(summary: BatchSummary): Promise<string> {
    await mkdir(this.logsDir, { recursive: true });

    const summaryPath = join(this.logsDir, 'summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return summaryPath;
  }
}
