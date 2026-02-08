/**
 * Screenshot Generator for Questionnaire Review
 *
 * Generates visual screenshots of Excel sheets for human review.
 * Uses puppeteer to render HTML tables as images.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import type { QuestionnaireStructure, SheetData, RowData, CellData } from './excel-structure.js';

// =============================================================================
// TYPES
// =============================================================================

export interface SectionOverlay {
  id: string;
  title: string;
  startRow: number;
  endRow: number;
  startCol: string;
  endCol: string;
  topic?: string;
  color: string;
}

export interface SheetScreenshot {
  sheetName: string;
  htmlPath: string;
  sections: SectionOverlay[];
}

// =============================================================================
// HTML GENERATOR
// =============================================================================

export class ScreenshotGenerator {
  private outputDir: string;

  constructor(outputDir: string = './review') {
    this.outputDir = outputDir;
  }

  /**
   * Generate HTML preview for a questionnaire
   */
  async generatePreview(structure: QuestionnaireStructure): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });

    // Generate index filename first so we can link back to it
    const safeName = structure.source.filename.replace(/[^a-zA-Z0-9]/g, '_');
    const indexFilename = `${safeName}_index.html`;

    const sheets: SheetScreenshot[] = [];

    for (const sheet of structure.sheets) {
      const htmlPath = await this.generateSheetHtml(sheet, structure.source.filename, indexFilename);
      sheets.push({
        sheetName: sheet.name,
        htmlPath,
        sections: [],
      });
    }

    // Generate index HTML
    const indexPath = await this.generateIndexHtml(structure, sheets);

    return indexPath;
  }

  /**
   * Generate HTML for a single sheet
   */
  private async generateSheetHtml(sheet: SheetData, filename: string, indexFilename: string): Promise<string> {
    const safeName = `${filename.replace(/[^a-zA-Z0-9]/g, '_')}_${sheet.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const htmlPath = join(this.outputDir, `${safeName}.html`);

    // Build HTML table
    const html = this.buildSheetHtml(sheet, filename, indexFilename);
    await writeFile(htmlPath, html, 'utf-8');

    return htmlPath;
  }

  /**
   * Build HTML representation of a sheet
   */
  private buildSheetHtml(sheet: SheetData, filename: string, indexFilename: string): string {
    // Find column range
    const allCols = new Set<string>();
    let maxRow = 0;

    for (const row of sheet.rows) {
      maxRow = Math.max(maxRow, row.row);
      for (const col of Object.keys(row.cells)) {
        allCols.add(col);
      }
    }

    const cols = Array.from(allCols).sort((a, b) => this.colToNum(a) - this.colToNum(b));

    // Limit to first 20 columns for readability
    const displayCols = cols.slice(0, 20);

    // Build rows map for quick lookup
    const rowsMap = new Map<number, RowData>();
    for (const row of sheet.rows) {
      rowsMap.set(row.row, row);
    }

    // Limit to first 150 rows
    const maxDisplayRow = Math.min(maxRow, 150);

    let tableRows = '';
    for (let r = 1; r <= maxDisplayRow; r++) {
      const row = rowsMap.get(r);
      let cells = `<td class="row-num">${r}</td>`;

      for (const col of displayCols) {
        const cell = row?.cells[col];
        if (cell) {
          const classes = this.getCellClasses(cell);
          const style = this.getCellStyle(cell);
          const value = this.escapeHtml(cell.value.substring(0, 100));
          cells += `<td class="${classes}" style="${style}" data-cell="${cell.ref}" title="${cell.ref}: ${this.escapeHtml(cell.value)}">${value}</td>`;
        } else {
          cells += `<td class="empty"></td>`;
        }
      }

      tableRows += `<tr data-row="${r}">${cells}</tr>\n`;
    }

    // Build header row
    let headerCells = '<th>#</th>';
    for (const col of displayCols) {
      headerCells += `<th>${col}</th>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${sheet.name} - ${filename}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 10px 0;
      color: #333;
    }
    .meta {
      font-size: 12px;
      color: #666;
      margin-bottom: 20px;
    }
    .table-container {
      overflow-x: auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    table {
      border-collapse: collapse;
      font-size: 11px;
      min-width: 100%;
    }
    th, td {
      border: 1px solid #e0e0e0;
      padding: 4px 6px;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      background: #f8f9fa;
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .row-num {
      background: #f8f9fa;
      color: #666;
      font-size: 10px;
      text-align: center;
      width: 30px;
      position: sticky;
      left: 0;
      z-index: 5;
    }
    .empty { background: #fafafa; }

    /* Cell roles */
    .role-header { background: #e3f2fd !important; font-weight: bold; }
    .role-section { background: #bbdefb !important; font-weight: bold; font-size: 12px; }
    .role-label { background: #f5f5f5 !important; }
    .role-input { background: #fff9c4 !important; }
    .role-value { background: #fff !important; }

    /* Formatting */
    .bold { font-weight: bold; }
    .merged { border: 2px solid #1976d2; }

    /* Hover */
    td:hover:not(.row-num):not(.empty) {
      outline: 2px solid #1976d2;
      cursor: pointer;
    }

    /* Section overlay */
    .section-marker {
      position: absolute;
      border: 3px solid;
      pointer-events: none;
      opacity: 0.5;
    }

    /* Legend */
    .legend {
      display: flex;
      gap: 15px;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
    }
    .legend-box {
      width: 16px;
      height: 16px;
      border: 1px solid #ccc;
    }

    /* Navigation */
    .nav {
      margin-bottom: 20px;
    }
    .nav a {
      color: #1976d2;
      text-decoration: none;
      margin-right: 15px;
    }
    .nav a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="nav">
    <a href="${indexFilename}">← Back to Index</a>
  </div>

  <h1>${this.escapeHtml(sheet.name)}</h1>
  <div class="meta">
    File: ${this.escapeHtml(filename)} |
    Rows: ${sheet.rows.length} |
    Topic: ${sheet.topic || 'Unknown'}
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-box" style="background: #bbdefb"></div> Section Header</div>
    <div class="legend-item"><div class="legend-box" style="background: #e3f2fd"></div> Header</div>
    <div class="legend-item"><div class="legend-box" style="background: #f5f5f5"></div> Label</div>
    <div class="legend-item"><div class="legend-box" style="background: #fff9c4"></div> Input Field</div>
    <div class="legend-item"><div class="legend-box" style="background: #fff"></div> Value</div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <script>
    // Click handler to show cell details
    document.querySelectorAll('td[data-cell]').forEach(td => {
      td.addEventListener('click', () => {
        const cell = td.dataset.cell;
        const value = td.title;
        console.log('Cell:', cell, value);
        alert(value);
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Generate index HTML with all sheets
   */
  private async generateIndexHtml(structure: QuestionnaireStructure, sheets: SheetScreenshot[]): Promise<string> {
    const safeName = structure.source.filename.replace(/[^a-zA-Z0-9]/g, '_');
    const indexPath = join(this.outputDir, `${safeName}_index.html`);

    const sheetLinks = sheets.map(s => {
      const href = s.htmlPath.split('/').pop();
      return `<li><a href="${href}">${this.escapeHtml(s.sheetName)}</a></li>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Review: ${structure.source.filename}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 40px;
      background: #f5f5f5;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      font-size: 24px;
      margin: 0 0 10px 0;
    }
    .meta {
      color: #666;
      margin-bottom: 30px;
    }
    h2 {
      font-size: 16px;
      margin: 20px 0 10px 0;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      margin: 8px 0;
    }
    a {
      color: #1976d2;
      text-decoration: none;
      font-size: 14px;
    }
    a:hover {
      text-decoration: underline;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      text-align: center;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #1976d2;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${this.escapeHtml(structure.source.filename)}</h1>
    <div class="meta">
      Extracted: ${structure.source.extractedAt}
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${structure.stats.totalSheets}</div>
        <div class="stat-label">Sheets</div>
      </div>
      <div class="stat">
        <div class="stat-value">${structure.stats.filledCells}</div>
        <div class="stat-label">Filled Cells</div>
      </div>
      <div class="stat">
        <div class="stat-value">${structure.stats.totalRows}</div>
        <div class="stat-label">Total Rows</div>
      </div>
    </div>

    <h2>Sheets</h2>
    <ul>
      ${sheetLinks}
    </ul>
  </div>
</body>
</html>`;

    await writeFile(indexPath, html, 'utf-8');
    return indexPath;
  }

  /**
   * Get CSS classes for a cell based on its role
   */
  private getCellClasses(cell: CellData): string {
    const classes: string[] = [];

    if (cell.role) {
      classes.push(`role-${cell.role}`);
    }

    if (cell.format?.bold) {
      classes.push('bold');
    }

    if (cell.format?.isMerged) {
      classes.push('merged');
    }

    return classes.join(' ');
  }

  /**
   * Get inline styles for a cell
   */
  private getCellStyle(cell: CellData): string {
    const styles: string[] = [];

    if (cell.format?.bgColor && !cell.role) {
      styles.push(`background-color: ${cell.format.bgColor}`);
    }

    if (cell.format?.fontColor) {
      styles.push(`color: ${cell.format.fontColor}`);
    }

    return styles.join('; ');
  }

  /**
   * Convert column letter to number
   */
  private colToNum(col: string): number {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
      num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
