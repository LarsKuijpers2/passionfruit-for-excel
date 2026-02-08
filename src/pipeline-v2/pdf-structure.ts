/**
 * PDF Document Structure Extraction
 *
 * Extracts questionnaire structure from PDF files.
 * Uses pdf-parse to extract text and converts to QuestionnaireStructure.
 */

import { PDFParse } from 'pdf-parse';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import type {
  QuestionnaireStructure,
  SheetData,
  RowData,
  CellData,
  CellRole,
  DocumentType,
} from './excel-structure.js';

// =============================================================================
// TYPES
// =============================================================================

interface ParsedLine {
  text: string;
  type: 'section' | 'question' | 'answer' | 'text';
  pageNumber: number;
  lineNumber: number;
}

// =============================================================================
// EXTRACTOR
// =============================================================================

export class PdfStructureExtractor {
  /**
   * Get the document type this extractor handles
   */
  getDocumentType(): DocumentType {
    return 'pdf';
  }

  /**
   * Extract complete structure from PDF file
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const filename = basename(filepath);
    const buffer = await readFile(filepath);

    // Parse PDF using PDFParse class
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    await parser.destroy();

    // Get text and page count
    const fullText = textResult.text;
    const numPages = textResult.pages.length;

    // Split text by pages
    const pages = this.splitByPages(fullText, numPages, textResult.pages);

    // Convert pages to sheets (one sheet per page or all in one)
    const sheets = this.convertToSheets(pages, filename);

    // Calculate stats
    let totalRows = 0;
    let totalCells = 0;
    let filledCells = 0;

    for (const sheet of sheets) {
      totalRows += sheet.rows.length;
      for (const row of sheet.rows) {
        for (const cell of Object.values(row.cells)) {
          totalCells++;
          if (cell.filled) filledCells++;
        }
      }
    }

    // Detect customer from filename
    const customer = this.detectCustomer(filename);

    return {
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer,
        documentType: 'pdf',
      },
      sheets,
      stats: {
        totalSheets: sheets.length,
        totalRows,
        totalCells,
        filledCells,
      },
    };
  }

  /**
   * Split PDF text by pages
   */
  private splitByPages(text: string, numPages: number, pageTexts?: { text: string }[]): string[] {
    // If we have per-page texts from the parser, use those
    if (pageTexts && pageTexts.length > 0) {
      return pageTexts.map(p => p.text).filter(t => t.trim());
    }

    // Try to split by form feed characters (some PDFs use these)
    if (text.includes('\f')) {
      return text.split('\f').filter(p => p.trim());
    }

    // If only one page or can't determine pages, return as single page
    if (numPages <= 1) {
      return [text];
    }

    // Otherwise return as single document (we'll treat it as one "sheet")
    return [text];
  }

  /**
   * Convert pages to SheetData format
   */
  private convertToSheets(pages: string[], filename: string): SheetData[] {
    // For simplicity, we'll create one sheet for the entire document
    // (PDF page breaks don't always align with logical sections)
    const fullText = pages.join('\n\n');
    const lines = this.parseLines(fullText);
    const sheet = this.createSheetFromLines(lines, 'Document', 0, filename);

    return [sheet];
  }

  /**
   * Parse text into structured lines
   */
  private parseLines(text: string): ParsedLine[] {
    const lines: ParsedLine[] = [];
    const rawLines = text.split(/\n/).filter(l => l.trim());
    let lineNumber = 0;
    let pageNumber = 1;

    for (const raw of rawLines) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      lineNumber++;
      const type = this.classifyLine(trimmed);

      lines.push({
        text: trimmed,
        type,
        pageNumber,
        lineNumber,
      });
    }

