/**
 * Claude Markdown Extractor
 *
 * Extracts structured markdown from PDFs using Claude Vision.
 * This produces output similar to Claude Chat when you upload a PDF directly.
 *
 * Benefits over Azure cell-by-cell extraction:
 * - Preserves document hierarchy (headers, sections, subsections)
 * - Proper markdown tables with aligned columns
 * - Unicode checkboxes (☒/☐) instead of markers
 * - Instruction paragraphs preserved, not dropped
 * - Question-answer pairs naturally grouped
 */

import { readFile } from 'fs/promises';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { execSync } from 'child_process';
import type {
  QuestionnaireStructure,
  SheetData,
  RowData,
  CellData,
  CellRole,
} from './excel.js';

const CLAUDE_MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';

interface ExtractedMarkdown {
  markdown: string;
  sections: ExtractedSection[];
  tables: ExtractedTable[];
  pageCount: number;
}

interface ExtractedSection {
  title: string;
  level: number; // 1-6 for h1-h6
  content: string;
  pageNumber: number;
}

interface ExtractedTable {
  title?: string;
  headers: string[];
  rows: string[][];
  pageNumber: number;
}

export class ClaudeMarkdownExtractor {
  private client: BedrockRuntimeClient;
  private maxPagesPerRequest = 5; // Claude has token limits

  constructor(region?: string) {
    this.client = new BedrockRuntimeClient({
      region: region || process.env.AWS_REGION || 'eu-central-1'
    });
  }

  /**
   * Extract structured markdown from a PDF file.
   * Processes pages in batches and combines results.
   */
  async extract(pdfPath: string): Promise<ExtractedMarkdown> {
    // Convert PDF to images
    const images = await this.pdfToImages(pdfPath);
    console.log(`  📄 Converted ${images.length} pages to images`);

    // Process in batches
    const allMarkdown: string[] = [];
    const allSections: ExtractedSection[] = [];
    const allTables: ExtractedTable[] = [];

    for (let i = 0; i < images.length; i += this.maxPagesPerRequest) {
      const batchImages = images.slice(i, i + this.maxPagesPerRequest);
      const startPage = i + 1;
      const endPage = Math.min(i + this.maxPagesPerRequest, images.length);

      console.log(`  🔍 Processing pages ${startPage}-${endPage}...`);

      const result = await this.extractFromImages(batchImages, startPage);
      allMarkdown.push(result.markdown);
      allSections.push(...result.sections);
      allTables.push(...result.tables);
    }

    return {
      markdown: allMarkdown.join('\n\n---\n\n'),
      sections: allSections,
      tables: allTables,
      pageCount: images.length,
    };
  }

  /**
   * Extract to QuestionnaireStructure format (for pipeline compatibility)
   */
  async extractToStructure(pdfPath: string, filename: string): Promise<QuestionnaireStructure> {
    const extracted = await this.extract(pdfPath);

    // Parse markdown into rows
    const rows = this.markdownToRows(extracted);

    // Calculate stats
    let totalCells = 0;
    let filledCells = 0;
    for (const row of rows) {
      for (const cell of Object.values(row.cells)) {
        totalCells++;
        if (cell.filled) filledCells++;
      }
    }

    const sheet: SheetData = {
      name: 'Document',
      index: 0,
      rows,
      mergedRanges: [],
      rowCount: rows.length,
      columnCount: Math.max(...rows.map(r => Object.keys(r.cells).length), 1),
      stats: {
        totalCells,
        filledCells,
        emptyRows: 0,
        mergedRanges: 0,
      },
    };

    return {
      source: {
        filename,
        filepath: pdfPath,
        extractedAt: new Date().toISOString(),
        documentType: 'pdf',
      },
      sheets: [sheet],
      stats: {
        totalSheets: 1,
        totalRows: rows.length,
        totalCells,
        filledCells,
      },
      metadata: {
        extractionMethod: 'claude-markdown',
        markdown: extracted.markdown,
        pageCount: extracted.pageCount,
      },
    };
  }

