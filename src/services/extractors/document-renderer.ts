/**
 * Document Renderer
 *
 * Renders document pages as PNG images for visual analysis with Claude Vision.
 * Supports PDF, Excel (.xlsx/.xls), and Word (.docx) documents.
 *
 * Rendering pipeline:
 *   PDF  → pdftoppm → PNG images
 *   Excel/Word → LibreOffice (convert to PDF) → pdftoppm → PNG images
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, mkdir, rm, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { DocumentType } from './index.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// TYPES
// =============================================================================

/** A rendered page image */
export interface PageImage {
  /** Page number (1-based) */
  page: number;
  /** PNG image data */
  data: Buffer;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
}

/** Rendering options */
export interface RenderOptions {
  /** DPI for rendering (default: 200 — good balance of quality vs size) */
  dpi?: number;
  /** Maximum number of pages to render (default: 20) */
  maxPages?: number;
}

// =============================================================================
// DOCUMENT RENDERER
// =============================================================================

export class DocumentRenderer {
  private dpi: number;
  private maxPages: number;

  constructor(options: RenderOptions = {}) {
    this.dpi = options.dpi || 200;
    this.maxPages = options.maxPages || 20;
  }

  /**
   * Render a document to page images.
   * Automatically detects document type from file extension.
   */
  async render(filepath: string): Promise<PageImage[]> {
    const ext = extname(filepath).toLowerCase();

    switch (ext) {
      case '.pdf':
        return this.renderPdf(filepath);
      case '.xlsx':
      case '.xls':
        return this.renderViaLibreOffice(filepath, 'excel');
      case '.docx':
        return this.renderViaLibreOffice(filepath, 'word');
      default:
        throw new Error(`Cannot render document type: ${ext}`);
    }
  }

  /**
   * Render PDF pages to PNG images using pdftoppm
   */
  private async renderPdf(filepath: string): Promise<PageImage[]> {
    const tempDir = join(tmpdir(), `doc-render-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const prefix = join(tempDir, 'page');

      // Render PDF pages as PNG using pdftoppm
      // -png: output PNG format
      // -r: DPI resolution
      // -l: last page to render (limits page count)
      const args = [
        '-png',
        '-r', String(this.dpi),
        '-l', String(this.maxPages),
        filepath,
        prefix,
      ];

      await execFileAsync('pdftoppm', args, { timeout: 120_000 });

      // Read generated PNG files (pdftoppm names them: page-01.png, page-02.png, ...)
      const files = await readdir(tempDir);
      const pngFiles = files
        .filter(f => f.endsWith('.png'))
        .sort(); // Sort to ensure correct page order

      const pages: PageImage[] = [];
      for (let i = 0; i < pngFiles.length; i++) {
        const data = await readFile(join(tempDir, pngFiles[i]));
        pages.push({
          page: i + 1,
          data,
        });
      }

      return pages;
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Render Excel/Word documents by first converting to PDF via LibreOffice,
   * then rendering the PDF pages to PNG.
   */
  private async renderViaLibreOffice(filepath: string, docType: 'excel' | 'word'): Promise<PageImage[]> {
    const tempDir = join(tmpdir(), `doc-render-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Step 1: Convert to PDF using LibreOffice headless
      const args = [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', tempDir,
        filepath,
      ];

      await execFileAsync('libreoffice', args, {
        timeout: 120_000,
        env: {
          ...process.env,
          // Use a unique user profile to avoid lock conflicts
          HOME: tempDir,
        },
      });

      // Find the generated PDF
      const files = await readdir(tempDir);
      const pdfFile = files.find(f => f.endsWith('.pdf'));

      if (!pdfFile) {
        throw new Error(`LibreOffice failed to convert ${docType} document to PDF`);
      }

      const pdfPath = join(tempDir, pdfFile);

      // Step 2: Render PDF pages to PNG
      return this.renderPdf(pdfPath);
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Check if the system has the required tools for document rendering
 */
export async function checkRenderingTools(): Promise<{
  pdftoppm: boolean;
  libreoffice: boolean;
}> {
  const check = async (cmd: string): Promise<boolean> => {
    try {
      await execFileAsync('which', [cmd]);
      return true;
    } catch {
      return false;
    }
  };

  return {
    pdftoppm: await check('pdftoppm'),
    libreoffice: await check('libreoffice'),
  };
}
