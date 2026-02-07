/**
 * Output generator for the questionnaire extraction pipeline.
 *
 * Generates a standardised Excel file with three sheets:
 * 1. README — rules applied, column definitions, source file, extraction date
 * 2. Q&A Data — 12-column extraction data
 * 3. Review — low-confidence items only
 */

import ExcelJS from 'exceljs';
import type { CategorisedQAPair, ProcessingStats, Category } from './types.js';

/** Category colour coding */
const CATEGORY_COLOURS: Record<Category, string> = {
  EntityDB: 'D6EAF8',   // Blue
  Procedures: 'D5F5E3',  // Green
  Product: 'FEF9E7',     // Yellow
};

/** Header style */
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

export class OutputGenerator {
  /** Generate the standardised output Excel file */
  async generate(
    outputPath: string,
    pairs: CategorisedQAPair[],
    stats: ProcessingStats,
    sourceFileName: string,
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Passionfruit Questionnaire Pipeline';
    workbook.created = new Date();

    this.buildReadmeSheet(workbook, stats, sourceFileName);
    this.buildQADataSheet(workbook, pairs);
    this.buildReviewSheet(workbook, pairs);

    await workbook.xlsx.writeFile(outputPath);
  }

  /** Build the README sheet */
  private buildReadmeSheet(
    workbook: ExcelJS.Workbook,
    stats: ProcessingStats,
    sourceFileName: string,
  ): void {
    const sheet = workbook.addWorksheet('README', {
      properties: { tabColor: { argb: 'FF4472C4' } },
    });

    sheet.columns = [
      { header: 'Field', key: 'field', width: 30 },
      { header: 'Value', key: 'value', width: 60 },
    ];

    // Style header row
    this.styleHeaderRow(sheet);

    const rows = [
      { field: 'Pipeline Version', value: '1.0.0' },
      { field: 'Source File', value: sourceFileName },
      { field: 'Extraction Date', value: new Date().toISOString() },
      { field: 'Total Q&A Pairs', value: stats.totalPairs.toString() },
      { field: 'EntityDB Count', value: stats.entityDBCount.toString() },
      { field: 'Procedures Count', value: stats.proceduresCount.toString() },
      { field: 'Product Count', value: stats.productCount.toString() },
      { field: 'Languages Detected', value: stats.languagesDetected.join(', ') },
      { field: 'High Confidence Items', value: stats.highConfidence.toString() },
      { field: 'Medium Confidence Items', value: stats.mediumConfidence.toString() },
      { field: 'Low Confidence Items', value: stats.lowConfidence.toString() },
      { field: 'Blank Answers', value: stats.blankAnswers.toString() },
      { field: 'Sheets Processed', value: stats.sheetsProcessed.toString() },
      { field: 'Processing Time (ms)', value: stats.processingTimeMs.toString() },
      { field: '', value: '' },
      { field: 'Q&A Data Column Definitions', value: '' },
      { field: '#', value: 'Sequential row number' },
      { field: 'Sheet', value: 'Source sheet name from the original file' },
      { field: 'Category', value: 'EntityDB / Procedures / Product' },
      { field: 'Question (DE)', value: 'German question text' },
      { field: 'Question (EN)', value: 'English question text' },
      { field: 'Answer (DE)', value: 'German answer text' },
      { field: 'Answer (EN)', value: 'English answer text' },
      { field: 'Notes (DE)', value: 'German notes/comments from the source' },
      { field: 'Notes (EN)', value: 'English notes/comments' },
      { field: 'Question Cell', value: 'Cell reference in source file (e.g., Sheet1!A5)' },
      { field: 'Answer Cell', value: 'Cell reference in source file (e.g., Sheet1!B5)' },
      { field: 'Comment Cell', value: 'Cell reference for any comment/note' },
    ];

    for (const row of rows) {
      sheet.addRow(row);
    }

    // Bold the "Q&A Data Column Definitions" row
    const defRow = sheet.getRow(17);
    defRow.font = { bold: true, size: 11 };
  }

