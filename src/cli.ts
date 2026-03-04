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
 *   train-model    - Train custom Azure model from approved data
 *   test-enhanced  - Test enhanced extraction on documents
 *   optimize       - Apply current extraction optimizations
 */

// Load environment variables from .env file
import 'dotenv/config';

import { Command } from 'commander';
import { resolve, join } from 'path';
import { readdir, readFile } from 'fs/promises';
import {
  StructureStorage,
  structureToMarkdown,
} from './services/extractors/excel.js';
import { getExtractor, getDocumentType } from './services/extractors/index.js';
import { VisualAnalyzer } from './services/analysis/visual-analyzer.js';
import { QuestionnaireIndexer } from './services/analysis/questionnaire-indexer.js';
import { AnswerHarvester } from './services/analysis/answer-harvester.js';
import { ReviewCLI } from './services/review/review-cli.js';
import { WebReviewGenerator } from './services/review/web-generator.js';
import { ReviewServer } from './server.js';
import { printEnvironmentInfo, getConfig, hasApiKey } from './config/environments.js';
import { PassionfruitAPIClient } from './services/sync/api-client.js';
import {
  getCustomerPaths,
  ensureCustomerDirs,
  listCustomers,
  getRulesDir,
  getLegacyPaths,
} from './utils/customer-paths.js';
import { classifyDocument } from './services/analysis/document-classifier.js';

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
  .option('-e, --extractor <type>', 'PDF extractor: azure | vision | two-pass-vision (default: azure)', 'azure')
  .option('--output-dir <dir>', 'Output directory (legacy mode, ignored if --customer is set)')
  .option('--markdown', 'Also export to Markdown')
  .option('--overwrite', 'Overwrite existing structure even if it has manual edits')
  .action(async (file: string, opts) => {
    try {
      const filePath = resolve(file);
      const customer = opts.customer as string | undefined;

      // Determine output directory
      let outputDir: string;
      if (customer) {
        const paths = ensureCustomerDirs(customer);
        outputDir = paths.structure;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        outputDir = opts.outputDir as string || './structure';
      }

      const docType = getDocumentType(filePath);
      const extractorType = opts.extractor as 'azure' | 'vision' | 'two-pass-vision';
      const extractorLabel = docType === 'pdf' && extractorType !== 'azure' ? ` [${extractorType}]` : '';
      console.log('\nStoring: ' + file + ' (' + docType + ')' + extractorLabel);

      const extractor = await getExtractor(filePath, {
        customerDir: customer ? `./customers/${customer}` : undefined,
        pdfExtractor: extractorType,
      });
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

      // Apply structure training (learned extraction corrections) if customer specified
      let trainingApplied = 0;
      if (customer) {
        try {
          const { structureTrainingProcessor } = await import('./services/training/structure-training-processor.js');
          const training = await structureTrainingProcessor.loadCompiled(customer);

          if (training && training.substitutionRules.length > 0) {
            console.log('\n🎓 Applying learned extraction corrections...');

            // Apply corrections to all cell values in the structure
            for (const sheet of structure.sheets) {
              for (const row of sheet.rows) {
                for (const [col, cell] of Object.entries(row.cells)) {
                  if (cell.value) {
                    const result = structureTrainingProcessor.applyCorrections(cell.value, training);
                    if (result.changes.length > 0) {
                      cell.value = result.corrected;
                      trainingApplied += result.changes.length;
                      // Log first few corrections
                      if (trainingApplied <= 5) {
                        for (const change of result.changes) {
                          console.log(`   ${cell.ref}: "${change.from}" → "${change.to}"`);
                        }
                      }
                    }
                  }
                }
              }
            }

            if (trainingApplied > 0) {
              console.log(`   ✅ Applied ${trainingApplied} auto-corrections from training data`);
              if (trainingApplied > 5) {
                console.log(`   (showing first 5 of ${trainingApplied})`);
              }
            } else {
              console.log('   No corrections needed');
            }
          }
        } catch (e) {
          // No compiled training data available, continue without
        }
      }

      console.log('\n  Sheets:');
      for (const sheet of structure.sheets) {
        const topic = sheet.topic ? ' [' + sheet.topic + ']' : '';
        console.log('    - ' + sheet.name + topic + ': ' + sheet.stats.filledCells + ' filled');
      }

      const storage = new StructureStorage(outputDir);
      const jsonPath = await storage.save(structure, { overwrite: !!opts.overwrite });
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
  .option('--dir <dir>', 'Structure directory (legacy mode)')
  .option('--output <dir>', 'Output directory for indexed questionnaires (legacy mode)')
  .option('--rules-dir <dir>', 'Rules directory (legacy mode)')
  .option('--no-vision', 'Skip Claude Vision validation for PDFs')
  .option('-s, --strategy <strategy>', 'Extraction strategy: azure (local JSON), vision (Claude Vision), both, or legacy (default: legacy)', 'legacy')
  .action(async (file: string, opts) => {
    try {
      const customer = opts.customer as string | undefined;
      const useVision = opts.vision !== false;
      const strategy = (opts.strategy as string || 'legacy') as 'azure' | 'vision' | 'both' | 'legacy';

      // Determine directories based on customer or legacy mode
      let dir: string;
      let outputDir: string;
      let rulesDir: string;
      let incomingDir: string | undefined;

      if (customer) {
        const paths = ensureCustomerDirs(customer);
        dir = paths.structure;
        outputDir = paths.indexed;
        rulesDir = getRulesDir(customer);
        incomingDir = paths.incoming;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        dir = opts.dir as string || './structure';
        outputDir = opts.output as string || './indexed';
        rulesDir = opts.rulesDir as string || './rules';
      }

      console.log('\n📇 Indexing: ' + file);
      console.log('   Strategy: ' + strategy + '\n');

      const indexer = new QuestionnaireIndexer(dir, 'eu-central-1', rulesDir);

      // Use strategy-based indexing if not legacy
      if (strategy !== 'legacy') {
        // Find PDF path for vision strategy
        let pdfPath: string | undefined;
        if (strategy === 'vision' || strategy === 'both') {
          const { existsSync } = await import('fs');
          const { readdir } = await import('fs/promises');

          // If input file is already a PDF, use it directly
          if (file.toLowerCase().endsWith('.pdf') && existsSync(file)) {
            pdfPath = file;
          } else if (incomingDir) {
            // Otherwise search for a matching PDF in the incoming directory
            const sourceName = file.replace(/\.(json|xlsx?|docx?)$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
            const files = await readdir(incomingDir);
            const baseWords = sourceName.toLowerCase().split('_').filter(w => w.length > 3).slice(0, 3);

            for (const f of files) {
              if (f.toLowerCase().endsWith('.pdf')) {
                const matches = baseWords.filter(w => f.toLowerCase().includes(w));
                if (matches.length >= 2) {
                  pdfPath = join(incomingDir, f);
                  break;
                }
              }
            }
          }
        }

        const result = await indexer.indexWithStrategy(file, strategy, {
          outputDir,
          pdfPath,
        });

        // Print summary
        if (result.azure) {
          console.log('\n📊 Azure Results:');
          console.log('   Total items: ' + result.azure.stats.total);
          console.log('   Answered: ' + result.azure.stats.answered);
        }
        if (result.vision) {
          console.log('\n📊 Vision Results:');
          console.log('   Total items: ' + result.vision.stats.total);
          console.log('   Answered: ' + result.vision.stats.answered);
        }

        console.log('\n💾 Output files saved to: ' + outputDir);
        return;
      }

      // Legacy mode - original behavior
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

      // Enhance PDFs with Claude Vision for strikethrough detection
      if (useVision && incomingDir) {
        const { existsSync } = await import('fs');
        const { enhanceWithVision } = await import('./services/extractors/vision-enhancer.js');

        // Find the original PDF
        const sourceName = indexed.source.replace(/\.json$/, '');
        const possiblePdfNames = [
          sourceName,
          sourceName.replace(/_/g, ' '),
          sourceName.replace(/__/g, ' (').replace(/_(\d)_/g, ')$1(') // Handle encoded parentheses
        ];

        let pdfPath: string | null = null;
        for (const name of possiblePdfNames) {
          const testPath = join(incomingDir, name);
          if (existsSync(testPath) && testPath.toLowerCase().endsWith('.pdf')) {
            pdfPath = testPath;
            break;
          }
          if (existsSync(testPath + '.pdf')) {
            pdfPath = testPath + '.pdf';
            break;
          }
        }

        // Also try to find any PDF with similar name
        if (!pdfPath) {
          const { readdir } = await import('fs/promises');
          const files = await readdir(incomingDir);
          const baseWords = sourceName.toLowerCase().split('_').filter(w => w.length > 3).slice(0, 3);
          for (const f of files) {
            if (f.toLowerCase().endsWith('.pdf')) {
              const matches = baseWords.filter(w => f.toLowerCase().includes(w));
              if (matches.length >= 2) {
                pdfPath = join(incomingDir, f);
                break;
              }
            }
          }
        }

        if (pdfPath && existsSync(pdfPath)) {
          // Vision validation - flags discrepancies for human review, never auto-corrects
          console.log('\n👁️  Validating with Claude Vision...');
          console.log('   (compares extraction against what Vision sees in the PDF)');
          const validation = await enhanceWithVision(outputPath, pdfPath);

          const accuracy = validation.totalItems > 0
            ? ((validation.matchedCorrectly / validation.totalItems) * 100).toFixed(0)
            : '0';

          if (validation.discrepancies.length === 0) {
            console.log(`   ✅ Vision confirms extraction (${accuracy}% match, ${validation.matchedCorrectly}/${validation.totalItems} items)`);
          } else {
            console.log(`   ⚠️  Found ${validation.discrepancies.length} discrepancies to review`);
            console.log(`   📊 Matched: ${validation.matchedCorrectly}/${validation.totalItems} (${accuracy}%)`);
            // Show first few discrepancies
            for (const d of validation.discrepancies.slice(0, 3)) {
              console.log(`      - "${d.label.slice(0, 40)}..." Base: ${d.baseValue || '(empty)'} → Vision: ${d.visionValue}`);
            }
            if (validation.discrepancies.length > 3) {
              console.log(`      ... and ${validation.discrepancies.length - 3} more`);
            }
          }
        }
      }

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
      const { tagQuestionnaire, tagAllQuestionnaires } = await import('./services/analysis/destination-tagger.js');
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

        const questionnaires = countFiles(paths.structure, '.json') + countFiles(paths.structure, '.yaml');
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
  .option('--structure-dir <dir>', 'Raw structure directory (legacy mode)')
  .option('--review-dir <dir>', 'Review output directory (legacy mode)')
  .action(async (opts) => {
    try {
      const customer = opts.customer as string | undefined;

      let indexedDir: string;
      let structureDir: string;
      let reviewDir: string;

      if (customer) {
        const paths = ensureCustomerDirs(customer);
        indexedDir = paths.indexed;
        structureDir = paths.structure;
        reviewDir = paths.review;
        console.log(`\n📁 Customer: ${customer}`);
      } else {
        indexedDir = opts.indexedDir as string || './indexed';
        structureDir = opts.structureDir as string || './structure';
        reviewDir = opts.reviewDir as string || './review';
      }

      const reviewCli = new ReviewCLI(
        indexedDir,
        structureDir,
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
  .option('--dir <dir>', 'Storage directory', './structure')
  .action(async (opts) => {
    try {
      const dir = opts.dir as string || './structure';
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
  .option('--structure-dir <dir>', 'Structure directory', './structure')
  .option('--indexed-dir <dir>', 'Indexed questionnaires directory', './indexed')
  .option('--library <file>', 'Answer library file', './answer-library.yaml')
  .option('--output <dir>', 'Output directory', './review')
  .action(async (file: string, opts) => {
    try {
      const structureDir = opts.structureDir as string || './structure';
      const indexedDir = opts.indexedDir as string || './indexed';
      const libraryPath = opts.library as string || './answer-library.yaml';
      const outputDir = opts.output as string || './review';

      // Normalize filename (preserve hyphens like other parts of pipeline)
      const baseName = file.replace(/\.(xlsx?|json|yaml)$/i, '');
      const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');

      // Find the structure file
      const structurePath = join(structureDir, `${safeName}.json`);
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
  .option('--structure-dir <dir>', 'Structure directory', './structure')
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
  .option('-e, --extractor <type>', 'PDF extractor: azure | vision | two-pass-vision (default: azure)', 'azure')
  .option('--output-dir <dir>', 'Output directory for downloaded file (legacy mode)')
  .option('--process', 'Automatically run store and index after download')
  .option('--dry-run', 'Show what would be downloaded without actually downloading')
  .option('--overwrite', 'Overwrite existing structure even if it has manual edits')
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
      const structureDir = paths.structure;
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
        const extractorType = opts.extractor as 'azure' | 'vision' | 'two-pass-vision';
        const extractor = await getExtractor(filepath, {
          customerDir: `./customers/${customer}`,
          pdfExtractor: extractorType,
        });
        const structure = await extractor.extract(filepath);

        // Inject API source info
        structure.source.evidenceId = evidence.id;
        structure.source.evidenceName = evidence.name;

        // Apply structure training (learned extraction corrections)
        try {
          const { structureTrainingProcessor } = await import('./services/training/structure-training-processor.js');
          const training = await structureTrainingProcessor.loadCompiled(customer);

          if (training && training.substitutionRules.length > 0) {
            let trainingApplied = 0;
            for (const sheet of structure.sheets) {
              for (const row of sheet.rows) {
                for (const [col, cell] of Object.entries(row.cells)) {
                  if (cell.value) {
                    const result = structureTrainingProcessor.applyCorrections(cell.value, training);
                    if (result.changes.length > 0) {
                      cell.value = result.corrected;
                      trainingApplied += result.changes.length;
                    }
                  }
                }
              }
            }
            if (trainingApplied > 0) {
              console.log(`  🎓 Applied ${trainingApplied} learned corrections`);
            }
          }
        } catch {
          // No compiled training data available
        }

        const storage = new StructureStorage(structureDir);
        const jsonPath = await storage.save(structure, { overwrite: !!opts.overwrite });
        console.log(`  ✅ Stored: ${jsonPath}`);

        // Index
        const indexer = new QuestionnaireIndexer(structureDir, 'eu-central-1', rulesDir);
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
// BATCH-FETCH - Download multiple questionnaires from Passionfruit API
// =============================================================================

program
  .command('batch-fetch')
  .description('Fetch multiple questionnaires from Passionfruit API by evidence IDs')
  .argument('<evidenceIds...>', 'Passionfruit evidence IDs (space or comma separated)')
  .requiredOption('-c, --customer <name>', 'Customer name (required)')
  .option('-e, --extractor <type>', 'PDF extractor: azure | vision | two-pass-vision (default: azure)', 'azure')
  .option('--process', 'Automatically run store and index after download (default: true)', true)
  .option('--no-process', 'Skip automatic processing')
  .option('--dry-run', 'Show what would be downloaded without actually downloading')
  .option('--continue-on-error', 'Continue processing remaining IDs if one fails')
  .option('--overwrite', 'Overwrite existing structures even if they have manual edits')
  .action(async (evidenceIdsRaw: string[], opts) => {
    try {
      // Parse evidence IDs (handle both space and comma separated)
      const evidenceIds = evidenceIdsRaw
        .flatMap(id => id.split(','))
        .map(id => id.trim())
        .filter(id => id.length > 0)
        .map(id => {
          const num = parseInt(id, 10);
          if (isNaN(num)) {
            throw new Error(`Invalid evidence ID: ${id}`);
          }
          return num;
        });

      if (evidenceIds.length === 0) {
        throw new Error('No evidence IDs provided');
      }

      if (!hasApiKey()) {
        console.error('\n❌ PASSIONFRUIT_API_KEY not set');
        console.error('Set the API key in your environment or .env file\n');
        process.exit(1);
      }

      const customer = opts.customer as string;
      const paths = ensureCustomerDirs(customer);
      const incomingDir = paths.incoming;
      const structureDir = paths.structure;
      const indexedDir = paths.indexed;
      const rulesDir = getRulesDir(customer);

      console.log(`\n📁 Customer: ${customer}`);
      console.log(`📋 Processing ${evidenceIds.length} evidence IDs: ${evidenceIds.join(', ')}\n`);

      const client = new PassionfruitAPIClient();
      console.log(`  Environment: ${client.environment}`);
      console.log(`  API URL: ${client.url}\n`);

      const results: { id: number; status: 'success' | 'error'; name?: string; error?: string }[] = [];

      for (let i = 0; i < evidenceIds.length; i++) {
        const id = evidenceIds[i];
        console.log(`\n[${'─'.repeat(60)}]`);
        console.log(`[${i + 1}/${evidenceIds.length}] Evidence ID: ${id}`);
        console.log(`[${'─'.repeat(60)}]`);

        try {
          if (opts.dryRun) {
            const evidence = await client.getEvidence(id);
            console.log(`  Name: ${evidence.name}`);
            console.log(`  File: ${evidence.fileType || '(unknown)'}`);
            console.log(`  Has URL: ${evidence.fileTempURL ? 'Yes' : 'No'}`);
            results.push({ id, status: 'success', name: evidence.name });
            continue;
          }

          // Fetch evidence and download file
          const { evidence, file } = await client.fetchEvidenceWithFile(id);
          console.log(`  Name: ${evidence.name}`);
          console.log(`  File: ${file.filename}`);
          console.log(`  Size: ${(file.buffer.length / 1024).toFixed(1)} KB`);

          // Save file
          const { writeFile: write, mkdir: mk } = await import('fs/promises');
          await mk(incomingDir, { recursive: true });
          const filepath = join(incomingDir, file.filename);
          await write(filepath, file.buffer);
          console.log(`  ✅ Downloaded`);

          // Write metadata
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

          // Process if requested
          if (opts.process) {
            const extractorType = opts.extractor as 'azure' | 'vision' | 'two-pass-vision';
            const extractor = await getExtractor(filepath, {
              customerDir: `./customers/${customer}`,
              pdfExtractor: extractorType,
            });
            const structure = await extractor.extract(filepath);
            structure.source.evidenceId = evidence.id;
            structure.source.evidenceName = evidence.name;

            // Apply structure training (learned extraction corrections)
            try {
              const { structureTrainingProcessor } = await import('./services/training/structure-training-processor.js');
              const training = await structureTrainingProcessor.loadCompiled(customer);

              if (training && training.substitutionRules.length > 0) {
                let trainingApplied = 0;
                for (const sheet of structure.sheets) {
                  for (const row of sheet.rows) {
                    for (const [col, cell] of Object.entries(row.cells)) {
                      if (cell.value) {
                        const result = structureTrainingProcessor.applyCorrections(cell.value, training);
                        if (result.changes.length > 0) {
                          cell.value = result.corrected;
                          trainingApplied += result.changes.length;
                        }
                      }
                    }
                  }
                }
                if (trainingApplied > 0) {
                  console.log(`  🎓 Applied ${trainingApplied} learned corrections`);
                }
              }
            } catch {
              // No compiled training data available
            }

            const storage = new StructureStorage(structureDir);
            await storage.save(structure, { overwrite: !!opts.overwrite });
            console.log(`  ✅ Stored`);

            const indexer = new QuestionnaireIndexer(structureDir, 'eu-central-1', rulesDir);
            const indexed = await indexer.index(file.filename);
            await indexer.save(indexed, indexedDir);
            console.log(`  ✅ Indexed (${indexed.stats.total} items)`);
          }

          results.push({ id, status: 'success', name: evidence.name });

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  ❌ Error: ${errorMsg}`);
          results.push({ id, status: 'error', error: errorMsg });

          if (!opts.continueOnError) {
            throw error;
          }
        }
      }

      // Summary
      console.log(`\n${'═'.repeat(60)}`);
      console.log('BATCH FETCH SUMMARY');
      console.log(`${'═'.repeat(60)}`);

      const successful = results.filter(r => r.status === 'success');
      const failed = results.filter(r => r.status === 'error');

      console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
      for (const r of successful) {
        console.log(`   ${r.id}: ${r.name || '(processed)'}`);
      }

      if (failed.length > 0) {
        console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
        for (const r of failed) {
          console.log(`   ${r.id}: ${r.error}`);
        }
      }

      console.log();

      if (failed.length > 0 && !opts.continueOnError) {
        process.exit(1);
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
      const { aggregateCustomerData } = await import('./services/sync/aggregate-customer-data.js');
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
      const { groupRelatedItems } = await import('./services/sync/group-related-items.js');
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
      const { prepareCustomerImport } = await import('./services/sync/prepare-customer-import.js');
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
      const { syncToNSLibrary } = await import('./services/sync/sync-to-nslibrary.js');
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
      const { addToAnswerLibrary } = await import('./services/sync/add-to-answer-library.js');
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
// COMPARE-API - Compare indexed questionnaire with existing API answers
// =============================================================================

program
  .command('compare-api')
  .description('Compare indexed questionnaire with existing NS library answers, export duplicates to Excel')
  .argument('<questionnaire>', 'Indexed questionnaire filename')
  .option('-c, --customer <name>', 'Customer name', 'Doehler Oosterhout')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)', '0.4')
  .option('-o, --output <file>', 'Output TSV file name', 'duplicates-comparison.tsv')
  .action(async (questionnaire: string, opts) => {
    try {
      const { readFile, writeFile } = await import('fs/promises');
      const { join } = await import('path');

      const customer = opts.customer as string;
      const threshold = parseFloat(opts.threshold as string);
      const outputFile = opts.output as string;

      console.log(`\n📊 Comparing ${questionnaire} with API answers`);
      console.log(`   Customer: ${customer}`);
      console.log(`   Threshold: ${(threshold * 100).toFixed(0)}%`);

      // Load indexed questionnaire
      const paths = getCustomerPaths(customer);
      const indexedPath = join(paths.indexed, questionnaire);

      let data;
      try {
        data = JSON.parse(await readFile(indexedPath, 'utf-8'));
      } catch {
        console.error(`\n❌ Could not read: ${indexedPath}`);
        process.exit(1);
      }

      // Extract items from indexed questionnaire
      interface LocalItem {
        id: string;
        label: string;
        value: string;
        section: string;
      }

      const localItems: LocalItem[] = [];
      for (const section of data.sections || []) {
        for (const item of section.items || []) {
          if (item.label && item.value) {
            localItems.push({
              id: item.id,
              label: item.label,
              value: item.value,
              section: section.title,
            });
          }
        }
      }

      console.log(`   Local items: ${localItems.length}`);

      // Fetch API answers
      const client = new PassionfruitAPIClient();
      const apiAnswers = await client.listAnswers();

      // Deduplicate (API pagination bug returns duplicates)
      const uniqueAnswers = new Map<number, typeof apiAnswers[0]>();
      for (const a of apiAnswers) {
        uniqueAnswers.set(a.id, a);
      }
      const existingAnswers = Array.from(uniqueAnswers.values());

      console.log(`   API answers: ${existingAnswers.length}`);

      // Similarity function
      const calculateSimilarity = (q1: string, q2: string): number => {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const words1 = new Set(normalize(q1));
        const words2 = new Set(normalize(q2));
        if (words1.size === 0 || words2.size === 0) return 0;
        const intersection = [...words1].filter(w => words2.has(w)).length;
        const union = new Set([...words1, ...words2]).size;
        return intersection / union;
      };

      // Find matches
      const matches: Array<{
        existing: typeof existingAnswers[0];
        local: LocalItem;
        similarity: number;
      }> = [];

      for (const existing of existingAnswers) {
        for (const local of localItems) {
          const similarity = calculateSimilarity(existing.question, local.label);
          if (similarity >= threshold) {
            matches.push({ existing, local, similarity });
          }
        }
      }

      matches.sort((a, b) => b.similarity - a.similarity);

      console.log(`\n   Matches found: ${matches.length}`);

      // Show top matches
      if (matches.length > 0) {
        console.log('\n   Top matches:');
        for (const m of matches.slice(0, 5)) {
          const sameAnswer = m.existing.answer.toLowerCase().trim() === m.local.value.toLowerCase().trim();
          console.log(`     [${(m.similarity * 100).toFixed(0)}%] ${sameAnswer ? '✓' : '≠'} ${m.existing.question.slice(0, 50)}...`);
        }
        if (matches.length > 5) {
          console.log(`     ... and ${matches.length - 5} more`);
        }
      }

      // Export to TSV
      const tsvRows: string[] = [];
      tsvRows.push([
        'Similarity',
        'API ID',
        'API Question',
        'API Answer',
        'Local Section',
        'Local Question',
        'Local Answer',
        'Same Answer?',
        'Action',
      ].join('\t'));

      for (const m of matches) {
        const sameAnswer = m.existing.answer.toLowerCase().trim() === m.local.value.toLowerCase().trim();
        tsvRows.push([
          (m.similarity * 100).toFixed(0) + '%',
          m.existing.id.toString(),
          m.existing.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
          m.existing.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
          m.local.section,
          m.local.label.replace(/\t/g, ' ').replace(/\n/g, ' '),
          m.local.value.replace(/\t/g, ' ').replace(/\n/g, ' '),
          sameAnswer ? 'YES' : 'NO',
          '',
        ].join('\t'));
      }

      // Add unmatched API answers
      const matchedApiIds = new Set(matches.map(m => m.existing.id));
      const unmatchedApi = existingAnswers.filter(a => !matchedApiIds.has(a.id));

      if (unmatchedApi.length > 0) {
        tsvRows.push('');
        tsvRows.push('--- API ANSWERS NOT IN LOCAL QUESTIONNAIRE ---');
        for (const a of unmatchedApi) {
          tsvRows.push([
            'no match',
            a.id.toString(),
            a.question.replace(/\t/g, ' ').replace(/\n/g, ' '),
            a.answer.replace(/\t/g, ' ').replace(/\n/g, ' '),
            '',
            '',
            '',
            '',
            '',
          ].join('\t'));
        }
      }

      const outputPath = join(`./customers/${customer}`, outputFile);
      await writeFile(outputPath, tsvRows.join('\n'));

      console.log(`\n✅ Exported to: ${outputPath}`);
      console.log('   (Tab-separated file - open in Excel)\n');

      // Summary
      const sameAnswerCount = matches.filter(m =>
        m.existing.answer.toLowerCase().trim() === m.local.value.toLowerCase().trim()
      ).length;

      console.log('Summary:');
      console.log(`  Local items: ${localItems.length}`);
      console.log(`  API answers: ${existingAnswers.length}`);
      console.log(`  Matches: ${matches.length}`);
      console.log(`  Same answer content: ${sameAnswerCount}`);
      console.log(`  Unmatched API: ${unmatchedApi.length}`);

    } catch (error) {
      console.error('\n❌ Error: ' + (error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });

// =============================================================================
// LEARN - Self-learning system for extraction quality
// =============================================================================

program
  .command('learn')
  .description('Run extraction learning cycle - analyze feedback notes and generate improvements')
  .option('--report', 'Generate detailed markdown report')
  .option('--export', 'Export prompt improvements to file')
  .action(async (opts) => {
    try {
      const { runLearningCycle, ExtractionLearner } = await import('./services/learning/extraction-learner.js');
      const { writeFile } = await import('fs/promises');

      await runLearningCycle('./customers');

      if (opts.report || opts.export) {
        const learner = new ExtractionLearner();
        await learner.load();

        if (opts.export) {
          const additions = learner.exportPromptAdditions();
          const exportPath = './knowledge/prompt-improvements.txt';
          await writeFile(exportPath, additions);
          console.log(`\n📄 Exported prompt additions to ${exportPath}`);
        }

        if (opts.report) {
          const summary = learner.getSummary();
          let report = `# Extraction Learning Report\n\nGenerated: ${new Date().toISOString()}\n\n`;
          report += `## Summary\n\n- Total Issues: ${summary.totalIssues}\n`;
          report += `- Pending Improvements: ${summary.pendingImprovements.length}\n\n`;
          report += `## Issues by Category\n\n`;
          for (const [cat, count] of Object.entries(summary.byCategory)) {
            report += `- ${cat}: ${count}\n`;
          }
          const reportPath = './knowledge/extraction-learning-report.md';
          await writeFile(reportPath, report);
          console.log(`\n📊 Generated report at ${reportPath}`);
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
║  All commands support --customer <name> for per-customer data  ║
║                                                                ║
║  CUSTOMER FOLDER STRUCTURE:                                    ║
║  customers/<name>/                                             ║
║    ├── incoming/         # Drop questionnaire files here       ║
║    ├── structure/   # Document structure JSON               ║
║    ├── indexed/          # AI-indexed files                    ║
║    ├── approved/         # Approved exports                    ║
║    ├── answer-library.yaml                                     ║
║    └── rules/            # Customer-specific rules             ║
║                                                                ║
║  1. STORE                                                      ║
║     npx tsx src/pipeline-v2/cli.ts store <file> -c <customer>  ║
║     → Extracts structure, preserves formatting                 ║
║     → Output: customers/<customer>/structure/*.json       ║
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

// =============================================================================
// TRAINING AND OPTIMIZATION COMMANDS
// =============================================================================

program
  .command('train-model')
  .description('Train custom Azure Document Intelligence model from approved questionnaire data')
  .option('-c, --customers <names...>', 'Specific customers to include (default: all)')
  .option('--min-quality <score>', 'Minimum data quality score (0-1, default: 0.7)', '0.7')
  .option('--dry-run', 'Analyze training data without actual training')
  .action(async (opts) => {
    try {
      console.log('🎯 Custom Model Training Pipeline\n');

      // Dynamic import to avoid bundling issues
      const { trainCustomModel } = await import('./services/training/custom-model-trainer.js');

      // Find customer paths
      const customersDir = resolve('./customers');
      let customerPaths: string[] = [];

      if (opts.customers && opts.customers.length > 0) {
        customerPaths = opts.customers.map((name: string) => resolve(customersDir, name));
      } else {
        // Find all customers with approved data
        const { readdir, stat } = await import('fs/promises');
        const entries = await readdir(customersDir);

        for (const entry of entries) {
          const customerPath = resolve(customersDir, entry);
          try {
            const customerStat = await stat(customerPath);
            if (customerStat.isDirectory()) {
              const approvedDir = resolve(customerPath, 'approved');
              const approvedStat = await stat(approvedDir);
              if (approvedStat.isDirectory()) {
                const approvedFiles = await readdir(approvedDir);
                if (approvedFiles.some(f => f.endsWith('.json'))) {
                  customerPaths.push(customerPath);
                }
              }
            }
          } catch {
            // Skip if no approved directory
          }
        }
      }

      if (customerPaths.length === 0) {
        console.log('❌ No training data found. Process some questionnaires first.');
        process.exit(1);
      }

      console.log(`📊 Found training data from ${customerPaths.length} customers`);

      if (opts.dryRun) {
        console.log('🧪 Dry run mode - analyzing training data only');
        // Implement dry run analysis
        process.exit(0);
      }

      // Train the model
      const modelId = await trainCustomModel(customerPaths);

      console.log(`✅ Training completed!`);
      console.log(`📝 Model ID: ${modelId}`);
      console.log(`\n🚀 To use the trained model:`);
      console.log(`export AZURE_MODEL_ID=${modelId}`);

    } catch (error) {
      console.error('❌ Training failed:', error);
      process.exit(1);
    }
  });

program
  .command('test-enhanced')
  .description('Test enhanced Azure extraction with optimizations')
  .argument('<file>', 'PDF file to test extraction on')
  .option('-c, --customer <name>', 'Customer name')
  .option('-m, --model <id>', 'Custom model ID to test')
  .option('--type <type>', 'Document type: questionnaire, certificate, general', 'questionnaire')
  .option('--compare', 'Compare with baseline extraction')
  .action(async (file: string, opts) => {
    try {
      const filePath = resolve(file);
      console.log(`🧪 Testing enhanced extraction on: ${file}\n`);

      // Dynamic import
      const { EnhancedAzureExtractor } = await import('./services/extractors/enhanced-azure.js');

      const extractor = new EnhancedAzureExtractor();

      // Set custom model if specified
      if (opts.model) {
        process.env.AZURE_MODEL_ID = opts.model;
        console.log(`📄 Using custom model: ${opts.model}`);
      }

      const startTime = Date.now();

      const result = await extractor.extractWithOptimizations(filePath, {
        documentType: opts.type,
        prioritizeTableStructure: opts.type === 'questionnaire',
        enhancedFieldDetection: true,
        customModelId: opts.model
      });

      const duration = Date.now() - startTime;

      console.log(`\n✅ Enhanced extraction completed in ${duration}ms\n`);

      // Display results summary
      console.log('📊 Extraction Results:');
      console.log(`  Pages: ${result.pages?.length || 0}`);
      console.log(`  Tables: ${result.tables?.length || 0}`);
      console.log(`  Paragraphs: ${result.paragraphs?.length || 0}`);
      console.log(`  Key-Value Pairs: ${result.keyValuePairs?.length || 0}`);

      if (result.tables) {
        console.log('\n📋 Table Analysis:');
        result.tables.forEach((table: any, index: number) => {
          console.log(`  Table ${index + 1}: ${table.tableType || 'general'} (${table.cells?.length || 0} cells)`);
        });
      }

      // Save results if customer specified
      if (opts.customer) {
        const customer = opts.customer;
        const outputDir = resolve(`./customers/${customer}/test-results`);
        const { mkdir, writeFile } = await import('fs/promises');

        await mkdir(outputDir, { recursive: true });
        const outputFile = resolve(outputDir, `enhanced-extraction-${Date.now()}.json`);
        await writeFile(outputFile, JSON.stringify(result, null, 2));

        console.log(`\n💾 Results saved to: ${outputFile}`);
      }

      // Compare with baseline if requested
      if (opts.compare) {
        console.log('\n🔄 Running baseline comparison...');

        // Extract with standard method
        const { extractPdfWithAzure } = await import('./services/extractors/azure.js');
        const baselineResult = await extractPdfWithAzure(filePath);

        console.log('\n📊 Comparison:');
        console.log(`  Enhanced tables: ${result.tables?.length || 0}`);
        console.log(`  Baseline tables: ${baselineResult.tables?.length || 0}`);
        console.log(`  Table improvement: ${((result.tables?.length || 0) - (baselineResult.tables?.length || 0)) >= 0 ? '+' : ''}${(result.tables?.length || 0) - (baselineResult.tables?.length || 0)}`);
      }

    } catch (error) {
      console.error('❌ Enhanced extraction failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// CONVERT-VISION - Convert vision extraction Q&A pairs to indexed format
// =============================================================================

program
  .command('convert-vision')
  .description('Convert vision extraction Q&A pairs to indexed format for destination tagging')
  .argument('<file>', 'Questionnaire filename (from vision-extraction folder)')
  .option('-c, --customer <name>', 'Customer name (required)', '')
  .action(async (file: string, opts) => {
    try {
      const customer = opts.customer as string;
      if (!customer) {
        console.error('❌ Customer name required. Use: pnpm cli convert-vision <file> -c <customer>');
        process.exit(1);
      }

      console.log(`\n🔄 Converting vision extraction to indexed format`);
      console.log(`   Customer: ${customer}`);
      console.log(`   File: ${file}\n`);

      const { convertAndSave } = await import('./services/extractors/vision-to-indexed.js');
      const customerDir = `./customers/${customer}`;

      const outputPath = await convertAndSave(customerDir, file);

      console.log(`\n✅ Conversion complete!`);
      console.log(`   Output: ${outputPath}`);
      console.log(`\n💡 Now open the review UI to assign destinations:`);
      console.log(`   pnpm cli serve -c ${customer}`);

    } catch (error) {
      console.error('❌ Conversion failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('optimize')
  .description('Apply current extraction optimizations to existing Azure configuration')
  .option('--format <format>', 'Output format: html, markdown', 'html')
  .option('--model <model>', 'Azure model: prebuilt-document, prebuilt-layout, prebuilt-read', 'prebuilt-document')
  .action(async (opts) => {
    try {
      console.log('🔧 Applying extraction optimizations...\n');

      // Update environment variables
      process.env.AZURE_OUTPUT_FORMAT = opts.format;
      process.env.AZURE_MODEL_ID = opts.model;

      console.log('✅ Applied optimizations:');
      console.log(`  - Output format: ${opts.format}`);
      console.log(`  - Default model: ${opts.model}`);
      console.log(`  - Enhanced table processing: enabled`);
      console.log(`  - Questionnaire patterns: enabled`);

      console.log('\n📝 Environment variables set:');
      console.log(`  AZURE_OUTPUT_FORMAT=${opts.format}`);
      console.log(`  AZURE_MODEL_ID=${opts.model}`);

      console.log('\n🚀 Optimizations applied! New extractions will use enhanced settings.');

    } catch (error) {
      console.error('❌ Optimization failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// TRAINING - Manage compiled training data from human corrections
// =============================================================================

program
  .command('training')
  .description('Manage training data compiled from human corrections')
  .argument('[action]', 'Action: status, compile, view', 'status')
  .option('-c, --customer <name>', 'Customer name (required for compile/view)')
  .action(async (action: string, opts) => {
    try {
      const { trainingProcessor } = await import('./services/training/training-processor.js');

      if (action === 'status') {
        // Show status for all customers
        console.log('\n📊 Training Data Status\n');
        const statuses = await trainingProcessor.getAllStatus();

        if (statuses.length === 0) {
          console.log('  No training data found. Make corrections in the review UI to build training data.');
          process.exit(0);
        }

        for (const status of statuses) {
          const staleIndicator = status.isStale ? ' ⚠️  STALE' : ' ✅';
          console.log(`\n  📁 ${status.customer}${staleIndicator}`);
          console.log(`     Corrections: ${status.correctionsCount}`);
          console.log(`     Questionnaires: ${status.questionnairesWithCorrections.length}`);
          if (status.compiledAt) {
            console.log(`     Compiled: ${status.compiledAt}`);
          } else {
            console.log(`     Compiled: Never`);
          }
          if (status.isStale) {
            console.log(`     → Run: pnpm cli training compile -c ${status.customer}`);
          }
        }
        console.log('');

      } else if (action === 'compile') {
        const customer = opts.customer as string;
        if (!customer) {
          console.error('❌ Customer name required. Use: pnpm cli training compile -c <customer>');
          process.exit(1);
        }

        console.log(`\n🔧 Compiling training data for ${customer}...\n`);
        const compiled = await trainingProcessor.compile(customer);

        console.log('\n📈 Compilation Results:');
        console.log(`   Total corrections: ${compiled.stats.totalCorrections}`);
        console.log(`   Destination changes: ${compiled.stats.destinationChanges}`);
        console.log(`   Value changes: ${compiled.stats.valueChanges}`);
        console.log(`   Questionnaires used: ${compiled.stats.questionnairesUsed}`);
        console.log(`   Hard rules generated: ${compiled.hardRules.length}`);
        console.log(`   Destination patterns: ${compiled.destinationPatterns.length}`);
        console.log(`   Few-shot examples: ${compiled.fewShotExamples.length}`);
        console.log(`\n✅ Training data compiled and saved`);

      } else if (action === 'view') {
        const customer = opts.customer as string;
        if (!customer) {
          console.error('❌ Customer name required. Use: pnpm cli training view -c <customer>');
          process.exit(1);
        }

        const compiled = await trainingProcessor.loadCompiled(customer);
        if (!compiled) {
          console.error(`❌ No compiled training data for ${customer}. Run: pnpm cli training compile -c ${customer}`);
          process.exit(1);
        }

        console.log(`\n📊 Compiled Training Data for ${customer}\n`);
        console.log(`   Version: ${compiled.version}`);
        console.log(`   Compiled: ${compiled.compiledAt}`);
        console.log(`   Total corrections: ${compiled.stats.totalCorrections}`);

        if (compiled.hardRules.length > 0) {
          console.log('\n   🔒 Hard Rules (label → destination):');
          for (const rule of compiled.hardRules.slice(0, 10)) {
            console.log(`      "${rule.labelContains}" → ${rule.destination}`);
          }
          if (compiled.hardRules.length > 10) {
            console.log(`      ... and ${compiled.hardRules.length - 10} more`);
          }
        }

        if (compiled.destinationPatterns.length > 0) {
          console.log('\n   📝 Destination Patterns:');
          for (const pattern of compiled.destinationPatterns.slice(0, 10)) {
            console.log(`      "${pattern.pattern}" (${pattern.fromDestination} → ${pattern.toDestination}, confidence: ${(pattern.confidence * 100).toFixed(0)}%)`);
          }
          if (compiled.destinationPatterns.length > 10) {
            console.log(`      ... and ${compiled.destinationPatterns.length - 10} more`);
          }
        }
        console.log('');

      } else {
        console.error(`❌ Unknown action: ${action}. Use: status, compile, or view`);
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Training command failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// STRUCTURE-TRAINING - Manage extraction-level training from structure corrections
// =============================================================================

program
  .command('structure-training')
  .description('Manage structure/extraction training data from human corrections to Azure output')
  .argument('[action]', 'Action: status, compile, view', 'status')
  .option('-c, --customer <name>', 'Customer name (required for compile/view)')
  .action(async (action: string, opts) => {
    try {
      const { structureTrainingProcessor } = await import('./services/training/structure-training-processor.js');

      if (action === 'status') {
        // Show status for all customers
        console.log('\n📊 Structure Training Data Status (Extraction Corrections)\n');
        const statuses = await structureTrainingProcessor.getAllStatus();

        if (statuses.length === 0) {
          console.log('  No structure training data found.');
          console.log('  Make corrections to extracted cell values in the Original panel to build training data.');
          process.exit(0);
        }

        for (const status of statuses) {
          const staleIndicator = status.isStale ? ' ⚠️  STALE' : ' ✅';
          console.log(`\n  📁 ${status.customer}${staleIndicator}`);
          console.log(`     Corrections: ${status.correctionsCount}`);
          console.log(`     Questionnaires: ${status.questionnairesWithCorrections.length}`);
          if (status.compiledAt) {
            console.log(`     Compiled: ${status.compiledAt}`);
          } else {
            console.log(`     Compiled: Never`);
          }
          if (status.isStale) {
            console.log(`     → Run: pnpm cli structure-training compile -c ${status.customer}`);
          }
        }
        console.log('');

      } else if (action === 'compile') {
        const customer = opts.customer as string;
        if (!customer) {
          console.error('❌ Customer name required. Use: pnpm cli structure-training compile -c <customer>');
          process.exit(1);
        }

        console.log(`\n🔧 Compiling structure training data for ${customer}...\n`);
        const compiled = await structureTrainingProcessor.compile(customer);

        console.log('\n📈 Compilation Results:');
        console.log(`   Total corrections: ${compiled.stats.totalCorrections}`);
        console.log(`   OCR fixes: ${compiled.stats.ocrFixes}`);
        console.log(`   Content additions: ${compiled.stats.contentAdditions}`);
        console.log(`   Content removals: ${compiled.stats.contentRemovals}`);
        console.log(`   Questionnaires used: ${compiled.stats.questionnairesUsed}`);
        console.log(`   OCR patterns: ${compiled.ocrPatterns.length}`);
        console.log(`   Substitution rules: ${compiled.substitutionRules.length}`);
        console.log(`\n✅ Structure training data compiled and saved`);

      } else if (action === 'view') {
        const customer = opts.customer as string;
        if (!customer) {
          console.error('❌ Customer name required. Use: pnpm cli structure-training view -c <customer>');
          process.exit(1);
        }

        const compiled = await structureTrainingProcessor.loadCompiled(customer);
        if (!compiled) {
          console.error(`❌ No compiled structure training data for ${customer}.`);
          console.error(`   Run: pnpm cli structure-training compile -c ${customer}`);
          process.exit(1);
        }

        console.log(`\n📊 Compiled Structure Training for ${customer}\n`);
        console.log(`   Version: ${compiled.version}`);
        console.log(`   Compiled: ${compiled.compiledAt}`);
        console.log(`   Total corrections: ${compiled.stats.totalCorrections}`);

        if (compiled.substitutionRules.length > 0) {
          console.log('\n   🔄 Substitution Rules (find → replace):');
          for (const rule of compiled.substitutionRules.slice(0, 10)) {
            const find = rule.find.length > 30 ? rule.find.slice(0, 30) + '...' : rule.find;
            const replace = rule.replace.length > 30 ? rule.replace.slice(0, 30) + '...' : rule.replace;
            console.log(`      "${find}" → "${replace}" (${rule.count}x)`);
          }
          if (compiled.substitutionRules.length > 10) {
            console.log(`      ... and ${compiled.substitutionRules.length - 10} more`);
          }
        }

        if (compiled.ocrPatterns.length > 0) {
          console.log('\n   👁️  OCR Patterns (wrong → correct):');
          for (const pattern of compiled.ocrPatterns.slice(0, 10)) {
            console.log(`      "${pattern.wrongPattern}" → "${pattern.correction}" (${pattern.count}x, conf: ${(pattern.confidence * 100).toFixed(0)}%)`);
          }
          if (compiled.ocrPatterns.length > 10) {
            console.log(`      ... and ${compiled.ocrPatterns.length - 10} more`);
          }
        }

        if (compiled.cellPatterns.length > 0) {
          console.log('\n   📍 Cell Patterns:');
          for (const pattern of compiled.cellPatterns.slice(0, 5)) {
            const rowInfo = pattern.rowRange ? ` rows ${pattern.rowRange.min}-${pattern.rowRange.max}` : '';
            console.log(`      ${pattern.cellPattern}${rowInfo}: ${pattern.correctionType} (${pattern.count}x)`);
          }
        }
        console.log('');

      } else {
        console.error(`❌ Unknown action: ${action}. Use: status, compile, or view`);
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Structure training command failed:', error);
      process.exit(1);
    }
  });

program.parse();
