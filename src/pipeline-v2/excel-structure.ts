/**
 * Excel Structure Preservation
 *
 * Stores questionnaires in their original Excel structure:
 * - Sheets with names
 * - Rows with cell values
 * - Cell references preserved
 * - No forced Q&A transformation
 */

import ExcelJS from 'exceljs';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// =============================================================================
// TYPES
// =============================================================================

/** Cell formatting information */
export interface CellFormat {
  /** Background color (hex) */
  bgColor?: string;
  /** Font color (hex) */
  fontColor?: string;
  /** Is bold */
  bold?: boolean;
  /** Is italic */
  italic?: boolean;
  /** Font size */
  fontSize?: number;
  /** Has border */
  hasBorder?: boolean;
  /** Border style */
  borderStyle?: string;
  /** Is part of merged range */
  isMerged?: boolean;
  /** Merged range (e.g., "A1:C3") */
  mergeRange?: string;
  /** Is this the top-left of a merged range */
  isMergeOrigin?: boolean;
}

/** Detected cell role based on formatting */
export type CellRole = 'header' | 'section' | 'label' | 'input' | 'value' | 'empty' | 'unknown';

/** A single cell with its value and metadata */
export interface CellData {
  /** Cell reference (e.g., "A5") */
  ref: string;
  /** Cell value as string */
  value: string;
  /** Original value type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'formula' | 'richtext' | 'empty';
  /** Is this cell filled (has content)? */
  filled: boolean;
  /** Cell formatting */
  format?: CellFormat;
  /** Detected role based on formatting */
  role?: CellRole;
}

/** A row with all its cells */
export interface RowData {
  /** Row number */
  row: number;
  /** All cells in this row (by column letter) */
  cells: Record<string, CellData>;
  /** Is this row empty? */
  isEmpty: boolean;
  /** Detected row type */
  rowType: 'header' | 'data' | 'section' | 'empty' | 'unknown';
}

/** Merged cell range */
export interface MergedRange {
  /** Range string (e.g., "A1:C3") */
  range: string;
  /** Top-left cell reference */
  start: string;
  /** Bottom-right cell reference */
  end: string;
  /** Start row */
  startRow: number;
  /** End row */
  endRow: number;
  /** Start column */
  startCol: string;
  /** End column */
  endCol: string;
  /** Value in merged range */
  value?: string;
}

/** A sheet with all its rows */
export interface SheetData {
  /** Sheet name */
  name: string;
  /** Sheet index */
  index: number;
  /** Is this sheet hidden? */
  hidden?: boolean;
  /** All rows */
  rows: RowData[];
  /** Merged cell ranges */
  mergedRanges: MergedRange[];
  /** Column headers (if detected) */
  headers?: Record<string, string>;
  /** Detected topic for this sheet */
  topic?: string;
  /** Row range */
  rowCount: number;
  /** Column range */
  columnCount: number;
  /** Detected input cells (likely answer fields) */
  inputCells?: string[];
  /** Stats */
  stats: {
    totalCells: number;
    filledCells: number;
    emptyRows: number;
    mergedRanges: number;
  };
}

/** Supported document types */
export type DocumentType = 'excel' | 'word' | 'pdf';

/** Complete questionnaire structure */
export interface QuestionnaireStructure {
  /** Source file info */
  source: {
    filename: string;
    filepath: string;
    extractedAt: string;
    customer?: string;
    /** Document type (excel, word, pdf) */
    documentType?: DocumentType;
  };
  /** All sheets */
  sheets: SheetData[];
  /** Overall stats */
  stats: {
    totalSheets: number;
    totalRows: number;
    totalCells: number;
    filledCells: number;
  };
}

// =============================================================================
// EXTRACTOR
// =============================================================================

