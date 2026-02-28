/**
 * Azure Document Intelligence Client
 *
 * Uses Azure AI Document Intelligence to extract structured content from PDFs.
 * Outputs markdown with proper table structure.
 */

import DocumentIntelligence, {
  getLongRunningPoller,
  AnalyzeResultOutput,
  isUnexpected,
} from '@azure-rest/ai-document-intelligence';
import { readFile } from 'fs/promises';

// =============================================================================
// CLIENT SETUP
// =============================================================================

const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY;

function getClient() {
  if (!endpoint || !apiKey) {
    throw new Error(
      'Azure Document Intelligence not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_API_KEY environment variables.'
    );
  }

  return DocumentIntelligence(endpoint, { key: apiKey });
}

// =============================================================================
// EXTRACTION
// =============================================================================

export interface PageDimensions {
  pageNumber: number;
  width: number;  // in inches
  height: number; // in inches
  unit: string;   // typically "inch"
}

export interface SelectionMark {
  /** State of the selection mark */
  state: 'selected' | 'unselected';
  /** Bounding box polygon [x1,y1, x2,y2, x3,y3, x4,y4] in inches */
  polygon: number[];
  /** Detection confidence 0-1 */
  confidence: number;
  /** Page number (1-indexed) */
  pageNumber: number;
}

export interface Paragraph {
  /** Paragraph content text */
  content: string;
  /** Page number */
  pageNumber?: number;
  /** Bounding box polygon */
  polygon?: number[];
}

export interface Line {
  /** Line content text */
  content: string;
  /** Page number */
  pageNumber?: number;
  /** Bounding box polygon */
  polygon?: number[];
}

export interface KeyValuePair {
  /** Key content */
  key?: {
    content: string;
    pageNumber?: number;
    polygon?: number[];
  };
  /** Value content */
  value?: {
    content: string;
    pageNumber?: number;
    polygon?: number[];
  };
  /** Page number */
  pageNumber?: number;
}

export interface DocumentAnalysisResult {
  /** Extracted content as markdown */
  markdown: string;
  /** Number of pages */
  pageCount: number;
  /** Detected tables */
  tables: TableInfo[];
  /** Page dimensions for bounding box scaling */
  pages: PageDimensions[];
  /** Selection marks (checkboxes) detected in the document */
  selectionMarks: SelectionMark[];
  /** Paragraphs extracted from document */
  paragraphs?: Paragraph[];
  /** Individual lines extracted from document */
  lines?: Line[];
  /** Key-value pairs extracted from document */
  keyValuePairs?: KeyValuePair[];
  /** Raw analysis result */
  raw: AnalyzeResultOutput;
}

export interface TableInfo {
  pageNumber: number;
  rowCount: number;
  columnCount: number;
  cells: TableCell[];
}

export interface TableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  kind?: 'columnHeader' | 'rowHeader' | 'content';
  columnSpan?: number;
  rowSpan?: number;
  /** Bounding box polygon [x1,y1, x2,y2, x3,y3, x4,y4] in inches from top-left */
  polygon?: number[];
  /** Page number (1-indexed) */
  pageNumber?: number;
}

/**
 * Extract content from a PDF file using Azure Document Intelligence
 */
