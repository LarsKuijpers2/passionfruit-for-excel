/**
 * Unified file reader for the questionnaire extraction pipeline.
 * Supports .xlsx, .xls, .pdf, and .docx files.
 */

import { ExcelExtractor } from '../excel-extractor.js';
import type {
  ExtractedContent,
  ExtractedSheet,
  ExtractedRow,
  ExtractedCell,
  FileType,
} from './types.js';

export class FileReader {
  private excelExtractor: ExcelExtractor;

  constructor() {
    this.excelExtractor = new ExcelExtractor();
  }

  /** Detect file type from extension */
  detectFileType(filePath: string): FileType | null {
    const ext = filePath.toLowerCase().split('.').pop();
    switch (ext) {
      case 'xlsx': return 'xlsx';
      case 'xls': return 'xls';
      case 'pdf': return 'pdf';
      case 'docx': return 'docx';
      default: return null;
    }
  }

  /** Read a file and extract structured content */
  async read(filePath: string): Promise<ExtractedContent> {
    const fileType = this.detectFileType(filePath);
    if (!fileType) {
      throw new Error(`Unsupported file type: ${filePath}`);
    }

    const fileName = filePath.split('/').pop() || filePath;

    switch (fileType) {
      case 'xlsx':
      case 'xls':
        return this.readExcel(filePath, fileName, fileType);
      case 'pdf':
        return this.readPDF(filePath, fileName);
      case 'docx':
        return this.readWord(filePath, fileName);
    }
  }

  /** Read an Excel file using ExcelJS via the existing extractor */
  private async readExcel(filePath: string, fileName: string, fileType: FileType): Promise<ExtractedContent> {
    const workbook = await this.excelExtractor.extractEnhanced(filePath);

    const sheets: ExtractedSheet[] = workbook.sheets.map(sheet => {
      const rowsMap = new Map<number, Map<string, ExtractedCell>>();

      for (const [, cell] of sheet.cells) {
        const rowMatch = cell.address.match(/^([A-Z]+)(\d+)$/);
        if (!rowMatch) continue;

        const colLetter = rowMatch[1];
        const rowNum = parseInt(rowMatch[2], 10);

        if (!rowsMap.has(rowNum)) {
          rowsMap.set(rowNum, new Map());
        }

        const value = cell.value !== null && cell.value !== undefined
          ? String(cell.value)
          : '';

        const isSectionHeader = !!(
          cell.mergeInfo?.isMaster &&
          cell.mergeInfo.colSpan >= 2 &&
          cell.style?.font?.bold &&
          cell.type === 'string' &&
          value.trim() &&
          !value.trim().endsWith(':')
        );

        rowsMap.get(rowNum)!.set(colLetter, {
          address: cell.address,
          value,
          isLabel: cell.isLikelyLabel,
          isInput: cell.isLikelyInput,
          isSectionHeader,
          isBold: cell.style?.font?.bold === true,
          isMerged: cell.mergeInfo?.isMerged === true,
          mergeRange: cell.mergeInfo?.range,
          comment: cell.comment,
        });
      }

      const rows: ExtractedRow[] = Array.from(rowsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([rowNumber, cells]) => ({ rowNumber, cells }));

      return {
        name: sheet.name,
        rows,
        isProtected: sheet.isProtected,
      };
    });

    return { fileType, fileName, sheets };
  }

  /** Read a PDF file and extract table/text content */
  private async readPDF(filePath: string, fileName: string): Promise<ExtractedContent> {
    try {
      const { readFile } = await import('fs/promises');
      const { PDFParse } = await import('pdf-parse');

      const dataBuffer = await readFile(filePath);
      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
      const textResult = await parser.getText();

      const lines = textResult.text.split('\n').filter((line: string) => line.trim());
      const rows: ExtractedRow[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cells = new Map<string, ExtractedCell>();

        // Detect if line looks like a Q&A pair (contains tab or multiple spaces as separator)
        const parts = line.split(/\t|\s{3,}/);

        if (parts.length >= 2) {
          // Treat as question + answer
          cells.set('A', {
            address: `A${i + 1}`,
            value: parts[0].trim(),
            isLabel: true,
            isInput: false,
            isSectionHeader: false,
            isBold: false,
            isMerged: false,
          });
          cells.set('B', {
            address: `B${i + 1}`,
            value: parts.slice(1).join(' ').trim(),
            isLabel: false,
            isInput: true,
            isSectionHeader: false,
            isBold: false,
            isMerged: false,
          });
        } else {
          // Check if it's a section header (short, possibly numbered)
          const isHeader = /^\d+[\.\)]\s/.test(line) ||
            (line === line.toUpperCase() && line.length < 80 && line.length > 3);

          cells.set('A', {
            address: `A${i + 1}`,
            value: line,
            isLabel: !isHeader,
            isInput: false,
            isSectionHeader: isHeader,
            isBold: isHeader,
            isMerged: false,
          });
        }

        rows.push({ rowNumber: i + 1, cells });
      }

      return {
        fileType: 'pdf',
        fileName,
        sheets: [{ name: 'Document', rows }],
      };
    } catch (error) {
      throw new Error(`Failed to read PDF: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Read a Word document and extract table/text content */
  private async readWord(filePath: string, fileName: string): Promise<ExtractedContent> {
    try {
      const { readFile } = await import('fs/promises');
      const mammoth = await import('mammoth');

      const dataBuffer = await readFile(filePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      const lines = result.value.split('\n').filter(line => line.trim());

      const rows: ExtractedRow[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cells = new Map<string, ExtractedCell>();

        // Detect if line looks like a Q&A pair
        const parts = line.split(/\t|\s{3,}/);

        if (parts.length >= 2) {
          cells.set('A', {
            address: `A${i + 1}`,
            value: parts[0].trim(),
            isLabel: true,
            isInput: false,
            isSectionHeader: false,
            isBold: false,
            isMerged: false,
          });
          cells.set('B', {
            address: `B${i + 1}`,
            value: parts.slice(1).join(' ').trim(),
            isLabel: false,
            isInput: true,
            isSectionHeader: false,
            isBold: false,
            isMerged: false,
          });
        } else {
          const isHeader = /^\d+[\.\)]\s/.test(line) ||
            (line === line.toUpperCase() && line.length < 80 && line.length > 3);

          cells.set('A', {
            address: `A${i + 1}`,
            value: line,
            isLabel: !isHeader,
            isInput: false,
            isSectionHeader: isHeader,
            isBold: isHeader,
            isMerged: false,
          });
        }

        rows.push({ rowNumber: i + 1, cells });
      }

      return {
        fileType: 'docx',
        fileName,
        sheets: [{ name: 'Document', rows }],
      };
    } catch (error) {
      throw new Error(`Failed to read Word document: ${error instanceof Error ? error.message : error}`);
    }
  }
}
