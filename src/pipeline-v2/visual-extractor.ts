/**
 * Visual Extractor for Pipeline v2
 *
 * Uses Claude's vision capabilities to understand questionnaire layouts
 * by analyzing screenshots of Excel sheets.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import ExcelJS from 'exceljs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  QuestionnaireMetadata,
  QuestionnaireSection,
  ExtractedQuestion,
} from './types.js';

const execAsync = promisify(exec);

const DEFAULT_MODEL = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
const DEFAULT_REGION = 'eu-central-1';

interface VisualExtractorConfig {
  region?: string;
  model?: string;
  tempDir?: string;
}

interface SheetAnalysis {
  sheetName: string;
  sections: {
    title: string;
    startRow: number;
    endRow: number;
  }[];
  questions: {
    questionText: string;
    answerText: string;
    questionCell: string;
    answerCell: string;
    sectionTitle?: string;
    rowNumber: number;
  }[];
}

export class VisualExtractor {
  private bedrockClient: BedrockRuntimeClient;
  private model: string;
  private tempDir: string;

  constructor(config?: VisualExtractorConfig) {
    const region = config?.region || DEFAULT_REGION;
    this.bedrockClient = new BedrockRuntimeClient({ region });
    this.model = config?.model || DEFAULT_MODEL;
    this.tempDir = config?.tempDir || '/tmp/questionnaire-screenshots';
  }

  /**
   * Extract sections and questions using visual analysis
   */
  async extract(filePath: string): Promise<{
    metadata: QuestionnaireMetadata;
    sections: QuestionnaireSection[];
    questions: ExtractedQuestion[];
  }> {
    const filename = filePath.split('/').pop() || 'unknown';

    // Create temp directory for screenshots
    await mkdir(this.tempDir, { recursive: true });

    try {
      // Load workbook to get sheet names and basic info
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const metadata: QuestionnaireMetadata = {
        filename,
        sheetCount: workbook.worksheets.length,
        processedAt: new Date().toISOString(),
      };

      const allSections: QuestionnaireSection[] = [];
      const allQuestions: ExtractedQuestion[] = [];

      // Process each worksheet
      for (const worksheet of workbook.worksheets) {
        if (worksheet.state === 'hidden') continue;

        console.log(`  Analyzing sheet: ${worksheet.name}`);

        // Generate screenshot of the sheet
        const screenshotPath = await this.captureSheetScreenshot(filePath, worksheet.name);

        if (screenshotPath) {
          // Analyze with Claude Vision
          const analysis = await this.analyzeSheetWithVision(
            screenshotPath,
            worksheet.name,
            worksheet
          );

          // Convert analysis to our types
          const { sections, questions } = this.convertAnalysis(analysis, worksheet.name);
          allSections.push(...sections);
          allQuestions.push(...questions);
        } else {
          // Fallback to text-based extraction if screenshot fails
          console.log(`  Screenshot failed, using text extraction for ${worksheet.name}`);
          const { sections, questions } = await this.extractFromSheetText(worksheet);
          allSections.push(...sections);
          allQuestions.push(...questions);
        }
      }

      return { metadata, sections: allSections, questions: allQuestions };

    } finally {
      // Cleanup temp directory
      try {
        await rm(this.tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Capture screenshot of an Excel sheet using headless tools
   */
  private async captureSheetScreenshot(
    excelPath: string,
    sheetName: string
  ): Promise<string | null> {
    const outputPath = join(this.tempDir, `${sheetName.replace(/[^a-z0-9]/gi, '_')}.png`);

    try {
      // Try using LibreOffice to convert to PDF then to PNG
      // This works on macOS if LibreOffice is installed
      const pdfPath = join(this.tempDir, 'temp.pdf');

      // First, convert to PDF
      await execAsync(
        `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf --outdir "${this.tempDir}" "${excelPath}"`,
        { timeout: 30000 }
      );

      // Then convert PDF to PNG using sips (macOS built-in)
      await execAsync(
        `sips -s format png "${pdfPath}" --out "${outputPath}"`,
        { timeout: 10000 }
      );

      // Check if file exists
      await readFile(outputPath);
      return outputPath;

    } catch (error) {
      // LibreOffice not available or failed
      // Try alternative: use Preview/QuickLook on macOS
      try {
        await execAsync(
          `qlmanage -t -s 1200 -o "${this.tempDir}" "${excelPath}"`,
          { timeout: 30000 }
        );

        // QuickLook outputs as .png with the original filename
        const qlPath = join(this.tempDir, `${excelPath.split('/').pop()}.png`);
        await readFile(qlPath);
        return qlPath;

      } catch {
        console.warn(`Could not generate screenshot for ${sheetName}`);
        return null;
      }
    }
  }

  /**
   * Analyze sheet screenshot with Claude Vision
   */
  private async analyzeSheetWithVision(
    screenshotPath: string,
    sheetName: string,
    worksheet: ExcelJS.Worksheet
  ): Promise<SheetAnalysis> {
    try {
      // Read screenshot as base64
      const imageBuffer = await readFile(screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      // Also get text content for reference
      const textContent = this.getSheetTextContent(worksheet);

      const command = new ConverseCommand({
        modelId: this.model,
        messages: [{
          role: 'user',
          content: [
            {
              image: {
                format: 'png',
                source: {
                  bytes: imageBuffer,
                },
              },
            },
            {
              text: `Analyze this questionnaire sheet and extract its structure.

SHEET NAME: ${sheetName}

TEXT CONTENT (for reference):
${textContent}

Please identify:
1. SECTIONS: Look for headers, titles, or visual groupings (often bold, colored, or larger text)
2. QUESTIONS: Text that asks for information (may end with ?, or start with "Please", "Indicate", etc.)
3. ANSWERS: Values entered in response cells (often in colored cells, to the right of questions)

Return a JSON object with this structure:
{
  "sections": [
    {"title": "Section Title", "startRow": 1, "endRow": 10}
  ],
  "questions": [
    {
      "questionText": "The question text",
      "answerText": "The answer if present",
      "questionCell": "A5",
      "answerCell": "B5",
      "sectionTitle": "Parent section title",
      "rowNumber": 5
    }
  ]
}

Be thorough - extract ALL question-answer pairs, even if the answer is empty.
Pay attention to the visual layout: questions are often in one column, answers in the next.
Include cell references (like A1, B2) based on the row numbers you can estimate.`,
            },
          ],
        }],
        inferenceConfig: {
          maxTokens: 8000,
        },
      });

      const response = await this.bedrockClient.send(command);
      const textContent2 = response.output?.message?.content?.[0];

      if (textContent2 && 'text' in textContent2) {
        // Extract JSON from response
        const jsonMatch = textContent2.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            sheetName,
            sections: parsed.sections || [],
            questions: parsed.questions || [],
          };
        }
      }

      return { sheetName, sections: [], questions: [] };

    } catch (error) {
      console.error(`Vision analysis failed for ${sheetName}: ${error}`);
      return { sheetName, sections: [], questions: [] };
    }
  }

  /**
   * Get text content of a sheet for reference
   */
  private getSheetTextContent(worksheet: ExcelJS.Worksheet): string {
    const lines: string[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = this.getCellValue(cell);
        if (value) cells.push(value);
      });
      if (cells.length > 0) {
        lines.push(`Row ${rowNumber}: ${cells.join(' | ')}`);
      }
    });

    // Limit to first 100 rows for context
    return lines.slice(0, 100).join('\n');
  }

  /**
   * Convert analysis to our types
   */
  private convertAnalysis(
    analysis: SheetAnalysis,
    sheetName: string
  ): {
    sections: QuestionnaireSection[];
    questions: ExtractedQuestion[];
  } {
    const sections: QuestionnaireSection[] = [];
    const questions: ExtractedQuestion[] = [];

    // Create sections
    for (let i = 0; i < analysis.sections.length; i++) {
      const s = analysis.sections[i];
      sections.push({
        id: `${sheetName}-${i + 1}`,
        title: s.title,
        sheetName,
        startRow: s.startRow,
        endRow: s.endRow,
        questions: [],
      });
    }

    // Create questions and link to sections
    for (const q of analysis.questions) {
      const question: ExtractedQuestion = {
        id: randomUUID(),
        sectionId: '',
        questionText: q.questionText,
        answerText: q.answerText || '',
        questionCell: `${sheetName}!${q.questionCell}`,
        answerCell: q.answerCell ? `${sheetName}!${q.answerCell}` : '',
        rowNumber: q.rowNumber,
      };

      // Find parent section
      for (const section of sections) {
        if (q.sectionTitle && section.title.includes(q.sectionTitle)) {
          question.sectionId = section.id;
          section.questions.push(question);
          break;
        }
        if (q.rowNumber >= section.startRow && q.rowNumber <= section.endRow) {
          question.sectionId = section.id;
          section.questions.push(question);
          break;
        }
      }

      // If no section found, create default
      if (!question.sectionId) {
        if (sections.length === 0) {
          sections.push({
            id: `${sheetName}-default`,
            title: sheetName,
            sheetName,
            startRow: 1,
            endRow: 9999,
            questions: [],
          });
        }
        question.sectionId = sections[0].id;
        sections[0].questions.push(question);
      }

      questions.push(question);
    }

    return { sections, questions };
  }

  /**
   * Fallback: extract from sheet text without vision
   */
  private async extractFromSheetText(
    worksheet: ExcelJS.Worksheet
  ): Promise<{
    sections: QuestionnaireSection[];
    questions: ExtractedQuestion[];
  }> {
    const sheetName = worksheet.name;
    const sections: QuestionnaireSection[] = [];
    const questions: ExtractedQuestion[] = [];

    let currentSection: QuestionnaireSection | null = null;
    let sectionCounter = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: Array<{ col: number; value: string; address: string }> = [];

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const value = this.getCellValue(cell);
        if (value.trim()) {
          cells.push({
            col: colNumber,
            value: value.trim(),
            address: cell.address,
          });
        }
      });

      if (cells.length === 0) return;

      // Check for section header (first cell is bold or matches header pattern)
      const firstCell = cells[0];
      if (this.looksLikeHeader(firstCell.value, row)) {
        if (currentSection) {
          currentSection.endRow = rowNumber - 1;
          sections.push(currentSection);
        }

        sectionCounter++;
        currentSection = {
          id: `${sheetName}-${sectionCounter}`,
          title: firstCell.value,
          sheetName,
          startRow: rowNumber,
          endRow: rowNumber,
          questions: [],
        };
        return;
      }

      // Check for question-answer pair
      if (cells.length >= 1) {
        const question: ExtractedQuestion = {
          id: randomUUID(),
          sectionId: currentSection?.id || `${sheetName}-default`,
          questionText: firstCell.value,
          answerText: cells.length > 1 ? cells[1].value : '',
          questionCell: `${sheetName}!${firstCell.address}`,
          answerCell: cells.length > 1 ? `${sheetName}!${cells[1].address}` : '',
          rowNumber,
        };

        if (!currentSection) {
          sectionCounter++;
          currentSection = {
            id: `${sheetName}-${sectionCounter}`,
            title: sheetName,
            sheetName,
            startRow: 1,
            endRow: rowNumber,
            questions: [],
          };
        }

        currentSection.questions.push(question);
        questions.push(question);
      }
    });

    // Save last section
    if (currentSection) {
      currentSection.endRow = worksheet.rowCount;
      sections.push(currentSection);
    }

    return { sections, questions };
  }

  /**
   * Check if text looks like a section header
   */
  private looksLikeHeader(text: string, row: ExcelJS.Row): boolean {
    // Check font
    const firstCell = row.getCell(1);
    if (firstCell.font?.bold) return true;
    if (firstCell.font?.size && firstCell.font.size >= 12) return true;

    // Check patterns
    if (/^[A-Z0-9]+[\.\)]\s+[A-Z]/.test(text)) return true;
    if (/^SECTION\s+\d+/i.test(text)) return true;
    if (/^PART\s+[A-Z0-9]+/i.test(text)) return true;
    if (text === text.toUpperCase() && text.length > 5 && text.length < 50) return true;

    return false;
  }

  /**
   * Get cell value as string
   */
  private getCellValue(cell: ExcelJS.Cell): string {
    const value = cell.value;

    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date) return value.toISOString().split('T')[0];

    if (typeof value === 'object' && 'richText' in value) {
      return value.richText.map(rt => rt.text).join('');
    }

    if (typeof value === 'object' && 'result' in value) {
      return String(value.result || '');
    }

    if (typeof value === 'object' && 'hyperlink' in value) {
      return value.text || value.hyperlink || '';
    }

    return String(value);
  }
}
