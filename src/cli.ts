#!/usr/bin/env node

/**
 * CLI for Passionfruit Excel - Claude-powered Excel analysis
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { PassfruitExcel } from './claude-excel.js';
import { ExcelExtractor } from './excel-extractor.js';
import { QuestionAnswerDetector } from './question-answer-detector.js';
import { formatSearchResults } from './web-search.js';
import type { DetectedQAPair, QuestionnaireStructure, ConfirmationResult, PassfruitConfig } from './types.js';

const program = new Command();

program
  .name('passionfruit')
  .description('Claude-powered Excel analysis and modification')
  .version('0.1.0');

/**
 * Analyze command - ask a question about an Excel file
 */
program
  .command('analyze')
  .description('Analyze an Excel file and ask questions about it')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .argument('[question]', 'Question to ask about the file')
  .option('-s, --skill', 'Use Anthropic xlsx skill (requires beta access)')
  .option('-j, --json', 'Output workbook data as JSON')
  .action(async (file: string, question: string | undefined, options: { skill?: boolean; json?: boolean }) => {
    try {
      const passionfruit = new PassfruitExcel();

      if (options.json) {
        // Just output the workbook structure
        const extractor = new ExcelExtractor();
        const workbook = await extractor.extract(file);
        console.log(JSON.stringify(extractor.toJSON(workbook), null, 2));
        return;
      }

      if (!question) {
        // If no question provided, show workbook summary
        const extractor = new ExcelExtractor();
        const workbook = await extractor.extract(file);
        console.log(chalk.bold(`\nWorkbook: ${workbook.filename}`));
        console.log(chalk.gray(`Sheets: ${workbook.sheets.length}`));

        for (const sheet of workbook.sheets) {
          console.log(chalk.cyan(`\n  Sheet: ${sheet.name}`));
          console.log(chalk.gray(`    Cells: ${sheet.cells.size}`));
          console.log(chalk.gray(`    Dimensions: Row ${sheet.dimensions.startRow}-${sheet.dimensions.endRow}`));
        }
        return;
      }

      console.log(chalk.gray(`\nAnalyzing ${file}...`));

      let result;
      if (options.skill) {
        result = await passionfruit.analyzeWithSkill(file, question);
      } else {
        result = await passionfruit.analyze(file, question);
      }

      console.log(chalk.bold('\nAnswer:'));
      console.log(result.answer);

      if (result.citations.length > 0) {
        console.log(chalk.bold('\nCell References:'));
        for (const citation of result.citations.slice(0, 10)) {
          console.log(chalk.gray(`  ${citation.sheet}!${citation.cell}: ${citation.value}`));
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Chat command - interactive conversation about an Excel file
 */
program
  .command('chat')
  .description('Start an interactive chat session about an Excel file')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .option('--web-search', 'Enable web search to look up customer websites')
  .option('--tavily-key <key>', 'Tavily Search API key for web search (or use TAVILY_API_KEY env var)')
  .option('--api-key <key>', 'Anthropic API key for web search (or use ANTHROPIC_API_KEY env var) - alternative to Brave')
  .action(async (file: string, options: { webSearch?: boolean; tavilyKey?: string; apiKey?: string }) => {
    try {
      // Build config with optional web search
      const config: PassfruitConfig = {};

      if (options.webSearch) {
        // Prefer Brave API key for Bedrock-based web search
        const tavilyKey = options.tavilyKey || process.env.TAVILY_API_KEY;
        const anthropicKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

        if (tavilyKey) {
          config.tavilyApiKey = tavilyKey;
          config.webSearch = { enabled: true };
        } else if (anthropicKey) {
          config.anthropicApiKey = anthropicKey;
          config.webSearch = { enabled: true };
        } else {
          console.log(chalk.yellow('Warning: No search API key provided, web search disabled'));
          console.log(chalk.gray('Provide Brave API key via --tavily-key or set TAVILY_API_KEY environment variable'));
          console.log(chalk.gray('Or provide Anthropic API key via --api-key or ANTHROPIC_API_KEY (uses Anthropic API instead of Bedrock)'));
        }
      }

      const passionfruit = new PassfruitExcel(config);

      console.log(chalk.gray(`\nLoading ${file}...`));
      const workbook = await passionfruit.loadWorkbook(file);

      console.log(chalk.green(`\nLoaded workbook with ${workbook.sheets.length} sheet(s):`));
      for (const sheet of workbook.sheets) {
        console.log(chalk.cyan(`  - ${sheet.name} (${sheet.cells.size} cells)`));
      }

      console.log(chalk.yellow('\nYou can now ask questions about the workbook.'));
      if (passionfruit.hasWebSearch()) {
        const searchProvider = config.tavilyApiKey ? 'Tavily Search (via Bedrock)' : 'Anthropic web search';
        console.log(chalk.cyan(`Web search enabled (${searchProvider}) - Claude can look up customer websites and information.`));
      }
      console.log(chalk.gray('Type "exit" or "quit" to end the session.\n'));

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const prompt = (): void => {
        rl.question(chalk.bold('You: '), async (input) => {
          const trimmed = input.trim();

          if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
            console.log(chalk.gray('\nGoodbye!'));
            rl.close();
            return;
          }

          if (!trimmed) {
            prompt();
            return;
          }

          try {
            console.log(chalk.gray('\nThinking...'));
            const result = await passionfruit.chat(trimmed);

            console.log(chalk.bold('\nClaude: ') + result.answer);

            // Show search info if web search was used
            const searchInfo = passionfruit.getLastSearchInfo();
            if (searchInfo && searchInfo.searchResults.length > 0) {
              console.log(chalk.gray('\nWeb sources used:'));
              for (const source of searchInfo.searchResults.slice(0, 3)) {
                console.log(chalk.blue(`  - ${source.title}: ${source.url}`));
              }
            }

            if (result.modifications && result.modifications.length > 0) {
              console.log(chalk.yellow('\nSuggested modifications:'));
              for (const mod of result.modifications) {
                console.log(chalk.cyan(`  ${mod.sheet}!${mod.cell} → ${mod.value}`));
              }
            }

            console.log('');
            prompt();
          } catch (error) {
            console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
            prompt();
          }
        });
      };

      prompt();
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Modify command - make changes to an Excel file
 */
program
  .command('modify')
  .description('Modify an Excel file based on instructions')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .argument('<instructions>', 'Instructions for modifications')
  .option('-o, --output <path>', 'Output file path (default: overwrites input)')
  .option('-d, --dry-run', 'Show modifications without applying them')
  .action(async (
    file: string,
    instructions: string,
    options: { output?: string; dryRun?: boolean }
  ) => {
    try {
      const passionfruit = new PassfruitExcel();

      console.log(chalk.gray(`\nAnalyzing ${file} for modifications...`));

      const result = await passionfruit.modify(file, instructions);

      console.log(chalk.bold('\nExplanation:'));
      console.log(result.explanation);

      if (result.modifications.length === 0) {
        console.log(chalk.yellow('\nNo modifications identified.'));
        return;
      }

      console.log(chalk.bold('\nModifications:'));
      for (const mod of result.modifications) {
        console.log(chalk.cyan(`  ${mod.sheet}!${mod.cell} → ${JSON.stringify(mod.value)}`));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\nDry run - no changes applied.'));
        return;
      }

      const outputPath = options.output || file;
      await passionfruit.applyModifications(file, outputPath, result.modifications);

      console.log(chalk.green(`\nChanges saved to ${outputPath}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Extract command - dump workbook structure
 */
program
  .command('extract')
  .description('Extract and display workbook structure')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .option('-f, --format <format>', 'Output format: text, json (default: text)')
  .action(async (file: string, options: { format?: string }) => {
    try {
      const extractor = new ExcelExtractor();
      const workbook = await extractor.extract(file);

      if (options.format === 'json') {
        console.log(JSON.stringify(extractor.toJSON(workbook), null, 2));
      } else {
        console.log(extractor.toTextRepresentation(workbook));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Detect command - detect question-answer structure in an Excel file
 */
program
  .command('detect')
  .description('Detect question-answer structure in an Excel questionnaire')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .option('-j, --json', 'Output as JSON')
  .option('-c, --confirm', 'Interactively confirm low-confidence detections')
  .action(async (file: string, options: { json?: boolean; confirm?: boolean }) => {
    try {
      const detector = new QuestionAnswerDetector();

      console.log(chalk.gray(`\nAnalyzing ${file} for Q&A structure...`));

      const structure = await detector.detect(file);

      if (options.json) {
        console.log(JSON.stringify(structure, null, 2));
        return;
      }

      // Display results
      console.log(chalk.bold('\n📋 Detection Results\n'));
      console.log(`Total Q&A pairs detected: ${chalk.cyan(structure.stats.totalPairs)}`);
      console.log(`  ${chalk.green('✓')} High confidence (≥70%): ${structure.stats.highConfidence}`);
      console.log(`  ${chalk.yellow('○')} Medium confidence (40-69%): ${structure.stats.mediumConfidence}`);
      console.log(`  ${chalk.red('⚠')} Low confidence (<40%): ${structure.stats.lowConfidence}`);
      console.log(`  Average confidence: ${Math.round(structure.stats.averageConfidence * 100)}%`);
      console.log('');

      // Display sections
      for (const section of structure.sections) {
        console.log(chalk.bold.blue(`\n## ${section.name}`));
        if (section.headerRange) {
          console.log(chalk.gray(`   Header: ${section.headerRange}`));
        }

        if (section.pairs.length === 0) {
          console.log(chalk.gray('   (No Q&A pairs in this section)'));
        } else {
          for (const pair of section.pairs) {
            const confIcon = pair.confidence >= 0.70 ? chalk.green('✓') :
                            pair.confidence >= 0.40 ? chalk.yellow('○') : chalk.red('⚠');
            const confText = `${Math.round(pair.confidence * 100)}%`;

            const questionShort = pair.question.text.length > 40
              ? pair.question.text.substring(0, 37) + '...'
              : pair.question.text;

            const cells = pair.answer.range || pair.answer.cells.join(', ');

            console.log(`   ${confIcon} ${chalk.white(questionShort)}`);
            console.log(`      → ${chalk.cyan(cells)} (${pair.answer.type}) [${confText}]`);
          }
        }
      }

      // Ungrouped pairs
      if (structure.ungroupedPairs.length > 0) {
        console.log(chalk.bold.blue('\n## Ungrouped Pairs'));
        for (const pair of structure.ungroupedPairs) {
          const confIcon = pair.confidence >= 0.70 ? chalk.green('✓') :
                          pair.confidence >= 0.40 ? chalk.yellow('○') : chalk.red('⚠');
          const confText = `${Math.round(pair.confidence * 100)}%`;
          const cells = pair.answer.range || pair.answer.cells.join(', ');

          console.log(`   ${confIcon} ${chalk.white(pair.question.text)}`);
          console.log(`      → ${chalk.cyan(cells)} (${pair.answer.type}) [${confText}]`);
        }
      }

      // Interactive confirmation for low-confidence pairs
      if (options.confirm && structure.lowConfidencePairs.length > 0) {
        console.log(chalk.bold.yellow('\n\n⚠ Low Confidence Detections - Review Required\n'));

        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const confirmations: ConfirmationResult[] = [];

        for (const pair of structure.lowConfidencePairs) {
          console.log(chalk.yellow(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
          console.log(chalk.bold(`Question: "${pair.question.text}"`));
          console.log(`Detected answer cell: ${chalk.cyan(pair.answer.cells.join(', '))}`);
          console.log(`Type: ${pair.answer.type}`);
          console.log(`Confidence: ${chalk.red(Math.round(pair.confidence * 100) + '%')}`);
          console.log(`Detection signals: ${pair.detectionSignals.join(', ')}`);
          console.log('');

          const answer = await askQuestion(rl,
            `Is this correct? ${chalk.gray('[Y]es / [N]o / [E]dit / [S]kip all')}: `
          );

          const choice = answer.toLowerCase().trim();

          if (choice === 's' || choice === 'skip') {
            console.log(chalk.gray('Skipping remaining confirmations...'));
            break;
          } else if (choice === 'y' || choice === 'yes' || choice === '') {
            confirmations.push({ pairId: pair.id, confirmed: true });
            console.log(chalk.green('✓ Confirmed'));
          } else if (choice === 'n' || choice === 'no') {
            confirmations.push({ pairId: pair.id, confirmed: false });
            console.log(chalk.red('✗ Rejected'));
          } else if (choice === 'e' || choice === 'edit') {
            const newCell = await askQuestion(rl, 'Enter correct answer cell(s) (comma-separated): ');
            const cells = newCell.split(',').map(c => c.trim().toUpperCase());
            confirmations.push({
              pairId: pair.id,
              confirmed: true,
              correctedAnswer: { cells }
            });
            console.log(chalk.green(`✓ Corrected to: ${cells.join(', ')}`));
          }
        }

        rl.close();

        // Summary
        const confirmed = confirmations.filter(c => c.confirmed).length;
        const rejected = confirmations.filter(c => !c.confirmed).length;
        const corrected = confirmations.filter(c => c.correctedAnswer).length;

        console.log(chalk.bold('\n\nConfirmation Summary:'));
        console.log(`  Confirmed: ${confirmed}`);
        console.log(`  Rejected: ${rejected}`);
        console.log(`  Corrected: ${corrected}`);
      }

      console.log('');

    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Fill command - fill detected answer cells with provided values
 */
program
  .command('fill')
  .description('Fill detected answer cells with values from a JSON file')
  .argument('<file>', 'Path to Excel file (.xlsx or .xlsm)')
  .argument('<answers>', 'Path to JSON file with answers or inline JSON')
  .option('-o, --output <path>', 'Output file path (default: adds -filled suffix)')
  .option('-d, --dry-run', 'Show what would be filled without making changes')
  .action(async (
    file: string,
    answersArg: string,
    options: { output?: string; dryRun?: boolean }
  ) => {
    try {
      const passionfruit = new PassfruitExcel();

      console.log(chalk.gray(`\nDetecting structure in ${file}...`));

      const structure = await passionfruit.detectStructure(file);
      const allPairs = [...structure.ungroupedPairs];
      for (const section of structure.sections) {
        allPairs.push(...section.pairs);
      }

      // Parse answers
      let answers: Record<string, string | number | boolean>;
      try {
        // Try as JSON string first
        answers = JSON.parse(answersArg);
      } catch {
        // Try as file path
        const { readFile } = await import('fs/promises');
        const content = await readFile(answersArg, 'utf-8');
        answers = JSON.parse(content);
      }

      console.log(chalk.bold('\nMatching answers to detected questions...\n'));

      const modifications: Array<{
        question: string;
        cell: string;
        value: string | number | boolean;
      }> = [];

      // Match answers to pairs
      for (const [key, value] of Object.entries(answers)) {
        // Try to find matching pair by question text (partial match)
        const keyLower = key.toLowerCase();
        const matchingPair = allPairs.find(p =>
          p.question.text.toLowerCase().includes(keyLower) ||
          keyLower.includes(p.question.text.toLowerCase().replace(':', '').trim())
        );

        if (matchingPair) {
          for (const cell of matchingPair.answer.cells) {
            modifications.push({
              question: matchingPair.question.text,
              cell,
              value,
            });
          }
          console.log(chalk.green(`✓ "${key}" → ${matchingPair.answer.cells.join(', ')}`));
        } else {
          console.log(chalk.yellow(`? "${key}" - no matching question found`));
        }
      }

      if (modifications.length === 0) {
        console.log(chalk.yellow('\nNo modifications to apply.'));
        return;
      }

      console.log(chalk.bold(`\nTotal modifications: ${modifications.length}`));

      if (options.dryRun) {
        console.log(chalk.yellow('\nDry run - no changes applied.'));
        console.log('\nWould apply:');
        for (const mod of modifications) {
          console.log(`  ${mod.cell}: ${JSON.stringify(mod.value)}`);
        }
        return;
      }

      // Apply modifications
      const outputPath = options.output || file.replace(/\.xlsx$/, '-filled.xlsx');

      // Get sheet name from first pair
      const sheetName = allPairs[0]?.question.sheet || 'Sheet1';

      await passionfruit.applyModifications(
        file,
        outputPath,
        modifications.map(m => ({
          sheet: sheetName,
          cell: m.cell,
          value: m.value,
        }))
      );

      console.log(chalk.green(`\n✓ Changes saved to ${outputPath}`));

    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Search command - search the web for customer information using Claude
 */
program
  .command('search')
  .description('Search the web for customer or company information')
  .argument('<query>', 'Search query (e.g., company name, website, etc.)')
  .option('-k, --tavily-key <key>', 'Tavily Search API key (or use TAVILY_API_KEY env var)')
  .option('--api-key <key>', 'Anthropic API key (or use ANTHROPIC_API_KEY env var) - uses Anthropic API instead of Bedrock')
  .option('-j, --json', 'Output as JSON')
  .action(async (
    query: string,
    options: { tavilyKey?: string; apiKey?: string; json?: boolean }
  ) => {
    try {
      const tavilyKey = options.tavilyKey || process.env.TAVILY_API_KEY;
      const anthropicKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

      if (!tavilyKey && !anthropicKey) {
        console.error(chalk.red('Error: No search API key provided'));
        console.error(chalk.gray('Provide Brave API key via --tavily-key or set TAVILY_API_KEY environment variable'));
        console.error(chalk.gray('Or provide Anthropic API key via --api-key or ANTHROPIC_API_KEY'));
        process.exit(1);
      }

      const passionfruit = new PassfruitExcel({
        tavilyApiKey: tavilyKey,
        anthropicApiKey: anthropicKey,
        webSearch: { enabled: true },
      });

      const searchProvider = tavilyKey ? 'Tavily Search' : 'Anthropic';
      console.log(chalk.gray(`\nSearching for "${query}" using ${searchProvider}...\n`));

      const response = await passionfruit.webSearch(query);

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      // Display answer
      console.log(chalk.bold('Answer:'));
      console.log(response.answer);
      console.log('');

      // Display search info
      if (response.searchInfo.searchResults.length > 0) {
        console.log(chalk.bold('Sources:'));
        for (const result of response.searchInfo.searchResults) {
          console.log(chalk.cyan(`  - ${result.title}`));
          console.log(chalk.blue(`    ${result.url}`));
          if (result.pageAge) {
            console.log(chalk.gray(`    Last updated: ${result.pageAge}`));
          }
        }
        console.log('');
      }

      // Display citations
      if (response.searchInfo.citations.length > 0) {
        console.log(chalk.bold('Citations:'));
        for (const citation of response.searchInfo.citations) {
          console.log(chalk.cyan(`  - ${citation.title}`));
          console.log(chalk.blue(`    ${citation.url}`));
          if (citation.citedText) {
            console.log(chalk.gray(`    "${citation.citedText}"`));
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

/**
 * Helper to ask a question and get answer
 */
function askQuestion(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

program.parse();
