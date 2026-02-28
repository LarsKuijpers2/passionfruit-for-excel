/**
 * Visual Q&A Extractor
 *
 * Uses Claude Vision with bounding box overlays to identify key-value pairs
 * from PDF pages based on visual layout and spatial proximity.
 *
 * Checks ALL text elements from Azure (paragraphs, keyValuePairs, etc.),
 * not limited to any specific type.
 *
 * Saves training data (images, prompts, responses) for model fine-tuning.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { basename, dirname, join } from 'path';

export interface TextElementWithPosition {
  content: string;
  pageNumber: number;
  boundingBox?: number[]; // [x1,y1, x2,y2, x3,y3, x4,y4] in inches
}

export interface PageInfo {
  pageNumber: number;
  width: number;  // inches
  height: number; // inches
}

export interface ExtractedQAPair {
  question: string;
  answer: string;
  pageNumber: number;
  questionIdx: number;
  answerIdx: number;
  confidence?: number;
  visualReason?: string;
  /** Bounding box of the question element [x1,y1,x2,y2,x3,y3,x4,y4] */
  questionBoundingBox?: number[];
}

/** Training data saved for each page extraction */
export interface VisualQATrainingData {
  /** Source PDF path */
  pdfPath?: string;
  /** Page number */
  pageNumber: number;
  /** Path to annotated image */
  imagePath: string;
  /** Text elements with positions */
  textElements: TextElementWithPosition[];
  /** Prompt sent to Claude */
  prompt: string;
  /** Raw Claude response */
  rawResponse: string;
  /** Extracted Q&A pairs */
  extractedPairs: ExtractedQAPair[];
  /** Timestamp */
  extractedAt: string;
}

/** Result with training data for saving */
export interface VisualQAResult {
  pairs: ExtractedQAPair[];
  trainingData: VisualQATrainingData[];
}

export class VisualQAExtractor {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private saveTrainingData: boolean;
  private trainingDataDir?: string;

  constructor(region: string = 'eu-central-1', options?: { saveTrainingData?: boolean; trainingDataDir?: string }) {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
    this.saveTrainingData = options?.saveTrainingData ?? true;
    this.trainingDataDir = options?.trainingDataDir;
  }

  /**
   * Extract Q&A pairs from text elements using Claude Vision with bounding boxes
   * Returns pairs and training data for model fine-tuning
   */
  async extractQAPairs(
    textElements: TextElementWithPosition[],
    pages: PageInfo[],
    pdfPath?: string
  ): Promise<ExtractedQAPair[]> {
    const result = await this.extractQAPairsWithTraining(textElements, pages, pdfPath);
    return result.pairs;
  }

  /**
   * Extract Q&A pairs and return training data for saving
   */
  async extractQAPairsWithTraining(
    textElements: TextElementWithPosition[],
    pages: PageInfo[],
    pdfPath?: string
  ): Promise<VisualQAResult> {
    if (!textElements || textElements.length < 2) {
      return { pairs: [], trainingData: [] };
    }

    // Group elements by page
    const byPage = new Map<number, TextElementWithPosition[]>();
    for (const el of textElements) {
      const page = el.pageNumber || 1;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(el);
    }

    // Create page info lookup
    const pageInfoMap = new Map<number, PageInfo>();
    for (const p of pages) {
      pageInfoMap.set(p.pageNumber, p);
    }

    const allPairs: ExtractedQAPair[] = [];
    const allTrainingData: VisualQATrainingData[] = [];

    // Determine training data directory
    let trainingDir = this.trainingDataDir;
    if (!trainingDir && pdfPath && this.saveTrainingData) {
      // Save in customer's visual-qa-training folder
      const customerDir = dirname(dirname(pdfPath));
      trainingDir = join(customerDir, 'visual-qa-training');
    }

    // Process each page
    for (const [pageNum, pageElements] of byPage) {
      // Skip pages with too few elements
      if (pageElements.length < 2) continue;

      const pageInfo = pageInfoMap.get(pageNum) || { pageNumber: pageNum, width: 8.5, height: 11 };
      const result = await this.extractFromPage(pageNum, pageElements, pageInfo, pdfPath, trainingDir);

      allPairs.push(...result.pairs);
      if (result.trainingData) {
        allTrainingData.push(result.trainingData);
      }
    }

    return { pairs: allPairs, trainingData: allTrainingData };
  }

