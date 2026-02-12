/**
 * Word Document Structure Extraction
 *
 * Extracts questionnaire structure from Word (.docx) files.
 * Uses mammoth to parse the document and converts to QuestionnaireStructure.
 */

import mammoth from 'mammoth';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import type {
  QuestionnaireStructure,
  SheetData,
  RowData,
  CellData,
  CellRole,
  MergedRange,
  DocumentType,
} from './excel.js';

// =============================================================================
// TYPES
// =============================================================================

interface ParsedElement {
  type: 'heading' | 'paragraph' | 'table' | 'list';
  level?: number; // For headings (1-6)
  text: string;
  bold?: boolean;
  children?: ParsedElement[]; // For tables and lists
  rows?: ParsedTableRow[]; // For tables
}

interface ParsedTableRow {
  cells: string[];
}

// =============================================================================
// EXTRACTOR
// =============================================================================

export class WordStructureExtractor {
  /**
   * Get the document type this extractor handles
   */
  getDocumentType(): DocumentType {
    return 'word';
  }

  /**
   * Extract complete structure from Word file
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const filename = basename(filepath);

    // Extract HTML and raw text from Word document
    const buffer = await readFile(filepath);
    const [htmlResult, textResult] = await Promise.all([
      mammoth.convertToHtml({ buffer }),
      mammoth.extractRawText({ buffer }),
    ]);

    // Parse HTML into structured elements
    const elements = this.parseHtml(htmlResult.value);

    // Convert to SheetData format (single "sheet" for the document)
    const sheetData = this.convertToSheetData(elements, filename);

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of sheetData.rows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
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
        documentType: 'word',
      },
      sheets: [sheetData],
      stats: {
        totalSheets: 1,
        totalRows: sheetData.rows.length,
        totalCells,
        filledCells,
      },
    };
  }

  /**
   * Parse mammoth HTML output into structured elements
   */
  private parseHtml(html: string): ParsedElement[] {
    const elements: ParsedElement[] = [];

    // Simple regex-based parsing (sufficient for mammoth's clean HTML output)
    // Mammoth produces clean HTML with consistent structure

    // Split by major block elements
    const blockPattern = /<(h[1-6]|p|table|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = blockPattern.exec(html)) !== null) {
      const [, tag, content] = match;
      const tagLower = tag.toLowerCase();

      if (tagLower.startsWith('h')) {
        // Heading
        const level = parseInt(tagLower[1], 10);
        elements.push({
          type: 'heading',
          level,
          text: this.stripHtml(content).trim(),
          bold: true,
        });
      } else if (tagLower === 'p') {
        // Paragraph - check if it contains bold text (likely a label)
        const text = this.stripHtml(content).trim();
        if (text) {
          const hasBold = /<strong>|<b>/i.test(content);
          elements.push({
            type: 'paragraph',
            text,
            bold: hasBold,
          });
        }
      } else if (tagLower === 'table') {
        // Table
        const rows = this.parseTable(content);
        if (rows.length > 0) {
          elements.push({
            type: 'table',
            text: 'Table',
            rows,
          });
        }
      } else if (tagLower === 'ul' || tagLower === 'ol') {
        // List
        const items = this.parseList(content);
        for (const item of items) {
          elements.push({
            type: 'list',
            text: item,
          });
        }
      }
    }

    // If no block elements found, fall back to splitting by newlines
    if (elements.length === 0) {
      const text = this.stripHtml(html);
      const lines = text.split(/\n+/).filter(l => l.trim());
      for (const line of lines) {
        elements.push({
          type: 'paragraph',
          text: line.trim(),
        });
      }
    }

