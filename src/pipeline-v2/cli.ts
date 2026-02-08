#!/usr/bin/env node

/**
 * Questionnaire Extraction Pipeline CLI
 *
 * Commands:
 *   store <file>   - Store questionnaire (Excel, Word, PDF)
 *   index <file>   - Index with Claude AI, extract all evidence pieces
 *   harvest        - Harvest entity-level answers into library
 *   review         - Interactive review with visual preview
 *   list           - List stored questionnaires
 */

// Load environment variables from .env file
import 'dotenv/config';

import { Command } from 'commander';
import { resolve, join } from 'path';
import { readdir, readFile } from 'fs/promises';
import {
  StructureStorage,
  structureToMarkdown,
} from './excel-structure.js';
import { getExtractor, getDocumentType } from './document-extractor.js';
import { VisualAnalyzer } from './visual-analyzer.js';
import { QuestionnaireIndexer } from './questionnaire-indexer.js';
import { AnswerHarvester } from './answer-harvester.js';
import { ReviewCLI } from './review-cli.js';
import { WebReviewGenerator } from './web-review-generator.js';
import { ReviewServer } from './review/server.js';
import { printEnvironmentInfo, getConfig, hasApiKey } from './config/environments.js';
import { PassionfruitAPIClient } from './sync/api-client.js';

const program = new Command();

program
  .name('pipeline')
  .description('Questionnaire extraction pipeline with AI analysis and feedback learning')
  .version('2.0.0');

// =============================================================================
// STORE - Extract and store questionnaire structure
// =============================================================================