  private async extractFromPage(
    pageNum: number,
    elements: TextElementWithPosition[],
    pageInfo: PageInfo,
    pdfPath?: string,
    trainingDir?: string
  ): Promise<{ pairs: ExtractedQAPair[]; trainingData?: VisualQATrainingData }> {
    // Sort by Y position
    const sorted = [...elements].sort((a, b) => {
      const yA = a.boundingBox?.[1] ?? 0;
      const yB = b.boundingBox?.[1] ?? 0;
      return yA - yB;
    });

    // Build text list with positions
    const textList = sorted.map((el, i) => {
      const y = el.boundingBox?.[1]?.toFixed(2) || '?';
      const x = el.boundingBox?.[0]?.toFixed(2) || '?';
      return `[${i}] x=${x}" y=${y}": "${el.content}"`;
    }).join('\n');

    // Create image with bounding boxes
    const annotatedImage = await this.createAnnotatedImage(
      sorted,
      pageInfo,
      pageNum,
      pdfPath
    );

    const prompt = `This is page ${pageNum} of a PDF questionnaire. I've drawn red bounding boxes around all detected text elements, each labeled with a number.

Here are the text contents with their box numbers and positions (x,y in inches):
${textList}

**Task**: Looking at the VISUAL LAYOUT in the image, identify key-value pairs (questions with their answers).

**IMPORTANT - Text Correction**: The OCR often incorrectly merges separate text. Look at the IMAGE to see what's ACTUALLY on the page:
- If a box contains "No SomeText" but the image shows "No" and "SomeText" are visually separate (e.g., "No" is an answer checkbox and "SomeText" is part of the question), you should SPLIT them.
- The "key" and "value" you return should match what you SEE in the image, not what the OCR text says.
- Example: If box says "No Elaeis guineensis (Oil)" but the image shows "No" is a checkbox answer separate from the question text "Elaeis guineensis (Oil)", return the split version.

A key-value pair is:
- A LABEL/QUESTION (the key) paired with its ANSWER/VALUE
- They should be visually associated: horizontally adjacent, vertically stacked, or in a form field layout
- The value can be ANY text (not just Yes/No) - short answers, numbers, dates, selections, etc.

Consider:
1. Form field patterns: label on left, value on right
2. Table patterns: header above, value below
3. Checkbox/selection patterns: question followed by marked answer
4. Proximity: key and value should be close together
5. **OCR errors**: Text may be merged incorrectly - use the IMAGE to see the real layout

Return a JSON array of ALL key-value pairs you can identify:
[{"key_idx": N, "value_idx": M, "key": "corrected label/question text", "value": "corrected answer text", "confidence": 0.9, "visual_reason": "why paired, note any OCR corrections"}]

Include any clear associations, not just Yes/No answers. Return empty array [] if no valid pairs found.`;

    let rawResponse = '';
    let pairs: ExtractedQAPair[] = [];
    let imagePath = '';

    try {
      const imageBase64 = annotatedImage.toString('base64');

      const response = await this.client.send(new InvokeModelCommand({
        modelId: this.modelId,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          }],
        }),
        contentType: 'application/json',
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      rawResponse = responseBody.content[0].text;

      // Extract JSON from response
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsedPairs = JSON.parse(jsonMatch[0]);
        pairs = parsedPairs.map((p: any) => ({
          question: p.key,
          answer: p.value,
          pageNumber: pageNum,
          questionIdx: p.key_idx,
          answerIdx: p.value_idx,
          confidence: p.confidence,
          visualReason: p.visual_reason,
          // Include bounding box for positioning in document order
          questionBoundingBox: sorted[p.key_idx]?.boundingBox,
        }));
      }

