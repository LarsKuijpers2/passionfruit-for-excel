/**
 * Claude API integration for Excel operations via AWS Bedrock
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { ExcelExtractor } from "./excel-extractor.js";
import { QuestionAnswerDetector } from "./question-answer-detector.js";
import { buildWebSearchTool, extractSearchInfo, formatSearchResults, buildBedrockWebSearchTool, executeWebSearch, formatSearchResultsForClaude } from "./web-search.js";
import type {
  PassfruitConfig,
  ChatMessage,
  AnalysisResult,
  WorkbookData,
  ExcelModification,
  EnhancedWorkbookData,
  QuestionnaireStructure,
  WebSearchConfig,
  WebSearchInfo,
} from "./types.js";

const DEFAULT_MODEL = "eu.anthropic.claude-opus-4-5-20251101-v1:0";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_REGION = "eu-central-1";

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

const SYSTEM_PROMPT_WITH_WEB_SEARCH = `You are an expert Excel assistant with web search capabilities. You help users understand, analyze, and modify Excel spreadsheets, and can search the internet when needed.

When analyzing a spreadsheet:
1. Identify the structure and purpose of the workbook
2. Note any input cells (often highlighted with colors like blue or gray)
3. Understand formula relationships between cells
4. Provide clear citations to specific cells when answering questions

When modifying a spreadsheet:
1. Only modify the cells that need to be changed
2. Preserve formulas and dependencies
3. Return modifications in a structured format

**IMPORTANT - Web Search:**
You have access to a web search tool. USE IT when:
- The user explicitly asks to search the web, internet, or look something up online
- The user asks about company information, certifications, or details not in the spreadsheet
- The user mentions "search", "lookup", "find online", "internet search", or similar phrases
- You need external information to answer a question about a supplier, customer, or company

When a user asks to "lookup certifications" or "search for company info", you MUST use the web_search tool to find that information.

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

// Model mapping for Anthropic API (without region prefix)
const ANTHROPIC_MODEL = "claude-opus-4-5-20251101";

export class PassfruitExcel {
  private bedrockClient: BedrockRuntimeClient;
  private anthropicClient: Anthropic | null = null;
  private model: string;
  private anthropicModel: string;
  private maxTokens: number;
  private extractor: ExcelExtractor;
  private detector: QuestionAnswerDetector;
  private webSearchConfig: WebSearchConfig | null = null;
  private tavilyApiKey: string | null = null;
  private conversationHistory: ChatMessage[] = [];
  private currentWorkbook: WorkbookData | null = null;
  private currentEnhancedWorkbook: EnhancedWorkbookData | null = null;
  private currentStructure: QuestionnaireStructure | null = null;
  private containerId: string | null = null;
  private lastSearchInfo: WebSearchInfo | null = null;

  constructor(config: PassfruitConfig = {}) {
    const region = config.region || DEFAULT_REGION;
    this.bedrockClient = new BedrockRuntimeClient({ region });
    this.model = config.model || DEFAULT_MODEL;
    this.anthropicModel = ANTHROPIC_MODEL;
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
    this.extractor = new ExcelExtractor();
    this.detector = new QuestionAnswerDetector();

    // Initialize Anthropic client if API key provided (for Anthropic API web search)
    if (config.anthropicApiKey) {
      this.anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    }

    // Store Brave API key for Bedrock web search
    if (config.tavilyApiKey) {
      this.tavilyApiKey = config.tavilyApiKey;
    }

    // Store web search config
    if (config.webSearch?.enabled) {
      this.webSearchConfig = config.webSearch;
    }
  }

  /**
   * Configure web search after initialization
   */
  configureWebSearch(apiKey: string, config?: Partial<WebSearchConfig>): void {
    this.anthropicClient = new Anthropic({ apiKey });
    this.webSearchConfig = {
      enabled: true,
      ...config,
    };
  }

  /**
   * Check if web search is available (either via Anthropic API or Bedrock with Brave)
   */
  hasWebSearch(): boolean {
    // Anthropic API web search
    if (this.anthropicClient !== null && this.webSearchConfig?.enabled === true) {
      return true;
    }
    // Bedrock web search with Brave API
    if (this.tavilyApiKey !== null && this.webSearchConfig?.enabled === true) {
      return true;
    }
    return false;
  }

  /**
   * Check if Bedrock web search is available (uses Brave API)
   */
  hasBedrockWebSearch(): boolean {
    return this.tavilyApiKey !== null && this.webSearchConfig?.enabled === true;
  }

  /**
   * Get the last web search info (queries, results, citations)
   */
  getLastSearchInfo(): WebSearchInfo | null {
    return this.lastSearchInfo;
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

    const command = new ConverseCommand({
      modelId: this.model,
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }],
        },
      ],
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
      },
    });

    const response = await this.bedrockClient.send(command);
    const assistantResponse =
      response.output?.message?.content?.[0]?.text || "";

    // Add to conversation history
    this.conversationHistory.push({ role: "user", content: question });
    this.conversationHistory.push({
      role: "assistant",
      content: assistantResponse,
    });

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
      throw new Error("No workbook loaded. Call loadWorkbook() first.");
    }

    // Use Anthropic API if web search is enabled with Anthropic client
    if (this.anthropicClient !== null && this.webSearchConfig?.enabled === true) {
      return this.chatWithWebSearch(message);
    }

    // Use Bedrock with web search if Brave API key is configured
    if (this.hasBedrockWebSearch()) {
      return this.chatWithBedrockWebSearch(message);
    }

    // Otherwise use Bedrock without web search
    return this.chatWithBedrock(message);
  }

  /**
   * Chat using Anthropic API with web search enabled
   */
  private async chatWithWebSearch(message: string): Promise<AnalysisResult> {
    if (!this.anthropicClient || !this.currentWorkbook) {
      throw new Error("Anthropic client not configured or no workbook loaded");
    }

    const workbookText = this.extractor.toTextRepresentation(this.currentWorkbook);

    // Build messages for Anthropic API
    const messages: Anthropic.MessageParam[] = [];

    if (this.conversationHistory.length === 0) {
      messages.push({
        role: "user",
        content: `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nQuestion: ${message}`,
      });
    } else {
      // Include workbook context in first message
      messages.push({
        role: "user",
        content: `Here is the Excel workbook content:\n\n${workbookText}`,
      });
      messages.push({
        role: "assistant",
        content: "I've loaded the Excel workbook. I can see all the sheets, cells, and formulas. How can I help you?",
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
        role: "user",
        content: message,
      });
    }

    // Build web search tool
    const webSearchTool = buildWebSearchTool(this.webSearchConfig || undefined);

    const response = await this.anthropicClient.messages.create({
      model: this.anthropicModel,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT_WITH_WEB_SEARCH,
      messages,
      // @ts-expect-error - web_search_20250305 is a special tool type not in SDK types yet
      tools: [webSearchTool],
    });

    // Extract text response and search info
    // @ts-expect-error - response.content may contain web search result blocks
    const content = response.content as Array<Record<string, unknown>>;
    const textBlocks = content.filter((block) => block.type === "text");
    const finalResponse = textBlocks.map((block) => block.text as string).join("\n");

    // Extract search info for display
    this.lastSearchInfo = extractSearchInfo(content);

    // Update conversation history
    this.conversationHistory.push({ role: "user", content: message });
    this.conversationHistory.push({
      role: "assistant",
      content: finalResponse,
    });

    // Check for modifications in response
    const modifications = this.extractModifications(finalResponse);

    return {
      answer: finalResponse,
      citations: this.extractCitations(finalResponse, this.currentWorkbook),
      modifications,
    };
  }

  /**
   * Chat using AWS Bedrock (no web search)
   */
  private async chatWithBedrock(message: string): Promise<AnalysisResult> {
    if (!this.currentWorkbook) {
      throw new Error("No workbook loaded");
    }

    const workbookText = this.extractor.toTextRepresentation(this.currentWorkbook);

    // Build messages for Bedrock
    const messages: Array<{
      role: "user" | "assistant";
      content: Array<{ text: string }>;
    }> = [];

    if (this.conversationHistory.length === 0) {
      messages.push({
        role: "user",
        content: [
          {
            text: `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nQuestion: ${message}`,
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: [
          { text: `Here is the Excel workbook content:\n\n${workbookText}` },
        ],
      });
      messages.push({
        role: "assistant",
        content: [
          {
            text: "I've loaded the Excel workbook. I can see all the sheets, cells, and formulas. How can I help you?",
          },
        ],
      });

      for (const msg of this.conversationHistory) {
        messages.push({
          role: msg.role,
          content: [{ text: msg.content }],
        });
      }

      messages.push({
        role: "user",
        content: [{ text: message }],
      });
    }

    const command = new ConverseCommand({
      modelId: this.model,
      messages,
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
      },
    });

    const response = await this.bedrockClient.send(command);
    const assistantResponse = response.output?.message?.content?.[0]?.text || "";

    this.conversationHistory.push({ role: "user", content: message });
    this.conversationHistory.push({
      role: "assistant",
      content: assistantResponse,
    });

    const modifications = this.extractModifications(assistantResponse);

    return {
      answer: assistantResponse,
      citations: this.extractCitations(assistantResponse, this.currentWorkbook),
      modifications,
    };
  }

  /**
   * Chat using AWS Bedrock with web search support via Brave API
   */
  private async chatWithBedrockWebSearch(message: string): Promise<AnalysisResult> {
    if (!this.currentWorkbook || !this.tavilyApiKey) {
      throw new Error("No workbook loaded or Brave API key not configured");
    }

    const workbookText = this.extractor.toTextRepresentation(this.currentWorkbook);

    // Build messages for Bedrock
    type BedrockMessage = {
      role: "user" | "assistant";
      content: Array<{ text: string } | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } } | { toolResult: { toolUseId: string; content: Array<{ text: string }> } }>;
    };

    const messages: BedrockMessage[] = [];

    if (this.conversationHistory.length === 0) {
      messages.push({
        role: "user",
        content: [
          {
            text: `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nQuestion: ${message}`,
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: [
          { text: `Here is the Excel workbook content:\n\n${workbookText}` },
        ],
      });
      messages.push({
        role: "assistant",
        content: [
          {
            text: "I've loaded the Excel workbook. I can see all the sheets, cells, and formulas. How can I help you?",
          },
        ],
      });

      for (const msg of this.conversationHistory) {
        messages.push({
          role: msg.role,
          content: [{ text: msg.content }],
        });
      }

      messages.push({
        role: "user",
        content: [{ text: message }],
      });
    }

    // Build web search tool for Bedrock
    const webSearchTool = buildBedrockWebSearchTool();

    // Track search results for this conversation
    const searchResults: Array<{ url: string; title: string; snippet?: string }> = [];

    // Tool use loop
    let finalResponse = "";
    let continueLoop = true;
    const maxIterations = 5; // Prevent infinite loops
    let iteration = 0;

    while (continueLoop && iteration < maxIterations) {
      iteration++;

      const command = new ConverseCommand({
        modelId: this.model,
        messages: messages as Array<{
          role: "user" | "assistant";
          content: Array<{ text: string }>;
        }>,
        system: [{ text: SYSTEM_PROMPT_WITH_WEB_SEARCH }],
        inferenceConfig: {
          maxTokens: this.maxTokens,
        },
        toolConfig: {
          tools: [webSearchTool],
        },
      });

      const response = await this.bedrockClient.send(command);

      // Check stop reason
      const stopReason = response.stopReason;

      if (stopReason === "tool_use") {
        // Claude wants to use a tool
        const assistantContent = response.output?.message?.content || [];

        // Add assistant message to conversation
        messages.push({
          role: "assistant",
          content: assistantContent as BedrockMessage["content"],
        });

        // Process tool uses
        const toolResultContent: Array<{ toolResult: { toolUseId: string; content: Array<{ text: string }> } }> = [];

        for (const block of assistantContent) {
          if ("toolUse" in block && block.toolUse) {
            const toolUse = block.toolUse as { toolUseId: string; name: string; input: Record<string, unknown> };

            if (toolUse.name === "web_search") {
              const query = (toolUse.input as { query: string }).query;

              try {
                // Execute the search
                const results = await executeWebSearch(query, this.tavilyApiKey!);
                searchResults.push(...results);

                // Format results for Claude
                const formattedResults = formatSearchResultsForClaude(results);

                toolResultContent.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ text: formattedResults }],
                  },
                });
              } catch (error) {
                // Return error to Claude
                toolResultContent.push({
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ text: `Search error: ${error instanceof Error ? error.message : "Unknown error"}` }],
                  },
                });
              }
            }
          }
        }

        // Add tool results as user message
        if (toolResultContent.length > 0) {
          messages.push({
            role: "user",
            content: toolResultContent,
          });
        }
      } else {
        // Final response (end_turn or other stop reason)
        continueLoop = false;

        // Extract text from response
        const content = response.output?.message?.content || [];
        for (const block of content) {
          if ("text" in block && block.text) {
            finalResponse += block.text;
          }
        }
      }
    }

    // Update search info
    this.lastSearchInfo = {
      searchQueries: [],
      searchResults: searchResults.map(r => ({ url: r.url, title: r.title })),
      citations: [],
    };

    this.conversationHistory.push({ role: "user", content: message });
    this.conversationHistory.push({
      role: "assistant",
      content: finalResponse,
    });

    const modifications = this.extractModifications(finalResponse);

    return {
      answer: finalResponse,
      citations: this.extractCitations(finalResponse, this.currentWorkbook),
      modifications,
    };
  }

  /**
   * Request modifications to the workbook
   */
  async modify(
    filePath: string,
    instructions: string,
  ): Promise<{
    modifications: ExcelModification[];
    explanation: string;
  }> {
    const workbook = await this.loadWorkbook(filePath);
    const workbookText = this.extractor.toTextRepresentation(workbook);

    const userMessage = `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\nPlease make the following modifications:\n${instructions}\n\nRespond with the exact cells to modify in the JSON format specified.`;

    const command = new ConverseCommand({
      modelId: this.model,
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }],
        },
      ],
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
      },
    });

    const response = await this.bedrockClient.send(command);
    const assistantResponse =
      response.output?.message?.content?.[0]?.text || "";

    const modifications = this.extractModifications(assistantResponse);

    // Extract explanation from the response
    const explanationMatch = assistantResponse.match(
      /"explanation":\s*"([^"]+)"/,
    );
    const explanation =
      explanationMatch?.[1] || assistantResponse.split("```")[0].trim();

    return {
      modifications,
      explanation,
    };
  }

  /**
   * Use Anthropic's pre-built xlsx skill (requires beta access)
   * This is the approach used by Claude for Excel
   */
  async analyzeWithSkill(
    filePath: string,
    question: string,
  ): Promise<AnalysisResult> {
    // Read file as base64
    const fileBuffer = await readFile(filePath);
    const base64Content = fileBuffer.toString("base64");
    const filename = filePath.split("/").pop() || "workbook.xlsx";

    try {
      // @ts-expect-error - Beta API types may not be fully defined
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        betas: [
          "code-execution-2025-08-25",
          "skills-2025-10-02",
          "files-api-2025-04-14",
        ],
        container: {
          skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }],
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type:
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  data: base64Content,
                },
                filename,
              },
              {
                type: "text",
                text: question,
              },
            ],
          },
        ],
        tools: [{ type: "code_execution_20250825", name: "code_execution" }],
      });

      // Store container ID for multi-turn
      if (response.container?.id) {
        this.containerId = response.container.id;
      }

      const textContent = response.content.find(
        (c: { type: string }) => c.type === "text",
      ) as { text: string } | undefined;

      return {
        answer: textContent?.text || "No response received",
        citations: [],
      };
    } catch (error) {
      // Fallback to custom extraction if beta not available
      console.warn(
        "Beta skills not available, falling back to custom extraction",
      );
      return this.analyze(filePath, question);
    }
  }

  /**
   * Extract cell citations from response
   */
  private extractCitations(
    response: string,
    workbook: WorkbookData,
  ): AnalysisResult["citations"] {
    const citations: AnalysisResult["citations"] = [];

    // Match cell references like A1, B2, Sheet1!C3, etc.
    const cellPattern = /(?:([A-Za-z_][A-Za-z0-9_]*)!)?([A-Z]+[0-9]+)/g;
    const matches = response.matchAll(cellPattern);

    for (const match of matches) {
      const sheetName = match[1] || workbook.sheets[0]?.name;
      const cellAddress = match[2];

      // Find the cell in the workbook
      const sheet = workbook.sheets.find(
        (s) => s.name.toLowerCase() === sheetName?.toLowerCase(),
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
    modifications: ExcelModification[],
  ): Promise<void> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);

    for (const mod of modifications) {
      const worksheet = workbook.getWorksheet(mod.sheet);
      if (worksheet) {
        const cell = worksheet.getCell(mod.cell);
        mod.previousValue = cell.value as ExcelModification["previousValue"];
        cell.value = mod.value;
      }
    }

    await workbook.xlsx.writeFile(outputPath);
  }

  /**
   * Detect question-answer structure in an Excel file
   */
  async detectStructure(filePath: string): Promise<QuestionnaireStructure> {
    this.currentEnhancedWorkbook = await this.extractor.extractEnhanced(filePath);
    this.currentStructure = this.detector.detectInWorkbook(this.currentEnhancedWorkbook);
    return this.currentStructure;
  }

  /**
   * Get the detected structure (must call detectStructure first)
   */
  getDetectedStructure(): QuestionnaireStructure | null {
    return this.currentStructure;
  }

  /**
   * Get enhanced workbook data
   */
  getEnhancedWorkbook(): EnhancedWorkbookData | null {
    return this.currentEnhancedWorkbook;
  }

  /**
   * Format detected structure as text for display
   */
  formatStructureAsText(): string {
    if (!this.currentStructure) {
      return 'No structure detected. Call detectStructure() first.';
    }
    return this.detector.formatAsText(this.currentStructure);
  }

  /**
   * Analyze with detected structure context
   * This provides Claude with the Q&A structure for better understanding
   */
  async analyzeWithStructure(filePath: string, question: string): Promise<AnalysisResult> {
    // Detect structure if not already done
    if (!this.currentStructure) {
      await this.detectStructure(filePath);
    }

    // Load basic workbook for citations
    const workbook = await this.loadWorkbook(filePath);

    // Build context with structure information
    const workbookText = this.extractor.toTextRepresentation(workbook);
    const structureText = this.formatStructureAsText();

    const userMessage = `Here is the Excel workbook content:\n\n${workbookText}\n\n---\n\n## Detected Question-Answer Structure:\n\n${structureText}\n\n---\n\nQuestion: ${question}`;

    const command = new ConverseCommand({
      modelId: this.model,
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }],
        },
      ],
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
      },
    });

    const response = await this.bedrockClient.send(command);
    const assistantResponse =
      response.output?.message?.content?.[0]?.text || "";

    this.conversationHistory.push({ role: "user", content: question });
    this.conversationHistory.push({
      role: "assistant",
      content: assistantResponse,
    });

    return {
      answer: assistantResponse,
      citations: this.extractCitations(assistantResponse, workbook),
    };
  }

  /**
   * Perform a web search using Claude (via Bedrock with Brave, or Anthropic API)
   */
  async webSearch(query: string): Promise<{
    answer: string;
    searchInfo: WebSearchInfo;
  }> {
    // Prefer Bedrock with Brave API if available
    if (this.tavilyApiKey) {
      return this.webSearchWithBedrock(query);
    }

    // Fallback to Anthropic API
    if (!this.anthropicClient) {
      throw new Error("Web search requires either Brave API key (for Bedrock) or Anthropic API key. Configure one via constructor.");
    }

    const webSearchTool = buildWebSearchTool(this.webSearchConfig || { enabled: true });

    const response = await this.anthropicClient.messages.create({
      model: this.anthropicModel,
      max_tokens: this.maxTokens,
      system: "You are a helpful assistant with web search capabilities. Always use the web_search tool to find information for the user's query. Provide comprehensive answers with sources.",
      messages: [
        {
          role: "user",
          content: query,
        },
      ],
      // @ts-expect-error - web_search_20250305 is a special tool type not in SDK types yet
      tools: [webSearchTool],
    });

    // @ts-expect-error - response.content may contain web search result blocks
    const content = response.content as Array<Record<string, unknown>>;
    const textBlocks = content.filter((block) => block.type === "text");
    const answer = textBlocks.map((block) => block.text as string).join("\n");
    const searchInfo = extractSearchInfo(content);

    this.lastSearchInfo = searchInfo;

    return {
      answer,
      searchInfo,
    };
  }

  /**
   * Perform a web search using Bedrock with Brave Search API
   */
  private async webSearchWithBedrock(query: string): Promise<{
    answer: string;
    searchInfo: WebSearchInfo;
  }> {
    if (!this.tavilyApiKey) {
      throw new Error("Brave API key not configured");
    }

    // First, do the actual search
    const searchResults = await executeWebSearch(query, this.tavilyApiKey);
    const formattedResults = formatSearchResultsForClaude(searchResults);

    // Then ask Claude to summarize/analyze the results
    const command = new ConverseCommand({
      modelId: this.model,
      messages: [
        {
          role: "user",
          content: [
            {
              text: `I searched the web for: "${query}"\n\nHere are the search results:\n\n${formattedResults}\n\nPlease analyze these results and provide a comprehensive answer to the query. Include relevant information from the sources and cite them.`,
            },
          ],
        },
      ],
      system: [{ text: "You are a helpful assistant. Analyze the provided web search results and give a comprehensive, well-organized answer. Cite your sources." }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
      },
    });

    const response = await this.bedrockClient.send(command);
    const answer = response.output?.message?.content?.[0]?.text || "";

    const searchInfo: WebSearchInfo = {
      searchQueries: [query],
      searchResults: searchResults.map(r => ({ url: r.url, title: r.title })),
      citations: [],
    };

    this.lastSearchInfo = searchInfo;

    return {
      answer,
      searchInfo,
    };
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.currentWorkbook = null;
    this.currentEnhancedWorkbook = null;
    this.currentStructure = null;
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
