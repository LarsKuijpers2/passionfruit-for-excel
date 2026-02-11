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
import {
  getCustomerPaths,
  ensureCustomerDirs,
  listCustomers,
  getRulesDir,
  getLegacyPaths,
} from './customer-paths.js';

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
  .option('-c, --customer <name>', 'Customer name (uses customer folder structure)')
  .option('--output-dir <dir>', 'Output directory (legacy mode, ignored if --customer is set)')
  .option('--markdown', 'Also export to Markdown')
  .action(async (file: string, opts) => {
    try {
      const filePath = resolve(file);
      const customer = opts.customer as string | undefined;

      // Determine output directory
      let outputDir: string;
      if (customer) {
        const paths = ensureCustomerDirs(customer);
        outputDir = paths.questionnaires;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        outputDir = opts.outputDir as string || './questionnaires';
      }

      const docType = getDocumentType(filePath);
      console.log('\nStoring: ' + file + ' (' + docType + ')');

      const extractor = await getExtractor(filePath);
      const structure = await extractor.extract(filePath);

      // Check for sidecar .meta.json file (created by fetch command)
      const metadataPath = filePath + '.meta.json';
      try {
        const metadataContent = await readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataContent);
        if (metadata.evidenceId && metadata.evidenceName) {
          structure.source.evidenceId = metadata.evidenceId;
          structure.source.evidenceName = metadata.evidenceName;
          console.log(`  📎 API Source: Evidence #${metadata.evidenceId} - ${metadata.evidenceName}`);
        }
      } catch {
        // No metadata file, continue without API source info
      }

      console.log('  Sheets: ' + structure.stats.totalSheets);
      console.log('  Rows: ' + structure.stats.totalRows);
      console.log('  Filled cells: ' + structure.stats.filledCells + '/' + structure.stats.totalCells);

      console.log('\n  Sheets:');
      for (const sheet of structure.sheets) {
        const topic = sheet.topic ? ' [' + sheet.topic + ']' : '';
        console.log('    - ' + sheet.name + topic + ': ' + sheet.stats.filledCells + ' filled');
      }

      // Save JSON (TODO: convert to YAML in Phase 3)
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
  .option('-c, --customer <name>', 'Customer name (uses customer folder structure)')
  .option('--dir <dir>', 'Questionnaires directory (legacy mode)')
  .option('--output <dir>', 'Output directory for indexed questionnaires (legacy mode)')
  .option('--rules-dir <dir>', 'Rules directory (legacy mode)')
  .action(async (file: string, opts) => {
    try {
      const customer = opts.customer as string | undefined;

      // Determine directories based on customer or legacy mode
      let dir: string;
      let outputDir: string;
      let rulesDir: string;

      if (customer) {
        const paths = ensureCustomerDirs(customer);
        dir = paths.questionnaires;
        outputDir = paths.indexed;
        rulesDir = getRulesDir(customer);
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        dir = opts.dir as string || './questionnaires';
        outputDir = opts.output as string || './indexed';
        rulesDir = opts.rulesDir as string || './rules';
      }

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
// TAG - Assign destinations to indexed items based on rules
// =============================================================================

program
  .command('tag')
  .description('Assign destinations to indexed items based on tag-rules.yaml (items without matching rules get needs_review=true)')
  .argument('[file]', 'Specific indexed file to tag (optional - tags all if not provided)')
  .option('-c, --customer <name>', 'Customer name (uses customer folder structure)')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory (legacy mode)')
  .action(async (file: string | undefined, opts) => {
    try {
      const { tagQuestionnaire, tagAllQuestionnaires } = await import('./destination-tagger.js');
      const customer = opts.customer as string | undefined;

      let indexedDir: string;

      if (customer) {
        const paths = ensureCustomerDirs(customer);
        indexedDir = paths.indexed;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        indexedDir = opts.indexedDir as string || './indexed';
      }

      console.log('\n🏷️  Tagging destinations\n');

      if (file) {
        // Tag single file
        const filePath = (file.endsWith('.yaml') || file.endsWith('.json')) ? join(indexedDir, file) : join(indexedDir, `${file}.json`);
        console.log(`  File: ${file}`);
        const result = await tagQuestionnaire(filePath, customer);

        console.log('\n📊 Tagging Results:');
        console.log(`   Total items: ${result.totalItems}`);
        console.log(`   Tagged: ${result.tagged}`);
        console.log(`   Needs review: ${result.needsReview}`);
        console.log(`   Excluded: ${result.excluded}`);

        if (Object.keys(result.byDestination).length > 0) {
          console.log('\n📁 By Destination:');
          for (const [dest, count] of Object.entries(result.byDestination)) {
            console.log(`   ${dest}: ${count}`);
          }
        }
      } else {
        // Tag all files
        console.log(`  Directory: ${indexedDir}`);
        const results = await tagAllQuestionnaires(customer);

        // Summary
        const totals = results.reduce(
          (acc, r) => ({
            items: acc.items + r.totalItems,
            tagged: acc.tagged + r.tagged,
            review: acc.review + r.needsReview,
            excluded: acc.excluded + r.excluded,
          }),
          { items: 0, tagged: 0, review: 0, excluded: 0 }
        );

        console.log('\n📊 Summary:');
        console.log(`   Total items: ${totals.items}`);
        console.log(`   Tagged: ${totals.tagged}`);
        console.log(`   Needs review: ${totals.review}`);
        console.log(`   Excluded: ${totals.excluded}`);
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// HARVEST - DEPRECATED: Use TAG instead
// =============================================================================

program
  .command('harvest')
  .description('[DEPRECATED] Use "tag" command instead. Harvest was replaced by rule-based destination tagging.')
  .option('-c, --customer <name>', 'Customer name')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory')
  .option('--output <file>', 'Output library file')
  .option('--rules-dir <dir>', 'Rules directory')
  .option('--file <name>', 'Harvest from a specific indexed file only')
  .action(async (opts) => {
    console.log('\n⚠️  DEPRECATED: The "harvest" command has been replaced by "tag".\n');
    console.log('The new workflow is:');
    console.log('  1. INDEX  - AI extracts items with type, topic, level');
    console.log('  2. TAG    - Rules assign destinations (company, answer_library, product)');
    console.log('  3. REVIEW - Human reviews and approves items');
    console.log('  4. EXPORT - Approved items exported by destination\n');
    console.log('Run instead:');
    console.log('  npx tsx src/pipeline-v2/cli.ts tag' + (opts.customer ? ` -c ${opts.customer}` : '') + '\n');
    console.log('Or run "npx tsx src/pipeline-v2/cli.ts flow" to see the full pipeline.\n');
    process.exit(0);
  });

// =============================================================================
// CUSTOMERS - List all customers
// =============================================================================

program
  .command('customers')
  .description('List all customers with their data')
  .action(async () => {
    try {
      const customers = listCustomers();

      if (customers.length === 0) {
        console.log('\n📁 No customers found');
        console.log('   Create a customer with: npx tsx src/pipeline-v2/cli.ts store <file> --customer <name>\n');
        return;
      }

      console.log(`\n📁 Customers (${customers.length}):\n`);

      for (const customer of customers) {
        const paths = getCustomerPaths(customer);
        const { existsSync, readdirSync } = await import('fs');

        // Count files in each directory
        const countFiles = (dir: string, ext?: string) => {
          if (!existsSync(dir)) return 0;
          const files = readdirSync(dir);
          if (ext) return files.filter(f => f.endsWith(ext)).length;
          return files.filter(f => !f.startsWith('.')).length;
        };

        const questionnaires = countFiles(paths.questionnaires, '.json') + countFiles(paths.questionnaires, '.yaml');
        const indexed = countFiles(paths.indexed, '.json') + countFiles(paths.indexed, '.yaml');
        const approved = countFiles(paths.approved);
        const hasLibrary = existsSync(paths.answerLibrary);

        console.log(`  📦 ${customer}`);
        console.log(`     Questionnaires: ${questionnaires}`);
        console.log(`     Indexed: ${indexed}`);
        console.log(`     Approved: ${approved}`);
        console.log(`     Answer Library: ${hasLibrary ? '✓' : '—'}`);
        console.log();
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
  .option('-c, --customer <name>', 'Customer name (uses customer folder structure)')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory (legacy mode)')
  .option('--questionnaires-dir <dir>', 'Raw questionnaires directory (legacy mode)')
  .option('--review-dir <dir>', 'Review output directory (legacy mode)')
  .action(async (opts) => {
    try {
      const customer = opts.customer as string | undefined;

      let indexedDir: string;
      let questionnairesDir: string;
      let reviewDir: string;

      if (customer) {
        const paths = ensureCustomerDirs(customer);
        indexedDir = paths.indexed;
        questionnairesDir = paths.questionnaires;
        reviewDir = paths.review;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        indexedDir = opts.indexedDir as string || './indexed';
        questionnairesDir = opts.questionnairesDir as string || './questionnaires';
        reviewDir = opts.reviewDir as string || './review';
      }

      const reviewCli = new ReviewCLI(
        indexedDir,
        questionnairesDir,
        reviewDir
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
      const indexedPath = join(indexedDir, `${safeName}.json`);

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
// FETCH - Download questionnaire from Passionfruit API
// =============================================================================

program
  .command('fetch')
  .description('Fetch a questionnaire from Passionfruit API by evidence ID and process through pipeline')
  .argument('<evidenceId>', 'Passionfruit evidence ID')
  .option('-c, --customer <name>', 'Customer name (uses customer folder structure)')
  .option('--output-dir <dir>', 'Output directory for downloaded file (legacy mode)')
  .option('--process', 'Automatically run store and index after download')
  .option('--dry-run', 'Show what would be downloaded without actually downloading')
  .action(async (evidenceId: string, opts) => {
    try {
      const id = parseInt(evidenceId, 10);
      if (isNaN(id)) {
        throw new Error(`Invalid evidence ID: ${evidenceId}`);
      }

      if (!hasApiKey()) {
        console.error('\n❌ PASSIONFRUIT_API_KEY not set');
        console.error('Set the API key in your environment or .env file\n');
        process.exit(1);
      }

      // Prompt for customer name if not provided
      let customer = opts.customer as string | undefined;
      if (!customer) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        customer = await new Promise<string>((resolve) => {
          rl.question('\n📁 Enter customer name: ', (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        if (!customer) {
          console.error('❌ Customer name is required');
          process.exit(1);
        }
      }

      // Set up customer directories
      const paths = ensureCustomerDirs(customer);
      const incomingDir = paths.incoming;
      const questionnairesDir = paths.questionnaires;
      const indexedDir = paths.indexed;
      const rulesDir = getRulesDir(customer);
      console.log(`\n📁 Customer: ${customer}`);

      console.log(`\n🔄 Fetching evidence ${id} from Passionfruit API...\n`);

      const client = new PassionfruitAPIClient();

      // Show environment
      console.log(`  Environment: ${client.environment}`);
      console.log(`  API URL: ${client.url}`);

      if (opts.dryRun) {
        // Dry run - just show evidence info
        const evidence = await client.getEvidence(id);
        console.log('\n📄 Evidence Details:');
        console.log(`  ID: ${evidence.id}`);
        console.log(`  UUID: ${evidence.uuid}`);
        console.log(`  Name: ${evidence.name}`);
        console.log(`  Status: ${evidence.status}`);
        console.log(`  File Type: ${evidence.fileType || '(unknown)'}`);
        console.log(`  Has File URL: ${evidence.fileTempURL ? 'Yes' : 'No'}`);
        console.log(`  Classification: ${evidence.classification || '(none)'}`);

        if (!evidence.fileTempURL) {
          console.log('\n⚠️  This evidence has no file attached or URL is not available');
        }
        return;
      }

      // Fetch evidence and download file
      const { evidence, file } = await client.fetchEvidenceWithFile(id);

      console.log('\n📄 Evidence:');
      console.log(`  ID: ${evidence.id}`);
      console.log(`  Name: ${evidence.name}`);
      console.log(`  File: ${file.filename}`);
      console.log(`  Size: ${(file.buffer.length / 1024).toFixed(1)} KB`);

      // Save file to incoming folder
      const { writeFile: write, mkdir: mk } = await import('fs/promises');
      await mk(incomingDir, { recursive: true });

      const filepath = join(incomingDir, file.filename);
      await write(filepath, file.buffer);

      console.log(`\n✅ Downloaded: ${filepath}`);

      // Write metadata file alongside for pipeline to pick up
      const metadataPath = filepath + '.meta.json';
      await write(metadataPath, JSON.stringify({
        evidenceId: evidence.id,
        evidenceUuid: evidence.uuid,
        evidenceName: evidence.name,
        downloadedAt: new Date().toISOString(),
        classification: evidence.classification,
        fileType: evidence.fileType,
        metadata: evidence.metadata,
      }, null, 2));

      console.log(`✅ Metadata: ${metadataPath}`);

      // Optionally process through pipeline
      if (opts.process) {
        console.log('\n📦 Processing through pipeline...\n');

        // Store
        const extractor = await getExtractor(filepath);
        const structure = await extractor.extract(filepath);

        // Inject API source info
        structure.source.evidenceId = evidence.id;
        structure.source.evidenceName = evidence.name;

        const storage = new StructureStorage(questionnairesDir);
        const jsonPath = await storage.save(structure);
        console.log(`  ✅ Stored: ${jsonPath}`);

        // Index
        const indexer = new QuestionnaireIndexer(questionnairesDir, 'eu-central-1', rulesDir);
        const indexed = await indexer.index(file.filename);

        const indexedPath = await indexer.save(indexed, indexedDir);
        console.log(`  ✅ Indexed: ${indexedPath}`);

        console.log('\n✅ Pipeline complete! Run "tag" and "review" to continue.\n');
      } else {
        console.log('\n💡 Run with --process to automatically store and index the questionnaire\n');
      }

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// AGGREGATE - Aggregate customer data for import
// =============================================================================

program
  .command('aggregate')
  .description('Aggregate approved exports for a customer, deduplicating items and tracking sources')
  .argument('<customer>', 'Customer folder name in approved-exports/')
  .option('--output <path>', 'Output path for aggregated data')
  .action(async (customer: string, opts) => {
    try {
      const { aggregateCustomerData } = await import('./sync/aggregate-customer-data.js');
      const outputPath = opts.output || `./api-ready/${customer}-aggregated.json`;

      console.log(`\nAggregating data for customer: ${customer}\n`);

      const data = aggregateCustomerData(customer);

      // Ensure output directory exists
      const { mkdir, writeFile } = await import('fs/promises');
      const { dirname } = await import('path');
      await mkdir(dirname(outputPath), { recursive: true });

      await writeFile(outputPath, JSON.stringify(data, null, 2));

      console.log('\n=== AGGREGATION SUMMARY ===\n');
      console.log(`Customer: ${data.customer}`);
      console.log(`Questionnaires: ${data.questionnaires.length}`);

      console.log('\nAnswer Library:');
      console.log(`  Total items: ${data.answerLibrary.total}`);
      console.log(`  Unique items: ${data.answerLibrary.unique}`);
      console.log(`  Duplicates removed: ${data.answerLibrary.duplicates}`);

      console.log('\nEntity Data:');
      console.log(`  Total items: ${data.entityData.total}`);
      console.log(`  Unique items: ${data.entityData.unique}`);
      console.log(`  Duplicates removed: ${data.entityData.duplicates}`);

      console.log('\nItems in multiple questionnaires:', data.stats.multiSourceItems);
      console.log(`\n✅ Output: ${outputPath}`);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// GROUP - Group related items (question + follow-up comments)
// =============================================================================

program
  .command('group')
  .description('Group related items together (Yes/No questions with their follow-up comments)')
  .argument('<customer>', 'Customer folder name')
  .option('--input <path>', 'Path to aggregated data file')
  .option('--output <path>', 'Output path for grouped data')
  .action(async (customer: string, opts) => {
    try {
      const { groupRelatedItems } = await import('./sync/group-related-items.js');
      const inputPath = opts.input || `./api-ready/${customer}-aggregated.json`;
      const outputPath = opts.output || `./api-ready/${customer}-grouped.json`;

      const { existsSync } = await import('fs');
      if (!existsSync(inputPath)) {
        console.error(`\n❌ Aggregated data not found: ${inputPath}`);
        console.error('Run "aggregate" command first');
        process.exit(1);
      }

      console.log(`\nGrouping related items for: ${customer}\n`);

      const { readFileSync, writeFileSync } = await import('fs');
      const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
      const grouped = groupRelatedItems(data);

      writeFileSync(outputPath, JSON.stringify(grouped, null, 2));

      console.log('=== GROUPING SUMMARY ===\n');
      console.log(`Original items: ${data.answerLibrary.unique}`);
      console.log(`Items grouped: ${grouped.answerLibrary.grouped}`);
      console.log(`Final items: ${grouped.answerLibrary.items.length}`);

      const withFollowUps = grouped.answerLibrary.items.filter((i: any) => i.followUps?.length > 0);
      console.log(`\nItems with follow-ups merged: ${withFollowUps.length}`);
      console.log(`\n✅ Output: ${outputPath}`);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// PREPARE-IMPORT - Prepare aggregated data for API import
// =============================================================================

program
  .command('prepare-import')
  .description('Prepare aggregated customer data for Passionfruit API import')
  .argument('<customer>', 'Customer folder name')
  .option('--aggregated <path>', 'Path to aggregated data file')
  .option('--output <path>', 'Output path for import preview')
  .action(async (customer: string, opts) => {
    try {
      const { prepareCustomerImport } = await import('./sync/prepare-customer-import.js');
      const aggregatedPath = opts.aggregated || `./api-ready/${customer}-aggregated.json`;
      const outputPath = opts.output || `./api-ready/${customer}-import-preview.json`;

      const { existsSync } = await import('fs');
      if (!existsSync(aggregatedPath)) {
        console.error(`\n❌ Aggregated data not found: ${aggregatedPath}`);
        console.error('Run "aggregate" command first');
        process.exit(1);
      }

      console.log(`\nPreparing import for: ${customer}\n`);

      const preview = prepareCustomerImport(aggregatedPath);

      const { writeFile } = await import('fs/promises');
      await writeFile(outputPath, JSON.stringify(preview, null, 2));

      console.log('=== IMPORT PREVIEW ===\n');
      console.log(`Customer: ${preview.customer}`);
      console.log(`Entity: ${preview.entity.name}`);
      console.log(`  Top-level fields: ${Object.keys(preview.entity.fields).length}`);
      console.log(`  Additional data: ${Object.keys(preview.entity.data).length}`);
      console.log(`\nAnswers: ${preview.stats.totalAnswers}`);
      console.log(`  To create: ${preview.stats.toCreate}`);
      console.log(`  To update: ${preview.stats.toUpdate}`);
      console.log(`\n✅ Output: ${outputPath}`);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// SYNC-NSLIBRARY - Sync answers to NSLibrary via API
// =============================================================================

program
  .command('sync-nslibrary')
  .description('Sync grouped customer answers to NSLibrary via Passionfruit API')
  .argument('<customer>', 'Customer folder name')
  .option('--dry-run', 'Preview changes without making API calls')
  .option('--entity <id>', 'Link answers to entity ID')
  .action(async (customer: string, opts) => {
    try {
      const { syncToNSLibrary } = await import('./sync/sync-to-nslibrary.js');
      const groupedPath = `./api-ready/${customer}-grouped.json`;

      const { existsSync } = await import('fs');
      if (!existsSync(groupedPath)) {
        console.error(`\n❌ Grouped data not found: ${groupedPath}`);
        console.error('Run "aggregate" and "group" commands first');
        process.exit(1);
      }

      const entityId = opts.entity ? parseInt(opts.entity) : undefined;
      const result = await syncToNSLibrary(groupedPath, {
        dryRun: opts.dryRun,
        entityId,
      });

      console.log('\n=== SYNC COMPLETE ===');
      console.log(`Created: ${result.created}`);
      console.log(`Updated: ${result.updated}`);
      console.log(`Skipped: ${result.skipped}`);
      console.log(`Failed: ${result.failed}`);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// ADD-TO-LIBRARY - Add aggregated data to answer library
// =============================================================================

program
  .command('add-to-library')
  .description('Add grouped customer data to answer-library.yaml')
  .argument('<customer>', 'Customer folder name')
  .option('--grouped <path>', 'Path to grouped data file')
  .option('--library <path>', 'Path to answer library', './answer-library.yaml')
  .action(async (customer: string, opts) => {
    try {
      const { addToAnswerLibrary } = await import('./sync/add-to-answer-library.js');
      const groupedPath = opts.grouped || `./api-ready/${customer}-grouped.json`;
      const libraryPath = opts.library || './answer-library.yaml';

      const { existsSync } = await import('fs');
      if (!existsSync(groupedPath)) {
        console.error(`\n❌ Grouped data not found: ${groupedPath}`);
        console.error('Run "aggregate" and "group" commands first');
        process.exit(1);
      }

      console.log(`\nAdding ${customer} data to answer library...`);
      addToAnswerLibrary(groupedPath, libraryPath);

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
║  All commands support --customer <name> for per-customer data  ║
║                                                                ║
║  CUSTOMER FOLDER STRUCTURE:                                    ║
║  customers/<name>/                                             ║
║    ├── incoming/         # Drop questionnaire files here       ║
║    ├── questionnaires/   # Stored raw structures               ║
║    ├── indexed/          # AI-indexed files                    ║
║    ├── approved/         # Approved exports                    ║
║    ├── answer-library.yaml                                     ║
║    └── rules/            # Customer-specific rules             ║
║                                                                ║
║  1. STORE                                                      ║
║     npx tsx src/pipeline-v2/cli.ts store <file> -c <customer>  ║
║     → Extracts structure, preserves formatting                 ║
║     → Output: customers/<customer>/questionnaires/*.json       ║
║                                                                ║
║  2. INDEX                                                      ║
║     npx tsx src/pipeline-v2/cli.ts index <file> -c <customer>  ║
║     → Claude AI extracts: label, value, type, topic, level     ║
║     → Output: customers/<customer>/indexed/*.yaml              ║
║                                                                ║
║  3. TAG                                                        ║
║     npx tsx src/pipeline-v2/cli.ts tag [file] -c <customer>    ║
║     → Assigns destinations based on tag-rules.yaml             ║
║     → Items without matching rules get needs_review=true       ║
║     → Updates: customers/<customer>/indexed/*.yaml             ║
║                                                                ║
║  4. SAVE                                                       ║
║     npx tsx src/pipeline-v2/cli.ts serve <file> -c <customer>  ║
║     → Interactive review with visual preview                   ║
║     → Assign destinations for needs_review items               ║
║     → Approve items for export                                 ║
║     → Output: customers/<customer>/approved/*.yaml             ║
║                                                                ║
║  5. AGGREGATE                                                  ║
║     npx tsx src/pipeline-v2/cli.ts aggregate <customer>        ║
║     → Aggregate approved exports for a customer                ║
║     → Deduplicate items, track sources across questionnaires   ║
║     → Output: api-ready/<customer>-aggregated.json             ║
║                                                                ║
║  6. GROUP                                                      ║
║     npx tsx src/pipeline-v2/cli.ts group <customer>            ║
║     → Group related items (Yes/No + follow-up comments)        ║
║     → Merge comments into parent questions                     ║
║     → Output: api-ready/<customer>-grouped.json                ║
║                                                                ║
║  7. PREPARE-IMPORT                                             ║
║     npx tsx src/pipeline-v2/cli.ts prepare-import <customer>   ║
║     → Convert aggregated data to API format                    ║
║     → Map entity fields, prepare answers                       ║
║     → Output: api-ready/<customer>-import-preview.json         ║
║                                                                ║
║  8. SYNC (coming soon)                                         ║
║     npx tsx src/pipeline-v2/cli.ts sync-import <customer>      ║
║     → Sync prepared data to Passionfruit API                   ║
║     → Creates entity, uploads answers                          ║
║                                                                ║
║  CUSTOMERS                                                     ║
║     npx tsx src/pipeline-v2/cli.ts customers                   ║
║     → List all customers with their data                       ║
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
