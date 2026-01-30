/**
 * Excel file extraction utilities using ExcelJS
 */

import ExcelJS from 'exceljs';
import type {
  WorkbookData,
  SheetData,
  CellData,
  CellStyle,
  EnhancedWorkbookData,
  EnhancedSheetData,
  EnhancedCellData,
  DataValidation,
  BorderInfo,
  MergeInfo,
} from './types.js';

export class ExcelExtractor {
  /**
   * Extract all data from an Excel file
   */
  async extract(filePath: string): Promise<WorkbookData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets: SheetData[] = [];

    workbook.eachSheet((worksheet) => {
      const sheetData = this.extractSheet(worksheet);
      sheets.push(sheetData);
    });

    return {
      filename: filePath.split('/').pop() || filePath,
      sheets,
      activeSheet: sheets[0]?.name || '',
    };
  }

  /**
   * Extract data from a single worksheet
   */
  private extractSheet(worksheet: ExcelJS.Worksheet): SheetData {
    const cells = new Map<string, CellData>();
    const mergedCells: string[] = [];

    // Get merged cells
    // @ts-expect-error - ExcelJS types don't expose _merges properly
    const merges = worksheet._merges || {};
    Object.keys(merges).forEach((key) => {
      mergedCells.push(key);
    });

    // Track dimensions
    let startRow = Infinity, endRow = 0, startCol = Infinity, endCol = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      startRow = Math.min(startRow, rowNumber);
      endRow = Math.max(endRow, rowNumber);

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        startCol = Math.min(startCol, colNumber);
        endCol = Math.max(endCol, colNumber);

        const address = cell.address;
        const cellData = this.extractCell(cell);
        cells.set(address, cellData);
      });
    });

    return {
      name: worksheet.name,
      cells,
      dimensions: {
        startRow: startRow === Infinity ? 1 : startRow,
        endRow: endRow || 1,
        startCol: startCol === Infinity ? 1 : startCol,
        endCol: endCol || 1,
      },
      mergedCells,
    };
  }

  /**
   * Extract data from a single cell
   */
  private extractCell(cell: ExcelJS.Cell): CellData {
    const address = cell.address;
    let value = cell.value;
    let type: CellData['type'] = 'empty';
    let formula: string | undefined;

    // Handle formula cells
    if (cell.formula) {
      formula = cell.formula;
      type = 'formula';
      // Get the calculated value
      if (cell.result !== undefined) {
        value = cell.result;
      }
    } else if (value === null || value === undefined) {
      type = 'empty';
      value = null;
    } else if (typeof value === 'string') {
      type = 'string';
    } else if (typeof value === 'number') {
      type = 'number';
    } else if (typeof value === 'boolean') {
      type = 'boolean';
    } else if (value instanceof Date) {
      type = 'date';
    } else if (typeof value === 'object' && 'richText' in value) {
      // Handle rich text
      type = 'string';
      value = value.richText.map((rt: { text: string }) => rt.text).join('');
    } else if (typeof value === 'object' && 'result' in value) {
      // Handle formula result object
      type = 'formula';
      formula = (value as { formula?: string }).formula;
      value = (value as { result: CellData['value'] }).result;
    }

    // Extract style
    const style = this.extractStyle(cell);

    return {
      address,
      value: value as CellData['value'],
      formula,
      type,
      style,
    };
  }

  /**
   * Extract cell style information
   */
  private extractStyle(cell: ExcelJS.Cell): CellStyle | undefined {
    const style: CellStyle = {};
    let hasStyle = false;

    // Fill color
    if (cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor) {
      const color = cell.fill.fgColor;
      if ('argb' in color && color.argb) {
        style.fill = `#${color.argb.substring(2)}`;
        hasStyle = true;
      }
    }

    // Font
    if (cell.font) {
      style.font = {};
      if (cell.font.bold) {
        style.font.bold = true;
        hasStyle = true;
      }
      if (cell.font.italic) {
        style.font.italic = true;
        hasStyle = true;
      }
      if (cell.font.color?.argb) {
        style.font.color = `#${cell.font.color.argb.substring(2)}`;
        hasStyle = true;
      }
      if (cell.font.size) {
        style.font.size = cell.font.size;
        hasStyle = true;
      }
    }

    // Border
    if (cell.border && Object.keys(cell.border).length > 0) {
      style.border = true;
      hasStyle = true;
    }

    // Alignment
    if (cell.alignment?.horizontal) {
      style.alignment = cell.alignment.horizontal as CellStyle['alignment'];
      hasStyle = true;
    }

    return hasStyle ? style : undefined;
  }

  /**
   * Convert workbook data to a text representation for Claude
   */
  toTextRepresentation(workbook: WorkbookData): string {
    const lines: string[] = [];

    lines.push(`# Excel Workbook: ${workbook.filename}`);
    lines.push(`Total sheets: ${workbook.sheets.length}`);
    lines.push('');

    for (const sheet of workbook.sheets) {
      lines.push(`## Sheet: ${sheet.name}`);
      lines.push(`Dimensions: Row ${sheet.dimensions.startRow}-${sheet.dimensions.endRow}, Col ${sheet.dimensions.startCol}-${sheet.dimensions.endCol}`);

      if (sheet.mergedCells.length > 0) {
        lines.push(`Merged cells: ${sheet.mergedCells.join(', ')}`);
      }

      lines.push('');
      lines.push('### Cell Contents:');
      lines.push('');

      // Group cells by row for readable output
      const cellsByRow = new Map<number, CellData[]>();

      for (const [, cell] of sheet.cells) {
        const rowMatch = cell.address.match(/\d+/);
        if (rowMatch) {
          const row = parseInt(rowMatch[0], 10);
          if (!cellsByRow.has(row)) {
            cellsByRow.set(row, []);
          }
          cellsByRow.get(row)!.push(cell);
        }
      }

      // Sort rows and output
      const sortedRows = Array.from(cellsByRow.keys()).sort((a, b) => a - b);

      for (const rowNum of sortedRows) {
        const cells = cellsByRow.get(rowNum)!;
        cells.sort((a, b) => a.address.localeCompare(b.address));

        for (const cell of cells) {
          let cellInfo = `${cell.address}: `;

          if (cell.formula) {
            cellInfo += `=${cell.formula} → ${this.formatValue(cell.value)}`;
          } else {
            cellInfo += this.formatValue(cell.value);
          }

          // Add style hints for input cells (often highlighted)
          if (cell.style?.fill && cell.style.fill !== '#FFFFFF') {
            cellInfo += ` [fill: ${cell.style.fill}]`;
          }

          lines.push(cellInfo);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Convert workbook to JSON for Claude (more structured)
   */
  toJSON(workbook: WorkbookData): object {
    return {
      filename: workbook.filename,
      sheets: workbook.sheets.map(sheet => ({
        name: sheet.name,
        dimensions: sheet.dimensions,
        mergedCells: sheet.mergedCells,
        cells: Object.fromEntries(
          Array.from(sheet.cells.entries()).map(([addr, cell]) => [
            addr,
            {
              value: cell.value,
              formula: cell.formula,
              type: cell.type,
              isInputCell: cell.style?.fill && cell.style.fill !== '#FFFFFF',
            },
          ])
        ),
      })),
    };
  }

  /**
   * Format a cell value for display
   */
  private formatValue(value: CellData['value']): string {
    if (value === null || value === undefined) {
      return '(empty)';
    }
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    if (typeof value === 'string' && value.includes('\n')) {
      return `"${value.replace(/\n/g, '\\n')}"`;
    }
    return String(value);
  }

  // ============================================
  // Enhanced Extraction Methods
  // ============================================

  /**
   * Extract all data from an Excel file with enhanced cell information
   */
  async extractEnhanced(filePath: string): Promise<EnhancedWorkbookData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets: EnhancedSheetData[] = [];

    workbook.eachSheet((worksheet) => {
      const sheetData = this.extractEnhancedSheet(worksheet);
      sheets.push(sheetData);
    });

    return {
      filename: filePath.split('/').pop() || filePath,
      sheets,
      activeSheet: sheets[0]?.name || '',
    };
  }

  /**
   * Extract enhanced data from a single worksheet
   */
  private extractEnhancedSheet(worksheet: ExcelJS.Worksheet): EnhancedSheetData {
    const cells = new Map<string, EnhancedCellData>();
    const mergedCells: string[] = [];
    const namedRanges = new Map<string, string>();

    // Get merged cells and build a lookup
    // @ts-expect-error - ExcelJS types don't expose _merges properly
    const merges = worksheet._merges || {};

    // Build merge lookup from Range objects
    const mergeLookup = this.buildMergeLookupFromRanges(merges);

    // Collect merged cell ranges as strings
    for (const [, info] of mergeLookup.entries()) {
      if (info.isMaster && !mergedCells.includes(info.range)) {
        mergedCells.push(info.range);
      }
    }

    // Check if worksheet is protected
    // @ts-expect-error - ExcelJS types may not expose protection properly
    const isProtected = worksheet.protection?.sheet || false;

    // Track dimensions
    let startRow = Infinity, endRow = 0, startCol = Infinity, endCol = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      startRow = Math.min(startRow, rowNumber);
      endRow = Math.max(endRow, rowNumber);

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        startCol = Math.min(startCol, colNumber);
        endCol = Math.max(endCol, colNumber);

        const address = cell.address;
        const mergeInfo = mergeLookup.get(address);
        const cellData = this.extractEnhancedCell(cell, isProtected, mergeInfo);
        cells.set(address, cellData);
      });
    });

    // Also extract empty cells that are part of merged ranges (they may be input cells)
    for (const mergeRange of mergedCells) {
      const masterAddress = this.getMasterCellFromRange(mergeRange);
      if (!cells.has(masterAddress)) {
        const cell = worksheet.getCell(masterAddress);
        const mergeInfo = mergeLookup.get(masterAddress);
        const cellData = this.extractEnhancedCell(cell, isProtected, mergeInfo);
        cells.set(masterAddress, cellData);
      }
    }

    // Get named ranges from workbook that reference this sheet
    const wb = worksheet.workbook as ExcelJS.Workbook & { definedNames?: { matrixMap?: Record<string, unknown> } };
    if (wb.definedNames) {
      for (const [name, range] of Object.entries(wb.definedNames.matrixMap || {})) {
        if (typeof range === 'string' && range.includes(worksheet.name)) {
          namedRanges.set(name, range);
        }
      }
    }

    return {
      name: worksheet.name,
      cells,
      dimensions: {
        startRow: startRow === Infinity ? 1 : startRow,
        endRow: endRow || 1,
        startCol: startCol === Infinity ? 1 : startCol,
        endCol: endCol || 1,
      },
      mergedCells,
      isProtected,
      namedRanges,
    };
  }

  /**
   * Extract enhanced data from a single cell
   */
  private extractEnhancedCell(
    cell: ExcelJS.Cell,
    sheetProtected: boolean,
    mergeInfo?: MergeInfo
  ): EnhancedCellData {
    // Get base cell data
    const baseData = this.extractCell(cell);

    // Extract data validation
    const dataValidation = this.extractDataValidation(cell);

    // Extract protection info
    const cellProtection = cell.protection as { locked?: boolean; hidden?: boolean } | undefined;
    const protection = {
      locked: cellProtection?.locked !== false, // Default is locked
      hidden: cellProtection?.hidden || false,
    };

    // Extract comment
    const note = cell.note as string | { texts?: Array<{ text: string }> } | undefined;
    const comment = typeof note === 'string' ? note : note?.texts?.map((t: { text: string }) => t.text).join('') || undefined;

    // Extract detailed border info
    const borders = this.extractBorderInfo(cell);

    // Compute detection hints
    const isLikelyLabel = this.computeIsLikelyLabel(baseData, borders);
    const isLikelyInput = this.computeIsLikelyInput(baseData, dataValidation, borders, protection, sheetProtected, mergeInfo);
    const inputScore = this.computeInputScore(baseData, dataValidation, borders, protection, sheetProtected);

    return {
      ...baseData,
      dataValidation,
      protection,
      comment,
      borders,
      mergeInfo,
      isLikelyLabel,
      isLikelyInput,
      inputScore,
    };
  }

  /**
   * Extract data validation information
   */
  private extractDataValidation(cell: ExcelJS.Cell): DataValidation | undefined {
    const dv = cell.dataValidation as {
      type?: string;
      formulae?: string[];
      allowBlank?: boolean;
    } | undefined;
    if (!dv) return undefined;

    let type: DataValidation['type'] = 'none';
    let options: string[] | undefined;

    switch (dv.type) {
      case 'list':
        type = 'list';
        // Extract dropdown options from formulae
        if (dv.formulae && dv.formulae.length > 0) {
          const formula = dv.formulae[0];
          if (typeof formula === 'string') {
            // Handle comma-separated list like "Yes,No,N/A"
            if (formula.startsWith('"') || !formula.includes('!')) {
              options = formula.replace(/^"|"$/g, '').split(',');
            }
          }
        }
        break;
      case 'whole':
        type = 'whole';
        break;
      case 'decimal':
        type = 'decimal';
        break;
      case 'date':
        type = 'date';
        break;
      case 'textLength':
        type = 'textLength';
        break;
      case 'custom':
        type = 'custom';
        break;
      // 'time' and other types default to 'none'
    }

    return {
      type,
      options,
      allowBlank: dv.allowBlank !== false,
      formula1: dv.formulae?.[0],
      formula2: dv.formulae?.[1],
    };
  }

  /**
   * Extract detailed border information
   */
  private extractBorderInfo(cell: ExcelJS.Cell): BorderInfo {
    const border = cell.border || {};

    const hasTop = !!border.top?.style;
    const hasBottom = !!border.bottom?.style;
    const hasLeft = !!border.left?.style;
    const hasRight = !!border.right?.style;

    return {
      top: hasTop,
      bottom: hasBottom,
      left: hasLeft,
      right: hasRight,
      all: hasTop && hasBottom && hasLeft && hasRight,
    };
  }

  /**
   * Build a lookup map from ExcelJS Range objects
   */
  private buildMergeLookupFromRanges(merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }>): Map<string, MergeInfo> {
    const lookup = new Map<string, MergeInfo>();

    for (const [masterAddr, rangeObj] of Object.entries(merges)) {
      const model = rangeObj?.model;
      if (!model) continue;

      const startRow = model.top;
      const endRow = model.bottom;
      const startCol = model.left;
      const endCol = model.right;

      const rowSpan = endRow - startRow + 1;
      const colSpan = endCol - startCol + 1;

      // Build range string
      const startAddr = this.toAddress(startRow, startCol);
      const endAddr = this.toAddress(endRow, endCol);
      const range = startAddr === endAddr ? startAddr : `${startAddr}:${endAddr}`;

      // Add info for master cell
      lookup.set(startAddr, {
        isMerged: true,
        isMaster: true,
        masterCell: startAddr,
        range,
        rowSpan,
        colSpan,
      });

      // Add info for all other cells in the range
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const addr = this.toAddress(r, c);
          if (addr !== startAddr) {
            lookup.set(addr, {
              isMerged: true,
              isMaster: false,
              masterCell: startAddr,
              range,
              rowSpan,
              colSpan,
            });
          }
        }
      }
    }

    return lookup;
  }

  /**
   * Parse cell address to row/col numbers
   */
  private parseAddress(address: string): { row: number; col: number } {
    const match = address.match(/^([A-Z]+)(\d+)$/);
    if (!match) return { row: 1, col: 1 };

    const colStr = match[1];
    const row = parseInt(match[2], 10);

    let col = 0;
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }

    return { row, col };
  }

  /**
   * Convert row/col to address
   */
  private toAddress(row: number, col: number): string {
    let colStr = '';
    let c = col;
    while (c > 0) {
      c--;
      colStr = String.fromCharCode(65 + (c % 26)) + colStr;
      c = Math.floor(c / 26);
    }
    return `${colStr}${row}`;
  }

  /**
   * Get master cell address from a merge range
   */
  private getMasterCellFromRange(range: string): string {
    return range.split(':')[0];
  }

  /**
   * Determine if a cell is likely a label (question)
   */
  private computeIsLikelyLabel(
    cell: CellData,
    borders: BorderInfo
  ): boolean {
    if (cell.type !== 'string' || !cell.value) return false;

    const text = String(cell.value).trim();

    // Check for label patterns
    const endsWithColon = text.endsWith(':');
    const endsWithQuestion = text.endsWith('?');
    const isBold = cell.style?.font?.bold === true;
    const hasNoFill = !cell.style?.fill || cell.style.fill === '#FFFFFF';
    const hasNoBorder = !borders.all;

    // Strong indicators
    if (endsWithColon || endsWithQuestion) return true;
    if (isBold && hasNoFill) return true;

    // Weaker indicators - text without fill that's short
    if (hasNoFill && hasNoBorder && text.length < 100) {
      // Check for common label words
      const lowerText = text.toLowerCase();
      const labelWords = ['name', 'address', 'date', 'phone', 'email', 'contact', 'number', 'company', 'country', 'town', 'zip', 'code'];
      if (labelWords.some(word => lowerText.includes(word))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine if a cell is likely an input (answer) cell
   */
  private computeIsLikelyInput(
    cell: CellData,
    dataValidation: DataValidation | undefined,
    borders: BorderInfo,
    protection: { locked: boolean; hidden: boolean },
    sheetProtected: boolean,
    mergeInfo?: MergeInfo
  ): boolean {
    // Strong indicators
    if (dataValidation && dataValidation.type !== 'none') return true;
    if (sheetProtected && !protection.locked) return true;

    // Fill color (non-white) is a common indicator
    if (cell.style?.fill && cell.style.fill !== '#FFFFFF') return true;

    // All-around border often indicates input field
    if (borders.all) return true;

    // Large merged area with border might be signature/comment area
    if (mergeInfo?.isMaster && mergeInfo.rowSpan >= 2 && borders.all) return true;

    return false;
  }

  /**
   * Compute a 0-1 score for how likely a cell is an input cell
   */
  private computeInputScore(
    cell: CellData,
    dataValidation: DataValidation | undefined,
    borders: BorderInfo,
    protection: { locked: boolean; hidden: boolean },
    sheetProtected: boolean
  ): number {
    let score = 0;

    // Data validation present (+0.30)
    if (dataValidation && dataValidation.type !== 'none') {
      score += 0.30;
    }

    // Fill color (+0.20)
    if (cell.style?.fill && cell.style.fill !== '#FFFFFF') {
      score += 0.20;
    }

    // All-around border (+0.15)
    if (borders.all) {
      score += 0.15;
    }

    // Unlocked in protected sheet (+0.25)
    if (sheetProtected && !protection.locked) {
      score += 0.25;
    }

    // Empty cell (+0.10) - likely waiting for input
    if (cell.type === 'empty' || cell.value === null || cell.value === '') {
      score += 0.10;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Convert enhanced workbook to text representation
   */
  toEnhancedTextRepresentation(workbook: EnhancedWorkbookData): string {
    const lines: string[] = [];

    lines.push(`# Excel Workbook: ${workbook.filename}`);
    lines.push(`Total sheets: ${workbook.sheets.length}`);
    lines.push('');

    for (const sheet of workbook.sheets) {
      lines.push(`## Sheet: ${sheet.name}`);
      lines.push(`Dimensions: Row ${sheet.dimensions.startRow}-${sheet.dimensions.endRow}, Col ${sheet.dimensions.startCol}-${sheet.dimensions.endCol}`);
      lines.push(`Protected: ${sheet.isProtected ? 'Yes' : 'No'}`);

      if (sheet.mergedCells.length > 0) {
        lines.push(`Merged cells: ${sheet.mergedCells.join(', ')}`);
      }

      if (sheet.namedRanges.size > 0) {
        lines.push(`Named ranges: ${Array.from(sheet.namedRanges.entries()).map(([n, r]) => `${n}=${r}`).join(', ')}`);
      }

      lines.push('');
      lines.push('### Cell Contents:');
      lines.push('');

      // Group cells by row
      const cellsByRow = new Map<number, EnhancedCellData[]>();

      for (const [, cell] of sheet.cells) {
        const rowMatch = cell.address.match(/\d+/);
        if (rowMatch) {
          const row = parseInt(rowMatch[0], 10);
          if (!cellsByRow.has(row)) {
            cellsByRow.set(row, []);
          }
          cellsByRow.get(row)!.push(cell);
        }
      }

      const sortedRows = Array.from(cellsByRow.keys()).sort((a, b) => a - b);

      for (const rowNum of sortedRows) {
        const cells = cellsByRow.get(rowNum)!;
        cells.sort((a, b) => a.address.localeCompare(b.address));

        for (const cell of cells) {
          let cellInfo = `${cell.address}: `;

          if (cell.formula) {
            cellInfo += `=${cell.formula} → ${this.formatValue(cell.value)}`;
          } else {
            cellInfo += this.formatValue(cell.value);
          }

          // Add indicators
          const indicators: string[] = [];

          if (cell.isLikelyLabel) {
            indicators.push('LABEL');
          }
          if (cell.isLikelyInput) {
            indicators.push(`INPUT(${Math.round(cell.inputScore * 100)}%)`);
          }
          if (cell.dataValidation?.type === 'list') {
            indicators.push(`dropdown:[${cell.dataValidation.options?.join('|') || '...'}]`);
          } else if (cell.dataValidation && cell.dataValidation.type !== 'none') {
            indicators.push(`validation:${cell.dataValidation.type}`);
          }
          if (cell.style?.fill && cell.style.fill !== '#FFFFFF') {
            indicators.push(`fill:${cell.style.fill}`);
          }
          if (cell.borders.all) {
            indicators.push('bordered');
          }
          if (cell.mergeInfo?.isMaster) {
            indicators.push(`merged:${cell.mergeInfo.range}`);
          }

          if (indicators.length > 0) {
            cellInfo += ` [${indicators.join(', ')}]`;
          }

          lines.push(cellInfo);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}

export const extractor = new ExcelExtractor();