  /**
   * Convert PDF pages to base64-encoded images using pdftoppm
   */
  private async pdfToImages(pdfPath: string): Promise<Buffer[]> {
    const images: Buffer[] = [];

    // Get page count
    const pageCountOutput = execSync(`pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`, {
      encoding: 'utf-8'
    }).trim();
    const pageCount = parseInt(pageCountOutput, 10) || 1;

    // Convert each page to PNG
    for (let page = 1; page <= pageCount; page++) {
      try {
        // pdftoppm outputs to stdout with -png -singlefile
        const imageBuffer = execSync(
          `pdftoppm -png -singlefile -f ${page} -l ${page} -r 150 "${pdfPath}"`,
          { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for large pages
        );
        images.push(imageBuffer);
      } catch (error) {
        console.warn(`  Warning: Could not convert page ${page}`);
      }
    }

    return images;
  }

  /**
   * Send images to Claude Vision and get structured markdown
   */
  private async extractFromImages(
    images: Buffer[],
    startPage: number
  ): Promise<{ markdown: string; sections: ExtractedSection[]; tables: ExtractedTable[] }> {
    // Build content array with images
    const content: any[] = [];

    for (let i = 0; i < images.length; i++) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: images[i].toString('base64'),
        },
      });
    }

    // Add the extraction prompt
    content.push({
      type: 'text',
      text: `Extract ALL content from these PDF pages into well-structured markdown.

IMPORTANT RULES:
1. Preserve EVERY piece of text - headers, paragraphs, instructions, notes, everything
2. Use proper markdown hierarchy:
   - # for main document title
   - ## for major sections
   - ### for subsections
   - #### for sub-subsections
3. Format tables properly:
   - Use markdown table syntax with | separators
   - Include header row with --- separator
   - Align columns properly
4. For checkboxes:
   - Use ☒ for checked/selected boxes
   - Use ☐ for unchecked/empty boxes
   - Include the text next to the checkbox
5. For Q&A pairs NOT in tables:
   - Format as: **Question text?** Answer text
   - Or use definition list style if many short Q&As
6. Preserve ALL instruction text, notes, and context paragraphs
7. Keep content in document reading order (top to bottom, left to right)

Output ONLY the markdown content, no explanations or meta-commentary.
Start with the content immediately.`
    });

    const response = await this.client.send(new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content,
        }],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const markdown = result.content?.[0]?.text || '';

    // Parse sections from markdown
    const sections = this.parseSections(markdown, startPage);
    const tables = this.parseTables(markdown, startPage);

    return { markdown, sections, tables };
  }

  /**
   * Parse section headers from markdown
   */
  private parseSections(markdown: string, startPage: number): ExtractedSection[] {
    const sections: ExtractedSection[] = [];
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;

    let match;
    while ((match = headerRegex.exec(markdown)) !== null) {
      sections.push({
        title: match[2].trim(),
        level: match[1].length,
        content: '', // Could extract content after header if needed
        pageNumber: startPage, // Approximate - could be refined
      });
    }

    return sections;
  }

  /**
   * Parse tables from markdown
   */
  private parseTables(markdown: string, startPage: number): ExtractedTable[] {
    const tables: ExtractedTable[] = [];

    // Find markdown tables (lines starting with |)
    const lines = markdown.split('\n');
    let inTable = false;
    let currentTable: { headers: string[]; rows: string[][] } | null = null;
    let lastHeader = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for section header before table
      const headerMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (headerMatch) {
        lastHeader = headerMatch[1];
      }

      // Table row
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());

        // Skip separator rows (|---|---|)
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue;
        }

        if (!inTable) {
          // Start new table - this is the header row
          inTable = true;
          currentTable = { headers: cells, rows: [] };
        } else if (currentTable) {
          // Data row
          currentTable.rows.push(cells);
        }
      } else if (inTable && currentTable) {
        // End of table
        tables.push({
          title: lastHeader || undefined,
          headers: currentTable.headers,
          rows: currentTable.rows,
          pageNumber: startPage,
        });
        inTable = false;
        currentTable = null;
      }
    }

    // Don't forget last table
    if (inTable && currentTable) {
      tables.push({
        title: lastHeader || undefined,
        headers: currentTable.headers,
        rows: currentTable.rows,
        pageNumber: startPage,
      });
    }

    return tables;
  }

  /**
   * Convert extracted markdown to RowData array for QuestionnaireStructure
   */
  private markdownToRows(extracted: ExtractedMarkdown): RowData[] {
    const rows: RowData[] = [];
    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let rowNumber = 1;

    const lines = extracted.markdown.split('\n');
    let inTable = false;
    let tableHeaders: string[] = [];
    let lastSectionLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---') continue;

      // Section header
      const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        inTable = false;
        tableHeaders = [];
        lastSectionLevel = headerMatch[1].length;

        rows.push({
          row: rowNumber,
          cells: {
            A: {
              ref: `A${rowNumber}`,
              value: headerMatch[2],
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
        continue;
      }

      // Table row
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());

        // Skip separator
        if (cells.every(c => /^[-:]+$/.test(c))) continue;

        if (!inTable) {
          // Header row
          inTable = true;
          tableHeaders = cells;

          const rowCells: Record<string, CellData> = {};
          cells.forEach((cell, idx) => {
            if (idx < 26) {
              const col = colLetters[idx];
              rowCells[col] = {
                ref: `${col}${rowNumber}`,
                value: cell,
                type: 'string',
                filled: cell.length > 0,
                role: 'header',
              };
            }
          });

          rows.push({
            row: rowNumber,
            cells: rowCells,
            isEmpty: false,
            rowType: 'header',
          });
          rowNumber++;
        } else {
          // Data row - interpret checkboxes based on headers
          const rowCells: Record<string, CellData> = {};
          cells.forEach((cell, idx) => {
            if (idx >= 26) return;

            const col = colLetters[idx];
            let value = cell;
            const header = tableHeaders[idx]?.toLowerCase() || '';

            // Interpret checkbox marks based on column header
            if (value === '☒' || value === 'X' || value === 'x' || value === '✓') {
              if (/^yes/i.test(header)) value = 'Yes';
              else if (/^no$/i.test(header)) value = 'No';
              else if (/^n\/a/i.test(header)) value = 'N/A';
            } else if (value === '☐' || value === '') {
              // Empty checkbox or no value
            }

            rowCells[col] = {
              ref: `${col}${rowNumber}`,
              value,
              type: 'string',
              filled: value.length > 0,
              role: idx === 0 ? 'label' : 'value',
            };
          });

          rows.push({
            row: rowNumber,
            cells: rowCells,
            isEmpty: Object.values(rowCells).every(c => !c.filled),
            rowType: 'data',
          });
          rowNumber++;
        }
        continue;
      }

      // End of table
      if (inTable && !trimmed.startsWith('|')) {
        inTable = false;
        tableHeaders = [];
      }

      // Bold Q&A pattern: **Question?** Answer
      const boldQA = trimmed.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      if (boldQA) {
        rows.push({
          row: rowNumber,
          cells: {
            A: {
              ref: `A${rowNumber}`,
              value: boldQA[1],
              type: 'string',
              filled: true,
              role: 'label',
            },
            B: {
              ref: `B${rowNumber}`,
              value: boldQA[2] || '',
              type: 'string',
              filled: (boldQA[2] || '').length > 0,
              role: 'value',
            },
          },
          isEmpty: false,
          rowType: 'data',
        });
        rowNumber++;
        continue;
      }

      // Regular paragraph/text
      if (!inTable && trimmed.length > 0) {
        rows.push({
          row: rowNumber,
          cells: {
            A: {
              ref: `A${rowNumber}`,
              value: trimmed,
              type: 'string',
              filled: true,
              role: 'label',
            },
          },
          isEmpty: false,
          rowType: 'text',
        });
        rowNumber++;
      }
    }

    return rows;
  }
}

/**
 * Convenience function to extract markdown from a PDF
 */
export async function extractPdfWithClaudeVision(
  pdfPath: string,
  options?: { region?: string }
): Promise<ExtractedMarkdown> {
  const extractor = new ClaudeMarkdownExtractor(options?.region);
  return extractor.extract(pdfPath);
}

/**
 * Convenience function to extract to QuestionnaireStructure
 */
export async function extractPdfToStructure(
  pdfPath: string,
  filename: string,
  options?: { region?: string }
): Promise<QuestionnaireStructure> {
  const extractor = new ClaudeMarkdownExtractor(options?.region);
  return extractor.extractToStructure(pdfPath, filename);
}