export async function extractPdfWithAzure(filepath: string): Promise<DocumentAnalysisResult> {
  const client = getClient();

  // Read file as base64
  const fileBuffer = await readFile(filepath);
  const base64Content = fileBuffer.toString('base64');

  // Use prebuilt-layout with keyValuePairs feature for questionnaire extraction
  // Note: prebuilt-document model not available in all Azure regions
  const modelId = process.env.AZURE_MODEL_ID || 'prebuilt-layout';
  const initialResponse = await client
    .path('/documentModels/{modelId}:analyze', modelId)
    .post({
      contentType: 'application/json',
      body: {
        base64Source: base64Content,
      },
      queryParameters: {
        // Markdown preserves structure and is easy to parse
        outputContentFormat: 'markdown',
        // keyValuePairs extracts form field label-value pairs (FREE)
        // ocrHighResolution improves OCR quality for scanned documents (add-on, paid)
        features: ['keyValuePairs', 'ocrHighResolution'],
        locale: 'en-US',
      },
    });

  if (isUnexpected(initialResponse)) {
    throw new Error(`Azure Document Intelligence error: ${initialResponse.body.error?.message || 'Unknown error'}`);
  }

  // Poll until complete
  const poller = getLongRunningPoller(client, initialResponse);
  const result = await poller.pollUntilDone();

  if (isUnexpected(result)) {
    throw new Error(`Azure Document Intelligence error: ${result.body.error?.message || 'Unknown error'}`);
  }

  const analyzeResult = (result.body as any).analyzeResult as AnalyzeResultOutput;
  if (!analyzeResult) {
    throw new Error('No analysis result returned');
  }

  // Extract page dimensions for bounding box scaling
  const pages: PageDimensions[] = (analyzeResult.pages || []).map((page: any) => ({
    pageNumber: page.pageNumber || 1,
    width: page.width || 8.5,
    height: page.height || 11,
    unit: page.unit || 'inch',
  }));

  // Extract table information with bounding boxes
  const tables: TableInfo[] = (analyzeResult.tables || []).map((table: any) => ({
    pageNumber: table.boundingRegions?.[0]?.pageNumber || 1,
    rowCount: table.rowCount || 0,
    columnCount: table.columnCount || 0,
    cells: (table.cells || []).map((cell: any) => ({
      rowIndex: cell.rowIndex || 0,
      columnIndex: cell.columnIndex || 0,
      content: cell.content || '',
      kind: cell.kind as TableCell['kind'],
      columnSpan: cell.columnSpan,
      rowSpan: cell.rowSpan,
      // Store bounding box for overlay rendering
      polygon: cell.boundingRegions?.[0]?.polygon,
      pageNumber: cell.boundingRegions?.[0]?.pageNumber,
    })),
  }));

  // Extract selection marks (checkboxes) from all pages
  const selectionMarks: SelectionMark[] = [];
  for (const page of (analyzeResult as any).pages || []) {
    const pageNumber = page.pageNumber || 1;
    for (const mark of page.selectionMarks || []) {
      selectionMarks.push({
        state: mark.state as 'selected' | 'unselected',
        polygon: mark.polygon || [],
        confidence: mark.confidence || 0,
        pageNumber,
      });
    }
  }

  // Extract paragraphs
  const paragraphs: Paragraph[] = (analyzeResult.paragraphs || []).map((para: any) => ({
    content: para.content || '',
    pageNumber: para.boundingRegions?.[0]?.pageNumber,
    polygon: para.boundingRegions?.[0]?.polygon,
  }));

  // Extract lines
  const lines: Line[] = [];
  for (const page of (analyzeResult as any).pages || []) {
    const pageNumber = page.pageNumber || 1;
    for (const line of page.lines || []) {
      lines.push({
        content: line.content || '',
        pageNumber,
        polygon: line.polygon,
      });
    }
  }

  // Extract key-value pairs with polygon data for positioning
  const keyValuePairs: KeyValuePair[] = (analyzeResult.keyValuePairs || []).map((kvp: any) => ({
    key: kvp.key ? {
      content: kvp.key.content || '',
      pageNumber: kvp.key.boundingRegions?.[0]?.pageNumber,
      polygon: kvp.key.boundingRegions?.[0]?.polygon,
    } : undefined,
    value: kvp.value ? {
      content: kvp.value.content || '',
      pageNumber: kvp.value.boundingRegions?.[0]?.pageNumber,
      polygon: kvp.value.boundingRegions?.[0]?.polygon,
    } : undefined,
    pageNumber: kvp.key?.boundingRegions?.[0]?.pageNumber || kvp.value?.boundingRegions?.[0]?.pageNumber,
  }));

  return {
    markdown: analyzeResult.content || '',
    pageCount: analyzeResult.pages?.length || 1,
    tables,
    pages,
    selectionMarks,
    paragraphs,
    lines,
    keyValuePairs,
    raw: analyzeResult,
  };
}

/**
 * Check if Azure Document Intelligence is configured
 */
export function isAzureConfigured(): boolean {
  return !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY);
}