  /** Build the Q&A Data sheet */
  private buildQADataSheet(
    workbook: ExcelJS.Workbook,
    pairs: CategorisedQAPair[],
  ): void {
    const sheet = workbook.addWorksheet('Q&A Data', {
      properties: { tabColor: { argb: 'FF70AD47' } },
    });

    sheet.columns = [
      { header: '#', key: 'rowNumber', width: 6 },
      { header: 'Sheet', key: 'sheet', width: 20 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Question (DE)', key: 'questionDE', width: 40 },
      { header: 'Question (EN)', key: 'questionEN', width: 40 },
      { header: 'Answer (DE)', key: 'answerDE', width: 30 },
      { header: 'Answer (EN)', key: 'answerEN', width: 30 },
      { header: 'Notes (DE)', key: 'notesDE', width: 25 },
      { header: 'Notes (EN)', key: 'notesEN', width: 25 },
      { header: 'Question Cell', key: 'questionCell', width: 16 },
      { header: 'Answer Cell', key: 'answerCell', width: 16 },
      { header: 'Comment Cell', key: 'commentCell', width: 16 },
    ];

    // Style header row
    this.styleHeaderRow(sheet);

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];

    // Enable auto-filter
    sheet.autoFilter = {
      from: 'A1',
      to: 'L1',
    };

    // Add data rows
    for (const pair of pairs) {
      const row = sheet.addRow({
        rowNumber: pair.rowNumber,
        sheet: pair.sheet,
        category: pair.category,
        questionDE: pair.questionDE,
        questionEN: pair.questionEN,
        answerDE: pair.answerDE,
        answerEN: pair.answerEN,
        notesDE: pair.notesDE,
        notesEN: pair.notesEN,
        questionCell: pair.questionCell,
        answerCell: pair.answerCell,
        commentCell: pair.commentCell,
      });

      // Apply category colour coding
      const colour = CATEGORY_COLOURS[pair.category];
      if (colour) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${colour}` },
          };
        });
      }

      // Wrap text for question and answer columns
      for (const colIdx of [4, 5, 6, 7, 8, 9]) {
        const cell = row.getCell(colIdx);
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
    }
  }

  /** Build the Review sheet */
  private buildReviewSheet(
    workbook: ExcelJS.Workbook,
    pairs: CategorisedQAPair[],
  ): void {
    const sheet = workbook.addWorksheet('Review', {
      properties: { tabColor: { argb: 'FFFF0000' } },
    });

    sheet.columns = [
      { header: '#', key: 'rowNumber', width: 6 },
      { header: 'Question', key: 'question', width: 50 },
      { header: 'Current Category', key: 'category', width: 16 },
      { header: 'Confidence', key: 'confidence', width: 14 },
      { header: 'Reason', key: 'reason', width: 40 },
      { header: 'Suggested Action', key: 'suggestedAction', width: 40 },
      { header: 'Reviewer Decision', key: 'reviewerDecision', width: 20 },
    ];

    // Style header row
    this.styleHeaderRow(sheet);

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];

    // Add low-confidence items
    const reviewItems = pairs.filter(
      p => p.confidenceLevel === 'LOW' || p.confidenceLevel === 'MEDIUM'
    );

    for (const pair of reviewItems) {
      const row = sheet.addRow({
        rowNumber: pair.rowNumber,
        question: pair.questionEN || pair.questionDE,
        category: pair.category,
        confidence: pair.confidenceLevel,
        reason: pair.flagReason || '',
        suggestedAction: pair.suggestedAction || '',
        reviewerDecision: '',
      });

      // Colour based on confidence level
      const colour = pair.confidenceLevel === 'LOW' ? 'FFFFC7CE' : 'FFFFFFCC';
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colour },
        };
      });

      // Wrap text for question and reason columns
      for (const colIdx of [2, 5, 6]) {
        const cell = row.getCell(colIdx);
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
    }

    // If no review items, add a message
    if (reviewItems.length === 0) {
      sheet.addRow({
        rowNumber: '',
        question: 'No items require review — all items have HIGH confidence.',
        category: '',
        confidence: '',
        reason: '',
        suggestedAction: '',
        reviewerDecision: '',
      });
    }
  }

  /** Apply header styling to the first row of a sheet */
  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.font = HEADER_FONT;
    headerRow.fill = HEADER_FILL;
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;
  }
}
