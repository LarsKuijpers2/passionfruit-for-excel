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

export interface DocumentAnalysisResult {
  /** Extracted content as markdown */
  markdown: string;
  /** Number of pages */
  pageCount: number;
  /** Detected tables */
  tables: TableInfo[];
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
}

/**
 * Extract content from a PDF file using Azure Document Intelligence
 */
export async function extractPdfWithAzure(filepath: string): Promise<DocumentAnalysisResult> {
  const client = getClient();

  // Read file as base64
  const fileBuffer = await readFile(filepath);
  const base64Content = fileBuffer.toString('base64');

  // Analyze document with prebuilt-layout model
  const initialResponse = await client
    .path('/documentModels/{modelId}:analyze', 'prebuilt-layout')
    .post({
      contentType: 'application/json',
      body: {
        base64Source: base64Content,
      },
      queryParameters: {
        outputContentFormat: 'markdown',
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

  const analyzeResult = result.body.analyzeResult;
  if (!analyzeResult) {
    throw new Error('No analysis result returned');
  }

  // Extract table information
  const tables: TableInfo[] = (analyzeResult.tables || []).map(table => ({
    pageNumber: table.boundingRegions?.[0]?.pageNumber || 1,
    rowCount: table.rowCount || 0,
    columnCount: table.columnCount || 0,
    cells: (table.cells || []).map(cell => ({
      rowIndex: cell.rowIndex || 0,
      columnIndex: cell.columnIndex || 0,
      content: cell.content || '',
      kind: cell.kind as TableCell['kind'],
    })),
  }));

  return {
    markdown: analyzeResult.content || '',
    pageCount: analyzeResult.pages?.length || 1,
    tables,
    raw: analyzeResult,
  };
}

/**
 * Check if Azure Document Intelligence is configured
 */
export function isAzureConfigured(): boolean {
  return !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY);
}
