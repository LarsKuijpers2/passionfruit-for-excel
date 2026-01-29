/**
 * Claude API integration for Excel operations
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { ExcelExtractor } from './excel-extractor.js';
import type {
  PassfruitConfig,
  ChatMessage,
  AnalysisResult,
  WorkbookData,
  ExcelModification
} from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 8192;

const SYSTEM_PROMPT = `You are an expert Excel assistant. You help users understand, analyze, and modify Excel spreadsheets.

When analyzing a spreadsheet:
1. Identify the structure and purpose of the workbook
2. Note any input cells (often highlighted with colors like blue or gray)
3. Understand formula relationships between cells
4. Provide clear citations to specific cells when answering questions

When modifying a spreadsheet:
1. Only modify the cells that need to be changed
2. Preserve formulas and dependencies
3. Return modifications in a structured format

For modifications, respond with a JSON block containing the changes:
\`\`\`json
{
  "modifications": [
    {"sheet": "SheetName", "cell": "A1", "value": "new value"},
    {"sheet": "SheetName", "cell": "B2", "value": 123}
  ],
  "explanation": "Description of what was changed and why"
}
\`\`\`

Always be precise about cell references and sheet names.`;

export class PassfruitExcel {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private extractor: ExcelExtractor;
  private conversationHistory: ChatMessage[] = [];
  private currentWorkbook: WorkbookData | null = null;
  private containerId: string | null = null;

  constructor(config: PassfruitConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
    this.extractor = new ExcelExtractor();
  }

  /**
   * Load and analyze an Excel file
   */
  async loadWorkbook(filePath: string): Promise<WorkbookData> {
    this.currentWorkbook = await this.extractor.extract(filePath);
    this.conversationHistory = [];
    return this.currentWorkbook;
  }

  /**
   * Analyze a workbook with a question (using custom extraction approach)
   */
  async analyze(filePath: string, question: string): Promise<AnalysisResult> {
    // Load the workbook
    const workbook = await this.loadWorkbook(filePath);

    // Convert to text representation for Claude
    const workbookText = this.extractor.toTextRepresentation(workbook);

    const userMessage = `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nQuestion: ${question}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const assistantResponse = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: assistantResponse });

    return {
      answer: assistantResponse,
      citations: this.extractCitations(assistantResponse, workbook),
    };
  }

  /**
   * Chat about the currently loaded workbook
   */
  async chat(message: string): Promise<AnalysisResult> {
    if (!this.currentWorkbook) {
      throw new Error('No workbook loaded. Call loadWorkbook() first.');
    }

    // Build conversation context
    const workbookText = this.extractor.toTextRepresentation(this.currentWorkbook);

    // First message includes workbook context
    const messages: Anthropic.MessageParam[] = [];

    if (this.conversationHistory.length === 0) {
      messages.push({
        role: 'user',
        content: `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nQuestion: ${message}`,
      });
    } else {
      // Include workbook context in first message
      messages.push({
        role: 'user',
        content: `Here is the Excel workbook content:\n\n${workbookText}`,
      });
      messages.push({
        role: 'assistant',
        content: 'I\'ve loaded the Excel workbook. I can see all the sheets, cells, and formulas. How can I help you?',
      });

      // Add conversation history
      for (const msg of this.conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add new message
      messages.push({
        role: 'user',
        content: message,
      });
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages,
    });

    const assistantResponse = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // Update conversation history
    this.conversationHistory.push({ role: 'user', content: message });
    this.conversationHistory.push({ role: 'assistant', content: assistantResponse });

    // Check for modifications in response
    const modifications = this.extractModifications(assistantResponse);

    return {
      answer: assistantResponse,
      citations: this.extractCitations(assistantResponse, this.currentWorkbook),
      modifications,
    };
  }

  /**
   * Request modifications to the workbook
   */
  async modify(filePath: string, instructions: string): Promise<{
    modifications: ExcelModification[];
    explanation: string;
  }> {
    const workbook = await this.loadWorkbook(filePath);
    const workbookText = this.extractor.toTextRepresentation(workbook);

    const userMessage = `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nPlease make the following modifications:\n${instructions}\n\nRespond with the exact cells to modify in the JSON format specified.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const assistantResponse = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    const modifications = this.extractModifications(assistantResponse);

    // Extract explanation from the response
    const explanationMatch = assistantResponse.match(/"explanation":\s*"([^"]+)"/);
    const explanation = explanationMatch?.[1] || assistantResponse.split('```')[0].trim();

    return {
      modifications,
      explanation,
    };
  }

  /**
   * Use Anthropic's pre-built xlsx skill (requires beta access)
   * This is the approach used by Claude for Excel
   */
  async analyzeWithSkill(filePath: string, question: string): Promise<AnalysisResult> {
    // Read file as base64
    const fileBuffer = await readFile(filePath);
    const base64Content = fileBuffer.toString('base64');
    const filename = filePath.split('/').pop() || 'workbook.xlsx';

    try {
      // @ts-expect-error - Beta API types may not be fully defined
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        betas: ['code-execution-2025-08-25', 'skills-2025-10-02', 'files-api-2025-04-14'],
        container: {
          skills: [
            { type: 'anthropic', skill_id: 'xlsx', version: 'latest' }
          ]
        },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                data: base64Content,
              },
              filename,
            },
            {
              type: 'text',
              text: question,
            },
          ],
        }],
        tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
      });

      // Store container ID for multi-turn
      if (response.container?.id) {
        this.containerId = response.container.id;
      }

      const textContent = response.content.find(
        (c: { type: string }) => c.type === 'text'
      ) as { text: string } | undefined;

      return {
        answer: textContent?.text || 'No response received',
        citations: [],
      };
    } catch (error) {
      // Fallback to custom extraction if beta not available
      console.warn('Beta skills not available, falling back to custom extraction');
      return this.analyze(filePath, question);
    }
  }

  /**
   * Extract cell citations from response
   */
  private extractCitations(
    response: string,
    workbook: WorkbookData
  ): AnalysisResult['citations'] {
    const citations: AnalysisResult['citations'] = [];

    // Match cell references like A1, B2, Sheet1!C3, etc.
    const cellPattern = /(?:([A-Za-z_][A-Za-z0-9_]*)!)?([A-Z]+[0-9]+)/g;
    const matches = response.matchAll(cellPattern);

    for (const match of matches) {
      const sheetName = match[1] || workbook.sheets[0]?.name;
      const cellAddress = match[2];

      // Find the cell in the workbook
      const sheet = workbook.sheets.find(s =>
        s.name.toLowerCase() === sheetName?.toLowerCase()
      );

      if (sheet) {
        const cell = sheet.cells.get(cellAddress);
        if (cell) {
          citations.push({
            sheet: sheet.name,
            cell: cellAddress,
            value: cell.value,
            context: match[0],
          });
        }
      }
    }

    return citations;
  }

  /**
   * Extract modifications from Claude's response
   */
  private extractModifications(response: string): ExcelModification[] {
    const modifications: ExcelModification[] = [];

    // Look for JSON block with modifications
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.modifications && Array.isArray(parsed.modifications)) {
          for (const mod of parsed.modifications) {
            if (mod.sheet && mod.cell && mod.value !== undefined) {
              modifications.push({
                sheet: mod.sheet,
                cell: mod.cell,
                value: mod.value,
              });
            }
          }
        }
      } catch {
        // JSON parse failed, try to extract manually
      }
    }

    return modifications;
  }

  /**
   * Apply modifications to an Excel file
   */
  async applyModifications(
    inputPath: string,
    outputPath: string,
    modifications: ExcelModification[]
  ): Promise<void> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);

    for (const mod of modifications) {
      const worksheet = workbook.getWorksheet(mod.sheet);
      if (worksheet) {
        const cell = worksheet.getCell(mod.cell);
        mod.previousValue = cell.value as ExcelModification['previousValue'];
        cell.value = mod.value;
      }
    }

    await workbook.xlsx.writeFile(outputPath);
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.currentWorkbook = null;
    this.containerId = null;
  }

  /**
   * Get current workbook data
   */
  getWorkbook(): WorkbookData | null {
    return this.currentWorkbook;
  }
}

export default PassfruitExcel;
