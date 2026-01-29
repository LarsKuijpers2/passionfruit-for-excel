#!/usr/bin/env node

/**
 * CLI for Passionfruit Excel - Claude-powered Excel analysis
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { PassfruitExcel } from './claude-excel.js';
import { ExcelExtractor } from './excel-extractor.js';

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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable not set'));
      process.exit(1);
    }

    try {
      const passionfruit = new PassfruitExcel({ apiKey });

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
  .action(async (file: string) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable not set'));
      process.exit(1);
    }

    try {
      const passionfruit = new PassfruitExcel({ apiKey });

      console.log(chalk.gray(`\nLoading ${file}...`));
      const workbook = await passionfruit.loadWorkbook(file);

      console.log(chalk.green(`\nLoaded workbook with ${workbook.sheets.length} sheet(s):`));
      for (const sheet of workbook.sheets) {
        console.log(chalk.cyan(`  - ${sheet.name} (${sheet.cells.size} cells)`));
      }

      console.log(chalk.yellow('\nYou can now ask questions about the workbook.'));
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable not set'));
      process.exit(1);
    }

    try {
      const passionfruit = new PassfruitExcel({ apiKey });

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

program.parse();
