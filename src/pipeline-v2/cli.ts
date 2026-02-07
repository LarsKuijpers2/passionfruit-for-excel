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
import { readdir } from 'fs/promises';
import { PipelineV2 } from './pipeline.js';
import { loadRules } from './rules-loader.js';
import { SectionExtractor } from './section-extractor.js';
import { QuestionnaireIndexer } from './questionnaire-index.js';
import { SourceStorage } from './source-storage.js';
import { QuestionnaireMatcher } from './questionnaire-matcher.js';
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
    .option('-s, --section-first', 'Classify by section first (more efficient)')
).action(async (file: string, opts) => {
  const pipelineOpts = buildOptions(opts);
  const pipeline = new PipelineV2(pipelineOpts);

  try {
    const filePath = resolve(file);
    const result = await pipeline.processFile(filePath, {
      useVision: !!opts.vision,
      interactive: !!opts.interactive,
      sectionFirst: !!opts.sectionFirst,
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

/** Batch process all files in incoming directory */
addCommonOptions(
  program
    .command('batch')
    .description('Process all questionnaire files in the incoming directory')
    .option('--input-dir <dir>', 'Input directory', './incoming')
    .option('--vision', 'Use visual extraction (Claude Vision)')
    .option('-i, --interactive', 'Interactive review mode')
    .option('-s, --section-first', 'Classify by section first (more efficient)')
).action(async (opts) => {
  const pipelineOpts = buildOptions(opts);
  const inputDir = opts.inputDir as string || './incoming';
  const pipeline = new PipelineV2(pipelineOpts);

  try {
    // Find all Excel files in incoming directory
    const files = await readdir(inputDir);
    const excelFiles = files.filter(f =>
      f.endsWith('.xlsx') || f.endsWith('.xls')
    );

    if (excelFiles.length === 0) {
      console.log(`\nNo Excel files found in ${inputDir}`);
      return;
    }

    console.log(`\n📂 Found ${excelFiles.length} files in ${inputDir}\n`);

    let totalQuestions = 0;
    let totalFlagged = 0;
    const results: { file: string; questions: number; flagged: number; error?: string }[] = [];

    for (const file of excelFiles) {
      const filePath = resolve(inputDir, file);

      try {
        const result = await pipeline.processFile(filePath, {
          useVision: !!opts.vision,
          interactive: !!opts.interactive,
          sectionFirst: !!opts.sectionFirst,
        });

        totalQuestions += result.summary.totalQuestions;
        totalFlagged += result.summary.flaggedForReview;
        results.push({
          file,
          questions: result.summary.totalQuestions,
          flagged: result.summary.flaggedForReview,
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ Error: ${errorMsg}`);
        results.push({ file, questions: 0, flagged: 0, error: errorMsg });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Batch Summary');
    console.log('='.repeat(60));
    console.log(`Files processed: ${excelFiles.length}`);
    console.log(`Total questions: ${totalQuestions}`);
    console.log(`Total flagged: ${totalFlagged}`);
    console.log('');

    console.log('Per file:');
    for (const r of results) {
      if (r.error) {
        console.log(`  ❌ ${r.file}: ERROR - ${r.error}`);
      } else {
        console.log(`  ✅ ${r.file}: ${r.questions} questions, ${r.flagged} flagged`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

/** Index a questionnaire and save as source */
addCommonOptions(
  program
    .command('index')
    .description('Index a questionnaire (create TOC, label values, save as source)')
    .argument('<file>', 'Path to the questionnaire file')
    .option('--sources-dir <dir>', 'Sources directory', './sources')
).action(async (file: string, opts) => {
  try {
    const filePath = resolve(file);
    const sourcesDir = opts.sourcesDir as string || './sources';

    console.log('Loading rules...');
    const rules = await loadRules(opts.rules as string || './rules/rules.yaml');
    console.log(`  Loaded ${rules.config.topics.length} topics`);

    console.log(`\nIndexing: ${file}`);
    const extractor = new SectionExtractor();
    const { metadata, sections, questions } = await extractor.extract(filePath);

    console.log(`  Found ${sections.length} sections, ${questions.length} fields`);

    const indexer = new QuestionnaireIndexer(rules);
    const index = indexer.createIndex(metadata, sections, questions, filePath);

    console.log(`\n📋 Table of Contents:`);
    for (const section of index.toc) {
      const fill = section.filledFields > 0 ? `✓ ${section.filledFields}/${section.totalFields}` : `○ ${section.totalFields}`;
      console.log(`  ${section.title} [${fill}]`);
      if (section.topics.length > 0) {
        console.log(`    Topics: ${section.topics.join(', ')}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Total fields: ${index.summary.totalFields}`);
    console.log(`  Filled: ${index.summary.filledFields}`);
    console.log(`  Empty: ${index.summary.emptyFields}`);
    console.log(`  Narrative (reusable): ${index.summary.narrativeFields}`);
    console.log(`  Topics: ${index.summary.topicsCovered.join(', ')}`);

    // Save as source
    const storage = new SourceStorage(sourcesDir);
    const savedPath = await storage.save(index);
    console.log(`\n✅ Saved to: ${savedPath}`);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

/** List/search sources */
program
  .command('sources')
  .description('List and search source questionnaires')
  .option('--sources-dir <dir>', 'Sources directory', './sources')
  .option('--search <query>', 'Search for content')
  .option('--topic <topic>', 'Filter by topic')
  .action(async (opts) => {
    try {
      const sourcesDir = opts.sourcesDir as string || './sources';
      const storage = new SourceStorage(sourcesDir);

      if (opts.search) {
        console.log(`\n🔍 Searching for: "${opts.search}"`);
        const results = await storage.search(opts.search as string);

        if (results.length === 0) {
          console.log('  No matches found');
        } else {
          for (const r of results) {
            console.log(`\n  📁 ${r.sourceFile} (${r.customer || 'unknown'})`);
            for (const m of r.matches.slice(0, 3)) {
              console.log(`    Q: ${m.questionText.substring(0, 60)}...`);
              console.log(`    A: ${m.answerText.substring(0, 60)}...`);
            }
          }
        }
      } else if (opts.topic) {
        console.log(`\n📂 Searching topic: "${opts.topic}"`);
        const results = await storage.searchByTopic(opts.topic as string);

        for (const r of results) {
          console.log(`\n  📁 ${r.sourceFile}: ${r.matches.length} matches`);
        }
      } else {
        // List all sources
        const summary = await storage.getSummary();

        console.log(`\n📚 Source Library`);
        console.log(`  Total sources: ${summary.totalSources}`);
        console.log(`  Total fields: ${summary.totalFields}`);
        console.log(`  Filled fields: ${summary.filledFields}`);
        console.log(`  Narrative answers: ${summary.narrativeFields}`);
        console.log(`\nTopics covered: ${summary.topicsCovered.join(', ')}`);

        console.log(`\nSources:`);
        for (const s of summary.sourcesList) {
          console.log(`  📁 ${s.filename}`);
          console.log(`     Customer: ${s.customer || 'unknown'}`);
          console.log(`     Fields: ${s.filled}/${s.fields} filled`);
        }
      }
    } catch (error) {
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

/** Match a questionnaire against sources */
addCommonOptions(
  program
    .command('match')
    .description('Find matching answers for a questionnaire from sources')
    .argument('<file>', 'Path to the questionnaire file')
    .option('--sources-dir <dir>', 'Sources directory', './sources')
).action(async (file: string, opts) => {
  try {
    const filePath = resolve(file);
    const sourcesDir = opts.sourcesDir as string || './sources';
    const answerLibDir = opts.answerLibrary as string || './answer-library';

    console.log(`\nMatching: ${file}`);

    // Extract questionnaire
    const extractor = new SectionExtractor();
    const { sections, questions } = await extractor.extract(filePath);
    console.log(`  Found ${questions.length} questions`);

    // Match against sources
    const matcher = new QuestionnaireMatcher(sourcesDir, answerLibDir);
    await matcher.init();

    const result = await matcher.getSuggestions(questions, sections);

    console.log(`\n📊 Match Results:`);
    console.log(`  Already filled: ${result.filled}`);
    console.log(`  Suggestions found: ${result.suggested}`);
    console.log(`  No match: ${result.noMatch}`);

    if (result.suggestions.length > 0) {
      console.log(`\n💡 Suggestions:`);
      for (const s of result.suggestions.slice(0, 10)) {
        console.log(`\n  Cell ${s.cell}: ${s.question}`);
        console.log(`  → ${s.suggestedAnswer}`);
        console.log(`    Source: ${s.source} (${s.confidence}% confidence)`);
      }

      if (result.suggestions.length > 10) {
        console.log(`\n  ... and ${result.suggestions.length - 10} more suggestions`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
});

program.parse();
