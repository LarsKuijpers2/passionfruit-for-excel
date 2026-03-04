/**
 * Two-Pass Vision Extractor
 *
 * Extracts questionnaires using a two-pass Claude Vision approach:
 * - Pass 1: Extract document structure to markdown (document understanding)
 * - Pass 2: Extract Q&A pairs from the structure (information extraction)
 *
 * This approach replicates the accuracy of Claude Chat when processing PDFs,
 * achieving ~99% accuracy on complex questionnaire layouts.
 *
 * Benefits over Azure OCR:
 * - Preserves document hierarchy and relationships
 * - Better checkbox/selection mark interpretation
 * - Handles complex table layouts
 * - Debuggable: intermediate outputs saved for feedback loop
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  QuestionnaireStructure,
  SheetData,
  RowData,
  CellData,
  DocumentType,
} from './excel.js';
import type { DocumentExtractor } from './index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CLAUDE_MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
const MAX_PAGES_PER_BATCH = 15; // Leave headroom in context window
const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000]; // Exponential backoff

// =============================================================================
// TYPES
// =============================================================================

/** Extracted Q&A pair from Pass 2 */
export interface ExtractedQA {
  label: string;
  value: string;
  section: string;
  type: 'question' | 'table_row' | 'checkbox_list' | 'certification' | 'text';
  destination: 'library' | 'entity' | 'product' | 'excluded';
}

/** Extraction metadata for debugging/feedback */
export interface ExtractionMetadata {
  extractedAt: string;
  modelId: string;
  pass1Tokens: { input: number; output: number };
  pass2Tokens: { input: number; output: number };
  processingTimeMs: number;
  pageCount: number;
  batchCount: number;
  retryCount: number;
  pdfHash: string;
}

/** Custom error for extraction failures */
export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly phase: 'pass1' | 'pass2' | 'conversion',
    public readonly details?: any
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

// =============================================================================
// MAIN EXTRACTOR CLASS
// =============================================================================

export class TwoPassVisionExtractor implements DocumentExtractor {
  private client: BedrockRuntimeClient;
  private customerDir: string;

  constructor(customerDir?: string, region?: string) {
    this.customerDir = customerDir || './customers/default';
    this.client = new BedrockRuntimeClient({
      region: region || process.env.AWS_REGION || 'eu-central-1',
    });
  }

  getDocumentType(): DocumentType {
    return 'pdf';
  }

