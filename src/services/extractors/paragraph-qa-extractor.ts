/**
 * Paragraph Q&A Extractor
 * 
 * Uses Claude to match questions with answers from PDF paragraphs
 * based on spatial proximity (Y coordinates).
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface ParagraphWithPosition {
  content: string;
  pageNumber: number;
  boundingBox?: number[]; // [x1,y1, x2,y2, x3,y3, x4,y4] in inches
}

export interface ExtractedQAPair {
  question: string;
  answer: string;
  pageNumber: number;
  questionIdx: number;
  answerIdx: number;
}

export class ParagraphQAExtractor {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(region: string = 'eu-central-1') {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';
  }

  /**
   * Extract Q&A pairs from paragraphs using Claude to match by proximity
   */
  async extractQAPairs(paragraphs: ParagraphWithPosition[]): Promise<ExtractedQAPair[]> {
    if (!paragraphs || paragraphs.length < 2) return [];

    // Group paragraphs by page
    const byPage = new Map<number, ParagraphWithPosition[]>();
    for (const p of paragraphs) {
      const page = p.pageNumber || 1;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(p);
    }

    const allPairs: ExtractedQAPair[] = [];

    // Process each page
    for (const [pageNum, pageParagraphs] of byPage) {
      // Skip pages with too few paragraphs
      if (pageParagraphs.length < 2) continue;

      // Check if page has potential Q&A (has Yes/No answers)
      const hasYesNo = pageParagraphs.some(p => 
        /^(yes|no|ja|nein|oui|non|n\/a)$/i.test(p.content.trim())
      );
      if (!hasYesNo) continue;

      const pairs = await this.extractFromPage(pageNum, pageParagraphs);
      allPairs.push(...pairs);
    }

    return allPairs;
  }

  private async extractFromPage(
    pageNum: number,
    paragraphs: ParagraphWithPosition[]
  ): Promise<ExtractedQAPair[]> {
    // Sort by Y position
    const sorted = [...paragraphs].sort((a, b) => {
      const yA = a.boundingBox?.[1] ?? 0;
      const yB = b.boundingBox?.[1] ?? 0;
      return yA - yB;
    });

    // Build text list with positions
    const textList = sorted.map((p, i) => {
      const y = p.boundingBox?.[1]?.toFixed(2) || '?';
      return `[${i}] y=${y}" : "${p.content}"`;
    }).join('\n');

    const prompt = `I have PDF paragraphs from page ${pageNum} with their Y positions (inches from top).

${textList}

Find Q&A pairs where:
- A question is followed by "Yes", "No", "Ja", "Nein", "N/A" at similar Y position
- Items at nearly same Y = horizontally adjacent (question left, answer right)
- Items at slightly different Y = vertically stacked (question above, answer below)

Return ONLY valid Q&A pairs as JSON array:
[{"question_idx": N, "answer_idx": M, "question": "full text", "answer": "Yes/No/etc"}]

Rules:
- Only include pairs where answer is exactly Yes/No/Ja/Nein/N/A
- Question must be >15 chars (not just a label)
- Skip headers, titles, page numbers
- Return empty array [] if no valid pairs found`;

    try {
      const response = await this.client.send(new InvokeModelCommand({
        modelId: this.modelId,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: prompt,
          }],
        }),
        contentType: 'application/json',
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content[0].text;

      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const pairs = JSON.parse(jsonMatch[0]);
      
      return pairs.map((p: any) => ({
        question: p.question,
        answer: p.answer,
        pageNumber: pageNum,
        questionIdx: p.question_idx,
        answerIdx: p.answer_idx,
      }));
    } catch (error) {
      console.error(`  Error extracting Q&A from page ${pageNum}:`, error);
      return [];
    }
  }
}
