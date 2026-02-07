#!/usr/bin/env node

/**
 * CLI for Questionnaire Extraction Pipeline v2
 *
 * Usage:
 *   npx tsx src/pipeline-v2/cli.ts process <file>           — Process a single file
 *   npx tsx src/pipeline-v2/cli.ts process <file> --vision  — Use visual extraction
 *   npx tsx src/pipeline-v2/cli.ts process <file> -i        — Interactive review
 *   npx tsx src/pipeline-v2/cli.ts stats                    — Show Answer Library stats
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { PipelineV2 } from './pipeline.js';
import type { PipelineV2Options } from './types.js';

const program = new Command();

program
  .name('pipeline-v2')
  .description('Questionnaire extraction with smart topic classification and Answer Library')
  .version('2.0.0');

/** Shared options */
function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--review-dir <dir>', 'Review output directory', './review')
    .option('--approved-dir <dir>', 'Approved extractions directory', './approved')
    .option('--answer-library <dir>', 'Answer Library directory', './answer-library')
    .option('--rules <file>', 'Rules YAML file', './rules/rules.yaml')
    .option('--logs-dir <dir>', 'Logs directory', './logs')
    .option('--region <region>', 'AWS region for Bedrock', 'eu-central-1')
    .option('--model <model>', 'Bedrock model ID')
    .option('--offline', 'Skip Bedrock calls (rule-based only)')
    .option('--dry-run', 'Preview without writing files');
}

function buildOptions(opts: Record<string, unknown>): Partial<PipelineV2Options> {
  return {
    reviewDir: opts.reviewDir as string,
    approvedDir: opts.approvedDir as string,
    answerLibraryDir: opts.answerLibrary as string,
    rulesFile: opts.rules as string,
    logsDir: opts.logsDir as string,
    awsRegion: opts.region as string || process.env.AWS_REGION || 'eu-central-1',
    bedrockModel: opts.model as string,
    useBedrock: !opts.offline,
    dryRun: !!opts.dryRun,
  };
}

/** Process a single file */
addCommonOptions(
  program
    .command('process')
    .description('Process a questionnaire file')
    .argument('<file>', 'Path to the questionnaire file')
    .option('--vision', 'Use visual extraction (Claude Vision)')
    .option('-i, --interactive', 'Interactive review mode')
).action(async (file: string, opts) => {
  const pipelineOpts = buildOptions(opts);
  const pipeline = new PipelineV2(pipelineOpts);

  try {
    const filePath = resolve(file);
    const result = await pipeline.processFile(filePath, {
      useVision: !!opts.vision,
      interactive: !!opts.interactive,
    });

    console.log('\n✅ Done.');
    console.log(`   Questions: ${result.summary.totalQuestions}`);
    console.log(`   Flagged: ${result.summary.flaggedForReview}`);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

/** Show Answer Library stats */
addCommonOptions(
  program
    .command('stats')
    .description('Show Answer Library statistics')
).action(async (opts) => {
  const pipelineOpts = buildOptions(opts);
  const pipeline = new PipelineV2(pipelineOpts);

  try {
    const stats = await pipeline.getLibraryStats();

    console.log('\n📚 Answer Library Statistics\n');
    console.log(`Total approved answers: ${stats.totalAnswers}`);
    console.log('\nBy topic:');

    const sortedTopics = Object.entries(stats.byTopic)
      .sort(([, a], [, b]) => b - a);

    for (const [topic, count] of sortedTopics) {
      console.log(`  ${topic}: ${count}`);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

/** List topics from rules */
addCommonOptions(
  program
    .command('topics')
    .description('List all topics from rules')
).action(async (opts) => {
  const { loadRules } = await import('./rules-loader.js');

  try {
    const rules = await loadRules(opts.rules as string || './rules/rules.yaml');

    console.log('\n📋 Topics Configuration\n');

    console.log('Entity-level topics (→ Answer Library / Entity DB):');
    for (const topic of rules.config.topics) {
      if (topic.level.some(l => ['company', 'group', 'site'].includes(l))) {
        console.log(`  ${topic.id}`);
        console.log(`    Name: ${topic.name}`);
        console.log(`    Destination: ${topic.destination}`);
        console.log(`    Reusable: ${topic.reusable ? 'Yes' : 'No'}`);
        console.log('');
      }
    }

    console.log('\nProduct-level topics (→ Product Spec):');
    for (const topic of rules.config.topics) {
      if (topic.level.some(l => ['product', 'product_group'].includes(l))) {
        console.log(`  ${topic.id}`);
        console.log(`    Name: ${topic.name}`);
        console.log(`    Destination: ${topic.destination}`);
        console.log('');
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

program.parse();