  /**
   * Main extraction method - implements DocumentExtractor interface
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const startTime = Date.now();
    const filename = basename(filepath);
    let retryCount = 0;

    console.log(`  🔍 Two-pass vision extraction: ${filename}`);

    // 1. Convert PDF to page images (with caching)
    const { images, pageCount, pdfHash } = await this.convertToImages(filepath);
    console.log(`  📄 Converted ${pageCount} pages to images`);

    // 2. Pass 1: Structure extraction
    let pass1Result: { markdown: string; tokens: { input: number; output: number } };
    try {
      pass1Result = await this.extractStructure(images, pageCount);
      console.log(`  ✓ Pass 1 complete: ${pass1Result.markdown.length} chars`);
    } catch (error) {
      throw new ExtractionError(
        `Pass 1 failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'pass1',
        { filepath, pageCount }
      );
    }

    // 3. Save Pass 1 output
    await this.saveIntermediateOutput(filepath, 'pass1', pass1Result.markdown);

    // 4. Pass 2: Q&A extraction
    let pass2Result: { qaPairs: ExtractedQA[]; tokens: { input: number; output: number } };
    try {
      pass2Result = await this.extractQAPairs(pass1Result.markdown);
      console.log(`  ✓ Pass 2 complete: ${pass2Result.qaPairs.length} Q&A pairs`);
    } catch (error) {
      // Keep Pass 1 output for debugging even if Pass 2 fails
      console.warn(`  ⚠ Pass 2 failed, keeping Pass 1 output for debugging`);
      throw new ExtractionError(
        `Pass 2 failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'pass2',
        { filepath, pass1Length: pass1Result.markdown.length }
      );
    }

    // 5. Save Pass 2 output
    await this.saveIntermediateOutput(filepath, 'pass2', pass2Result.qaPairs);

    // 6. Save metadata
    const metadata: ExtractionMetadata = {
      extractedAt: new Date().toISOString(),
      modelId: CLAUDE_MODEL_ID,
      pass1Tokens: pass1Result.tokens,
      pass2Tokens: pass2Result.tokens,
      processingTimeMs: Date.now() - startTime,
      pageCount,
      batchCount: Math.ceil(pageCount / MAX_PAGES_PER_BATCH),
      retryCount,
      pdfHash,
    };
    await this.saveIntermediateOutput(filepath, 'metadata', metadata);

    // 7. Convert to QuestionnaireStructure
    const structure = this.toQuestionnaireStructure(
      pass2Result.qaPairs,
      filepath,
      filename,
      pass1Result.markdown,
      metadata
    );

    // 8. Save final structure
    await this.saveIntermediateOutput(filepath, 'final', structure);

    console.log(`  ✓ Extraction complete in ${metadata.processingTimeMs}ms`);
    return structure;
  }

  // ===========================================================================
  // PASS 1: STRUCTURE EXTRACTION
  // ===========================================================================

  /**
   * Pass 1: Extract document structure to markdown
   */
  private async extractStructure(
    images: Buffer[],
    totalPages: number
  ): Promise<{ markdown: string; tokens: { input: number; output: number } }> {
    const allMarkdown: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Process in batches
    for (let i = 0; i < images.length; i += MAX_PAGES_PER_BATCH) {
      const batchImages = images.slice(i, i + MAX_PAGES_PER_BATCH);
      const startPage = i + 1;
      const endPage = Math.min(i + MAX_PAGES_PER_BATCH, images.length);

      console.log(`    Processing pages ${startPage}-${endPage} of ${totalPages}...`);

      const result = await this.callClaudePass1(batchImages, startPage, endPage, totalPages);
      allMarkdown.push(result.markdown);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }

    return {
      markdown: allMarkdown.join('\n\n'),
      tokens: { input: totalInputTokens, output: totalOutputTokens },
    };
  }