    return lines;
  }

  /**
   * Classify a line as section header, question, answer, or plain text
   */
  private classifyLine(text: string): ParsedLine['type'] {
    // Section headers: ALL CAPS, numbered sections, or short titles
    if (this.isSectionHeader(text)) {
      return 'section';
    }

    // Questions: ends with ? or :, or starts with a number followed by period
    if (this.isQuestion(text)) {
      return 'question';
    }

    // Answers: yes/no, ja/nein, or follows question patterns
    if (this.isAnswer(text)) {
      return 'answer';
    }

    return 'text';
  }

  /**
   * Check if line is a section header
   */
  private isSectionHeader(text: string): boolean {
    // All caps and not too long
    if (text === text.toUpperCase() && text.length < 60 && text.length > 3) {
      return true;
    }

    // Numbered section like "1. Company Information" or "Section 1:"
    if (/^(\d+\.|\d+\)|\w\.|Section\s+\d)/i.test(text) && text.length < 80) {
      return true;
    }

    return false;
  }

  /**
   * Check if line is a question
   */
  private isQuestion(text: string): boolean {
    // Ends with ? or :
    if (/[?:]\s*$/.test(text)) {
      return true;
    }

    // Numbered question like "1.1" or "Q1:"
    if (/^(\d+\.\d+|\d+\)|Q\d+)/i.test(text)) {
      return true;
    }

    // Contains question indicators
    if (/\b(do you|have you|is there|are there|please|bitte|gibt es)\b/i.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Check if line is an answer
   */
  private isAnswer(text: string): boolean {
    const lower = text.toLowerCase().trim();

    // Yes/No type answers
    if (/^(yes|no|ja|nein|oui|non|true|false|n\/a|na|✓|✗|☐|☑)$/i.test(lower)) {
      return true;
    }

    // Short answers (less than 30 chars, doesn't end with : or ?)
    if (text.length < 30 && !/[?:]$/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Create SheetData from parsed lines
   */
  private createSheetFromLines(
    lines: ParsedLine[],
    name: string,
    index: number,
    filename: string
  ): SheetData {
    const rows: RowData[] = [];
    let rowNumber = 1;
    let currentSection = '';
    let pendingQuestion: ParsedLine | null = null;

    for (const line of lines) {
      if (line.type === 'section') {
        // Save any pending question first
        if (pendingQuestion) {
          rows.push(this.createQuestionRow(rowNumber, pendingQuestion, null));
          rowNumber++;
          pendingQuestion = null;
        }

        currentSection = line.text;
        rows.push(this.createSectionRow(rowNumber, line));
        rowNumber++;
      } else if (line.type === 'question') {
        // Save any previous pending question
        if (pendingQuestion) {
          rows.push(this.createQuestionRow(rowNumber, pendingQuestion, null));
          rowNumber++;
        }
        pendingQuestion = line;
      } else if (line.type === 'answer' && pendingQuestion) {
        // Pair answer with pending question
        rows.push(this.createQuestionRow(rowNumber, pendingQuestion, line));
        rowNumber++;
        pendingQuestion = null;
      } else {
        // Save any pending question first
        if (pendingQuestion) {
          rows.push(this.createQuestionRow(rowNumber, pendingQuestion, null));
          rowNumber++;
          pendingQuestion = null;
        }

        // Regular text line
        rows.push(this.createTextRow(rowNumber, line));
        rowNumber++;
      }
    }

    // Don't forget the last pending question
    if (pendingQuestion) {
      rows.push(this.createQuestionRow(rowNumber, pendingQuestion, null));
    }

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    let emptyRows = 0;

    for (const row of rows) {
      if (row.isEmpty) emptyRows++;
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    return {
      name,
      index,
      rows,
      mergedRanges: [],
      topic: this.detectTopicFromFilename(filename),
      rowCount: rows.length,
      columnCount: 2,
      stats: {
        totalCells,
        filledCells,
        emptyRows,
        mergedRanges: 0,
      },
    };
  }

  /**
   * Create a section row
   */
  private createSectionRow(rowNumber: number, line: ParsedLine): RowData {
    const ref = `PG${line.pageNumber}L${line.lineNumber}`;
    return {
      row: rowNumber,
      cells: {
        A: this.createCell(ref, line.text, 'section', true),
      },
      isEmpty: false,
      rowType: 'section',
    };
  }

  /**
   * Create a question/answer row
   */
  private createQuestionRow(
    rowNumber: number,
    question: ParsedLine,
    answer: ParsedLine | null
  ): RowData {
    const qRef = `PG${question.pageNumber}L${question.lineNumber}`;
    const cells: Record<string, CellData> = {
      A: this.createCell(`${qRef}Q`, question.text, 'label', true),
    };

    if (answer) {
      const aRef = `PG${answer.pageNumber}L${answer.lineNumber}`;
      cells.B = this.createCell(`${aRef}A`, answer.text, 'value', true);
    } else {
      cells.B = this.createCell(`${qRef}A`, '', 'input', false);
    }

    return {
      row: rowNumber,
      cells,
      isEmpty: false,
      rowType: 'data',
    };
  }

  /**
   * Create a text row
   */
  private createTextRow(rowNumber: number, line: ParsedLine): RowData {
    const ref = `PG${line.pageNumber}L${line.lineNumber}`;
    return {
      row: rowNumber,
      cells: {
        A: this.createCell(ref, line.text, 'value', true),
      },
      isEmpty: false,
      rowType: 'data',
    };
  }

  /**
   * Create a cell
   */
  private createCell(ref: string, value: string, role: CellRole, filled: boolean): CellData {
    return {
      ref,
      value,
      type: 'string',
      filled,
      role,
      format: role === 'section' ? { bold: true } : undefined,
    };
  }

  /**
   * Detect topic from filename
   */
  private detectTopicFromFilename(filename: string): string | undefined {
    const lower = filename.toLowerCase();

    if (/company|general|info|supplier/i.test(lower)) return 'Company Information';
    if (/allerg/i.test(lower)) return 'Allergens';
    if (/certif/i.test(lower)) return 'Certifications';
    if (/haccp|food.*safety/i.test(lower)) return 'Food Safety';
    if (/sustain|rse|csr/i.test(lower)) return 'Sustainability';
    if (/questionnaire|fragebogen/i.test(lower)) return 'Questionnaire';

    return undefined;
  }

  /**
   * Detect customer from filename
   */
  private detectCustomer(filename: string): string | undefined {
    const match = filename.match(/^([A-Za-z0-9+_-]+)/);
    if (match) {
      return match[1].replace(/_/g, ' ');
    }
    return undefined;
  }
}