export class ExcelStructureExtractor {
  /**
   * Extract complete structure from Excel file
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filepath);

    const filename = basename(filepath);
    const sheets: SheetData[] = [];

    let totalRows = 0;
    let totalCells = 0;
    let filledCells = 0;

    workbook.eachSheet((worksheet, sheetIndex) => {
      // Skip hidden sheets - they're not relevant for users
      const isHidden = worksheet.state === 'hidden' || worksheet.state === 'veryHidden';
      if (isHidden) {
        return; // Skip this sheet entirely
      }

      const sheetData = this.extractSheet(worksheet, sheetIndex);
      sheets.push(sheetData);

      totalRows += sheetData.rows.length;
      totalCells += sheetData.stats.totalCells;
      filledCells += sheetData.stats.filledCells;
    });

    // Try to detect customer from filename or content
    const customer = this.detectCustomer(filename, sheets);

    return {
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer,
        documentType: 'excel' as const,
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
   * Extract a single sheet
   */
  private extractSheet(worksheet: ExcelJS.Worksheet, index: number): SheetData {
    const rows: RowData[] = [];
    let totalCells = 0;
    let filledCells = 0;
    let emptyRows = 0;
    let maxColumn = 0;

    // Extract merged cell ranges first
    const mergedRanges = this.extractMergedRanges(worksheet);
    const mergedCellMap = this.buildMergedCellMap(mergedRanges);

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: Record<string, CellData> = {};
      let hasContent = false;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colLetter = this.columnToLetter(colNumber);
        const cellRef = `${colLetter}${rowNumber}`;
        const mergeInfo = mergedCellMap.get(cellRef);
        const cellData = this.extractCell(cell, colLetter, rowNumber, mergeInfo);
        cells[colLetter] = cellData;

        totalCells++;
        if (cellData.filled) {
          filledCells++;
          hasContent = true;
        }

        if (colNumber > maxColumn) maxColumn = colNumber;
      });

      if (!hasContent) {
        emptyRows++;
      }

      const rowType = this.detectRowType(cells, rowNumber);

      rows.push({
        row: rowNumber,
        cells,
        isEmpty: !hasContent,
        rowType,
      });
    });

    // Detect headers (usually first non-empty row)
    const headers = this.detectHeaders(rows);

    // Detect topic from sheet name
    const topic = this.detectTopicFromName(worksheet.name);

    // Detect input cells based on formatting
    const inputCells = this.detectInputCells(rows);

    return {
      name: worksheet.name,
      index,
      rows,
      mergedRanges,
      headers,
      topic,
      rowCount: rows.length,
      columnCount: maxColumn,
      inputCells,
      stats: {
        totalCells,
        filledCells,
        emptyRows,
        mergedRanges: mergedRanges.length,
      },
    };
  }

  /**
   * Extract merged cell ranges from worksheet
   */
  private extractMergedRanges(worksheet: ExcelJS.Worksheet): MergedRange[] {
    const ranges: MergedRange[] = [];

    // ExcelJS stores merged cells as an object with range keys
    const merges = worksheet.model.merges || [];

    for (const merge of merges) {
      // Parse range like "A1:C3"
      const match = merge.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (match) {
        const [, startCol, startRowStr, endCol, endRowStr] = match;
        const startRow = parseInt(startRowStr, 10);
        const endRow = parseInt(endRowStr, 10);

        // Get value from top-left cell
        const cell = worksheet.getCell(`${startCol}${startRow}`);
        const value = this.getCellValue(cell);

        ranges.push({
          range: merge,
          start: `${startCol}${startRow}`,
          end: `${endCol}${endRow}`,
          startRow,
          endRow,
          startCol,
          endCol,
          value: value || undefined,
        });
      }
    }

    return ranges;
  }

  /**
   * Build a map of cell references to their merge info
   */
  private buildMergedCellMap(ranges: MergedRange[]): Map<string, { range: string; isOrigin: boolean }> {
    const map = new Map<string, { range: string; isOrigin: boolean }>();

    for (const range of ranges) {
      // Add all cells in the merged range
      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let col = this.letterToColumn(range.startCol); col <= this.letterToColumn(range.endCol); col++) {
          const cellRef = `${this.columnToLetter(col)}${row}`;
          const isOrigin = cellRef === range.start;
          map.set(cellRef, { range: range.range, isOrigin });
        }
      }
    }

    return map;
  }

  /**
   * Convert column letter to number
   */
  private letterToColumn(letter: string): number {
    let col = 0;
    for (let i = 0; i < letter.length; i++) {
      col = col * 26 + (letter.charCodeAt(i) - 64);
    }
    return col;
  }

  /**
   * Detect input cells based on formatting patterns
   */
  private detectInputCells(rows: RowData[]): string[] {
    const inputCells: string[] = [];

    for (const row of rows) {
      for (const [col, cell] of Object.entries(row.cells)) {
        if (cell.role === 'input' || cell.role === 'value') {
          inputCells.push(cell.ref);
        }
      }
    }

    return inputCells;
  }

  /**
   * Extract a single cell with formatting
   */
  private extractCell(
    cell: ExcelJS.Cell,
    colLetter: string,
    rowNumber: number,
    mergeInfo?: { range: string; isOrigin: boolean }
  ): CellData {
    const ref = `${colLetter}${rowNumber}`;
    const value = this.getCellValue(cell);
    const type = this.getCellType(cell);
    const filled = value.trim().length > 0;

    // Extract formatting
    const format = this.extractCellFormat(cell, mergeInfo);

    // Detect cell role based on formatting
    const role = this.detectCellRole(cell, format, value, rowNumber);

    return { ref, value, type, filled, format, role };
  }

  /**
   * Extract cell formatting information
   */
  private extractCellFormat(
    cell: ExcelJS.Cell,
    mergeInfo?: { range: string; isOrigin: boolean }
  ): CellFormat | undefined {
    const format: CellFormat = {};
    let hasFormat = false;

    // Background color
    const fill = cell.fill;
    if (fill && fill.type === 'pattern' && fill.fgColor) {
      const color = this.extractColor(fill.fgColor);
      if (color) {
        format.bgColor = color;
        hasFormat = true;
      }
    }

    // Font properties
    const font = cell.font;
    if (font) {
      if (font.bold) {
        format.bold = true;
        hasFormat = true;
      }
      if (font.italic) {
        format.italic = true;
        hasFormat = true;
      }
      if (font.size) {
        format.fontSize = font.size;
        hasFormat = true;
      }
      if (font.color) {
        const color = this.extractColor(font.color);
        if (color) {
          format.fontColor = color;
          hasFormat = true;
        }
      }
    }

    // Border
    const border = cell.border;
    if (border && (border.top || border.bottom || border.left || border.right)) {
      format.hasBorder = true;
      hasFormat = true;
      // Get most prominent border style
      const styles = [border.top?.style, border.bottom?.style, border.left?.style, border.right?.style]
        .filter(Boolean);
      if (styles.length > 0) {
        format.borderStyle = styles[0];
      }
    }

    // Merge info
    if (mergeInfo) {
      format.isMerged = true;
      format.mergeRange = mergeInfo.range;
      format.isMergeOrigin = mergeInfo.isOrigin;
      hasFormat = true;
    }

    return hasFormat ? format : undefined;
  }

  /**
   * Extract color from ExcelJS color object
   */
  private extractColor(color: Partial<ExcelJS.Color>): string | undefined {
    if (color.argb) {
      // ARGB format: first 2 chars are alpha, rest is RGB
      return `#${color.argb.substring(2)}`;
    }
    if (color.theme !== undefined) {
      // Theme colors - return placeholder
      return `theme:${color.theme}`;
    }
    return undefined;
  }

  /**
   * Detect cell role based on formatting
   */
  private detectCellRole(
    cell: ExcelJS.Cell,
    format: CellFormat | undefined,
    value: string,
    rowNumber: number
  ): CellRole {
    if (!value.trim()) return 'empty';

    // Headers: bold, larger font, merged, first few rows
    if (format?.bold || (format?.fontSize && format.fontSize > 11)) {
      if (rowNumber <= 5 || format?.isMerged) {
        return 'header';
      }
      return 'section';
    }

    // Large merged cells are usually section headers
    if (format?.isMerged && format?.isMergeOrigin) {
      return 'section';
    }

    // Input fields often have specific background colors
    // Common input colors: yellow (#FFFF00, #FFF2CC), light blue (#D6EAF8), white with border
    if (format?.bgColor) {
      const color = format.bgColor.toLowerCase();
      // Yellow tones often indicate input
      if (color.includes('ff') && color.includes('f2') ||
          color === '#ffff00' || color === '#fff2cc' || color === '#ffffcc' ||
          color === '#ffc000' || color === '#ffeb9c') {
        return 'input';
      }
      // Light blue can also be input
      if (color.includes('d6eaf8') || color.includes('bdd7ee') || color.includes('deebf7')) {
        return 'input';
      }
      // Gray backgrounds are usually labels/headers
      if (color.includes('d9') || color.includes('bfbf') || color.includes('e7e6')) {
        return 'label';
      }
    }

    // Cells with borders but light/no background might be input
    if (format?.hasBorder && !format?.bgColor) {
      return 'input';
    }

    // If filled and not styled, it's likely a value
    if (value.trim()) {
      return 'value';
    }

    return 'unknown';
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

    if (value instanceof Date) {
      try {
        return value.toISOString().split('T')[0];
      } catch {
        return '';
      }
    }

    if (typeof value === 'object') {
      // Rich text
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((rt: { text: string }) => rt.text).join('');
      }

      // Formula with result
      if ('result' in value) {
        const result = value.result;
        if (result === null || result === undefined) return '';
        if (typeof result === 'string') return result;
        if (typeof result === 'number') return result.toString();
        if (typeof result === 'boolean') return result ? 'Yes' : 'No';
        if (result instanceof Date) {
          try {
            return result.toISOString().split('T')[0];
          } catch {
            return '';
          }
        }
        return '';
      }

      // Hyperlink
      if ('hyperlink' in value) {
        return (value as { text?: string }).text || '';
      }

      // Text property
      if ('text' in value && typeof value.text === 'string') {
        return value.text;
      }

      return '';
    }

    return '';
  }

  /**
   * Get cell type
   */
  private getCellType(cell: ExcelJS.Cell): CellData['type'] {
    const value = cell.value;

    if (value === null || value === undefined) return 'empty';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date) return 'date';

    if (typeof value === 'object') {
      if ('richText' in value) return 'richtext';
      if ('formula' in value || 'result' in value) return 'formula';
    }

    return 'string';
  }

  /**
   * Detect row type
   */
  private detectRowType(cells: Record<string, CellData>, rowNumber: number): RowData['rowType'] {
    const values = Object.values(cells).filter(c => c.filled);

    if (values.length === 0) return 'empty';

    // Check if it looks like a header (bold, merged, or first few rows)
    if (rowNumber <= 3) return 'header';

    // Check if it looks like a section header (single cell with text)
    if (values.length === 1 && values[0].value.length > 10) {
      return 'section';
    }

    return 'data';
  }

  /**
   * Detect headers from first non-empty row
   */
  private detectHeaders(rows: RowData[]): Record<string, string> | undefined {
    for (const row of rows) {
      if (!row.isEmpty && row.rowType === 'header') {
        const headers: Record<string, string> = {};
        for (const [col, cell] of Object.entries(row.cells)) {
          if (cell.filled) {
            headers[col] = cell.value;
          }
        }
        if (Object.keys(headers).length > 0) {
          return headers;
        }
      }
    }
    return undefined;
  }

  /**
   * Detect topic from sheet name
   */
  private detectTopicFromName(name: string): string | undefined {
    const lower = name.toLowerCase();

    if (/company|general|info|supplier/i.test(lower)) return 'Company Information';
    if (/allerg/i.test(lower)) return 'Allergens';
    if (/certif/i.test(lower)) return 'Certifications';
    if (/haccp|food.*safety/i.test(lower)) return 'Food Safety';
    if (/sustain|rse|csr/i.test(lower)) return 'Sustainability';
    if (/nutri/i.test(lower)) return 'Nutritional';
    if (/pack/i.test(lower)) return 'Packaging';
    if (/export/i.test(lower)) return 'Export';

    return undefined;
  }

  /**
   * Detect customer from filename or content
   */
  private detectCustomer(filename: string, sheets: SheetData[]): string | undefined {
    // Try from filename
    const match = filename.match(/^([A-Za-z0-9+_-]+)/);
    if (match) {
      return match[1].replace(/_/g, ' ');
    }

    return undefined;
  }

  /**
   * Convert column number to letter (1 = A, 27 = AA)
   */
  private columnToLetter(col: number): string {
    let letter = '';
    while (col > 0) {
      const mod = (col - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      col = Math.floor((col - 1) / 26);
    }
    return letter;
  }

  /**
   * Get the document type this extractor handles
   */
  getDocumentType(): DocumentType {
    return 'excel';
  }
}