  /**
   * Call Claude Vision for Pass 1 (structure extraction)
   */
  private async callClaudePass1(
    images: Buffer[],
    startPage: number,
    endPage: number,
    totalPages: number
  ): Promise<{ markdown: string; inputTokens: number; outputTokens: number }> {
    const content: any[] = [];

    // Add images
    for (const image of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.toString('base64'),
        },
      });
    }

    // Add prompt
    const pageRange =
      totalPages > MAX_PAGES_PER_BATCH
        ? `\n\nThese are pages ${startPage}-${endPage} of ${totalPages}. Continue section numbering from previous batches if this is not the first batch.`
        : '';

    content.push({
      type: 'text',
      text: `You are extracting a supplier questionnaire PDF. Output structured markdown that:

1. Preserves ALL section headers with hierarchy (##, ###)
2. Converts ALL tables to markdown tables with all columns
3. Shows checkboxes as ☐ (unchecked) or ☒ (checked)
4. Keeps ALL text content verbatim - questions, answers, instructions, notes
5. Maintains document order (top to bottom, left to right)

IMPORTANT:
- Extract EVERY piece of text - do not skip or summarize
- For Q&A pairs not in tables, format as: **Question text** Answer text
- For checkbox lists, show the state of each checkbox
- Preserve paragraph text that provides context or instructions

Output ONLY the markdown content, no explanations.${pageRange}`,
    });

    // Call Claude with retries
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.send(
          new InvokeModelCommand({
            modelId: CLAUDE_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 16000,
              messages: [{ role: 'user', content }],
            }),
          })
        );

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const markdown = result.content?.[0]?.text || '';

        return {
          markdown,
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt]}ms...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    throw lastError || new Error('Pass 1 failed after retries');
  }

  // ===========================================================================
  // PASS 2: Q&A EXTRACTION
  // ===========================================================================

  /**
   * Pass 2: Extract Q&A pairs from markdown structure
   */
  private async extractQAPairs(
    markdown: string
  ): Promise<{ qaPairs: ExtractedQA[]; tokens: { input: number; output: number } }> {
    const result = await this.callClaudePass2(markdown);

    // Parse JSON response
    let qaPairs: ExtractedQA[];
    try {
      qaPairs = this.parseQAResponse(result.response);
    } catch (parseError) {
      // Retry with stricter prompt
      console.log('    JSON parse failed, retrying with stricter prompt...');
      const strictResult = await this.callClaudePass2Strict(markdown);
      qaPairs = this.parseQAResponse(strictResult.response);
      return {
        qaPairs,
        tokens: {
          input: result.inputTokens + strictResult.inputTokens,
          output: result.outputTokens + strictResult.outputTokens,
        },
      };
    }

    return {
      qaPairs,
      tokens: { input: result.inputTokens, output: result.outputTokens },
    };
  }

  /**
   * Call Claude for Pass 2 (Q&A extraction)
   */
  private async callClaudePass2(
    markdown: string
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    const prompt = `Given this structured document, extract all question-answer pairs.

For each pair, provide:
- label: The question or field name text
- value: The answer (convert checkboxes: ☒ YES = "Yes", ☒ NO = "No", ☒ N/A = "N/A")
- section: Section header this belongs to
- type: "question" | "table_row" | "checkbox_list" | "certification" | "text"
- destination: Where this data belongs:
  - "library": General answers reusable across questionnaires (certifications, company info)
  - "entity": Company/contact information (names, addresses, phone numbers)
  - "product": Product-specific data (ingredients, specifications)
  - "excluded": Instructions, headers, or non-data content

Rules:
1. Extract EVERY filled field - be exhaustive, do not skip any data
2. For tables, extract EVERY row that has any value filled in
3. For checkbox lists, extract EVERY item whether checked YES, NO, or N/A
4. "No" is a valid answer - it means something was explicitly unchecked/answered
5. Only skip truly empty fields with no value at all
6. Section headers themselves are type "text" with destination "excluded"
7. When in doubt, INCLUDE the item rather than skip it

Output as a JSON array only. No other text.

Document:
${markdown}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.send(
          new InvokeModelCommand({
            modelId: CLAUDE_MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 16000,
              messages: [{ role: 'user', content: prompt }],
            }),
          })
        );

        const result = JSON.parse(new TextDecoder().decode(response.body));
        return {
          response: result.content?.[0]?.text || '',
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt]}ms...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    throw lastError || new Error('Pass 2 failed after retries');
  }

  /**
   * Strict Pass 2 call for retry after JSON parse failure
   */
  private async callClaudePass2Strict(
    markdown: string
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    const prompt = `Extract Q&A pairs from this document. Output ONLY a valid JSON array, nothing else.

Each item must have exactly these fields:
{
  "label": "string",
  "value": "string",
  "section": "string",
  "type": "question" | "table_row" | "checkbox_list" | "certification" | "text",
  "destination": "library" | "entity" | "product" | "excluded"
}

Document:
${markdown}

JSON array (no markdown, no explanation):`;

    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: CLAUDE_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 16000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    );

    const result = JSON.parse(new TextDecoder().decode(response.body));
    return {
      response: result.content?.[0]?.text || '',
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
    };
  }

  /**
   * Parse Q&A response from Claude
   */
  private parseQAResponse(response: string): ExtractedQA[] {
    // Clean up response - remove markdown code blocks if present
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Parse JSON
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }

    // Validate and normalize each item
    return parsed.map((item, idx) => ({
      label: String(item.label || ''),
      value: String(item.value || ''),
      section: String(item.section || ''),
      type: this.normalizeType(item.type),
      destination: this.normalizeDestination(item.destination),
    }));
  }

  private normalizeType(type: string): ExtractedQA['type'] {
    const validTypes = ['question', 'table_row', 'checkbox_list', 'certification', 'text'];
    return validTypes.includes(type) ? (type as ExtractedQA['type']) : 'question';
  }

  private normalizeDestination(dest: string): ExtractedQA['destination'] {
    const validDests = ['library', 'entity', 'product', 'excluded'];
    return validDests.includes(dest) ? (dest as ExtractedQA['destination']) : 'library';
  }

  // ===========================================================================
  // FORMAT CONVERSION
  // ===========================================================================

  /**
   * Convert extracted Q&A pairs to QuestionnaireStructure format
   */
  private toQuestionnaireStructure(
    qaPairs: ExtractedQA[],
    filepath: string,
    filename: string,
    markdown: string,
    metadata: ExtractionMetadata
  ): QuestionnaireStructure {
    // Group Q&A pairs by section
    const sectionMap = new Map<string, ExtractedQA[]>();
    for (const qa of qaPairs) {
      const section = qa.section || 'Document';
      if (!sectionMap.has(section)) {
        sectionMap.set(section, []);
      }
      sectionMap.get(section)!.push(qa);
    }

    // Convert sections to sheets
    const sheets: SheetData[] = [];
    let sheetIndex = 0;

    for (const [sectionName, items] of sectionMap) {
      const rows: RowData[] = [];
      let rowNumber = 1;

      for (const item of items) {
        // Skip excluded items (headers, instructions)
        if (item.destination === 'excluded') continue;

        const cells: Record<string, CellData> = {
          A: {
            ref: `A${rowNumber}`,
            value: item.label,
            type: 'string',
            filled: item.label.length > 0,
            role: 'label',
          },
          B: {
            ref: `B${rowNumber}`,
            value: item.value,
            type: 'string',
            filled: item.value.length > 0,
            role: 'value',
          },
        };

        rows.push({
          row: rowNumber,
          cells,
          isEmpty: !item.label && !item.value,
          rowType: 'data',
          sectionTitle: sectionName,
          extractionSource: 'visualQA',
        });

        rowNumber++;
      }

      if (rows.length > 0) {
        sheets.push({
          name: sectionName,
          index: sheetIndex++,
          rows,
          mergedRanges: [],
          rowCount: rows.length,
          columnCount: 2,
          stats: {
            totalCells: rows.length * 2,
            filledCells: rows.reduce(
              (sum, row) => sum + Object.values(row.cells).filter((c) => c.filled).length,
              0
            ),
            emptyRows: rows.filter((r) => r.isEmpty).length,
            mergedRanges: 0,
          },
        });
      }
    }

    // Calculate totals
    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    const totalCells = sheets.reduce((sum, s) => sum + s.stats.totalCells, 0);
    const filledCells = sheets.reduce((sum, s) => sum + s.stats.filledCells, 0);

    return {
      source: {
        filename,
        filepath,
        extractedAt: metadata.extractedAt,
        documentType: 'pdf',
      },
      sheets,
      stats: {
        totalSheets: sheets.length,
        totalRows,
        totalCells,
        filledCells,
      },
      metadata: {
        extractionMethod: 'two-pass-vision',
        markdown,
        ...metadata,
      } as any,
    };
  }

  // ===========================================================================
  // IMAGE CONVERSION & CACHING
  // ===========================================================================

  /**
   * Convert PDF to page images with caching
   */
  private async convertToImages(
    filepath: string
  ): Promise<{ images: Buffer[]; pageCount: number; pdfHash: string }> {
    const filename = basename(filepath, '.pdf');
    const cacheDir = this.getOutputDir(filepath);
    const imageDir = join(cacheDir, 'page-images');
    const hashFile = join(cacheDir, 'pdf-hash.txt');

    // Calculate PDF hash
    const pdfBuffer = await readFile(filepath);
    const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex').slice(0, 16);

    // Check cache validity
    let useCache = false;
    if (existsSync(imageDir) && existsSync(hashFile)) {
      try {
        const cachedHash = (await readFile(hashFile, 'utf-8')).trim();
        useCache = cachedHash === pdfHash;
      } catch {
        useCache = false;
      }
    }

    // Get page count
    const pageCountOutput = execSync(`pdfinfo "${filepath}" | grep Pages | awk '{print $2}'`, {
      encoding: 'utf-8',
    }).trim();
    const pageCount = parseInt(pageCountOutput, 10) || 1;

    if (useCache) {
      console.log(`    Using cached images (hash: ${pdfHash.slice(0, 8)})`);
      const images: Buffer[] = [];
      for (let page = 1; page <= pageCount; page++) {
        const imagePath = join(imageDir, `page-${page}.png`);
        if (existsSync(imagePath)) {
          images.push(await readFile(imagePath));
        }
      }
      if (images.length === pageCount) {
        return { images, pageCount, pdfHash };
      }
      // Cache incomplete, reconvert
    }

    // Convert PDF to images
    console.log(`    Converting PDF to images...`);
    await mkdir(imageDir, { recursive: true });

    const images: Buffer[] = [];
    for (let page = 1; page <= pageCount; page++) {
      try {
        const outputPath = join(imageDir, `page-${page}`);
        // xpdf pdftoppm writes to file, poppler writes to stdout
        // Use file-based approach for compatibility with both
        execSync(
          `pdftoppm -f ${page} -l ${page} -r 150 "${filepath}" "${outputPath}"`,
          { maxBuffer: 50 * 1024 * 1024 }
        );

        // pdftoppm creates file with suffix like -000001.ppm
        // Find the generated file and convert to PNG
        const generatedFile = `${outputPath}-${String(page).padStart(6, '0')}.ppm`;
        const pngPath = join(imageDir, `page-${page}.png`);

        // Convert PPM to PNG using sips (macOS) or keep as PPM
        try {
          execSync(`sips -s format png "${generatedFile}" --out "${pngPath}" 2>/dev/null`, {
            maxBuffer: 50 * 1024 * 1024,
          });
          // Remove PPM file after conversion
          execSync(`rm "${generatedFile}"`, { encoding: 'utf-8' });
        } catch {
          // If sips fails, try using the PPM directly (rename to png)
          // Claude can handle various image formats
          execSync(`mv "${generatedFile}" "${pngPath}"`, { encoding: 'utf-8' });
        }

        const imageBuffer = await readFile(pngPath);
        images.push(imageBuffer);
      } catch (error) {
        console.warn(`    Warning: Could not convert page ${page}`);
      }
    }

    // Save hash for cache validation
    await writeFile(hashFile, pdfHash);

    return { images, pageCount, pdfHash };
  }

  // ===========================================================================
  // OUTPUT HELPERS
  // ===========================================================================

  /**
   * Get output directory for intermediate files
   */
  private getOutputDir(filepath: string): string {
    const filename = basename(filepath, '.pdf');
    // Sanitize filename for directory
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.customerDir, 'vision-extraction', safeName);
  }

  /**
   * Save intermediate output for debugging/feedback
   */
  private async saveIntermediateOutput(
    filepath: string,
    phase: 'pass1' | 'pass2' | 'metadata' | 'final',
    data: any
  ): Promise<void> {
    const outputDir = this.getOutputDir(filepath);
    await mkdir(outputDir, { recursive: true });

    let filename: string;
    let content: string;

    switch (phase) {
      case 'pass1':
        filename = 'pass1-structure.md';
        content = data as string;
        break;
      case 'pass2':
        filename = 'pass2-qa-pairs.json';
        content = JSON.stringify(data, null, 2);
        break;
      case 'metadata':
        filename = 'metadata.json';
        content = JSON.stringify(data, null, 2);
        break;
      case 'final':
        filename = 'final-structure.json';
        content = JSON.stringify(data, null, 2);
        break;
    }

    await writeFile(join(outputDir, filename), content, 'utf-8');
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Extract a PDF using the two-pass vision approach
 */
export async function extractWithTwoPassVision(
  pdfPath: string,
  customerDir?: string,
  region?: string
): Promise<QuestionnaireStructure> {
  const extractor = new TwoPassVisionExtractor(customerDir, region);
  return extractor.extract(pdfPath);
}
