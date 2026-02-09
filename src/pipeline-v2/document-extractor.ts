/**
 * Document Extractor Abstraction
 *
 * Provides a unified interface for extracting questionnaire structure
 * from different document types (Excel, Word, PDF).
 */

import { extname } from 'path';
import type { QuestionnaireStructure } from './excel-structure.js';

// =============================================================================
// TYPES
// =============================================================================

/** Supported document types */
export type DocumentType = 'excel' | 'word' | 'pdf' | 'html';

/** Document extractor interface - all extractors must implement this */
export interface DocumentExtractor {
  /** Extract structure from the document file */
  extract(filepath: string): Promise<QuestionnaireStructure>;

  /** Get the document type this extractor handles */
  getDocumentType(): DocumentType;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Get the appropriate extractor for a file based on its extension
 */
export async function getExtractor(filepath: string): Promise<DocumentExtractor> {
  const ext = extname(filepath).toLowerCase();

  switch (ext) {
    case '.xlsx':
    case '.xls': {
      const { ExcelStructureExtractor } = await import('./excel-structure.js');
      return new ExcelStructureExtractor();
    }

    case '.docx': {
      const { WordStructureExtractor } = await import('./word-structure.js');
      return new WordStructureExtractor();
    }

    case '.pdf': {
      const { PdfStructureExtractor } = await import('./pdf-structure.js');
      return new PdfStructureExtractor();
    }

    case '.html':
    case '.htm': {
      const { HtmlStructureExtractor } = await import('./html-structure.js');
      return new HtmlStructureExtractor();
    }

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported types: .xlsx, .xls, .docx, .pdf, .html`);
  }
}

/**
 * Get document type from file extension
 */
export function getDocumentType(filepath: string): DocumentType {
  const ext = extname(filepath).toLowerCase();

  switch (ext) {
    case '.xlsx':
    case '.xls':
      return 'excel';
    case '.docx':
      return 'word';
    case '.pdf':
      return 'pdf';
    case '.html':
    case '.htm':
      return 'html';
    default:
      throw new Error(`Unknown file type: ${ext}`);
  }
}

/**
 * Check if a file type is supported
 */
export function isSupportedFileType(filepath: string): boolean {
  const ext = extname(filepath).toLowerCase();
  return ['.xlsx', '.xls', '.docx', '.pdf', '.html', '.htm'].includes(ext);
}
