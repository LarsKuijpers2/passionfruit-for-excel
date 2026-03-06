/**
 * Region Vision Extractor
 *
 * Extracts Q&A pairs from a specific region of a PDF page using Claude Vision.
 * Used for the Vision Fix feature - allows users to select a region and have
 * Claude extract the missing/incorrect content.
 */

import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CLAUDE_MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000];

// =============================================================================
// TYPES
// =============================================================================

export interface RegionCoordinates {
  x: number;      // Normalized 0-1 (left edge)
  y: number;      // Normalized 0-1 (top edge)
  width: number;  // Normalized 0-1
  height: number; // Normalized 0-1
}

export interface ExtractedItem {
  id: string;
  label: string;
  value: string;
  type: 'field' | 'table_row' | 'checkbox' | 'text';
  destination: 'library' | 'entity' | 'product' | 'excluded';
  section?: string;
  confidence?: number;
}

export interface VisionFixResult {
  success: boolean;
  items: ExtractedItem[];
  debugInfo: {
    imageSize: { width: number; height: number };
    croppedSize: { width: number; height: number };
    tokensUsed: { input: number; output: number };
    processingTimeMs: number;
  };
  error?: string;
}

// =============================================================================
// MAIN EXTRACTOR CLASS
// =============================================================================

export class RegionVisionExtractor {
  private client: BedrockRuntimeClient;

  constructor(region?: string) {
    this.client = new BedrockRuntimeClient({
      region: region || process.env.AWS_REGION || 'eu-central-1',
    });
  }

