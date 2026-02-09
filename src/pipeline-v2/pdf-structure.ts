/**
 * PDF Document Structure Extraction
 *
 * Extracts questionnaire structure from PDF files.
 * Uses Azure Document Intelligence for high-quality table extraction,
 * with fallback to pdf-parse for basic text extraction.
 */

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
import { extractPdfWithAzure, isAzureConfigured, type DocumentAnalysisResult } from './azure-document-intelligence.js';

// =============================================================================
// TYPES
// =============================================================================

interface ParsedLine {
  text: string;
  type: 'section' | 'question' | 'answer' | 'text' | 'table-header' | 'table-row';
  pageNumber: number;
  lineNumber: number;
  cells?: string[]; // For table rows
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

    // Use Azure Document Intelligence if configured
    if (isAzureConfigured()) {
      console.log('  Using Azure Document Intelligence for PDF extraction...');
      return this.extractWithAzure(filepath, filename);
    }

    // Fallback to basic pdf-parse
    console.log('  Using basic PDF extraction (Azure DI not configured)...');
    return this.extractWithPdfParse(filepath, filename);
  }

  /**
   * Extract using Azure Document Intelligence (high quality)
   */
  private async extractWithAzure(filepath: string, filename: string): Promise<QuestionnaireStructure> {
    const result = await extractPdfWithAzure(filepath);

    // Parse the markdown into structured sheets
    const sheets = this.parseMarkdownToSheets(result, filename);

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

    return {
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer: this.detectCustomer(filename),
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
   * Parse Azure DI markdown output into sheets
   * Handles both markdown tables and HTML tables
   */
  private parseMarkdownToSheets(result: DocumentAnalysisResult, filename: string): SheetData[] {
    const markdown = result.markdown;

    // Check if content has HTML tables
    if (markdown.includes('<table') || markdown.includes('<tr>')) {
      return this.parseHtmlTables(markdown, filename);
    }

    // Otherwise parse as markdown
    return this.parseMarkdownTables(markdown, filename);
  }

  /**
   * Parse HTML tables from Azure DI output
   */
  private parseHtmlTables(html: string, filename: string): SheetData[] {
    const rows: RowData[] = [];
    let rowNumber = 1;

    // Extract all tables
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableContent = tableMatch[1];

      // Extract rows from table
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let isHeaderRow = true;
      let tableHeaders: string[] = [];

      while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
        const rowContent = rowMatch[1];

        // Extract cells (th or td)
        const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        const cells: string[] = [];
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          // Clean up cell content - remove HTML tags and decode entities
          let cellValue = cellMatch[1]
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
          cells.push(cellValue);
        }

        if (cells.length > 0) {
          if (isHeaderRow && cells.some(c => /^(yes|no|n\/a|ja|nein)/i.test(c))) {
            // This is a header row with Yes/No/N/A columns
            tableHeaders = cells;
            rows.push(this.createTableRow(rowNumber, cells, rowNumber, true));
            rowNumber++;
            isHeaderRow = false;
          } else if (tableHeaders.length > 0) {
            // Data row - interpret x/☒ marks based on column headers
            const interpretedCells = this.interpretYesNoCells(cells, tableHeaders);
            rows.push(this.createTableRow(rowNumber, interpretedCells, rowNumber, false, tableHeaders));
            rowNumber++;
          } else {
            // Regular row
            rows.push(this.createTableRow(rowNumber, cells, rowNumber, isHeaderRow));
            rowNumber++;
            isHeaderRow = false;
          }
        }
      }
    }

    // Also extract non-table text (section headers)
    const textRegex = /^([A-Z][A-Z\s]+)$/gm;
    let textMatch;
    const processedSections = new Set<string>();

    while ((textMatch = textRegex.exec(html)) !== null) {
      const sectionName = textMatch[1].trim();
      if (sectionName.length > 3 && sectionName.length < 60 && !processedSections.has(sectionName)) {
        processedSections.add(sectionName);
        // Insert section headers (we'll sort later or they'll appear at end)
      }
    }

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of rows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    return [{
      name: 'Document',
      index: 0,
      rows,
      mergedRanges: [],
      topic: this.detectTopicFromFilename(filename),
      rowCount: rows.length,
      columnCount: Math.max(...rows.map(r => Object.keys(r.cells).length), 1),
      stats: {
        totalCells,
        filledCells,
        emptyRows: 0,
        mergedRanges: 0,
      },
    }];
  }

  /**
   * Interpret Yes/No/N/A cells based on x/☒ marks
   */
  private interpretYesNoCells(cells: string[], headers: string[]): string[] {
    const result: string[] = [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const header = headers[i]?.toLowerCase() || '';

      // If this cell has an x or checkbox mark
      if (/^[x☒✓✔]$/i.test(cell.trim()) || cell.includes('☒') || cell.includes('✓')) {
        // Check which column this is
        if (/^yes/i.test(header)) {
          result.push('Yes');
        } else if (/^no$/i.test(header)) {
          result.push('No');
        } else if (/^n\/a/i.test(header)) {
          result.push('N/A');
        } else {
          result.push(cell); // Keep original
        }
      } else {
        result.push(cell);
      }
    }

    return result;
  }

  /**
   * Parse markdown tables
   */
  private parseMarkdownTables(markdown: string, filename: string): SheetData[] {
    const lines = markdown.split('\n');

    const rows: RowData[] = [];
    let rowNumber = 1;
    let currentSection = '';
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableRowIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect markdown headers (## Section Name)
      const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        inTable = false;
        currentSection = headerMatch[2];
        rows.push(this.createSectionRow(rowNumber, currentSection, i + 1));
        rowNumber++;
        continue;
      }

      // Detect markdown table header row (| Header 1 | Header 2 |)
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());

        // Check if this is a separator row (|---|---|)
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue; // Skip separator
        }

        if (!inTable) {
          // This is the header row
          inTable = true;
          tableHeaders = cells;
          tableRowIndex = 0;

          // Create header row
          rows.push(this.createTableRow(rowNumber, cells, i + 1, true));
          rowNumber++;
        } else {
          // This is a data row
          tableRowIndex++;
          rows.push(this.createTableRow(rowNumber, cells, i + 1, false, tableHeaders));
          rowNumber++;
        }
        continue;
      }

      // End of table
      if (inTable && !line.startsWith('|')) {
        inTable = false;
        tableHeaders = [];
      }

      // Regular text line - could be a question or answer
      if (!inTable) {
        const type = this.classifyLine(line);
        if (type === 'section') {
          rows.push(this.createSectionRow(rowNumber, line, i + 1));
        } else {
          rows.push(this.createTextRow(rowNumber, line, i + 1, type));
        }
        rowNumber++;
      }
    }

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of rows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    return [{
      name: 'Document',
      index: 0,
      rows,
      mergedRanges: [],
      topic: this.detectTopicFromFilename(filename),
      rowCount: rows.length,
      columnCount: Math.max(...rows.map(r => Object.keys(r.cells).length), 1),
      stats: {
        totalCells,
        filledCells,
        emptyRows: 0,
        mergedRanges: 0,
      },
    }];
  }

  /**
   * Create a table row from markdown table cells
   */
  private createTableRow(
    rowNumber: number,
    cells: string[],
    lineNumber: number,
    isHeader: boolean,
    headers?: string[]
  ): RowData {
    const rowCells: Record<string, CellData> = {};
    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (let i = 0; i < cells.length && i < 26; i++) {
      const colLetter = colLetters[i];
      const value = cells[i];
      const filled = value.length > 0;

      // Determine role based on position and content
      let role: CellRole = 'value';
      if (isHeader) {
        role = 'header';
      } else if (i === 0) {
        role = 'label'; // First column is usually the question/label
      } else if (headers && headers[i]) {
        // Check if this is a Yes/No column
        const header = headers[i].toLowerCase();
        if (/^(yes|no|n\/a|ja|nein|oui|non)$/i.test(header)) {
          role = 'value';
        }
      }

      rowCells[colLetter] = {
        ref: `${colLetter}${rowNumber}`,
        value,
        type: 'string',
        filled,
        role,
      };
    }

    return {
      row: rowNumber,
      cells: rowCells,
      isEmpty: Object.values(rowCells).every(c => !c.filled),
      rowType: isHeader ? 'header' : 'data',
    };
  }

  /**
   * Create a section row
   */
  private createSectionRow(rowNumber: number, text: string, lineNumber: number): RowData {
    return {
      row: rowNumber,
      cells: {
        A: {
          ref: `PG1L${lineNumber}`,
          value: text,
          type: 'string',
          filled: true,
          role: 'section',
          format: { bold: true },
        },
      },
      isEmpty: false,
      rowType: 'section',
    };
  }

  /**
   * Create a text row
   */
  private createTextRow(
    rowNumber: number,
    text: string,
    lineNumber: number,
    type: 'question' | 'answer' | 'text'
  ): RowData {
    const role: CellRole = type === 'question' ? 'label' : 'value';

    return {
      row: rowNumber,
      cells: {
        A: {
          ref: `PG1L${lineNumber}`,
          value: text,
          type: 'string',
          filled: true,
          role,
        },
      },
      isEmpty: false,
      rowType: 'data',
    };
  }

  /**
   * Classify a line type
   */
  private classifyLine(text: string): 'section' | 'question' | 'answer' | 'text' {
    // Section headers: ALL CAPS, numbered sections, or short titles
    if (this.isSectionHeader(text)) {
      return 'section';
    }

    // Questions: ends with ? or :
    if (/[?:]\s*$/.test(text)) {
      return 'question';
    }

    // Yes/No answers
    if (/^(yes|no|ja|nein|oui|non|n\/a|x|✓|✗)$/i.test(text.trim())) {
      return 'answer';
    }

    return 'text';
  }

  /**
   * Check if line is a section header
   */
  private isSectionHeader(text: string): boolean {
    if (text === text.toUpperCase() && text.length < 60 && text.length > 3) {
      return true;
    }
    if (/^(\d+\.|\d+\)|\w\.|Section\s+\d)/i.test(text) && text.length < 80) {
      return true;
    }
    return false;
  }

  // =============================================================================
  // FALLBACK: PDF-PARSE (basic text extraction)
  // =============================================================================

  /**
   * Extract using pdf-parse (fallback when Azure DI not configured)
   */
  private async extractWithPdfParse(filepath: string, filename: string): Promise<QuestionnaireStructure> {
    // Dynamic import of pdf-parse
    const { PDFParse } = await import('pdf-parse');
    const buffer = await readFile(filepath);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    await parser.destroy();
    const data = { text: textResult.text };

    const text = data.text;
    const lines = this.parseLinesFromText(text);
    const sheet = this.createSheetFromLines(lines, 'Document', 0, filename);

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of sheet.rows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    return {
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer: this.detectCustomer(filename),
        documentType: 'pdf',
      },
      sheets: [sheet],
      stats: {
        totalSheets: 1,
        totalRows: sheet.rows.length,
        totalCells,
        filledCells,
      },
    };
  }

  /**
   * Parse text into structured lines (for pdf-parse fallback)
   */
  private parseLinesFromText(text: string): ParsedLine[] {
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
   * Create SheetData from parsed lines (for pdf-parse fallback)
   */
  private createSheetFromLines(
    lines: ParsedLine[],
    name: string,
    index: number,
    filename: string
  ): SheetData {
    const rows: RowData[] = [];
    let rowNumber = 1;
    let pendingQuestion: ParsedLine | null = null;

    for (const line of lines) {
      if (line.type === 'section') {
        if (pendingQuestion) {
          rows.push(this.createQuestionRowFromLine(rowNumber, pendingQuestion, null));
          rowNumber++;
          pendingQuestion = null;
        }
        rows.push(this.createSectionRow(rowNumber, line.text, line.lineNumber));
        rowNumber++;
      } else if (line.type === 'question') {
        if (pendingQuestion) {
          rows.push(this.createQuestionRowFromLine(rowNumber, pendingQuestion, null));
          rowNumber++;
        }
        pendingQuestion = line;
      } else if (line.type === 'answer' && pendingQuestion) {
        rows.push(this.createQuestionRowFromLine(rowNumber, pendingQuestion, line));
        rowNumber++;
        pendingQuestion = null;
      } else {
        if (pendingQuestion) {
          rows.push(this.createQuestionRowFromLine(rowNumber, pendingQuestion, null));
          rowNumber++;
          pendingQuestion = null;
        }
        rows.push(this.createTextRow(rowNumber, line.text, line.lineNumber, line.type as 'text'));
        rowNumber++;
      }
    }

    if (pendingQuestion) {
      rows.push(this.createQuestionRowFromLine(rowNumber, pendingQuestion, null));
    }

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of rows) {
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
        emptyRows: 0,
        mergedRanges: 0,
      },
    };
  }

  /**
   * Create a question/answer row from parsed lines
   */
  private createQuestionRowFromLine(
    rowNumber: number,
    question: ParsedLine,
    answer: ParsedLine | null
  ): RowData {
    const qRef = `PG${question.pageNumber}L${question.lineNumber}`;
    const cells: Record<string, CellData> = {
      A: {
        ref: `${qRef}Q`,
        value: question.text,
        type: 'string',
        filled: true,
        role: 'label',
      },
    };

    if (answer) {
      const aRef = `PG${answer.pageNumber}L${answer.lineNumber}`;
      cells.B = {
        ref: `${aRef}A`,
        value: answer.text,
        type: 'string',
        filled: true,
        role: 'value',
      };
    } else {
      cells.B = {
        ref: `${qRef}A`,
        value: '',
        type: 'string',
        filled: false,
        role: 'input',
      };
    }

    return {
      row: rowNumber,
      cells,
      isEmpty: false,
      rowType: 'data',
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
