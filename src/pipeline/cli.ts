#!/usr/bin/env node

/**
 * CLI for the Questionnaire Extraction Pipeline
 *
 * Usage:
 *   npx tsx src/pipeline/cli.ts process <file>     — Process a single file
 *   npx tsx src/pipeline/cli.ts batch               — Process all files in incoming/
 *   npx tsx src/pipeline/cli.ts batch --dry-run     — Preview without generating output
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { Pipeline } from './pipeline.js';
import type { PipelineOptions } from './types.js';

const program = new Command();

program
  .name('questionnaire-pipeline')
  .description('Batch questionnaire extraction pipeline — extract, categorise, and structure Q&A data')
  .version('1.0.0');

/** Shared options */
function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--input-dir <dir>', 'Input directory', './incoming')
    .option('--output-dir <dir>', 'Output directory', './extracted')
    .option('--failed-dir <dir>', 'Failed files directory', './failed')
    .option('--logs-dir <dir>', 'Logs directory', './logs')
    .option('--offline', 'Skip Claude API calls (rule-based only)')
    .option('--region <region>', 'AWS region for Bedrock (or set AWS_REGION env var)', 'eu-central-1')
    .option('--model <model>', 'Bedrock model ID')
    .option('--dry-run', 'Preview without generating output files');
}

function buildOptions(opts: {
  inputDir?: string;
  outputDir?: string;
  failedDir?: string;
  logsDir?: string;
  offline?: boolean;
  region?: string;
  model?: string;
  dryRun?: boolean;
}): Partial<PipelineOptions> {
  return {
    inputDir: opts.inputDir,
    outputDir: opts.outputDir,
    failedDir: opts.failedDir,
    logsDir: opts.logsDir,
    useClaudeAPI: !opts.offline,
    awsRegion: opts.region || process.env.AWS_REGION || 'eu-central-1',
    bedrockModel: opts.model,
    dryRun: opts.dryRun || false,
  };
}

/** Process a single file */
addCommonOptions(
  program
    .command('process')
    .description('Process a single questionnaire file')
    .argument('<file>', 'Path to the questionnaire file (.xlsx, .xls, .pdf, .docx)')
).action(async (file: string, opts) => {
  const pipelineOpts = buildOptions(opts);
  const pipeline = new Pipeline(pipelineOpts);

  const filePath = resolve(file);
  const result = await pipeline.processFile(filePath);

  if (result.success) {
    console.log(`\nDone. Output: ${result.outputFile}`);
    console.log(`  Q&A pairs: ${result.stats.totalPairs}`);
    console.log(`  EntityDB: ${result.stats.entityDBCount} | Procedures: ${result.stats.proceduresCount} | Product: ${result.stats.productCount}`);
    console.log(`  Flagged for review: ${result.stats.lowConfidence}`);
  } else {
    console.error(`\nFailed: ${result.error}`);
    process.exit(1);
  }
});

/** Process all files in batch */
addCommonOptions(
  program
    .command('batch')
    .description('Process all questionnaire files in the incoming directory')
).action(async (opts) => {
  const pipelineOpts = buildOptions(opts);
  const pipeline = new Pipeline(pipelineOpts);

  const summary = await pipeline.processBatch();

  console.log(`\nBatch complete.`);
  console.log(`  Processed: ${summary.successCount}/${summary.totalFiles}`);
  console.log(`  Failed: ${summary.failedCount}`);
  console.log(`  Total Q&A pairs: ${summary.aggregateStats.totalPairs}`);

  if (summary.failedCount > 0) {
    process.exit(1);
  }
});

program.parse();