    return elements;
  }

  /**
   * Parse HTML table into rows
   */
  private parseTable(tableHtml: string): ParsedTableRow[] {
    const rows: ParsedTableRow[] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
      const rowContent = rowMatch[1];
      const cells: string[] = [];
      const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;

      while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
        cells.push(this.stripHtml(cellMatch[1]).trim());
      }

      if (cells.length > 0) {
        rows.push({ cells });
      }
    }

    return rows;
  }

  /**
   * Parse HTML list into items
   */
  private parseList(listHtml: string): string[] {
    const items: string[] = [];
    const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;

    while ((match = itemPattern.exec(listHtml)) !== null) {
      const text = this.stripHtml(match[1]).trim();
      if (text) {
        items.push(text);
      }
    }

    return items;
  }

  /**
   * Strip HTML tags from text
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Convert parsed elements to SheetData format
   */
  private convertToSheetData(elements: ParsedElement[], filename: string): SheetData {
    const rows: RowData[] = [];
    let rowNumber = 1;
    let currentSection = '';
    let tableIndex = 0;

    for (const element of elements) {
      if (element.type === 'heading') {
        // Heading becomes a section row
        currentSection = element.text;
        rows.push(this.createSectionRow(rowNumber, element.text, `H${element.level || 1}`));
        rowNumber++;
      } else if (element.type === 'paragraph') {
        // Check if paragraph looks like a Q&A pair (contains : or ?)
        const qaMatch = element.text.match(/^(.+?)[:\?]\s*(.*)$/);
        if (qaMatch) {
          const [, label, value] = qaMatch;
          rows.push(this.createQARow(rowNumber, label.trim(), value.trim(), `P${rowNumber}`));
        } else {
          // Single text paragraph
          rows.push(this.createTextRow(rowNumber, element.text, element.bold, `P${rowNumber}`));
        }
        rowNumber++;
      } else if (element.type === 'table' && element.rows) {
        // Table becomes multiple rows
        tableIndex++;
        const tableRows = this.convertTableToRows(element.rows, rowNumber, tableIndex);
        rows.push(...tableRows);
        rowNumber += tableRows.length;
      } else if (element.type === 'list') {
        // List item as a single row
        rows.push(this.createTextRow(rowNumber, `• ${element.text}`, false, `L${rowNumber}`));
        rowNumber++;
      }
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
      name: 'Document',
      index: 0,
      rows,
      mergedRanges: [],
      topic: this.detectTopicFromFilename(filename),
      rowCount: rows.length,
      columnCount: 3, // Max columns we use: A (ref), B (label), C (value)
      stats: {
        totalCells,
        filledCells,
        emptyRows,
        mergedRanges: 0,
      },
    };
  }

  /**
   * Create a section header row
   */
  private createSectionRow(rowNumber: number, text: string, ref: string): RowData {
    return {
      row: rowNumber,
      cells: {
        A: this.createCell(ref, text, 'section', true),
      },
      isEmpty: false,
      rowType: 'section',
    };
  }

  /**
   * Create a Q&A row (label + value)
   */
  private createQARow(rowNumber: number, label: string, value: string, ref: string): RowData {
    const cells: Record<string, CellData> = {
      A: this.createCell(`${ref}L`, label, 'label', true),
    };

    if (value) {
      cells.B = this.createCell(`${ref}V`, value, 'value', true);
    } else {
      cells.B = this.createCell(`${ref}V`, '', 'input', false);
    }

    return {
      row: rowNumber,
      cells,
      isEmpty: false,
      rowType: 'data',
    };
  }

  /**
   * Create a text row (single cell)
   */
  private createTextRow(rowNumber: number, text: string, bold: boolean | undefined, ref: string): RowData {
    const role: CellRole = bold ? 'label' : 'value';
    return {
      row: rowNumber,
      cells: {
        A: this.createCell(ref, text, role, true),
      },
      isEmpty: false,
      rowType: 'data',
    };
  }

  /**
   * Convert table rows to RowData format
   */
  private convertTableToRows(tableRows: ParsedTableRow[], startRow: number, tableIndex: number): RowData[] {
    const rows: RowData[] = [];
    const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    for (let i = 0; i < tableRows.length; i++) {
      const tableRow = tableRows[i];
      const rowNumber = startRow + i;
      const cells: Record<string, CellData> = {};
      const isHeader = i === 0; // First row is usually header

      for (let j = 0; j < tableRow.cells.length && j < columns.length; j++) {
        const col = columns[j];
        const cellValue = tableRow.cells[j];
        const ref = `T${tableIndex}R${i + 1}C${j + 1}`;
        const role: CellRole = isHeader ? 'header' : (j === 0 ? 'label' : 'value');

        cells[col] = this.createCell(ref, cellValue, role, cellValue.length > 0);
      }

      rows.push({
        row: rowNumber,
        cells,
        isEmpty: Object.values(cells).every(c => !c.filled),
        rowType: isHeader ? 'header' : 'data',
      });
    }

    return rows;
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
      format: role === 'section' || role === 'header' ? { bold: true } : undefined,
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
