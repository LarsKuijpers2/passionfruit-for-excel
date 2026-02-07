/**
 * Section Extractor for Pipeline v2
 *
 * Extracts the hierarchical structure of questionnaires:
 * - Detects sections and subsections
 * - Identifies question-answer pairs
 * - Preserves cell references
 */

import ExcelJS from 'exceljs';
import type {
  QuestionnaireMetadata,
  QuestionnaireSection,
  ExtractedQuestion,
} from './types.js';
import { randomUUID } from 'crypto';

/** Patterns that indicate a section header */
const SECTION_HEADER_PATTERNS = [
  /^[A-Z0-9]+[\.\)]\s+[A-Z]/,  // "1. COMPANY INFORMATION" or "A) QUALITY"
  /^SECTION\s+\d+/i,
  /^PART\s+[A-Z0-9]+/i,
  /^CHAPTER\s+\d+/i,
  /^[IVX]+\.\s+[A-Z]/,  // Roman numerals: "I. GENERAL"
  /^\d+\.\d+\s+[A-Z]/,  // "1.1 Subsection"
];

/** Patterns that indicate a question (label cell) */
const QUESTION_PATTERNS = [
  /\?$/,  // Ends with question mark
  /^(please|bitte|indicate|angeben|provide|describe|explain|list|name)/i,
  /^(is|are|do|does|have|has|can|will|does|did)\s/i,
  /^(if|falls|when|when|sofern)\s/i,  // Conditional
];

/** Cells that are likely input fields (answers) */
const INPUT_INDICATORS = {
  colors: ['#FFFF00', '#FFC000', '#BFBFBF', '#D9E1F2', '#E2EFDA'],  // Common input cell colors
  borders: true,  // Has visible borders
  unlocked: true,  // Cell is unlocked in protected sheet
};

interface CellInfo {
  address: string;
  row: number;
  col: number;
  value: string;
  isBold: boolean;
  isMerged: boolean;
  bgColor?: string;
  isUnlocked: boolean;
  fontSize?: number;
  comment?: string;
}

interface ExtractedRow {
  rowNumber: number;
  cells: CellInfo[];
}

export class SectionExtractor {
  /**
   * Extract sections and questions from an Excel file
   */
  async extract(filePath: string): Promise<{
    metadata: QuestionnaireMetadata;
    sections: QuestionnaireSection[];
    questions: ExtractedQuestion[];
  }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const filename = filePath.split('/').pop() || 'unknown';
    const sections: QuestionnaireSection[] = [];
    const questions: ExtractedQuestion[] = [];

    // Extract metadata
    const metadata: QuestionnaireMetadata = {
      filename,
      sheetCount: workbook.worksheets.length,
      processedAt: new Date().toISOString(),
    };

    // Try to extract customer/product from filename
    const filenameInfo = this.parseFilename(filename);
    if (filenameInfo.customer) metadata.customer = filenameInfo.customer;
    if (filenameInfo.products.length > 0) metadata.products = filenameInfo.products;
    if (filenameInfo.date) metadata.date = filenameInfo.date;

    // Process each worksheet
    for (const worksheet of workbook.worksheets) {
      // Skip hidden sheets
      if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') continue;

      const { sheetSections, sheetQuestions } = await this.extractFromSheet(worksheet);

      sections.push(...sheetSections);
      questions.push(...sheetQuestions);
    }

