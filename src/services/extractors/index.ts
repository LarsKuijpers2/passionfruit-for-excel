/**
 * Document Extractor Abstraction
 *
 * Provides a unified interface for extracting questionnaire structure
 * from different document types (Excel, Word, PDF).
 */

import { extname } from 'path';
import type { QuestionnaireStructure } from './excel.js';

// =============================================================================
// TYPES
// =============================================================================

/** Supported document types */
export type DocumentType = 'excel' | 'word' | 'pdf' | 'html';

/** PDF extractor types */
export type PdfExtractorType = 'azure' | 'two-pass-vision' | 'vision';

/** Document extractor interface - all extractors must implement this */
export interface DocumentExtractor {
  /** Extract structure from the document file */
  extract(filepath: string): Promise<QuestionnaireStructure>;

  /** Get the document type this extractor handles */
  getDocumentType(): DocumentType;
}

/** Options for extractor factory */
export interface GetExtractorOptions {
  /** Customer directory for extractors that need it */
  customerDir?: string;
  /** PDF extractor type (default: 'azure') */
  pdfExtractor?: PdfExtractorType;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Get the appropriate extractor for a file based on its extension
 * @param filepath Path to the file to extract
 * @param options Optional configuration for extractor selection
 */
export async function getExtractor(
  filepath: string,
  options?: GetExtractorOptions
): Promise<DocumentExtractor> {
  const ext = extname(filepath).toLowerCase();

  switch (ext) {
    case '.xlsx':
    case '.xls': {
      const { ExcelStructureExtractor } = await import('./excel.js');
      return new ExcelStructureExtractor();
    }

    case '.docx': {
      const { WordStructureExtractor } = await import('./word.js');
      return new WordStructureExtractor();
    }

    case '.pdf': {
      const pdfExtractor = options?.pdfExtractor || 'azure';

      if (pdfExtractor === 'vision') {
        // New two-phase vision extractor (recommended for complex documents)
        const { VisionExtractor } = await import('./vision-extractor.js');
        return new VisionExtractor(options?.customerDir);
      }

      if (pdfExtractor === 'two-pass-vision') {
        // Legacy two-pass vision extractor
        const { TwoPassVisionExtractor } = await import('./two-pass-vision-extractor.js');
        return new TwoPassVisionExtractor(options?.customerDir);
      }

      // Default: Azure OCR-based extraction
      const { PdfStructureExtractor } = await import('./pdf.js');
      return new PdfStructureExtractor();
    }

    case '.html':
    case '.htm': {
      const { HtmlStructureExtractor } = await import('./html.js');
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