program
  .command('store')
  .description('Store questionnaire preserving structure (Excel, Word, PDF)')
  .argument('<file>', 'Path to the questionnaire file (.xlsx, .docx, .pdf)')
  .option('--output-dir <dir>', 'Output directory', './questionnaires')
  .option('--markdown', 'Also export to Markdown')
  .action(async (file: string, opts) => {
    try {
      const filePath = resolve(file);
      const outputDir = opts.outputDir as string || './questionnaires';

      const docType = getDocumentType(filePath);
      console.log('\nStoring: ' + file + ' (' + docType + ')');

      const extractor = await getExtractor(filePath);
      const structure = await extractor.extract(filePath);

      console.log('  Sheets: ' + structure.stats.totalSheets);
      console.log('  Rows: ' + structure.stats.totalRows);
      console.log('  Filled cells: ' + structure.stats.filledCells + '/' + structure.stats.totalCells);

      console.log('\n  Sheets:');
      for (const sheet of structure.sheets) {
        const topic = sheet.topic ? ' [' + sheet.topic + ']' : '';
        console.log('    - ' + sheet.name + topic + ': ' + sheet.stats.filledCells + ' filled');
      }

      // Save JSON
      const storage = new StructureStorage(outputDir);
      const jsonPath = await storage.save(structure);
      console.log('\n✅ Saved: ' + jsonPath);

      // Optionally export Markdown
      if (opts.markdown) {
        const { writeFile: write, mkdir: mk } = await import('fs/promises');
        await mk(outputDir, { recursive: true });
        const mdContent = structureToMarkdown(structure);
        const mdPath = jsonPath.replace('.json', '.md');
        await write(mdPath, mdContent, 'utf-8');
        console.log('✅ Markdown: ' + mdPath);
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// INDEX - Analyze with Claude AI and extract evidence pieces
// =============================================================================

program
  .command('index')
  .description('Index questionnaire with Claude AI - extract all evidence pieces organized by section/topic')
  .argument('<file>', 'Questionnaire filename (from stored questionnaires)')
  .option('--dir <dir>', 'Questionnaires directory', './questionnaires')
  .option('--output <dir>', 'Output directory for indexed questionnaires', './indexed')
  .option('--rules-dir <dir>', 'Rules directory', './rules')
  .action(async (file: string, opts) => {
    try {
      const dir = opts.dir as string || './questionnaires';
      const outputDir = opts.output as string || './indexed';
      const rulesDir = opts.rulesDir as string || './rules';

      console.log('\n📇 Indexing: ' + file + '\n');

      const indexer = new QuestionnaireIndexer(dir, 'eu-central-1', rulesDir);
      const indexed = await indexer.index(file);

      console.log('\n📊 Index Summary:');
      console.log('   Language: ' + indexed.language.toUpperCase());
      console.log('   Total items: ' + indexed.stats.total);
      console.log('   Answered: ' + indexed.stats.answered);
      console.log('   Standard: ' + indexed.stats.standard);
      console.log('   Narrative: ' + indexed.stats.narrative);
      console.log('   Product: ' + indexed.stats.product);

      console.log('\n📁 Sections:');
      for (const section of indexed.sections.slice(0, 10)) {
        const answered = section.items.filter(i => i.value).length;
        console.log('   ' + section.title);
        console.log('     Topic: ' + section.topic + ', Items: ' + section.items.length + ' (' + answered + ' answered)');
      }
      if (indexed.sections.length > 10) {
        console.log('   ... and ' + (indexed.sections.length - 10) + ' more sections');
      }

      // Save
      const outputPath = await indexer.save(indexed, outputDir);
      console.log('\n💾 Saved to: ' + outputPath);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// HARVEST - Extract reusable items for the answer library
// =============================================================================

program
  .command('harvest')
  .description('Harvest standard + narrative items from indexed questionnaires into answer library')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory', './indexed')
  .option('--output <file>', 'Output library file', './answer-library.yaml')
  .option('--rules-dir <dir>', 'Rules directory', './rules')
  .option('--file <name>', 'Harvest from a specific indexed file only')
  .action(async (opts) => {
    try {
      const indexedDir = opts.indexedDir as string || './indexed';
      const outputFile = opts.output as string || './answer-library.yaml';
      const rulesDir = opts.rulesDir as string || './rules';

      console.log('\n🌾 Harvesting reusable items\n');

      const harvester = new AnswerHarvester(indexedDir, outputFile, rulesDir);

      if (opts.file) {
        console.log('  From: ' + opts.file);
        const items = await harvester.harvest(opts.file as string);
        console.log('  Found ' + items.length + ' reusable items\n');

        for (const item of items.slice(0, 5)) {
          console.log('   [' + item.topic + '] ' + item.label.substring(0, 50));
          console.log('   → ' + item.value.substring(0, 60));
          console.log('   (from: ' + item.source.file + ')\n');
        }
      } else {
        console.log('  From all indexed questionnaires in: ' + indexedDir);
        const library = await harvester.harvestAll();

        console.log('\n📊 Library Summary:');
        console.log('   Total items: ' + library.total);
        console.log('   Sources: ' + library.sources.length);

        console.log('\n📁 By Topic:');
        const sortedTopics = Object.entries(library.byTopic)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 10);
        for (const [topic, items] of sortedTopics) {
          console.log('   ' + topic + ': ' + items.length);
        }

        const outputPath = await harvester.saveLibrary(library);
        console.log('\n💾 Saved to: ' + outputPath);
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// REVIEW - Interactive review with visual preview and feedback
// =============================================================================

program
  .command('review')
  .description('Interactive review of indexed questionnaires with visual preview and feedback')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory', './indexed')
  .option('--questionnaires-dir <dir>', 'Raw questionnaires directory', './questionnaires')
  .option('--review-dir <dir>', 'Review output directory', './review')
  .action(async (opts) => {
    try {
      const reviewCli = new ReviewCLI(
        opts.indexedDir as string || './indexed',
        opts.questionnairesDir as string || './questionnaires',
        opts.reviewDir as string || './review'
      );

      await reviewCli.start();

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// LIST - List stored questionnaires
// =============================================================================

program
  .command('list')
  .description('List all stored questionnaires')
  .option('--dir <dir>', 'Storage directory', './questionnaires')
  .action(async (opts) => {
    try {
      const dir = opts.dir as string || './questionnaires';
      const storage = new StructureStorage(dir);

      const summary = await storage.getSummary();

      console.log('\n📁 Stored Questionnaires: ' + summary.total);
      console.log('');

      for (const q of summary.questionnaires) {
        console.log('  📄 ' + q.filename);
        console.log('     Customer: ' + (q.customer || 'Unknown'));
        console.log('     Sheets: ' + q.sheets + ', Filled: ' + q.filledCells + ' cells');
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// WEB-REVIEW - Generate browser-based review interface
// =============================================================================

program
  .command('web-review')
  .description('Generate browser-based review interface with Original/Indexed/Library panels')
  .argument('<file>', 'Questionnaire filename (without extension)')
  .option('--questionnaires-dir <dir>', 'Questionnaires directory', './questionnaires')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory', './indexed')
  .option('--library <file>', 'Answer library file', './answer-library.yaml')
  .option('--output <dir>', 'Output directory', './review')
  .action(async (file: string, opts) => {
    try {
      const questionnairesDir = opts.questionnairesDir as string || './questionnaires';
      const indexedDir = opts.indexedDir as string || './indexed';
      const libraryPath = opts.library as string || './answer-library.yaml';
      const outputDir = opts.output as string || './review';

      // Normalize filename (preserve hyphens like other parts of pipeline)
      const baseName = file.replace(/\.(xlsx?|json|yaml)$/i, '');
      const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');

      // Find the structure file
      const structurePath = join(questionnairesDir, `${safeName}.json`);
      const indexedPath = join(indexedDir, `${safeName}.yaml`);

      console.log('\n🌐 Generating web review interface\n');
      console.log('  Questionnaire: ' + structurePath);
      console.log('  Indexed: ' + indexedPath);
      console.log('  Library: ' + libraryPath);

      const generator = new WebReviewGenerator(outputDir);
      const outputPath = await generator.generate(structurePath, indexedPath, libraryPath);

      console.log('\n✅ Generated: ' + outputPath);
      console.log('\n   Open in browser to review:');
      console.log('   open ' + outputPath);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// REVIEW SERVE - Start review server with auto-save
// =============================================================================

program
  .command('serve')
  .description('Start review server with auto-save (replaces manual export)')
  .argument('[file]', 'Questionnaire filename (optional - opens welcome screen if not provided)')
  .option('--questionnaires-dir <dir>', 'Questionnaires directory', './questionnaires')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory', './indexed')
  .option('--library <file>', 'Answer library file', './answer-library.yaml')
  .option('--review-dir <dir>', 'Review output directory', './review')
  .option('--port <port>', 'Server port', '3456')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (file: string | undefined, opts) => {
    try {
      const reviewDir = opts.reviewDir as string || './review';
      const port = parseInt(opts.port as string || '3456', 10);

      console.log('\n🚀 Starting Passionfruit Review Server\n');
      console.log('  Port: ' + port);

      // Generate the single-page app shell
      console.log('\n  Generating review app...');
      const generator = new WebReviewGenerator(reviewDir);
      const htmlPath = await generator.generateAppShell();
      console.log('  ✅ Generated: ' + htmlPath);

      // Determine the questionnaire ID if provided
      let questionnaireId: string | undefined;
      if (file) {
        const fileName = file.split('/').pop() || file;
        const baseName = fileName.replace(/\.(xlsx?|json|yaml)$/i, '');
        questionnaireId = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
        console.log('  Questionnaire: ' + questionnaireId);
      }

      // Start server (use empty string for questionnaire since app handles multiple)
      const server = new ReviewServer(file || '', { port, reviewDir });
      await server.start();

      // Open browser
      if (opts.open !== false) {
        const url = questionnaireId ? `?q=${encodeURIComponent(questionnaireId)}` : '';
        server.openBrowser(url);
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// ENV - Show current environment configuration
// =============================================================================

program
  .command('env')
  .description('Show current Passionfruit API environment configuration')
  .option('--test', 'Test API connection')
  .action(async (opts) => {
    try {
      printEnvironmentInfo();

      if (opts.test) {
        if (!hasApiKey()) {
          console.log('Cannot test connection: PASSIONFRUIT_API_KEY not set\n');
          process.exit(1);
        }

        console.log('Testing API connection...');
        try {
          const client = new PassionfruitAPIClient();
          const stats = await client.getStats();
          console.log('✅ Connection successful!\n');
          console.log('API Stats:');
          console.log(`  Entities: ${stats.entities}`);
          console.log(`  Answers: ${stats.answers}`);
          console.log(`  Evidences: ${stats.evidences}`);
          console.log();
        } catch (error) {
          console.log('❌ Connection failed: ' + (error instanceof Error ? error.message : error));
          console.log();
          process.exit(1);
        }
      }
    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// HELP - Show the pipeline flow
// =============================================================================

program
  .command('flow')
  .description('Show the pipeline flow')
  .action(() => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              QUESTIONNAIRE EXTRACTION PIPELINE                 ║
╠═══════════════════════════════════════════════════════════════╣
║                                                                ║
║  1. STORE                                                      ║
║     npx tsx src/pipeline-v2/cli.ts store <file.xlsx>           ║
║     → Extracts Excel structure, preserves formatting           ║
║     → Output: questionnaires/*.json                            ║
║                                                                ║
║  2. INDEX                                                      ║
║     npx tsx src/pipeline-v2/cli.ts index <file.xlsx>           ║
║     → Claude AI analyzes layout, identifies evidence pieces    ║
║     → Output: indexed/*.yaml                                   ║
║                                                                ║
║  3. HARVEST                                                    ║
║     npx tsx src/pipeline-v2/cli.ts harvest                     ║
║     → Extracts entity-level answers for reuse                  ║
║     → Output: answer-library.yaml                              ║
║                                                                ║
║  4. REVIEW                                                     ║
║     npx tsx src/pipeline-v2/cli.ts serve <file.xlsx>           ║
║     → Interactive review with visual preview                   ║
║     → Approve items for entity DB and answer library           ║
║     → Output: approved-exports/<name>/*.json                   ║
║                                                                ║
║  5. SYNC (coming soon)                                         ║
║     npx tsx src/pipeline-v2/cli.ts sync-approved               ║
║     → Sync approved items to Passionfruit API                  ║
║     → Uploads evidence, creates entities, saves answers        ║
║                                                                ║
║  ENV                                                           ║
║     npx tsx src/pipeline-v2/cli.ts env                         ║
║     → Show current API environment (dev/production)            ║
║     → Set via PASSIONFRUIT_ENV environment variable            ║
║                                                                ║
╚═══════════════════════════════════════════════════════════════╝
`);
  });

program.parse();
