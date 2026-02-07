/**
 * Main pipeline orchestrator for questionnaire extraction.
 *
 * Coordinates file reading, Q&A extraction, categorisation,
 * language handling, and output generation.
 */

import { readdir, rename, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { FileReader } from './file-reader.js';
import { Categoriser } from './categoriser.js';
import { LanguageHandler } from './language-handler.js';
import { OutputGenerator } from './output-generator.js';
import { PipelineLogger } from './logger.js';
import type {
  PipelineOptions,
  FileProcessingResult,
  BatchSummary,
  ProcessingStats,
  RawQAPair,
  CategorisedQAPair,
  ExtractedContent,
  ExtractedSheet,
  ExtractedCell,
} from './types.js';

const DEFAULT_OPTIONS: PipelineOptions = {
  inputDir: './incoming',
  outputDir: './extracted',
  failedDir: './failed',
  logsDir: './logs',
  useClaudeAPI: true,
  dryRun: false,
};

export class Pipeline {
  private options: PipelineOptions;
  private fileReader: FileReader;
  private categoriser: Categoriser;
  private languageHandler: LanguageHandler;
  private outputGenerator: OutputGenerator;
  private logger: PipelineLogger;

  constructor(options: Partial<PipelineOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fileReader = new FileReader();
    this.categoriser = new Categoriser(this.options.anthropicApiKey);
    this.languageHandler = new LanguageHandler(this.options.anthropicApiKey);
    this.outputGenerator = new OutputGenerator();
    this.logger = new PipelineLogger(this.options.logsDir);
  }

  /** Process a single file */
  async processFile(filePath: string): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const fileName = basename(filePath);

    this.logger.info(`Processing: ${fileName}`);

    try {
      // Step 1: Read file
      this.logger.info(`  Reading file...`);
      const content = await this.fileReader.read(filePath);

      // Step 2: Extract Q&A pairs
      this.logger.info(`  Extracting Q&A pairs...`);
      const rawPairs = this.extractQAPairs(content);
      this.logger.info(`  Found ${rawPairs.length} Q&A pairs across ${content.sheets.length} sheet(s)`);

      if (rawPairs.length === 0) {
        this.logger.warn(`  No Q&A pairs found in ${fileName}`);
      }

      // Step 3: Categorise
      this.logger.info(`  Categorising...`);
      let categorisationResults;
      if (this.options.useClaudeAPI && this.options.anthropicApiKey) {
        categorisationResults = await this.categoriser.categoriseWithClaude(rawPairs);
      } else {
        categorisationResults = this.categoriser.categoriseBatch(rawPairs);
      }

      // Step 4: Handle languages
      this.logger.info(`  Handling languages...`);
      const categorisedPairs = await this.buildCategorisedPairs(rawPairs, categorisationResults);

      // Step 5: Compute statistics
      const stats = this.computeStats(categorisedPairs, content.sheets.length, Date.now() - startTime);

      // Step 6: Generate output
      const outputFileName = fileName.replace(/\.[^.]+$/, '-extracted.xlsx');
      const outputPath = join(this.options.outputDir, outputFileName);

      if (!this.options.dryRun) {
        await mkdir(this.options.outputDir, { recursive: true });
        this.logger.info(`  Generating output: ${outputFileName}`);
        await this.outputGenerator.generate(outputPath, categorisedPairs, stats, fileName);
      } else {
        this.logger.info(`  [DRY RUN] Would generate: ${outputFileName}`);
      }

      const result: FileProcessingResult = {
        sourceFile: filePath,
        sourceFileName: fileName,
        outputFile: outputPath,
        success: true,
        pairs: categorisedPairs,
        stats,
        timestamp: new Date().toISOString(),
      };

      this.logger.logFileResult(result);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`  Error processing ${fileName}: ${errorMessage}`);

      // Move to failed directory
      if (!this.options.dryRun) {
        try {
          await mkdir(this.options.failedDir, { recursive: true });
          const failedPath = join(this.options.failedDir, fileName);
          await rename(filePath, failedPath);
          this.logger.info(`  Moved to failed: ${failedPath}`);
        } catch {
          this.logger.warn(`  Could not move file to failed directory`);
        }
      }

      const result: FileProcessingResult = {
        sourceFile: filePath,
        sourceFileName: fileName,
        outputFile: '',
        success: false,
        error: errorMessage,
        pairs: [],
        stats: this.emptyStats(Date.now() - startTime),
        timestamp: new Date().toISOString(),
      };

      this.logger.logFileResult(result);
      return result;
    }
  }

  /** Process all files in the incoming directory */
  async processBatch(): Promise<BatchSummary> {
    const batchStartTime = Date.now();
    const batchId = new Date().toISOString().split('T')[0];

    this.logger.info(`Starting batch processing from: ${this.options.inputDir}`);

    // Find all supported files
    const supportedExtensions = ['.xlsx', '.xls', '.pdf', '.docx'];
    let files: string[];

    try {
      const dirEntries = await readdir(this.options.inputDir);
      files = dirEntries
        .filter(f => supportedExtensions.some(ext => f.toLowerCase().endsWith(ext)))
        .filter(f => !f.startsWith('.'))
        .map(f => join(this.options.inputDir, f));
    } catch (error) {
      this.logger.error(`Could not read input directory: ${this.options.inputDir}`);
      throw error;
    }

    if (files.length === 0) {
      this.logger.warn(`No supported files found in ${this.options.inputDir}`);
      return this.emptyBatchSummary(batchStartTime);
    }

    this.logger.info(`Found ${files.length} file(s) to process`);

    // Process each file
    const results: FileProcessingResult[] = [];

    for (const file of files) {
      try {
        const result = await this.processFile(file);
        results.push(result);
      } catch (error) {
        // Graceful failure — continue with next file
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unhandled error for ${basename(file)}: ${errorMessage}`);
        results.push({
          sourceFile: file,
          sourceFileName: basename(file),
          outputFile: '',
          success: false,
          error: errorMessage,
          pairs: [],
          stats: this.emptyStats(0),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Build summary
    const summary: BatchSummary = {
      totalFiles: files.length,
      successCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      results,
      aggregateStats: {
        totalPairs: results.reduce((sum, r) => sum + r.stats.totalPairs, 0),
        entityDBCount: results.reduce((sum, r) => sum + r.stats.entityDBCount, 0),
        proceduresCount: results.reduce((sum, r) => sum + r.stats.proceduresCount, 0),
        productCount: results.reduce((sum, r) => sum + r.stats.productCount, 0),
        highConfidence: results.reduce((sum, r) => sum + r.stats.highConfidence, 0),
        mediumConfidence: results.reduce((sum, r) => sum + r.stats.mediumConfidence, 0),
        lowConfidence: results.reduce((sum, r) => sum + r.stats.lowConfidence, 0),
      },
      timestamp: new Date().toISOString(),
      totalTimeMs: Date.now() - batchStartTime,
    };

    this.logger.logBatchSummary(summary);

    // Write log files
    if (!this.options.dryRun) {
      await this.logger.writeBatchLog(batchId);
      await this.logger.writeSummaryJson(summary);
      this.logger.info(`Log written to: ${this.options.logsDir}/batch-${batchId}.log`);
      this.logger.info(`Summary written to: ${this.options.logsDir}/summary.json`);
    }

    return summary;
  }

  /** Extract raw Q&A pairs from file content */
  private extractQAPairs(content: ExtractedContent): RawQAPair[] {
    const pairs: RawQAPair[] = [];

    for (const sheet of content.sheets) {
      const sheetPairs = this.extractFromSheet(sheet, content.fileName);
      pairs.push(...sheetPairs);
    }

    return pairs;
  }

  /** Extract Q&A pairs from a single sheet */
  private extractFromSheet(sheet: ExtractedSheet, fileName: string): RawQAPair[] {
    const pairs: RawQAPair[] = [];
    let currentSection: string | undefined;

    for (const row of sheet.rows) {
      const cells = Array.from(row.cells.values());

      // Check for section headers
      const headerCell = cells.find(c => c.isSectionHeader);
      if (headerCell) {
        currentSection = headerCell.value;
        continue;
      }

      // Find label (question) and input (answer) cells in this row
      const labelCells = cells.filter(c => c.isLabel && c.value.trim());
      const inputCells = cells.filter(c => c.isInput);

      if (labelCells.length === 0) continue;

      for (const label of labelCells) {
        // Find the corresponding answer cell
        const answer = this.findAnswerForQuestion(label, inputCells, cells);

        // Find comment
        const commentCell = cells.find(c => c.comment);

        const pair: RawQAPair = {
          sheet: sheet.name,
          questionText: label.value.trim(),
          answerText: answer ? answer.value.trim() : '',
          notesText: commentCell?.comment || '',
          questionCell: `${sheet.name}!${label.address}`,
          answerCell: answer ? `${sheet.name}!${answer.address}` : '',
          commentCell: commentCell ? `${sheet.name}!${commentCell.address}` : '',
          sectionHeader: currentSection,
        };

        // Detect conditional questions
        const condMatch = label.value.match(
          /(?:if|falls|wenn|only if|nur wenn|sofern)\s+(.+)/i
        );
        if (condMatch) {
          pair.isConditional = true;
          pair.conditionText = condMatch[1].trim();
        }

        pairs.push(pair);
      }

      // Handle multi-column answers (e.g., Plant 1, Plant 2, Plant 3)
      if (labelCells.length === 1 && inputCells.length > 1) {
        const mainLabel = labelCells[0];
        // Skip the first input (already handled above), process additional columns
        for (let i = 1; i < inputCells.length; i++) {
          const input = inputCells[i];
          pairs.push({
            sheet: sheet.name,
            questionText: mainLabel.value.trim(),
            answerText: input.value.trim(),
            notesText: '',
            questionCell: `${sheet.name}!${mainLabel.address}`,
            answerCell: `${sheet.name}!${input.address}`,
            commentCell: '',
            sectionHeader: currentSection,
            multiColumnId: `Column ${i + 1}`,
          });
        }
      }
    }

    return pairs;
  }

  /** Find the answer cell for a given question cell */
  private findAnswerForQuestion(
    question: ExtractedCell,
    inputCells: ExtractedCell[],
    allCells: ExtractedCell[],
  ): ExtractedCell | null {
    if (inputCells.length === 0) {
      // No explicit input cells — look for the cell to the right
      const qCol = this.colLetterToNumber(question.address.replace(/\d+/g, ''));
      const qRow = parseInt(question.address.replace(/[A-Z]+/g, ''), 10);

      for (const cell of allCells) {
        if (cell === question) continue;
        const cCol = this.colLetterToNumber(cell.address.replace(/\d+/g, ''));
        const cRow = parseInt(cell.address.replace(/[A-Z]+/g, ''), 10);

        if (cRow === qRow && cCol > qCol && cCol <= qCol + 3) {
          return cell;
        }
      }
      return null;
    }

    // Find closest input cell to the right on the same row
    const qCol = this.colLetterToNumber(question.address.replace(/\d+/g, ''));

    let closest: ExtractedCell | null = null;
    let closestDist = Infinity;

    for (const input of inputCells) {
      const iCol = this.colLetterToNumber(input.address.replace(/\d+/g, ''));
      const dist = iCol - qCol;

      if (dist > 0 && dist < closestDist) {
        closest = input;
        closestDist = dist;
      }
    }

    return closest;
  }

  /** Build categorised pairs with language handling */
  private async buildCategorisedPairs(
    rawPairs: RawQAPair[],
    categorisationResults: Array<{ category: string; confidence: number; confidenceLevel: string; flagReason?: string; suggestedAction?: string }>,
  ): Promise<CategorisedQAPair[]> {
    const pairs: CategorisedQAPair[] = [];

    // Collect items needing translation
    const translationItems: Array<{
      text: string;
      fromLang: string;
      toLang: string;
      index: number;
      field: 'questionDE' | 'questionEN' | 'answerDE' | 'answerEN' | 'notesDE' | 'notesEN';
    }> = [];

    // First pass: split languages and identify translation needs
    for (let i = 0; i < rawPairs.length; i++) {
      const raw = rawPairs[i];
      const cat = categorisationResults[i];

      const questionSplit = this.languageHandler.splitQuestion(raw.questionText);
      const answerSplit = this.languageHandler.splitAnswer(raw.answerText);

      let notesDE = raw.notesText;
      let notesEN = raw.notesText;

      // Add section header to notes
      if (raw.sectionHeader) {
        const sectionNote = `Section: ${raw.sectionHeader}`;
        notesDE = notesDE ? `${notesDE}; ${sectionNote}` : sectionNote;
        notesEN = notesEN ? `${notesEN}; ${sectionNote}` : sectionNote;
      }

      // Add multi-column identifier to notes
      if (raw.multiColumnId) {
        notesDE = notesDE ? `${notesDE}; ${raw.multiColumnId}` : raw.multiColumnId;
        notesEN = notesEN ? `${notesEN}; ${raw.multiColumnId}` : raw.multiColumnId;
      }

      // Add condition to notes
      if (raw.isConditional && raw.conditionText) {
        const condNote = `Condition: ${raw.conditionText}`;
        notesDE = notesDE ? `${notesDE}; ${condNote}` : condNote;
        notesEN = notesEN ? `${notesEN}; ${condNote}` : condNote;
      }

      const pair: CategorisedQAPair = {
        rowNumber: i + 1,
        sheet: raw.sheet,
        category: cat.category as CategorisedQAPair['category'],
        questionDE: questionSplit.de,
        questionEN: questionSplit.en,
        answerDE: answerSplit.de,
        answerEN: answerSplit.en,
        notesDE,
        notesEN,
        questionCell: raw.questionCell,
        answerCell: raw.answerCell,
        commentCell: raw.commentCell,
        confidence: cat.confidence,
        confidenceLevel: cat.confidenceLevel as CategorisedQAPair['confidenceLevel'],
        flagReason: cat.flagReason,
        suggestedAction: cat.suggestedAction,
      };

      pairs.push(pair);

      // Identify items needing translation
      if (questionSplit.sourceLanguage === 'de' && !this.languageHandler.isLanguageNeutral(questionSplit.de)) {
        translationItems.push({ text: questionSplit.de, fromLang: 'de', toLang: 'en', index: i, field: 'questionEN' });
      }
      if (questionSplit.sourceLanguage === 'en' && !this.languageHandler.isLanguageNeutral(questionSplit.en)) {
        translationItems.push({ text: questionSplit.en, fromLang: 'en', toLang: 'de', index: i, field: 'questionDE' });
      }
      if (answerSplit.sourceLanguage === 'de' && answerSplit.de && !this.languageHandler.isLanguageNeutral(answerSplit.de)) {
        translationItems.push({ text: answerSplit.de, fromLang: 'de', toLang: 'en', index: i, field: 'answerEN' });
      }
      if (answerSplit.sourceLanguage === 'en' && answerSplit.en && !this.languageHandler.isLanguageNeutral(answerSplit.en)) {
        translationItems.push({ text: answerSplit.en, fromLang: 'en', toLang: 'de', index: i, field: 'answerDE' });
      }
    }

    // Batch translate if Claude API is available
    if (translationItems.length > 0 && this.options.useClaudeAPI && this.options.anthropicApiKey) {
      this.logger.info(`  Translating ${translationItems.length} items...`);
      const translations = await this.languageHandler.translateBatch(translationItems);

      for (const item of translationItems) {
        const translated = translations.get(item.index);
        if (translated) {
          const pair = pairs[item.index];
          pair[item.field] = translated;

          // Add translation note
          const langNote = `[translated from ${item.fromLang.toUpperCase()}]`;
          if (item.field.endsWith('DE')) {
            pair.notesDE = pair.notesDE ? `${pair.notesDE}; ${langNote}` : langNote;
          } else {
            pair.notesEN = pair.notesEN ? `${pair.notesEN}; ${langNote}` : langNote;
          }
        }
      }
    }

    return pairs;
  }

  /** Compute processing statistics */
  private computeStats(
    pairs: CategorisedQAPair[],
    sheetsProcessed: number,
    processingTimeMs: number,
  ): ProcessingStats {
    const languages = new Set<string>();

    for (const pair of pairs) {
      if (pair.questionDE && pair.questionDE !== pair.questionEN) languages.add('DE');
      if (pair.questionEN && pair.questionEN !== pair.questionDE) languages.add('EN');
    }

    return {
      totalPairs: pairs.length,
      entityDBCount: pairs.filter(p => p.category === 'EntityDB').length,
      proceduresCount: pairs.filter(p => p.category === 'Procedures').length,
      productCount: pairs.filter(p => p.category === 'Product').length,
      highConfidence: pairs.filter(p => p.confidenceLevel === 'HIGH').length,
      mediumConfidence: pairs.filter(p => p.confidenceLevel === 'MEDIUM').length,
      lowConfidence: pairs.filter(p => p.confidenceLevel === 'LOW').length,
      blankAnswers: pairs.filter(p => !p.answerDE.trim() && !p.answerEN.trim()).length,
      languagesDetected: Array.from(languages),
      sheetsProcessed,
      processingTimeMs,
    };
  }

  /** Empty stats for failed files */
  private emptyStats(processingTimeMs: number): ProcessingStats {
    return {
      totalPairs: 0,
      entityDBCount: 0,
      proceduresCount: 0,
      productCount: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      blankAnswers: 0,
      languagesDetected: [],
      sheetsProcessed: 0,
      processingTimeMs,
    };
  }

  /** Empty batch summary */
  private emptyBatchSummary(startTime: number): BatchSummary {
    return {
      totalFiles: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
      aggregateStats: {
        totalPairs: 0,
        entityDBCount: 0,
        proceduresCount: 0,
        productCount: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
      },
      timestamp: new Date().toISOString(),
      totalTimeMs: Date.now() - startTime,
    };
  }

  /** Convert column letter(s) to number */
  private colLetterToNumber(col: string): number {
    let result = 0;
    for (let i = 0; i < col.length; i++) {
      result = result * 26 + (col.charCodeAt(i) - 64);
    }
    return result;
  }
}
