/**
 * PDF Document Structure Extraction
 *
 * Extracts questionnaire structure from PDF files.
 * Uses Azure Document Intelligence for high-quality table extraction,
 * with fallback to pdf-parse for basic text extraction.
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  QuestionnaireStructure,
  SheetData,
  RowData,
  CellData,
  CellRole,
  DocumentType,
} from './excel.js';
import { extractPdfWithAzure, isAzureConfigured, type DocumentAnalysisResult, type TableCell } from './azure.js';
import { classifyDocument, type DocumentClassification } from '../analysis/document-classifier.js';
import { extractTextQA, type TextQAResult } from './text-qa.js';
import { VisualQAExtractor, type TextElementWithPosition, type PageInfo } from './visual-qa-extractor.js';

const execAsync = promisify(exec);

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
   *
   * Uses intelligent document classification to choose the best extraction method:
   * - 'table': Azure Document Intelligence for checkbox/table-based questionnaires
   * - 'text': Text-based Q&A extraction for flowing text documents
   * - 'both': Combines both methods for mixed documents
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const filename = basename(filepath);

    // First, classify the document to understand what extraction method to use
    console.log('  Classifying document...');
    const classification = await this.classifyPdf(filepath, filename);

    if (classification) {
      console.log(`  Document type: ${classification.documentType}`);
      console.log(`  Recommended method: ${classification.recommendedMethod}`);

      // For complete page coverage, prefer 'both' method when available
      console.log('  Azure configured?', isAzureConfigured());
      if (classification.recommendedMethod === 'text') {
        console.log('  Upgrading from text to both method for better coverage');
        classification.recommendedMethod = 'both';
      }

      if (isAzureConfigured()) {
        if (classification.recommendedMethod === 'both') {
          console.log('  Using combined table + text extraction...');
          return this.extractWithBothMethods(filepath, filename, classification);
        } else if (classification.recommendedMethod === 'skip') {
          console.log('  Document marked for skip, using Azure extraction...');
        }
        // Use Azure extraction for table-based content
        console.log('  Using Azure Document Intelligence for PDF extraction...');
        return this.extractWithAzure(filepath, filename);
      }
    }

    // For non-Azure environments, use basic extraction fallback
    console.log('  Using basic PDF extraction (Azure DI not configured)...');
    return this.extractWithPdfParse(filepath, filename);
  }

  /**
   * Classify PDF to determine best extraction method
   */
  private async classifyPdf(filepath: string, filename: string): Promise<DocumentClassification | null> {
    try {
      // Extract text from PDF for classification
      const { stdout } = await execAsync(`pdftotext -layout "${filepath}" -`);

      if (stdout.length < 100) {
        console.log('  Warning: PDF has very little text content');
        return null;
      }

      return await classifyDocument(stdout, filename);
    } catch (error) {
      console.log('  Classification failed, using default extraction');
      return null;
    }
  }

  /**
   * Extract using text-based Q&A extraction
   * For documents with flowing text format (Question... Answer:)
   */
  private async extractWithTextQA(
    filepath: string,
    filename: string,
    classification: DocumentClassification
  ): Promise<QuestionnaireStructure> {
    const result = await extractTextQA(filepath);

    // Convert TextQAResult to QuestionnaireStructure
    const rows: RowData[] = [];
    let rowNumber = 1;
    let currentSection = '';

    for (const item of result.items) {
      // Add section header if new section
      if (item.section !== currentSection) {
        currentSection = item.section;
        rows.push({
          row: rowNumber,
          cells: {
            A: {
              ref: `A${rowNumber}`,
              value: currentSection,
              type: 'string',
              filled: true,
              role: 'section',
              format: { bold: true },
            },
          },
          isEmpty: false,
          rowType: 'section',
        });
        rowNumber++;
      }

      // Add Q&A row
      const questionText = item.questionNumber
        ? `${item.questionNumber} ${item.question}`
        : item.question;

      rows.push({
        row: rowNumber,
        cells: {
          A: {
            ref: `A${rowNumber}`,
            value: questionText,
            type: 'string',
            filled: true,
            role: 'label',
          },
          B: {
            ref: `B${rowNumber}`,
            value: item.answer,
            type: 'string',
            filled: item.answer.length > 0,
            role: 'value',
          },
        },
        isEmpty: false,
        rowType: 'data',
      });
      rowNumber++;
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
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer: this.detectCustomer(filename),
        documentType: 'pdf',
      },
      sheets: [{
        name: 'Document',
        index: 0,
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
      }],
      stats: {
        totalSheets: 1,
        totalRows: rows.length,
        totalCells,
        filledCells,
      },
      // Store classification metadata
      metadata: {
        classification: {
          documentType: classification.documentType,
          recommendedMethod: classification.recommendedMethod,
          sections: classification.sections.map(s => s.name),
          language: classification.language,
        },
        textQA: {
          itemCount: result.items.length,
          sections: result.sections,
          pageCount: result.pageCount,
        },
      },
    };
  }

  /**
   * Extract using both table and text methods, merging results
   * For mixed documents with both checkbox tables AND text Q&A sections
   */
  private async extractWithBothMethods(
    filepath: string,
    filename: string,
    classification: DocumentClassification
  ): Promise<QuestionnaireStructure> {
    // Run both extractions in parallel
    const [tableResult, textResult] = await Promise.all([
      isAzureConfigured()
        ? this.extractWithAzure(filepath, filename)
        : this.extractWithPdfParse(filepath, filename),
      extractTextQA(filepath),
    ]);

    // If table extraction got good results, prefer those
    // Otherwise merge in text extraction results
    const tableRowCount = tableResult.stats.totalRows;
    const textItemCount = textResult.items.length;

    console.log(`  Table extraction: ${tableRowCount} rows`);
    console.log(`  Text extraction: ${textItemCount} Q&A pairs`);

    // If text extraction found significantly more content, use text
    if (textItemCount > tableRowCount * 2) {
      console.log('  Text extraction found more content, using text results');
      return this.extractWithTextQA(filepath, filename, classification);
    }

    // Merge both extractions to preserve all pages
    // Table extraction provides structure, text extraction provides complete page coverage
    const mergedResult = this.mergeTableAndTextExtractions(tableResult, textResult, classification);

    console.log(`  Merged result: ${mergedResult.stats.totalRows} rows covering all pages`);
    return mergedResult;
  }

  /**
   * Merge table extraction (structure) with text extraction (complete page coverage)
   * Ensures no pages are lost while preserving table structure where it exists
   */
  private mergeTableAndTextExtractions(
    tableResult: QuestionnaireStructure,
    textResult: TextQAResult,
    classification: DocumentClassification
  ): QuestionnaireStructure {
    // Get pages covered by table extraction
    const tablePagesSet = new Set<number>();
    for (const sheet of tableResult.sheets) {
      for (const row of sheet.rows) {
        for (const cell of Object.values(row.cells)) {
          if (cell.pageNumber) {
            tablePagesSet.add(cell.pageNumber);
          }
        }
      }
    }

    const tablePages = Array.from(tablePagesSet).sort((a, b) => a - b);
    console.log(`    Table extraction covers pages: [${tablePages.join(', ')}]`);

    // Find missing pages from text extraction
    const missingPages: number[] = [];
    if (textResult.pageCount) {
      for (let page = 1; page <= textResult.pageCount; page++) {
        if (!tablePagesSet.has(page)) {
          missingPages.push(page);
        }
      }
    }

    if (missingPages.length > 0) {
      console.log(`    Adding missing pages from text extraction: [${missingPages.join(', ')}]`);

      // Add missing pages as text content to the table result
      const enhancedRows = [...tableResult.sheets[0].rows];
      let nextRowNumber = enhancedRows.length > 0 ? Math.max(...enhancedRows.map(r => r.row)) + 1 : 1;

      for (const pageNum of missingPages) {
        // Add page header
        enhancedRows.push({
          row: nextRowNumber++,
          cells: {
            A: {
              ref: `A${nextRowNumber - 1}`,
              value: `--- PAGE ${pageNum} (Text Content) ---`,
              type: 'string',
              filled: true,
              role: 'section',
              pageNumber: pageNum,
            },
            B: {
              ref: `B${nextRowNumber - 1}`,
              value: '',
              type: 'string',
              filled: false,
              role: 'empty',
              pageNumber: pageNum,
            },
          },
          isEmpty: false,
          rowType: 'section',
        });

        // Add content from text extraction for this page
        const pageItems = textResult.items.filter(item =>
          // Items don't have explicit page numbers, so add them as general content
          true // For now, add all text items to missing pages
        );

        // Add a few text items to represent this page's content
        const itemsToAdd = pageItems.slice(0, 3); // Limit to avoid duplication
        for (const item of itemsToAdd) {
          enhancedRows.push({
            row: nextRowNumber++,
            cells: {
              A: {
                ref: `A${nextRowNumber - 1}`,
                value: item.question,
                type: 'string',
                filled: true,
                role: 'label',
                pageNumber: pageNum,
              },
              B: {
                ref: `B${nextRowNumber - 1}`,
                value: item.answer || '',
                type: 'string',
                filled: !!item.answer,
                role: 'value',
                pageNumber: pageNum,
              },
            },
            isEmpty: false,
            rowType: 'data',
          });
        }
      }

      // Update the sheet with merged rows
      const enhancedSheet: SheetData = {
        ...tableResult.sheets[0],
        rows: enhancedRows,
        rowCount: enhancedRows.length,
        stats: {
          ...tableResult.sheets[0].stats,
          totalCells: enhancedRows.length * 2,
          filledCells: enhancedRows.reduce((count, row) =>
            count + Object.values(row.cells).filter(cell => cell.filled).length, 0
          ),
        },
      };

      // Return enhanced result
      const mergedResult: QuestionnaireStructure = {
        ...tableResult,
        sheets: [enhancedSheet],
        stats: {
          ...tableResult.stats,
          totalRows: enhancedRows.length,
          totalCells: enhancedRows.length * 2,
          filledCells: enhancedSheet.stats.filledCells,
        },
        metadata: {
          ...tableResult.metadata,
          classification: {
            documentType: classification.documentType,
            recommendedMethod: classification.recommendedMethod,
            sections: classification.sections.map(s => s.name),
            language: classification.language,
          },
          textQA: {
            itemCount: textResult.items.length,
            sections: textResult.sections,
            pageCount: textResult.pageCount,
          },
        },
      };

      return mergedResult;
    } else {
      // No missing pages, just enhance metadata
      return {
        ...tableResult,
        metadata: {
          ...tableResult.metadata,
          classification: {
            documentType: classification.documentType,
            recommendedMethod: classification.recommendedMethod,
            sections: classification.sections.map(s => s.name),
            language: classification.language,
          },
          textQA: {
            itemCount: textResult.items.length,
            sections: textResult.sections,
            pageCount: textResult.pageCount,
          },
        },
      };
    }
  }

  /**
   * Extract using Azure Document Intelligence table extraction
   */
  private async extractWithAzure(filepath: string, filename: string): Promise<QuestionnaireStructure> {
    console.log('  Using Azure Document Intelligence for table extraction...');
    const result = await extractPdfWithAzure(filepath);

    const sheets = this.parseRawTablesToSheets(result, filename);

    // Extract Q&A pairs from all text elements using Claude Vision (for items outside tables)
    if (result.paragraphs?.length || result.keyValuePairs?.length) {
      const visualQARows = await this.extractVisualQARows(result, sheets, filepath);
      if (visualQARows.length > 0 && sheets.length > 0) {
        // Add visual Q&A rows to the first sheet
        const lastRowNum = Math.max(...sheets[0].rows.map(r => r.row), 0);
        for (let i = 0; i < visualQARows.length; i++) {
          visualQARows[i].row = lastRowNum + i + 1;
          visualQARows[i].cells['A'].ref = `A${lastRowNum + i + 1}`;
          visualQARows[i].cells['B'].ref = `B${lastRowNum + i + 1}`;
        }
        sheets[0].rows.push(...visualQARows);
        sheets[0].rowCount = sheets[0].rows.length;
        console.log(`  ✓ Added ${visualQARows.length} Q&A pairs from visual analysis`);
      }
    }

    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    const totalCells = sheets.reduce((sum, sheet) => sum + sheet.stats.totalCells, 0);
    const filledCells = sheets.reduce((sum, sheet) => sum + sheet.stats.filledCells, 0);

    // Extract text content alongside table data
    const textContent = {
      markdown: result.markdown,
      paragraphs: result.paragraphs?.map(p => ({
        content: p.content,
        pageNumber: p.pageNumber,
        boundingBox: p.polygon
      })),
      lines: result.lines?.map(l => ({
        content: l.content,
        pageNumber: l.pageNumber,
        boundingBox: l.polygon
      })),
      keyValuePairs: result.keyValuePairs?.map(kvp => ({
        key: kvp.key?.content || '',
        value: kvp.value?.content || '',
        pageNumber: kvp.pageNumber || kvp.key?.pageNumber || kvp.value?.pageNumber
      }))
    };

    console.log(`  ✓ Extracted ${result.tables.length} tables, ${result.paragraphs?.length || 0} paragraphs, ${result.lines?.length || 0} lines`);

    return {
      source: {
        filename,
        filepath,
        extractedAt: new Date().toISOString(),
        customer: this.detectCustomer(filename),
        documentType: 'pdf',
      },
      sheets,
      pages: result.pages?.map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        unit: p.unit
      })),
      textContent,
      stats: {
        totalSheets: sheets.length,
        totalRows,
        totalCells,
        filledCells,
      },
      metadata: {
        classification: {
          documentType: 'pdf',
          recommendedMethod: 'azure-table-extraction',
          sections: [],
          language: 'en'
        }
      },
    };
  }

  /**
   * Parse raw Azure table data into sheets with proper column alignment
   * This is more accurate than parsing markdown which loses cell positioning
   */
  private parseRawTablesToSheets(result: DocumentAnalysisResult, filename: string): SheetData[] {
    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const allRows: RowData[] = [];
    let globalRowNumber = 1;

    // Track column headers for interpreting Yes/No checkboxes
    // Use x position ranges for matching since header and data rows may have different column indices
    // headerColumnOffset accounts for when section headers span multiple columns in header row
    let currentColumnHeaders: Map<number, string> = new Map();
    // x position based header mapping: maps x ranges to header values
    let headerXPositions: Array<{ xMin: number; xMax: number; header: string; colIdx: number }> = [];
    let headerColumnOffset = 0;

    // Track header row indices for post-processing realignment
    const headerRowIndices: number[] = [];

    // Parse markdown headings to extract section titles
    // Format: # Heading, ## Heading, ### Heading
    const sectionTitles = this.extractSectionTitlesFromMarkdown(result.markdown, result.tables);

    for (let tableIndex = 0; tableIndex < result.tables.length; tableIndex++) {
      const table = result.tables[tableIndex];
      const sectionTitle = sectionTitles.get(tableIndex);
      // Build a map of (row, col) -> cell for this table
      const cellMap = new Map<string, typeof table.cells[0]>();
      let maxRow = 0;
      let maxCol = 0;

      for (const cell of table.cells) {
        const key = `${cell.rowIndex},${cell.columnIndex}`;
        cellMap.set(key, cell);
        maxRow = Math.max(maxRow, cell.rowIndex);
        maxCol = Math.max(maxCol, cell.columnIndex);
      }

      // Process each row in the table
      for (let rowIdx = 0; rowIdx <= maxRow; rowIdx++) {
        const rowCells: Record<string, CellData> = {};
        let isHeaderRow = false;
        let isEmpty = true;
        let firstCellContent = '';
        let hasYesNoHeaders = false;

        // Collect all cells in this row
        const rowCellData: Array<{ colIdx: number; cell: typeof table.cells[0] }> = [];
        for (let colIdx = 0; colIdx <= maxCol && colIdx < 26; colIdx++) {
          const cell = cellMap.get(`${rowIdx},${colIdx}`);
          if (cell) {
            rowCellData.push({ colIdx, cell });
          }
        }

        // Check if this is a YES/NO/Comments header row
        const rowContents = rowCellData.map(d => d.cell.content.trim().toLowerCase());

        // Standard pattern: standalone YES and NO cells
        const hasStandaloneYes = rowContents.some(c => /^yes$/i.test(c));
        const hasStandaloneNo = rowContents.some(c => /^no$/i.test(c) || /^n\/a$/i.test(c));

        // Alternative pattern: YES embedded in text (like "...YES Attach certificates...") with standalone NO
        // This is common in certification tables
        const hasEmbeddedYes = rowContents.some(c => /\byes\b/i.test(c) && c.length > 10);
        const noCell = rowCellData.find(d => /^no$/i.test(d.cell.content.trim()));

        if ((hasStandaloneYes && (hasStandaloneNo || rowContents.some(c => /^comments?$/i.test(c)))) ||
            (hasEmbeddedYes && noCell)) {
          hasYesNoHeaders = true;
          // Store these as column headers for subsequent rows
          currentColumnHeaders = new Map();
          headerXPositions = [];

          // Find where YES is in the header row
          let yesCell = rowCellData.find(d => /^yes$/i.test(d.cell.content.trim()));
          const firstFilledCell = rowCellData.find(d => d.cell.content.trim());

          // If no standalone YES, but we have embedded YES pattern with NO column
          // The YES column is one column before NO
          if (!yesCell && noCell && hasEmbeddedYes) {
            // For certification tables: YES column is before NO column
            // Typical structure: [Label col B] [YES col C] [NO col D] [dates...]
            // So YES is at noCell.colIdx - 1
            const yesColIdx = noCell.colIdx - 1;
            currentColumnHeaders.set(yesColIdx, 'YES');
            currentColumnHeaders.set(noCell.colIdx, 'NO');
            headerColumnOffset = 0;
          } else if (yesCell && firstFilledCell && firstFilledCell.colIdx < yesCell.colIdx) {
            // If first cell is a section header (not YES/NO/Comments), calculate offset
            // Header row might have: [Section Header, empty, YES, NO, Comments]
            // Data rows have:        [Question,       YES,  NO,  Comments]
            // So there's an offset of 1 between header col positions and data col positions
            const firstContent = firstFilledCell.cell.content.trim().toLowerCase();
            if (!['yes', 'no', 'n/a', 'comments'].includes(firstContent)) {
              // First cell is section header, offset = yesCell.colIdx - 1 (YES should be at column 1 in data rows)
              headerColumnOffset = yesCell.colIdx - 1;
            }

            for (const { colIdx, cell } of rowCellData) {
              // Store with adjusted column index
              currentColumnHeaders.set(colIdx - headerColumnOffset, cell.content.trim());
            }
          } else {
            headerColumnOffset = 0;
            for (const { colIdx, cell } of rowCellData) {
              currentColumnHeaders.set(colIdx, cell.content.trim());
            }
          }

          // Build x position based header mapping for more accurate matching
          // This handles cases where header row and data rows have different column indices
          for (const { colIdx, cell } of rowCellData) {
            const content = cell.content.trim();
            if (/^(yes|no|n\/a|na|comments?)$/i.test(content) && cell.polygon) {
              const xMin = cell.polygon[0];
              const xMax = cell.polygon[2]; // polygon is [x1,y1, x2,y2, x3,y3, x4,y4]
              headerXPositions.push({ xMin, xMax, header: content, colIdx });
            }
          }
        }

        // Check if first cell has a section header pattern
        const firstNonEmptyCell = rowCellData.find(d => d.cell.content.trim());
        if (firstNonEmptyCell) {
          firstCellContent = firstNonEmptyCell.cell.content.trim();
        }

        // Detect section headers: numbered sections like "13-2 PURCHASE CONTROL..."
        const isSectionHeader = /^\d+(-\d+)?\s+[A-Z]/.test(firstCellContent) &&
                               firstCellContent.length < 80 &&
                               hasYesNoHeaders; // Section header followed by YES/NO columns

        // Check if this looks like a header row (has columnHeader cells)
        const looksLikeHeaderRow = rowCellData.some(d => d.cell.kind === 'columnHeader') || hasYesNoHeaders;

        // Normalize column positions - shift content if first cell is empty but others have content
        // SKIP for header rows - empty first column is intentional (for row numbers)
        let normalizedCells = looksLikeHeaderRow
          ? rowCellData
          : this.normalizeColumnPositions(rowCellData, maxCol);

        // Build the row cells
        for (const { colIdx, cell } of normalizedCells) {
          if (colIdx >= 26) continue;

          const colLetter = colLetters[colIdx];
          let value = cell.content.trim();
          const filled = value.length > 0;
          if (filled) isEmpty = false;

          // Check if this is a column header cell
          if (cell.kind === 'columnHeader' || hasYesNoHeaders) {
            isHeaderRow = true;
          }

          // Determine role
          let role: CellRole = 'value';
          if (cell.kind === 'columnHeader' || hasYesNoHeaders) {
            role = 'header';
          } else if (colIdx === 0) {
            role = 'label';
          }

          // Clean up Azure's selection mark notation (:selected:, :unselected:)
          // and interpret checkbox marks based on column headers
          let isSelected = value.includes(':selected:') || /^[x☒✓✔]$/i.test(value) || value.includes('☒') || value.includes('✓');
          const isUnselected = value.includes(':unselected:');

          // Clean the :selected:/:unselected: markers from value
          value = value.replace(/:selected:/g, '').replace(/:unselected:/g, '').trim();

          // Handle Azure merging checkbox marks with text (e.g., "FSSC 22000  x" or "ISO 9001 x")
          // This happens when the checkbox is very close to the label text
          // Track if we need to add a "Yes" to the next column
          let addYesToNextColumn = false;
          const trailingCheckboxMatch = value.match(/^(.+?)\s{1,3}[xX☒✓✔]$/);
          if (trailingCheckboxMatch && colIdx <= 1) {
            // Extract the label without the checkbox mark
            value = trailingCheckboxMatch[1].trim();
            // The checkbox was in the YES column (next column after label)
            addYesToNextColumn = true;
          }

          // Store flag for post-processing to add Yes to next column
          if (addYesToNextColumn) {
            // Add "Yes" to next column (will be processed after this cell)
            const nextColLetter = colLetters[colIdx + 1];
            if (nextColLetter && !rowCells[nextColLetter]) {
              rowCells[nextColLetter] = {
                ref: `${nextColLetter}${globalRowNumber}`,
                value: 'Yes',
                type: 'string',
                filled: true,
                role: 'value',
              };
              isEmpty = false;
            }
          }

          if (!isHeaderRow && currentColumnHeaders.size > 0 && (isSelected || isUnselected)) {
            // First try column index matching
            let header = currentColumnHeaders.get(colIdx)?.toLowerCase() || '';

            // If no header found by column index, try x position matching
            // This handles cases where header row and data rows have different column indices
            if (!header && cell.polygon && headerXPositions.length > 0) {
              const cellX = cell.polygon[0];
              // Find header whose x range contains this cell's x position (with tolerance)
              const matchedHeader = headerXPositions.find(h =>
                cellX >= h.xMin - 0.1 && cellX <= h.xMax + 0.1
              );
              if (matchedHeader) {
                header = matchedHeader.header.toLowerCase();
              }
            }

            if (isSelected) {
              if (/^yes$/i.test(header)) {
                value = 'Yes';
              } else if (/^no$/i.test(header)) {
                value = 'No';
              } else if (/^n\/a/i.test(header)) {
                value = 'N/A';
              } else if (!value) {
                value = '☒'; // Keep checkbox mark if no header context
              }
            } else if (isUnselected && !value) {
              value = '☐'; // Empty checkbox
            }
          } else if (isSelected && !value) {
            value = '☒';
          } else if (isUnselected && !value) {
            value = '☐';
          }

          rowCells[colLetter] = {
            ref: `${colLetter}${globalRowNumber}`,
            value,
            type: 'string',
            filled,
            role,
            polygon: cell.polygon,
            pageNumber: cell.pageNumber || table.pageNumber,
          };
        }

        // Skip empty rows
        if (isEmpty && Object.keys(rowCells).length === 0) continue;

        // Add empty cells for gaps
        for (let colIdx = 0; colIdx <= maxCol && colIdx < 26; colIdx++) {
          const colLetter = colLetters[colIdx];
          if (!rowCells[colLetter]) {
            rowCells[colLetter] = {
              ref: `${colLetter}${globalRowNumber}`,
              value: '',
              type: 'string',
              filled: false,
              role: colIdx === 0 ? 'label' : 'value',
            };
          }
        }

        // Determine row type
        let rowType: RowData['rowType'] = 'data';
        if (isHeaderRow) {
          rowType = 'header';
          // Track header row index for potential realignment
          headerRowIndices.push(allRows.length);
        } else if (isSectionHeader) {
          rowType = 'section';
        }

        const rowData: RowData = {
          row: globalRowNumber,
          cells: rowCells,
          isEmpty,
          rowType,
        };

        // Add section title to header rows (extracted from markdown headings)
        if (isHeaderRow && sectionTitle) {
          rowData.sectionTitle = sectionTitle;
        }

        allRows.push(rowData);

        globalRowNumber++;
      }
    }

    // Post-process: realign header row columns based on x-positions
    // When a header row has merged cells (like section titles), the YES/NO/Comments
    // headers may be in different column letters than where the data appears
    this.realignHeaderColumns(allRows, headerRowIndices);

    // Note: Paragraph Q&A extraction is done at the extractWithAzure level (async)

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of allRows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    return [{
      name: 'Document',
      index: 0,
      rows: allRows,
      mergedRanges: [],
      topic: this.detectTopicFromFilename(filename),
      rowCount: allRows.length,
      columnCount: Math.max(...allRows.map(r => Object.keys(r.cells).length), 1),
      stats: {
        totalCells,
        filledCells,
        emptyRows: 0,
        mergedRanges: 0,
      },
    }];
  }

  /**
   * Normalize column positions when questions are shifted to wrong columns
   * If first column is empty but there's a question-like content in column B,
   * shift everything left
   */
  private normalizeColumnPositions(
    rowCellData: Array<{ colIdx: number; cell: { content: string; kind?: string; polygon?: number[]; pageNumber?: number } }>,
    maxCol: number
  ): Array<{ colIdx: number; cell: { content: string; kind?: string; polygon?: number[]; pageNumber?: number } }> {
    if (rowCellData.length === 0) return rowCellData;

    // Find first non-empty cell
    const firstNonEmpty = rowCellData.find(d => d.cell.content.trim());
    if (!firstNonEmpty) return rowCellData;

    // Check if first column (0) is empty but column 1+ has question-like content
    const firstColCell = rowCellData.find(d => d.colIdx === 0);
    const firstColEmpty = !firstColCell || !firstColCell.cell.content.trim();

    if (firstColEmpty && firstNonEmpty.colIdx > 0) {
      const content = firstNonEmpty.cell.content.trim();

      // Check if it looks like a question (ends with ?, contains question words, or is long text)
      const looksLikeQuestion =
        content.endsWith('?') ||
        content.length > 30 ||
        /^(do|does|have|has|is|are|can|could|will|would|what|when|where|how|which)\s/i.test(content);

      if (looksLikeQuestion) {
        // Shift all cells left by the offset
        const offset = firstNonEmpty.colIdx;
        return rowCellData.map(d => ({
          colIdx: Math.max(0, d.colIdx - offset),
          cell: d.cell,
        }));
      }
    }

    return rowCellData;
  }

  /**
   * Realign header row columns based on x-positions of data rows below
   *
   * Problem: When a header row has a merged cell (like a section title spanning A-B),
   * Azure places YES/NO/Comments in columns C/D/E. But in data rows, the values
   * appear in B/C/D because there's no merged cell. This causes visual misalignment.
   *
   * Solution: Find data rows that follow each header row, compare x-positions,
   * and shift header cells to match the column letters of the data below.
   */
  private realignHeaderColumns(rows: RowData[], headerRowIndices: number[]): void {
    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (const headerIdx of headerRowIndices) {
      const headerRow = rows[headerIdx];
      if (!headerRow) continue;

      // Find the first non-empty data row after this header
      let dataRow: RowData | null = null;
      for (let i = headerIdx + 1; i < Math.min(headerIdx + 10, rows.length); i++) {
        const candidate = rows[i];
        if (candidate.rowType === 'data' && !candidate.isEmpty) {
          // Check if it has filled cells beyond column A
          const filledBeyondA = Object.entries(candidate.cells).some(
            ([col, cell]) => col !== 'A' && cell.filled && cell.value
          );
          if (filledBeyondA) {
            dataRow = candidate;
            break;
          }
        }
        // Stop if we hit another header
        if (candidate.rowType === 'header') break;
      }

      if (!dataRow) continue;

      // Build x-position to column mapping from header row
      const headerXToCol: Array<{ x: number; col: string; value: string }> = [];
      for (const [col, cell] of Object.entries(headerRow.cells)) {
        if (cell.polygon && cell.filled && /^(yes|no|n\/a|comments?)$/i.test(cell.value)) {
          headerXToCol.push({ x: cell.polygon[0], col, value: cell.value });
        }
      }


      if (headerXToCol.length === 0) continue;

      // Build x-position to column mapping from data row
      const dataXToCol: Array<{ x: number; col: string }> = [];
      for (const [col, cell] of Object.entries(dataRow.cells)) {
        if (cell.polygon && cell.filled) {
          dataXToCol.push({ x: cell.polygon[0], col });
        }
      }

      if (dataXToCol.length === 0) continue;

      // Match header cells to data columns by x-position (with tolerance)
      // Since data rows may have empty cells without polygons, we calculate
      // a consistent column offset from the first match and apply it to all headers
      const columnMapping: Map<string, string> = new Map();
      const tolerance = 0.15; // inches
      let columnOffset = 0; // How many columns to shift left (positive = shift left)

      // Find the offset from the first matching header cell
      for (const header of headerXToCol) {
        const matchedData = dataXToCol.find(d => Math.abs(d.x - header.x) < tolerance);
        if (matchedData && matchedData.col !== header.col) {
          // Calculate offset: if header is C and data is B, offset is 1
          const headerColIdx = colLetters.indexOf(header.col);
          const dataColIdx = colLetters.indexOf(matchedData.col);
          columnOffset = headerColIdx - dataColIdx;
          break;
        }
      }

      // Apply the offset to all header cells (not just the ones with matching data)
      if (columnOffset > 0) {
        for (const header of headerXToCol) {
          const headerColIdx = colLetters.indexOf(header.col);
          const newColIdx = headerColIdx - columnOffset;
          if (newColIdx >= 0 && newColIdx < colLetters.length) {
            const newCol = colLetters[newColIdx];
            if (newCol !== header.col) {
              columnMapping.set(header.col, newCol);
            }
          }
        }
      }

      // Apply the column mapping to the header row
      if (columnMapping.size > 0) {
        const newCells: Record<string, CellData> = {};

        // First, add all cells that are NOT being remapped (or cells without mappings)
        for (const [oldCol, cell] of Object.entries(headerRow.cells)) {
          if (!columnMapping.has(oldCol)) {
            // This cell is not being moved, but check if another cell is moving TO this position
            const somethingMovingHere = [...columnMapping.values()].includes(oldCol);
            if (!somethingMovingHere) {
              // Safe to keep this cell at its current position
              newCells[oldCol] = cell;
            }
            // If something is moving here, skip this cell (it will be replaced)
          }
        }

        // Then, apply the mappings (cells that ARE being remapped)
        for (const [oldCol, newCol] of columnMapping) {
          const cell = headerRow.cells[oldCol];
          if (cell) {
            // Update the cell reference
            const newRef = cell.ref.replace(/^[A-Z]+/, newCol);
            newCells[newCol] = { ...cell, ref: newRef };
          }
        }

        headerRow.cells = newCells;
      }
    }
  }

  /**
   * Extract Q&A pairs from PDF text elements using Claude Vision.
   * Uses visual layout with bounding boxes to identify key-value pairs.
   * Checks ALL text elements, not just paragraphs.
   */
  private async extractVisualQARows(
    result: DocumentAnalysisResult,
    sheets: SheetData[],
    pdfPath?: string
  ): Promise<RowData[]> {
    // Collect ALL text elements from Azure (paragraphs, keyValuePairs, etc.)
    const allElements: TextElementWithPosition[] = [];

    // Add paragraphs
    if (result.paragraphs) {
      for (const p of result.paragraphs) {
        if (p.content?.trim()) {
          allElements.push({
            content: p.content,
            pageNumber: p.pageNumber || 1,
            boundingBox: p.polygon,
          });
        }
      }
    }

    // Add key-value pairs (both keys and values as separate elements)
    // Note: KeyValuePairs from Azure don't have bounding boxes on key/value
    if (result.keyValuePairs) {
      for (const kvp of result.keyValuePairs) {
        if (kvp.key?.content?.trim()) {
          allElements.push({
            content: kvp.key.content,
            pageNumber: kvp.key.pageNumber || kvp.pageNumber || 1,
            // keyValuePairs don't have polygons in our type
          });
        }
        if (kvp.value?.content?.trim()) {
          allElements.push({
            content: kvp.value.content,
            pageNumber: kvp.value.pageNumber || kvp.pageNumber || 1,
            // keyValuePairs don't have polygons in our type
          });
        }
      }
    }

    if (allElements.length < 2) return [];

    // Get page info
    const pages: PageInfo[] = (result.pages || []).map(p => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
    }));

    // Get questions already captured in sheets to avoid duplicates
    const existingQuestions = new Set<string>();
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        const labelCell = row.cells['A'];
        if (labelCell?.value) {
          existingQuestions.add(labelCell.value.toLowerCase().trim());
        }
      }
    }

    try {
      const extractor = new VisualQAExtractor();
      const qaPairs = await extractor.extractQAPairs(allElements, pages, pdfPath);

      // Convert to rows, filtering out duplicates
      const rows: RowData[] = [];
      for (const pair of qaPairs) {
        const normalizedQuestion = pair.question.toLowerCase().trim();

        // Skip if already in sheets
        if (existingQuestions.has(normalizedQuestion)) continue;

        // Skip very short questions
        if (pair.question.length < 15) continue;

        rows.push({
          row: 0, // Will be set by caller
          isEmpty: false,
          rowType: 'data',
          extractionSource: 'visualQA', // Mark as extracted by visual Q&A
          cells: {
            'A': {
              ref: 'A0',
              value: pair.question,
              type: 'string',
              filled: true,
              role: 'label',
              pageNumber: pair.pageNumber,
            },
            'B': {
              ref: 'B0',
              value: pair.answer,
              type: 'string',
              filled: true,
              role: 'value',
              pageNumber: pair.pageNumber,
              // Store visual Q&A metadata for review
              visualQAMetadata: {
                confidence: pair.confidence,
                visualReason: pair.visualReason,
                questionIdx: pair.questionIdx,
                answerIdx: pair.answerIdx,
              },
            },
          },
        });

        existingQuestions.add(normalizedQuestion);
      }

      return rows;
    } catch (error) {
      console.error('  Error extracting visual Q&A:', error);
      return [];
    }
  }

  /**
   * Extract section titles from markdown headings and map them to table indices
   * Azure markdown format: # Heading, ## Heading, ### Heading followed by <table> tags
   */
  private extractSectionTitlesFromMarkdown(
    markdown: string,
    tables: DocumentAnalysisResult['tables']
  ): Map<number, string> {
    const sectionTitles = new Map<number, string>();

    if (!markdown || tables.length === 0) {
      return sectionTitles;
    }

    // Find all markdown headings and their positions
    // Matches: # Title, ## Title, ### Title
    const headingRegex = /^(#{1,3})\s+(.+)$/gm;
    const headings: Array<{ level: number; title: string; index: number }> = [];

    let match;
    while ((match = headingRegex.exec(markdown)) !== null) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        index: match.index
      });
    }

    // Find all table positions in the markdown
    const tableRegex = /<table[^>]*>/gi;
    const tablePositions: number[] = [];
    let tableMatch;
    while ((tableMatch = tableRegex.exec(markdown)) !== null) {
      tablePositions.push(tableMatch.index);
    }

    // For each table, find the closest preceding heading
    for (let tableIndex = 0; tableIndex < Math.min(tables.length, tablePositions.length); tableIndex++) {
      const tablePos = tablePositions[tableIndex];

      // Find the most recent heading before this table
      let closestHeading: typeof headings[0] | null = null;
      for (const heading of headings) {
        if (heading.index < tablePos) {
          closestHeading = heading;
        } else {
          break;
        }
      }

      if (closestHeading) {
        sectionTitles.set(tableIndex, closestHeading.title);
      }
    }

    // If we have more tables than table positions in markdown (Azure raw tables vs markdown),
    // try to match by page number
    if (tables.length > tablePositions.length && headings.length > 0) {
      // Fall back to using first heading for tables without matches
      for (let tableIndex = tablePositions.length; tableIndex < tables.length; tableIndex++) {
        if (!sectionTitles.has(tableIndex) && headings.length > 0) {
          // Use the last heading as fallback
          sectionTitles.set(tableIndex, headings[headings.length - 1].title);
        }
      }
    }

    return sectionTitles;
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