      // Save training data if enabled
      if (this.saveTrainingData && trainingDir) {
        try {
          await mkdir(trainingDir, { recursive: true });

          // Create unique filename based on PDF and page
          const pdfName = pdfPath ? basename(pdfPath, '.pdf').replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
          const timestamp = Date.now();
          const baseName = `${pdfName}_page${pageNum}_${timestamp}`;

          // Save annotated image
          imagePath = join(trainingDir, `${baseName}.png`);
          await writeFile(imagePath, annotatedImage);

          // Save training data JSON
          const trainingData: VisualQATrainingData = {
            pdfPath,
            pageNumber: pageNum,
            imagePath,
            textElements: sorted,
            prompt,
            rawResponse,
            extractedPairs: pairs,
            extractedAt: new Date().toISOString(),
          };

          const jsonPath = join(trainingDir, `${baseName}.json`);
          await writeFile(jsonPath, JSON.stringify(trainingData, null, 2));

          console.log(`  📸 Saved training data: ${baseName}`);

          return { pairs, trainingData };
        } catch (saveError) {
          console.error(`  Warning: Failed to save training data:`, saveError);
        }
      }

      return { pairs };
    } catch (error) {
      console.error(`  Error extracting Q&A from page ${pageNum}:`, error);
      return { pairs: [] };
    }
  }

  private async createAnnotatedImage(
    elements: TextElementWithPosition[],
    pageInfo: PageInfo,
    pageNum: number,
    pdfPath?: string
  ): Promise<Buffer> {
    const DPI = 150;
    const pageWidth = pageInfo.width || 8.5;
    const pageHeight = pageInfo.height || 11;
    const imgWidth = Math.round(pageWidth * DPI);
    const imgHeight = Math.round(pageHeight * DPI);

    // Try to render PDF page if path provided
    let baseImage: Buffer | null = null;

    if (pdfPath) {
      try {
        // Try pdftoppm
        try {
          execSync(`pdftoppm -f ${pageNum} -l ${pageNum} -r ${DPI} -png "${pdfPath}" /tmp/visual_qa_page`, { encoding: 'utf-8', stdio: 'pipe' });
        } catch {
          execSync(`pdftoppm "${pdfPath}" /tmp/visual_qa_page -f ${pageNum} -l ${pageNum} -r ${DPI} -png`, { encoding: 'utf-8', stdio: 'pipe' });
        }

        // Try different output file naming conventions
        for (const suffix of [`-${pageNum.toString().padStart(2, '0')}.png`, `-${pageNum}.png`, `-${pageNum.toString().padStart(3, '0')}.png`]) {
          try {
            baseImage = await readFile('/tmp/visual_qa_page' + suffix);
            break;
          } catch {}
        }
      } catch {}
    }

    // Create placeholder if PDF render failed
    if (!baseImage) {
      baseImage = await sharp({
        create: {
          width: imgWidth,
          height: imgHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      }).png().toBuffer();
    }

    // Get actual image dimensions
    const pdfImage = sharp(baseImage);
    const metadata = await pdfImage.metadata();
    const actualWidth = metadata.width || imgWidth;
    const actualHeight = metadata.height || imgHeight;

    // Scale factors
    const scaleX = actualWidth / pageWidth;
    const scaleY = actualHeight / pageHeight;

    // Build SVG overlay with bounding boxes
    const svgParts: string[] = [];
    svgParts.push(`<svg width="${actualWidth}" height="${actualHeight}" xmlns="http://www.w3.org/2000/svg">`);

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const bb = el.boundingBox;
      if (!bb || bb.length < 8) continue;

      // Bounding box: [x1,y1, x2,y2, x3,y3, x4,y4]
      const x1 = bb[0] * scaleX;
      const y1 = bb[1] * scaleY;
      const x2 = bb[2] * scaleX;
      const y3 = bb[5] * scaleY;

      const boxWidth = x2 - x1;
      const boxHeight = y3 - y1;

      const color = '#cc0000'; // red for all boxes

      svgParts.push(`<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${color}" stroke-width="3" opacity="0.8"/>`);
      svgParts.push(`<rect x="${x1}" y="${y1 - 18}" width="24" height="16" fill="${color}"/>`);
      svgParts.push(`<text x="${x1 + 3}" y="${y1 - 5}" font-size="12" font-weight="bold" fill="white">${i}</text>`);
    }

    svgParts.push('</svg>');
    const overlaySvg = svgParts.join('\n');

    // Composite overlay
    const annotatedImage = await pdfImage
      .composite([{
        input: Buffer.from(overlaySvg),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();

    return annotatedImage;
  }
}