    return { metadata, sections, questions };
  }

  /**
   * Extract sections and questions from a single worksheet
   */
  private async extractFromSheet(worksheet: ExcelJS.Worksheet): Promise<{
    sheetSections: QuestionnaireSection[];
    sheetQuestions: ExtractedQuestion[];
  }> {
    const sheetName = worksheet.name;
    const rows = this.extractRows(worksheet);

    const sheetSections: QuestionnaireSection[] = [];
    const sheetQuestions: ExtractedQuestion[] = [];

    let currentSection: QuestionnaireSection | null = null;
    let sectionCounter = 0;

    for (const row of rows) {
      // Check for section header
      const headerCell = this.findSectionHeader(row);
      if (headerCell) {
        // Save previous section
        if (currentSection && currentSection.questions.length > 0) {
          currentSection.endRow = row.rowNumber - 1;
          sheetSections.push(currentSection);
        }

        sectionCounter++;
        currentSection = {
          id: `${sheetName}-${sectionCounter}`,
          title: headerCell.value,
          sheetName,
          startRow: row.rowNumber,
          endRow: row.rowNumber,
          questions: [],
        };
        continue;
      }

      // Check for question-answer pair
      const qaPair = this.extractQAPair(row, sheetName);
      if (qaPair) {
        // Create default section if none exists
        if (!currentSection) {
          sectionCounter++;
          currentSection = {
            id: `${sheetName}-${sectionCounter}`,
            title: sheetName,
            sheetName,
            startRow: 1,
            endRow: row.rowNumber,
            questions: [],
          };
        }

        qaPair.sectionId = currentSection.id;
        currentSection.questions.push(qaPair);
        sheetQuestions.push(qaPair);
      }
    }

    // Save last section
    if (currentSection && currentSection.questions.length > 0) {
      currentSection.endRow = rows.length > 0 ? rows[rows.length - 1].rowNumber : currentSection.startRow;
      sheetSections.push(currentSection);
    }

    return { sheetSections, sheetQuestions };
  }

  /**
   * Extract all rows with cell information
   */
  private extractRows(worksheet: ExcelJS.Worksheet): ExtractedRow[] {
    const rows: ExtractedRow[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: CellInfo[] = [];

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const value = this.getCellValue(cell);
        if (!value.trim()) return;

        const font = cell.font || {};
        const fill = cell.fill;
        let bgColor: string | undefined;

        if (fill && fill.type === 'pattern' && fill.fgColor) {
          bgColor = fill.fgColor.argb || fill.fgColor.theme?.toString();
        }

        cells.push({
          address: cell.address,
          row: rowNumber,
          col: colNumber,
          value: value.trim(),
          isBold: !!font.bold,
          isMerged: !!cell.isMerged,
          bgColor,
          isUnlocked: cell.protection?.locked === false,
          fontSize: font.size,
          comment: cell.note?.texts?.map(t =>
            typeof t === 'string' ? t : t.text
          ).join('') || undefined,
        });
      });

      if (cells.length > 0) {
        rows.push({ rowNumber, cells });
      }
    });

    return rows;
  }

  /**
   * Find section header in a row
   */
  private findSectionHeader(row: ExtractedRow): CellInfo | null {
    for (const cell of row.cells) {
      // Check if cell looks like a header
      if (cell.isBold || cell.fontSize && cell.fontSize >= 12) {
        for (const pattern of SECTION_HEADER_PATTERNS) {
          if (pattern.test(cell.value)) {
            return cell;
          }
        }
      }

      // Check for merged cells spanning multiple columns (often headers)
      if (cell.isMerged && cell.isBold) {
        // If it's all caps or starts with a number/letter and period
        if (/^[A-Z0-9]+[\.\)]\s/.test(cell.value) || cell.value === cell.value.toUpperCase()) {
          return cell;
        }
      }
    }

    return null;
  }

  /**
   * Extract question-answer pair from a row
   */
  private extractQAPair(row: ExtractedRow, sheetName: string): ExtractedQuestion | null {
    if (row.cells.length < 1) return null;

    // Strategy 1: Find question cell (label) and answer cell (input)
    let questionCell: CellInfo | null = null;
    let answerCell: CellInfo | null = null;

    // Look for question patterns
    for (const cell of row.cells) {
      if (this.isLikelyQuestion(cell)) {
        questionCell = cell;
        break;
      }
    }

    // If no question found, check if first cell is a label
    if (!questionCell && row.cells.length >= 1) {
      const firstCell = row.cells[0];
      // First cell is likely a question if it's text and there's something after it
      if (firstCell.value.length > 5 && row.cells.length >= 2) {
        questionCell = firstCell;
      }
    }

    if (!questionCell) return null;

    // Find answer cell (to the right of question, or with input indicators)
    const questionCol = questionCell.col;
    for (const cell of row.cells) {
      if (cell.col > questionCol) {
        // Check for input cell indicators
        if (this.isLikelyInput(cell) || cell.col === questionCol + 1) {
          answerCell = cell;
          break;
        }
      }
    }

    // Create Q&A pair even if answer is empty
    const question: ExtractedQuestion = {
      id: randomUUID(),
      sectionId: '', // Will be set by caller
      questionText: questionCell.value,
      answerText: answerCell?.value || '',
      questionCell: `${sheetName}!${questionCell.address}`,
      answerCell: answerCell ? `${sheetName}!${answerCell.address}` : '',
      notes: questionCell.comment || answerCell?.comment,
      rowNumber: row.rowNumber,
    };

    // Detect conditional questions
    const condMatch = questionCell.value.match(
      /(?:if|falls|wenn|only if|nur wenn|sofern)\s+(.+)/i
    );
    if (condMatch) {
      question.isConditional = true;
      question.conditionText = condMatch[1].trim();
    }

    return question;
  }

  /**
   * Check if a cell is likely a question
   */
  private isLikelyQuestion(cell: CellInfo): boolean {
    const value = cell.value;

    // Check patterns
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(value)) {
        return true;
      }
    }

    // Check if it's a numbered item (1., 2., a), b), etc.)
    if (/^[\d]+[.\)]\s/.test(value) || /^[a-z][.\)]\s/i.test(value)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a cell is likely an input field
   */
  private isLikelyInput(cell: CellInfo): boolean {
    // Unlocked cells are typically input fields
    if (cell.isUnlocked) return true;

    // Check background color
    if (cell.bgColor) {
      const color = cell.bgColor.toUpperCase();
      for (const inputColor of INPUT_INDICATORS.colors) {
        if (color.includes(inputColor.replace('#', ''))) {
          return true;
        }
      }
    }

    // Short values are often answers (yes/no, numbers, dates)
    if (cell.value.length < 50 && !this.isLikelyQuestion(cell)) {
      return true;
    }

    return false;
  }

  /**
   * Get cell value as string
   */
  private getCellValue(cell: ExcelJS.Cell): string {
    const value = cell.value;

    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date) return value.toISOString().split('T')[0];

    // Rich text
    if (typeof value === 'object' && 'richText' in value) {
      return value.richText.map(rt => rt.text).join('');
    }

    // Formula result
    if (typeof value === 'object' && 'result' in value) {
      return String(value.result || '');
    }

    // Hyperlink
    if (typeof value === 'object' && 'hyperlink' in value) {
      return value.text || value.hyperlink || '';
    }

    return String(value);
  }

  /**
   * Parse filename for metadata
   */
  private parseFilename(filename: string): {
    customer?: string;
    products: string[];
    date?: string;
  } {
    const result: { customer?: string; products: string[]; date?: string } = {
      products: [],
    };

    // Remove extension
    const name = filename.replace(/\.[^.]+$/, '');

    // Look for date patterns
    const dateMatch = name.match(/(\d{4}[-_]?\d{2}[-_]?\d{2})|(\d{2}[-_]\d{2}[-_]\d{4})/);
    if (dateMatch) {
      result.date = dateMatch[0].replace(/_/g, '-');
    }

    // Look for common separators
    const parts = name.split(/[-_\s]+/);

    // First part is often customer name
    if (parts.length > 0) {
      const firstPart = parts[0];
      if (!/^\d+$/.test(firstPart)) {  // Not just a number
        result.customer = firstPart;
      }
    }

    // Look for product indicators
    const productKeywords = ['product', 'artikel', 'sku', 'item'];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].toLowerCase();
      if (productKeywords.some(k => part.includes(k)) && i + 1 < parts.length) {
        result.products.push(parts[i + 1]);
      }
    }

    return result;
  }
}