// =============================================================================
// STORAGE
// =============================================================================

export class StructureStorage {
  private storageDir: string;

  constructor(storageDir: string = './questionnaires') {
    this.storageDir = storageDir;
  }

  /**
   * Save questionnaire structure
   */
  async save(structure: QuestionnaireStructure): Promise<string> {
    await mkdir(this.storageDir, { recursive: true });

    const safeName = structure.source.filename
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '_');

    const filename = `${safeName}.json`;
    const filepath = join(this.storageDir, filename);

    await writeFile(filepath, JSON.stringify(structure, null, 2), 'utf-8');

    return filepath;
  }

  /**
   * Load questionnaire structure
   */
  async load(filename: string): Promise<QuestionnaireStructure | null> {
    try {
      const filepath = join(this.storageDir, filename);
      const content = await readFile(filepath, 'utf-8');
      return JSON.parse(content) as QuestionnaireStructure;
    } catch {
      return null;
    }
  }

  /**
   * List all stored questionnaires
   */
  async list(): Promise<string[]> {
    try {
      await mkdir(this.storageDir, { recursive: true });
      const files = await readdir(this.storageDir);
      return files.filter(f => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  /**
   * Search across all questionnaires
   */
  async search(query: string): Promise<Array<{
    file: string;
    matches: Array<{ sheet: string; row: number; cell: string; value: string }>;
  }>> {
    const files = await this.list();
    const results: Array<{
      file: string;
      matches: Array<{ sheet: string; row: number; cell: string; value: string }>;
    }> = [];

    const queryLower = query.toLowerCase();

    for (const file of files) {
      const structure = await this.load(file);
      if (!structure) continue;

      const matches: Array<{ sheet: string; row: number; cell: string; value: string }> = [];

      for (const sheet of structure.sheets) {
        for (const row of sheet.rows) {
          for (const [col, cell] of Object.entries(row.cells)) {
            if (cell.value.toLowerCase().includes(queryLower)) {
              matches.push({
                sheet: sheet.name,
                row: row.row,
                cell: cell.ref,
                value: cell.value,
              });
            }
          }
        }
      }

      if (matches.length > 0) {
        results.push({ file: structure.source.filename, matches });
      }
    }

    return results;
  }

  /**
   * Get summary of all questionnaires
   */
  async getSummary(): Promise<{
    total: number;
    questionnaires: Array<{
      filename: string;
      customer?: string;
      sheets: number;
      filledCells: number;
    }>;
  }> {
    const files = await this.list();
    const questionnaires: Array<{
      filename: string;
      customer?: string;
      sheets: number;
      filledCells: number;
    }> = [];

    for (const file of files) {
      const structure = await this.load(file);
      if (!structure) continue;

      questionnaires.push({
        filename: structure.source.filename,
        customer: structure.source.customer,
        sheets: structure.sheets.length,
        filledCells: structure.stats.filledCells,
      });
    }

    return { total: questionnaires.length, questionnaires };
  }
}

// =============================================================================
// MARKDOWN EXPORT
// =============================================================================

/**
 * Export structure to searchable Markdown (preserving table layout)
 */
export function structureToMarkdown(structure: QuestionnaireStructure): string {
  const lines: string[] = [];

  lines.push(`# ${structure.source.filename}`);
  lines.push('');
  lines.push(`**Customer:** ${structure.source.customer || 'Unknown'}`);
  lines.push(`**Extracted:** ${structure.source.extractedAt}`);
  lines.push(`**Sheets:** ${structure.stats.totalSheets}`);
  lines.push(`**Filled cells:** ${structure.stats.filledCells}/${structure.stats.totalCells}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Table of Contents
  lines.push('## Sheets');
  lines.push('');
  for (const sheet of structure.sheets) {
    const topic = sheet.topic ? ` (${sheet.topic})` : '';
    lines.push(`- [${sheet.name}](#${sheet.name.toLowerCase().replace(/[^a-z0-9]/g, '-')})${topic} - ${sheet.stats.filledCells} filled`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Each sheet
  for (const sheet of structure.sheets) {
    lines.push(`## ${sheet.name}`);
    lines.push('');

    if (sheet.topic) {
      lines.push(`**Topic:** ${sheet.topic}`);
      lines.push('');
    }

    // Find all columns used
    const allColumns = new Set<string>();
    for (const row of sheet.rows) {
      for (const col of Object.keys(row.cells)) {
        allColumns.add(col);
      }
    }
    const columns = [...allColumns].sort();

    if (columns.length === 0 || sheet.rows.length === 0) {
      lines.push('_Empty sheet_');
      lines.push('');
      continue;
    }

    // Build table
    lines.push(`| Row | ${columns.join(' | ')} |`);
    lines.push(`|-----|${columns.map(() => '---').join('|')}|`);

    for (const row of sheet.rows.slice(0, 100)) { // Limit to 100 rows
      if (row.isEmpty) continue;

      const values = columns.map(col => {
        const cell = row.cells[col];
        if (!cell || !cell.filled) return '';
        return cell.value.replace(/\|/g, '\\|').replace(/\n/g, ' ').substring(0, 40);
      });

      lines.push(`| ${row.row} | ${values.join(' | ')} |`);
    }

    if (sheet.rows.length > 100) {
      lines.push(`| ... | _${sheet.rows.length - 100} more rows_ |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
