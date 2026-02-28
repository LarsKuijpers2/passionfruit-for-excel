/**
 * HTML Structure Extraction
 *
 * Extracts questionnaire data from HTML exports (e.g., from online forms).
 * Converts HTML tables to the same structure as Excel questionnaires.
 */

import { readFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import type { DocumentExtractor, DocumentType } from './index.js';
import type { QuestionnaireStructure, SheetData, RowData, CellData, CellRole } from './excel.js';

/**
 * HTML Structure Extractor
 */
export class HtmlStructureExtractor implements DocumentExtractor {

  getDocumentType(): DocumentType {
    return 'html';
  }

  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const html = await readFile(filepath, 'utf-8');
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Find all tables in the document
    const tables = document.querySelectorAll('table');

    const sheets: SheetData[] = [];
    let tableIndex = 0;
    let totalFilledCells = 0;
    let totalCells = 0;

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) continue; // Skip empty or header-only tables

      // Try to detect if this is a Q&A table
      const headerRow = rows[0];
      const headerCells = headerRow.querySelectorAll('td, th');
      const headers = Array.from(headerCells).map(cell => cell.textContent?.trim() || '');

      // Look for Q.NO, Question, Answer/Comments patterns
      const qnoIndex = headers.findIndex(h => /q\.?no|number|#/i.test(h));
      const questionIndex = headers.findIndex(h => /question|description|item/i.test(h));
      const answerIndex = headers.findIndex(h => /answer|comment|response|value|optional/i.test(h));

      // If no clear structure, try to use first meaningful columns
      const effectiveQuestionIndex = questionIndex >= 0 ? questionIndex : (qnoIndex >= 0 ? qnoIndex + 1 : 0);
      const effectiveAnswerIndex = answerIndex >= 0 ? answerIndex : Math.max(effectiveQuestionIndex + 1, headers.length - 1);

      const sheetRows: RowData[] = [];
      let rowNum = 1;
      let sheetFilledCells = 0;
      let sheetTotalCells = 0;

      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        // Use Record<string, CellData> to match Excel format
        const rowCells: Record<string, CellData> = {};
        let colIndex = 0;
        let hasFilledCell = false;

        for (const cell of cells) {
          const value = cell.textContent?.trim() || '';
          const colLetter = String.fromCharCode(65 + colIndex); // A, B, C...
          const ref = `${colLetter}${rowNum}`;
          const filled = value.length > 0;

          // Detect cell role based on position
          let role: CellRole = 'unknown';
          if (rowNum === 1) {
            role = 'header';
          } else if (colIndex === effectiveQuestionIndex) {
            role = 'label';
          } else if (colIndex >= effectiveAnswerIndex) {
            role = filled ? 'value' : 'empty';
          }

          // Store cell in Record format with all required properties
          rowCells[colLetter] = {
            ref,
            value: value,
            type: 'string',
            filled,
            role,
          };

          sheetTotalCells++;
          if (filled) {
            sheetFilledCells++;
            hasFilledCell = true;
          }

          colIndex++;
        }

        // Determine row type
        let rowType: 'header' | 'data' | 'section' | 'empty' | 'unknown' = 'unknown';
        if (rowNum === 1) {
          rowType = 'header';
        } else if (hasFilledCell) {
          rowType = 'data';
        } else {
          rowType = 'empty';
        }

        if (hasFilledCell || rowNum === 1) {
          sheetRows.push({
            row: rowNum,
            cells: rowCells,
            isEmpty: !hasFilledCell,
            rowType,
          });
        }

        rowNum++;
      }

      if (sheetRows.length > 1) {
        tableIndex++;

        // Try to get section name from header or surrounding text
        let sectionName = `Section ${tableIndex}`;
        const prevSibling = table.previousElementSibling;
        if (prevSibling && ['H1', 'H2', 'H3', 'H4', 'P'].includes(prevSibling.tagName)) {
          const heading = prevSibling.textContent?.trim();
          if (heading && heading.length < 100) {
            sectionName = heading;
          }
        }

        sheets.push({
          name: sectionName,
          index: sheets.length,
          rows: sheetRows,
          mergedRanges: [],
          rowCount: sheetRows.length,
          columnCount: Math.max(...sheetRows.map(r => Object.keys(r.cells).length), 0),
          stats: {
            totalRows: sheetRows.length,
            totalCells: sheetTotalCells,
            filledCells: sheetFilledCells,
            emptyRows: 0,
            mergedRanges: 0,
          },
        });

        totalCells += sheetTotalCells;
        totalFilledCells += sheetFilledCells;
      }
    }

    // If no tables found with Q&A structure, create a single sheet from all text
    if (sheets.length === 0) {
      const textRows = this.extractTextAsRows(document);
      sheets.push({
        name: 'Document',
        index: 0,
        rows: textRows,
        mergedRanges: [],
        rowCount: textRows.length,
        columnCount: Math.max(...textRows.map(r => Object.keys(r.cells).length), 1),
        stats: {
          totalRows: textRows.length,
          totalCells: textRows.length,
          filledCells: textRows.length,
          emptyRows: 0,
          mergedRanges: 0,
        },
      });
      totalCells = textRows.length;
      totalFilledCells = textRows.length;
    }

    return {
      source: {
        filename: filepath.split('/').pop() || filepath,
        filepath,
        extractedAt: new Date().toISOString(),
        documentType: 'html',
      },
      sheets,
      stats: {
        totalSheets: sheets.length,
        totalRows: sheets.reduce((sum, s) => sum + (s.stats?.totalRows || 0), 0),
        totalCells,
        filledCells: totalFilledCells,
      },
    };
  }

  /**
   * Fallback: Extract all text content as rows
   */
  private extractTextAsRows(document: Document): RowData[] {
    const rows: RowData[] = [];
    const paragraphs = document.querySelectorAll('p, div, li');
    let rowNum = 1;

    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 5) {
        rows.push({
          row: rowNum,
          cells: {
            'A': {
              ref: `A${rowNum}`,
              value: text,
              type: 'string',
              filled: true,
              role: 'value',
            }
          },
          isEmpty: false,
          rowType: 'data',
        });
        rowNum++;
      }
    }

    return rows;
  }
}
