/**
 * Web search tool configuration for Claude
 *
 * Supports both:
 * - Anthropic API: Uses built-in web_search_20250305 tool (server-side)
 * - AWS Bedrock: Uses custom tool definition with external search API
 */

import type { WebSearchConfig, WebSearchResult } from "./types.js";

/**
 * Build the web search tool definition for Claude API
 */
export function buildWebSearchTool(config?: WebSearchConfig) {
  const tool: Record<string, unknown> = {
    type: "web_search_20250305",
    name: "web_search",
  };

  if (config?.maxUses) {
    tool.max_uses = config.maxUses;
  }

  if (config?.allowedDomains && config.allowedDomains.length > 0) {
    tool.allowed_domains = config.allowedDomains;
  }

  if (config?.blockedDomains && config.blockedDomains.length > 0) {
    tool.blocked_domains = config.blockedDomains;
  }

  if (config?.userLocation) {
    tool.user_location = {
      type: "approximate",
      ...config.userLocation,
    };
  }

  return tool;
}

/**
 * Extract search results and citations from Claude's response
 */
export function extractSearchInfo(content: Array<Record<string, unknown>>): {
  searchQueries: string[];
  searchResults: Array<{ url: string; title: string; pageAge?: string }>;
  citations: Array<{ url: string; title: string; citedText: string }>;
} {
  const searchQueries: string[] = [];
  const searchResults: Array<{ url: string; title: string; pageAge?: string }> = [];
  const citations: Array<{ url: string; title: string; citedText: string }> = [];

  for (const block of content) {
    // Extract search queries from server_tool_use blocks
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const input = block.input as Record<string, unknown>;
      if (input?.query) {
        searchQueries.push(input.query as string);
      }
    }

    // Extract search results
    if (block.type === "web_search_tool_result") {
      const results = block.content as Array<Record<string, unknown>>;
      if (Array.isArray(results)) {
        for (const result of results) {
          if (result.type === "web_search_result") {
            searchResults.push({
              url: result.url as string,
              title: result.title as string,
              pageAge: result.page_age as string | undefined,
            });
          }
        }
      }
    }

    // Extract citations from text blocks
    if (block.type === "text" && block.citations) {
      const blockCitations = block.citations as Array<Record<string, unknown>>;
      for (const citation of blockCitations) {
        if (citation.type === "web_search_result_location") {
          citations.push({
            url: citation.url as string,
            title: citation.title as string,
            citedText: citation.cited_text as string,
          });
        }
      }
    }
  }

  return { searchQueries, searchResults, citations };
}

/**
 * Format web search results for display
 */
export function formatSearchResults(
  searchResults: Array<{ url: string; title: string; pageAge?: string }>,
  citations: Array<{ url: string; title: string; citedText: string }>
): string {
  let output = "";

  if (searchResults.length > 0) {
    output += "Sources searched:\n";
    for (const result of searchResults) {
      output += `  - ${result.title}\n    ${result.url}`;
      if (result.pageAge) {
        output += ` (${result.pageAge})`;
      }
      output += "\n";
    }
  }

  if (citations.length > 0) {
    output += "\nCitations:\n";
    for (const citation of citations) {
      output += `  - ${citation.title}\n    ${citation.url}\n`;
      if (citation.citedText) {
        output += `    "${citation.citedText}"\n`;
      }
    }
  }

  return output;
}

/**
 * Bedrock tool definition for web search
 * This is used with Bedrock's Converse API toolConfig
 */
export function buildBedrockWebSearchTool() {
  return {
    toolSpec: {
      name: "web_search",
      description: "Search the internet for information. Use this when you need to find information about companies, certifications, products, or any other external data not present in the spreadsheet. Always use this tool when the user asks to 'search', 'lookup', 'find online', or asks about company information.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to look up on the internet"
            }
          },
          required: ["query"]
        }
      }
    }
  };
}

/**
 * Execute a web search using Tavily Search API
 */
export async function executeWebSearch(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    results?: Array<{
      url: string;
      title: string;
      content: string;
      published_date?: string;
    }>;
  };

  const results: WebSearchResult[] = [];

  if (data.results) {
    for (const result of data.results) {
      results.push({
        url: result.url,
        title: result.title,
        snippet: result.content,
        age: result.published_date,
      });
    }
  }

  return results;
}

/**
 * Format search results for Claude to process
 */
export function formatSearchResultsForClaude(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  let output = "Web search results:\n\n";

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    output += `${i + 1}. ${result.title}\n`;
    output += `   URL: ${result.url}\n`;
    output += `   ${result.snippet}\n`;
    if (result.age) {
      output += `   Age: ${result.age}\n`;
    }
    output += "\n";
  }

  return output;
}
