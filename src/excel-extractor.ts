/**
 * Excel file extraction utilities using ExcelJS
 */

import ExcelJS from 'exceljs';
import type { WorkbookData, SheetData, CellData, CellStyle } from './types.js';

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
      value = (value as { result: unknown }).result;
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
}

export const extractor = new ExcelExtractor();
