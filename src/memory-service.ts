/**
 * Memory service using Supermemory for persistent context across sessions
 *
 * This enables Claude to:
 * - Remember user preferences and past interactions
 * - Learn from previous questionnaire completions
 * - Build a profile of customers/suppliers over time
 */

import { supermemoryTools, searchMemoriesTool, addMemoryTool } from '@supermemory/tools/ai-sdk';
import type { MemoryConfig, MemorySearchResult, ConversationContext } from './types.js';

export class MemoryService {
  private apiKey: string;
  private tools: ReturnType<typeof supermemoryTools> | null = null;
  private userId: string;
  private projectId: string;

  constructor(config: MemoryConfig) {
    this.apiKey = config.apiKey;
    this.userId = config.userId || 'default-user';
    this.projectId = config.projectId || 'passionfruit-excel';

    if (this.apiKey) {
      this.tools = supermemoryTools(this.apiKey, {
        containerTags: [this.userId, this.projectId],
      });
    }
  }

  /**
   * Check if memory service is available
   */
  isAvailable(): boolean {
    return this.tools !== null;
  }

  /**
   * Search for relevant memories based on a query
   */
  async search(query: string): Promise<MemorySearchResult[]> {
    if (!this.tools) {
      return [];
    }

    try {
      const result = await this.tools.searchMemories.execute({
        informationToGet: query,
      });

      if (result.success && result.results) {
        return result.results.map((r: { content: string; score: number; metadata?: Record<string, unknown> }) => ({
          content: r.content,
          score: r.score,
          metadata: r.metadata,
        }));
      }

      return [];
    } catch (error) {
      console.error('Memory search error:', error);
      return [];
    }
  }

  /**
   * Add a new memory
   */
  async add(content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    if (!this.tools) {
      return false;
    }

    try {
      const result = await this.tools.addMemory.execute({
        memory: content,
        metadata: {
          ...metadata,
          userId: this.userId,
          projectId: this.projectId,
          timestamp: new Date().toISOString(),
        },
      });

      return result.success === true;
    } catch (error) {
      console.error('Memory add error:', error);
      return false;
    }
  }

  /**
   * Store conversation context for future sessions
   */
  async storeConversation(context: ConversationContext): Promise<boolean> {
    const content = this.formatConversationForMemory(context);
    return this.add(content, {
      type: 'conversation',
      workbook: context.workbookName,
      topic: context.topic,
    });
  }

  /**
   * Store customer/supplier information learned from questionnaires
   */
  async storeCustomerInfo(info: {
    name: string;
    data: Record<string, unknown>;
    source: string;
  }): Promise<boolean> {
    const content = `Customer/Supplier Information for ${info.name}:\n` +
      Object.entries(info.data)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join('\n');

    return this.add(content, {
      type: 'customer_info',
      customerName: info.name,
      source: info.source,
    });
  }

  /**
   * Store user preferences (e.g., formatting, default values)
   */
  async storePreference(key: string, value: string, description?: string): Promise<boolean> {
    const content = description
      ? `User preference: ${key} = ${value}. ${description}`
      : `User preference: ${key} = ${value}`;

    return this.add(content, {
      type: 'preference',
      preferenceKey: key,
      preferenceValue: value,
    });
  }

  /**
   * Get relevant context for a new conversation about a workbook
   */
  async getRelevantContext(workbookName: string, userQuery: string): Promise<string> {
    if (!this.tools) {
      return '';
    }

    // Search for relevant memories
    const searchQueries = [
      `information about ${workbookName}`,
      userQuery,
      'user preferences for Excel questionnaires',
    ];

    const allResults: MemorySearchResult[] = [];

    for (const query of searchQueries) {
      const results = await this.search(query);
      allResults.push(...results);
    }

    // Deduplicate and sort by relevance
    const uniqueResults = this.deduplicateResults(allResults);
    const topResults = uniqueResults.slice(0, 5);

    if (topResults.length === 0) {
      return '';
    }

    // Format as context for Claude
    return '\n\n## Relevant Memory Context:\n' +
      topResults.map((r, i) => `${i + 1}. ${r.content}`).join('\n');
  }

  /**
   * Format conversation for storage
   */
  private formatConversationForMemory(context: ConversationContext): string {
    const lines = [
      `Conversation about workbook: ${context.workbookName}`,
      `Topic: ${context.topic}`,
      '',
      'Key points:',
    ];

    for (const point of context.keyPoints) {
      lines.push(`- ${point}`);
    }

    if (context.modifications.length > 0) {
      lines.push('', 'Modifications made:');
      for (const mod of context.modifications) {
        lines.push(`- ${mod.cell}: ${mod.oldValue} → ${mod.newValue}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Deduplicate search results by content similarity
   */
  private deduplicateResults(results: MemorySearchResult[]): MemorySearchResult[] {
    const seen = new Set<string>();
    const unique: MemorySearchResult[] = [];

    for (const result of results) {
      // Simple deduplication by first 100 chars
      const key = result.content.substring(0, 100).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }

    // Sort by score descending
    return unique.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
}

/**
 * Create a memory service instance from environment
 */
export function createMemoryService(userId?: string): MemoryService | null {
  const apiKey = process.env.SUPERMEMORY_API_KEY;

  if (!apiKey) {
    return null;
  }

  return new MemoryService({
    apiKey,
    userId: userId || process.env.USER || 'default',
    projectId: 'passionfruit-excel',
  });
}

export default MemoryService;