  /**
   * Extract Q&A pairs from a specific region of a PDF page
   */
  async extractRegion(
    pdfPath: string,
    pageNumber: number,
    region: RegionCoordinates,
    instructions: string
  ): Promise<VisionFixResult> {
    const startTime = Date.now();

    try {
      // 1. Convert the specific page to an image
      console.log(`  📄 Converting page ${pageNumber} to image...`);
      const pageImage = await this.convertPageToImage(pdfPath, pageNumber);

      // 2. Get image dimensions
      const metadata = await sharp(pageImage).metadata();
      const imageWidth = metadata.width || 1000;
      const imageHeight = metadata.height || 1000;

      // 3. Crop to the selected region
      console.log(`  ✂️ Cropping to region...`);
      const croppedImage = await this.cropRegion(pageImage, region, imageWidth, imageHeight);
      const croppedMetadata = await sharp(croppedImage).metadata();

      // 4. Send to Claude Vision
      console.log(`  🔍 Sending to Claude Vision...`);
      const { items, tokens } = await this.callClaudeVision(croppedImage, instructions);

      const processingTimeMs = Date.now() - startTime;
      console.log(`  ✓ Extracted ${items.length} items in ${processingTimeMs}ms`);

      return {
        success: true,
        items,
        debugInfo: {
          imageSize: { width: imageWidth, height: imageHeight },
          croppedSize: {
            width: croppedMetadata.width || 0,
            height: croppedMetadata.height || 0
          },
          tokensUsed: tokens,
          processingTimeMs,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ✗ Vision fix failed: ${errorMessage}`);
      return {
        success: false,
        items: [],
        debugInfo: {
          imageSize: { width: 0, height: 0 },
          croppedSize: { width: 0, height: 0 },
          tokensUsed: { input: 0, output: 0 },
          processingTimeMs: Date.now() - startTime,
        },
        error: errorMessage,
      };
    }
  }

  /**
   * Convert a specific PDF page to a PNG image
   */
  private async convertPageToImage(pdfPath: string, pageNumber: number): Promise<Buffer> {
    const tempDir = '/tmp/vision-fix';
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const outputBase = join(tempDir, `page-${Date.now()}`);

    // Use pdftoppm to convert the specific page (150 DPI for good quality)
    execSync(
      `pdftoppm -f ${pageNumber} -l ${pageNumber} -r 150 "${pdfPath}" "${outputBase}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    // pdftoppm creates file with suffix like -000001.ppm
    const ppmPath = `${outputBase}-${String(pageNumber).padStart(6, '0')}.ppm`;
    const pngPath = `${outputBase}.png`;

    // Convert PPM to PNG using sips (macOS) or ImageMagick
    try {
      execSync(`sips -s format png "${ppmPath}" --out "${pngPath}" 2>/dev/null`, {
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch {
      // Fallback: try convert (ImageMagick)
      try {
        execSync(`convert "${ppmPath}" "${pngPath}"`, {
          maxBuffer: 50 * 1024 * 1024,
        });
      } catch {
        // Last resort: use PPM directly
        return readFile(ppmPath);
      }
    }

    const imageBuffer = await readFile(pngPath);

    // Cleanup temp files
    try {
      execSync(`rm -f "${ppmPath}" "${pngPath}"`, { encoding: 'utf-8' });
    } catch {}

    return imageBuffer;
  }

  /**
   * Crop the image to the selected region
   */
  private async cropRegion(
    imageBuffer: Buffer,
    region: RegionCoordinates,
    imageWidth: number,
    imageHeight: number
  ): Promise<Buffer> {
    // Convert normalized coordinates to pixels
    const left = Math.round(region.x * imageWidth);
    const top = Math.round(region.y * imageHeight);
    const width = Math.round(region.width * imageWidth);
    const height = Math.round(region.height * imageHeight);

    // Ensure we don't exceed image bounds
    const safeLeft = Math.max(0, Math.min(left, imageWidth - 1));
    const safeTop = Math.max(0, Math.min(top, imageHeight - 1));
    const safeWidth = Math.min(width, imageWidth - safeLeft);
    const safeHeight = Math.min(height, imageHeight - safeTop);

    // Crop using sharp
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left: safeLeft,
        top: safeTop,
        width: Math.max(1, safeWidth),
        height: Math.max(1, safeHeight),
      })
      .png()
      .toBuffer();

    return croppedBuffer;
  }

  /**
   * Call Claude Vision to extract content from the cropped region
   */
  private async callClaudeVision(
    imageBuffer: Buffer,
    instructions: string
  ): Promise<{ items: ExtractedItem[]; tokens: { input: number; output: number } }> {
    const content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: imageBuffer.toString('base64'),
        },
      },
      {
        type: 'text',
        text: this.buildPrompt(instructions),
      },
    ];

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
        const responseText = result.content?.[0]?.text || '';

        // Parse the JSON response
        const items = this.parseResponse(responseText);

        return {
          items,
          tokens: {
            input: result.usage?.input_tokens || 0,
            output: result.usage?.output_tokens || 0,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          console.log(`    Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    throw lastError || new Error('Vision extraction failed after retries');
  }

  /**
   * Build the prompt for Claude Vision
   */
  private buildPrompt(instructions: string): string {
    return `You are extracting data from a questionnaire document region. The user has selected this specific area and provided these instructions:

USER INSTRUCTIONS: ${instructions}

Extract all question-answer pairs from this region. For each item, provide:
- label: The question or field name
- value: The answer/value (use "Yes"/"No" for checkboxes, actual text for fields)
- type: "field" | "table_row" | "checkbox" | "text"
- destination: Categorize as one of:
  - "library" = policies, certifications, procedures, compliance questions
  - "entity" = company names, addresses, contacts, staff numbers
  - "product" = ingredients, allergens, specifications, product data
  - "excluded" = headers, instructions, empty fields
- section: The section name this belongs to (infer from context)

RULES:
1. Extract EVERY piece of information, even if brief
2. For checkboxes: ☒ = checked, ☐ = unchecked. Report "Yes" or "No" accordingly
3. For tables: extract each row as a separate item
4. Include signature info: names, titles, dates
5. Be thorough - the user selected this region because something was missed

Return a JSON array of items:
[
  {
    "label": "Question text",
    "value": "Answer text",
    "type": "field",
    "destination": "library",
    "section": "Section Name"
  }
]

Return ONLY the JSON array, no other text.`;
  }

  /**
   * Parse Claude's response into structured items
   */
  private parseResponse(responseText: string): ExtractedItem[] {
    // Remove markdown code blocks if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        return [];
      }

      // Validate and add IDs
      return parsed.map((item: any, index: number) => ({
        id: `vf-${Date.now()}-${index}`,
        label: String(item.label || '').trim(),
        value: String(item.value || '').trim(),
        type: this.normalizeType(item.type),
        destination: this.normalizeDestination(item.destination),
        section: item.section || 'Vision Fix',
        confidence: item.confidence,
      })).filter(item => item.label); // Remove items without labels
    } catch (error) {
      console.error('Failed to parse Vision response:', error);
      return [];
    }
  }

  private normalizeType(type: string): 'field' | 'table_row' | 'checkbox' | 'text' {
    const t = String(type || '').toLowerCase();
    if (t === 'field' || t === 'table_row' || t === 'checkbox' || t === 'text') {
      return t;
    }
    return 'field';
  }

  private normalizeDestination(dest: string): 'library' | 'entity' | 'product' | 'excluded' {
    const d = String(dest || '').toLowerCase();
    if (d === 'library' || d === 'entity' || d === 'product' || d === 'excluded') {
      return d;
    }
    return 'library';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
