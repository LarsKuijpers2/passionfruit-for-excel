/**
 * Vision Extractor - Two-Phase Approach
 *
 * Phase 1: STRUCTURE DISCOVERY
 *   - Send all page images to Claude Vision
 *   - Identify sections and their page ranges
 *   - Detect multi-page tables
 *
 * Phase 2: Q&A EXTRACTION (per section)
 *   - For each section, send only its pages
 *   - Extract Q&A pairs directly from images
 *   - Full table context preserved for multi-page tables
 *
 * This approach ensures:
 * - Multi-page tables are processed together
 * - Section context is maintained
 * - Direct image-to-QA for maximum accuracy
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
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
const MAX_PAGES_PER_BATCH = 20; // For structure discovery
const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000];

// AWS Bedrock pricing per million tokens (varies by model)
const BEDROCK_PRICING: Record<string, { input: number; output: number }> = {
  'sonnet': { input: 3.00, output: 15.00 },   // Claude Sonnet
  'opus': { input: 15.00, output: 75.00 },    // Claude Opus
  'haiku': { input: 0.25, output: 1.25 },     // Claude Haiku
};

/** Calculate cost in USD from token counts */
function calculateCost(inputTokens: number, outputTokens: number, modelId: string): number {
  // Detect model type from model ID
  const modelType = modelId.toLowerCase().includes('opus') ? 'opus'
    : modelId.toLowerCase().includes('haiku') ? 'haiku'
    : 'sonnet';
  const pricing = BEDROCK_PRICING[modelType];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// =============================================================================
// TYPES
// =============================================================================

/** Section identified in Phase 1 */
export interface IdentifiedSection {
  title: string;
  pages: number[]; // Page numbers (1-indexed)
  type: 'form' | 'table' | 'checklist' | 'text' | 'mixed';
  description?: string;
}

/** Q&A pair extracted in Phase 2 */
export interface ExtractedQA {
  question: string;           // Fully self-explanatory question
  answer: string;
  section: string;
  page: number;
  confidence: number;
  type: 'field' | 'table_cell' | 'checkbox' | 'text';
  originalLabel?: string;     // The raw label as it appears in the document
}

/** Extraction result with all data */
export interface VisionExtractionResult {
  sections: IdentifiedSection[];
  qaPairs: ExtractedQA[];
  metadata: {
    extractedAt: string;
    modelId: string;
    pageCount: number;
    phase1Tokens: { input: number; output: number };
    phase2Tokens: { input: number; output: number };
    processingTimeMs: number;
    pdfHash: string;
  };
}

// =============================================================================
// MAIN EXTRACTOR CLASS
// =============================================================================

export class VisionExtractor implements DocumentExtractor {
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
   * Main extraction method
   */
  async extract(filepath: string): Promise<QuestionnaireStructure> {
    const result = await this.extractWithVision(filepath);
    return this.toQuestionnaireStructure(result, filepath);
  }

  /**
   * Full extraction with both phases
   */
  async extractWithVision(filepath: string): Promise<VisionExtractionResult> {
    const startTime = Date.now();
    const filename = basename(filepath);

    console.log(`  🔍 Vision extraction: ${filename}`);

    // 1. Convert PDF to page images
    const { images, pageCount, pdfHash } = await this.convertToImages(filepath);
    console.log(`  📄 Converted ${pageCount} pages to images`);

    // 2. Phase 1: Structure Discovery
    console.log(`  📋 Phase 1: Discovering document structure...`);
    const phase1Result = await this.discoverStructure(images, pageCount);
    console.log(`  ✓ Found ${phase1Result.sections.length} sections`);

    // Save Phase 1 output
    await this.saveOutput(filepath, 'phase1-sections.json', phase1Result.sections);

    // 3. Phase 2: Q&A Extraction per section
    console.log(`  📝 Phase 2: Extracting Q&A pairs...`);
    const phase2Result = await this.extractQAPerSection(images, phase1Result.sections);
    console.log(`  ✓ Extracted ${phase2Result.qaPairs.length} Q&A pairs`);

    // Save Phase 2 output
    await this.saveOutput(filepath, 'phase2-qa-pairs.json', phase2Result.qaPairs);

    // 4. Build final result
    const totalInputTokens = phase1Result.tokens.input + phase2Result.tokens.input;
    const totalOutputTokens = phase1Result.tokens.output + phase2Result.tokens.output;
    const costUSD = calculateCost(totalInputTokens, totalOutputTokens, CLAUDE_MODEL_ID);

    const result: VisionExtractionResult = {
      sections: phase1Result.sections,
      qaPairs: phase2Result.qaPairs,
      metadata: {
        extractedAt: new Date().toISOString(),
        modelId: CLAUDE_MODEL_ID,
        pageCount,
        phase1Tokens: phase1Result.tokens,
        phase2Tokens: phase2Result.tokens,
        totalTokens: { input: totalInputTokens, output: totalOutputTokens },
        costUSD,
        processingTimeMs: Date.now() - startTime,
        pdfHash,
      },
    };

    // Save metadata
    await this.saveOutput(filepath, 'metadata.json', result.metadata);

    console.log(`  ✓ Extraction complete in ${result.metadata.processingTimeMs}ms`);
    console.log(`  💰 Cost: $${costUSD.toFixed(4)} (${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out tokens)`);
    return result;
  }

  // ===========================================================================
  // PHASE 1: STRUCTURE DISCOVERY
  // ===========================================================================

  private async discoverStructure(
    images: Buffer[],
    pageCount: number
  ): Promise<{ sections: IdentifiedSection[]; tokens: { input: number; output: number } }> {

    // For large documents, process in batches but ask for global structure
    const allSections: IdentifiedSection[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Send all pages (in batches if needed) to discover structure
    for (let i = 0; i < images.length; i += MAX_PAGES_PER_BATCH) {
      const batchImages = images.slice(i, i + MAX_PAGES_PER_BATCH);
      const startPage = i + 1;
      const endPage = Math.min(i + MAX_PAGES_PER_BATCH, images.length);
      const isFirstBatch = i === 0;
      const isLastBatch = endPage >= images.length;

      console.log(`    Analyzing pages ${startPage}-${endPage}...`);

      const result = await this.callPhase1(
        batchImages,
        startPage,
        endPage,
        pageCount,
        isFirstBatch,
        isLastBatch
      );

      allSections.push(...result.sections);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }

    // Merge and deduplicate sections from batches
    const mergedSections = this.mergeSections(allSections);

    return {
      sections: mergedSections,
      tokens: { input: totalInputTokens, output: totalOutputTokens },
    };
  }

  private async callPhase1(
    images: Buffer[],
    startPage: number,
    endPage: number,
    totalPages: number,
    isFirstBatch: boolean,
    isLastBatch: boolean
  ): Promise<{ sections: IdentifiedSection[]; inputTokens: number; outputTokens: number }> {

    const content: any[] = [];

    // Add images with page numbers
    images.forEach((image, idx) => {
      content.push({
        type: 'text',
        text: `--- Page ${startPage + idx} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.toString('base64'),
        },
      });
    });

    // Add prompt
    const batchContext = totalPages > MAX_PAGES_PER_BATCH
      ? `\n\nYou are viewing pages ${startPage}-${endPage} of ${totalPages} total pages.`
      : '';

    content.push({
      type: 'text',
      text: `Analyze this questionnaire document and identify all distinct sections.${batchContext}

For each section, provide:
- title: The section header/name
- pages: Array of page numbers where this section appears (can span multiple pages)
- type: "form" | "table" | "checklist" | "text" | "mixed"
- description: Brief description of what data this section contains

IMPORTANT:
- Tables that span multiple pages should be ONE section with all page numbers
- Look for visual boundaries: headers, lines, spacing changes
- Include ALL sections, even small ones
- Page numbers are ${startPage}-${endPage} for these images

Output ONLY valid JSON array:
[
  {
    "title": "Section Name",
    "pages": [1, 2],
    "type": "table",
    "description": "Allergen information with checkboxes"
  }
]`,
    });

    // Call Claude
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
              max_tokens: 4000,
              messages: [{ role: 'user', content }],
            }),
          })
        );

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const responseText = result.content?.[0]?.text || '[]';
        const sections = this.parseJsonResponse<IdentifiedSection[]>(responseText, []);

        return {
          sections,
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    throw lastError || new Error('Phase 1 failed');
  }

  private mergeSections(sections: IdentifiedSection[]): IdentifiedSection[] {
    // Group by similar titles
    const titleMap = new Map<string, IdentifiedSection>();

    for (const section of sections) {
      const normalizedTitle = section.title.toLowerCase().trim();

      if (titleMap.has(normalizedTitle)) {
        // Merge pages
        const existing = titleMap.get(normalizedTitle)!;
        const allPages = new Set([...existing.pages, ...section.pages]);
        existing.pages = Array.from(allPages).sort((a, b) => a - b);
      } else {
        titleMap.set(normalizedTitle, { ...section });
      }
    }

    return Array.from(titleMap.values());
  }

  // ===========================================================================
  // PHASE 2: Q&A EXTRACTION PER SECTION
  // ===========================================================================

  private async extractQAPerSection(
    images: Buffer[],
    sections: IdentifiedSection[]
  ): Promise<{ qaPairs: ExtractedQA[]; tokens: { input: number; output: number } }> {

    const allQAPairs: ExtractedQA[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const section of sections) {
      console.log(`    Processing section: ${section.title} (pages ${section.pages.join(', ')})`);

      // Get images for this section's pages
      const sectionImages = section.pages.map(pageNum => images[pageNum - 1]).filter(Boolean);

      if (sectionImages.length === 0) {
        console.log(`    ⚠ No images found for section pages`);
        continue;
      }

      const result = await this.callPhase2(sectionImages, section);
      allQAPairs.push(...result.qaPairs);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }

    return {
      qaPairs: allQAPairs,
      tokens: { input: totalInputTokens, output: totalOutputTokens },
    };
  }

  private async callPhase2(
    images: Buffer[],
    section: IdentifiedSection
  ): Promise<{ qaPairs: ExtractedQA[]; inputTokens: number; outputTokens: number }> {

    const content: any[] = [];

    // Add section context
    content.push({
      type: 'text',
      text: `Section: "${section.title}" (${section.type})
${section.description ? `Description: ${section.description}` : ''}
Pages: ${section.pages.join(', ')}

Below are the page images for this section:`,
    });

    // Add images
    images.forEach((image, idx) => {
      content.push({
        type: 'text',
        text: `--- Page ${section.pages[idx]} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.toString('base64'),
        },
      });
    });

    // Add extraction prompt based on section type
    const typeSpecificGuidance = this.getTypeSpecificGuidance(section.type);

    content.push({
      type: 'text',
      text: `Extract ALL question-answer pairs from this section.

${typeSpecificGuidance}

For EACH piece of data, provide:
- question: A FULLY SELF-EXPLANATORY question that someone could understand without seeing the document
- answer: The filled-in value (what was answered)
- section: "${section.title}"
- page: Page number where this appears
- confidence: 0.0-1.0 how confident you are
- type: "field" | "table_cell" | "checkbox" | "text"
- originalLabel: The exact raw label/text as it appears in the document (for reference)

CRITICAL - QUESTION FORMATTING:
The "question" field must be a COMPLETE, SELF-EXPLANATORY question. Transform raw labels into proper questions.

Examples of GOOD questions:
- Raw label "Product name supplier" → question: "What is the product name from the supplier?"
- Raw table cell with row "Cows Milk" and column "% in final product" → question: "What percentage of the final product is Cows Milk?"
- Raw label "Tel." under "Production site" → question: "What is the telephone number of the production site?"
- Raw checkbox "Gluten" under "Present as ingredient?" → question: "Is Gluten present as an ingredient in this product?"
- Raw label "Taste - Appearance/Description" → question: "What is the taste appearance or description of the product?"
- Raw label "GFSI Certification production" → question: "Does the production site have GFSI certification?"

Examples of BAD questions (DO NOT do this):
- "Cows Milk - % in final product" (just concatenated, not a real question)
- "Tel. - Production site" (not self-explanatory)
- "Present?" (missing context)
- "Gluten" (not a question at all)

RULES:
1. Extract EVERY filled field - do not skip anything
2. ALWAYS transform raw labels into proper, complete questions
3. For table cells: combine row label, column header, and table context into one clear question
4. For checkboxes: answer is "Yes", "No", or "N/A" based on which is checked
5. Empty/unfilled fields can be skipped EXCEPT for allergen/ingredient tables
6. If a table spans multiple pages, you see ALL pages - extract completely
7. ALLERGEN TABLES ARE CRITICAL: Extract EVERY ROW even if answer is "No"

Output ONLY valid JSON array of Q&A pairs:`,
    });

    // Call Claude
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
        const responseText = result.content?.[0]?.text || '[]';
        const qaPairs = this.parseJsonResponse<ExtractedQA[]>(responseText, []);

        // Ensure section name is set
        qaPairs.forEach(qa => {
          qa.section = section.title;
        });

        return {
          qaPairs,
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    throw lastError || new Error(`Phase 2 failed for section: ${section.title}`);
  }

  private getTypeSpecificGuidance(type: IdentifiedSection['type']): string {
    switch (type) {
      case 'table':
        return `This is a TABLE section. Pay special attention to:
- Column headers (may span multiple columns)
- Row labels (often in first column)
- Nested headers (e.g., "Company Head Office" > "Name", "Address")
- Checkbox columns (YES/NO patterns)
- Multi-page table continuation`;

      case 'checklist':
        return `This is a CHECKLIST section. Pay special attention to:
- Checkbox states: ☒ (checked) vs ☐ (unchecked)
- The label next to each checkbox
- Groupings of related checkboxes
- For allergen checklists: extract EVERY allergen row, even if "No" is checked
- Both columns matter: "Present as ingredient?" AND "Cross-contamination possible?"`;

      case 'form':
        return `This is a FORM section. Pay special attention to:
- Field labels and their corresponding filled values
- Required vs optional fields
- Grouped fields (e.g., address components)`;

      case 'text':
        return `This is a TEXT section. Extract:
- Any embedded Q&A patterns (Question: ... Answer: ...)
- Key information that could be answers to implicit questions`;

      default:
        return `This section contains mixed content. Extract all Q&A patterns you can identify.`;
    }
  }

  // ===========================================================================
  // CONVERSION TO QUESTIONNAIRE STRUCTURE
  // ===========================================================================

  private toQuestionnaireStructure(
    result: VisionExtractionResult,
    filepath: string
  ): QuestionnaireStructure {
    const filename = basename(filepath);

    // Group Q&A pairs by section
    const sectionMap = new Map<string, ExtractedQA[]>();
    for (const qa of result.qaPairs) {
      const section = qa.section || 'Document';
      if (!sectionMap.has(section)) {
        sectionMap.set(section, []);
      }
      sectionMap.get(section)!.push(qa);
    }

    // Convert to sheets
    const sheets: SheetData[] = [];
    let sheetIndex = 0;

    for (const [sectionName, qaPairs] of sectionMap) {
      const rows: RowData[] = [];
      let rowNumber = 1;

      for (const qa of qaPairs) {
        // Use the fully self-explanatory question directly (Claude generates it)
        const fullQuestion = qa.question;

        const cells: Record<string, CellData> = {
          A: {
            ref: `A${rowNumber}`,
            value: fullQuestion,
            type: 'string',
            filled: fullQuestion.length > 0,
            role: 'label',
            pageNumber: qa.page,
            originalLabel: qa.originalLabel, // Store the raw label for reference
          } as CellData,
          B: {
            ref: `B${rowNumber}`,
            value: qa.answer,
            type: 'string',
            filled: qa.answer.length > 0,
            role: 'value',
            pageNumber: qa.page,
          },
        };

        rows.push({
          row: rowNumber,
          cells,
          isEmpty: !qa.question && !qa.answer,
          rowType: 'data',
          sectionTitle: sectionName,
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
              (sum, row) => sum + Object.values(row.cells).filter(c => c.filled).length,
              0
            ),
            emptyRows: rows.filter(r => r.isEmpty).length,
            mergedRanges: 0,
          },
        });
      }
    }

    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    const totalCells = sheets.reduce((sum, s) => sum + s.stats.totalCells, 0);
    const filledCells = sheets.reduce((sum, s) => sum + s.stats.filledCells, 0);

    return {
      source: {
        filename,
        filepath,
        extractedAt: result.metadata.extractedAt,
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
        extractionMethod: 'vision-two-phase',
        ...result.metadata,
      } as any,
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private parseJsonResponse<T>(response: string, fallback: T): T {
    let jsonStr = response.trim();

    // Remove markdown code blocks
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch {
      console.warn('    ⚠ JSON parse failed, using fallback');
      return fallback;
    }
  }

  private async convertToImages(
    filepath: string
  ): Promise<{ images: Buffer[]; pageCount: number; pdfHash: string }> {
    const cacheDir = this.getOutputDir(filepath);
    const imageDir = join(cacheDir, 'page-images');
    const hashFile = join(cacheDir, 'pdf-hash.txt');

    // Calculate PDF hash
    const pdfBuffer = await readFile(filepath);
    const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex').slice(0, 16);

    // Check cache
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
    }

    // Convert PDF to images
    console.log(`    Converting PDF to images...`);
    await mkdir(imageDir, { recursive: true });

    const images: Buffer[] = [];
    for (let page = 1; page <= pageCount; page++) {
      try {
        const outputPath = join(imageDir, `page-${page}`);
        // xpdf pdftoppm doesn't support -png, outputs PPM instead
        execSync(
          `pdftoppm -f ${page} -l ${page} -r 150 "${filepath}" "${outputPath}"`,
          { maxBuffer: 50 * 1024 * 1024 }
        );

        // pdftoppm creates file with suffix like -000001.ppm
        const generatedFile = `${outputPath}-${String(page).padStart(6, '0')}.ppm`;
        const pngPath = join(imageDir, `page-${page}.png`);

        // Convert PPM to PNG using sips (macOS)
        try {
          execSync(`sips -s format png "${generatedFile}" --out "${pngPath}" 2>/dev/null`, {
            maxBuffer: 50 * 1024 * 1024,
          });
          // Remove PPM file after conversion
          execSync(`rm "${generatedFile}"`, { encoding: 'utf-8' });
        } catch {
          // If sips fails, rename PPM to png (Claude can handle various formats)
          execSync(`mv "${generatedFile}" "${pngPath}"`, { encoding: 'utf-8' });
        }

        if (existsSync(pngPath)) {
          images.push(await readFile(pngPath));
        }
      } catch (error) {
        console.warn(`    Warning: Could not convert page ${page}`);
      }
    }

    // Save hash
    await writeFile(hashFile, pdfHash);

    return { images, pageCount, pdfHash };
  }

  private getOutputDir(filepath: string): string {
    const filename = basename(filepath, '.pdf');
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.customerDir, 'vision-extraction', safeName);
  }

  private async saveOutput(filepath: string, filename: string, data: any): Promise<void> {
    const outputDir = this.getOutputDir(filepath);
    await mkdir(outputDir, { recursive: true });
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await writeFile(join(outputDir, filename), content, 'utf-8');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CONVENIENCE EXPORT
// =============================================================================

export async function extractWithVision(
  pdfPath: string,
  customerDir?: string,
  region?: string
): Promise<VisionExtractionResult> {
  const extractor = new VisionExtractor(customerDir, region);
  return extractor.extractWithVision(pdfPath);
}
