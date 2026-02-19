/**
 * Text-based Q&A Extractor
 *
 * Extracts Q&A pairs from documents where questions and answers
 * are in flowing text format rather than table cells.
 *
 * Handles formats like:
 * - "Question: ... Answer: ..."
 * - "1.1 Question text\nAnswer: Response text"
 * - Numbered questions followed by answer paragraphs
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const execAsync = promisify(exec);
const MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';

let bedrockClient: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'eu-central-1'
    });
  }
  return bedrockClient;
}

// =============================================================================
// TYPES
// =============================================================================

export interface ExtractedQA {
  id: string;
  section: string;
  questionNumber?: string;  // e.g., "1.1", "2.3"
  question: string;
  answer: string;
  pageNumber?: number;
}

export interface TextQAResult {
  items: ExtractedQA[];
  sections: string[];
  pageCount: number;
  extractionMethod: 'pdftotext' | 'claude_vision';
}

// =============================================================================
// TEXT EXTRACTION
// =============================================================================

/**
 * Extract text from PDF using pdftotext
 */
async function extractTextFromPdf(filepath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`pdftotext -layout "${filepath}" -`);
    return stdout;
  } catch (error) {
    console.error('  pdftotext failed, trying alternative...');
    // Could fall back to other methods here
    throw error;
  }
}

/**
 * Get page count from PDF
 */
async function getPdfPageCount(filepath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`pdfinfo "${filepath}" | grep Pages | awk '{print $2}'`);
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// Q&A PARSING
// =============================================================================

/**
 * Parse text content to extract Q&A pairs using Claude
 */
async function parseQAWithClaude(
  text: string,
  filename: string
): Promise<ExtractedQA[]> {
  const client = getClient();

  // Truncate if too long - keep first and last parts for context
  const maxLength = 50000;
  let truncatedText = text;
  if (text.length > maxLength) {
    const firstPart = text.slice(0, maxLength * 0.7);
    const lastPart = text.slice(-maxLength * 0.3);
    truncatedText = `${firstPart}\n\n[... content truncated for length - showing first 70% and last 30% ...]\n\n${lastPart}`;
  }

  const prompt = `Extract all question-answer pairs from this questionnaire document.

DOCUMENT: "${filename}"

CONTENT:
${truncatedText}

Extract each Q&A pair and return as JSON array:
[
  {
    "section": "Section name (e.g., 'Organisation and Finance', 'Quality and Food Safety')",
    "questionNumber": "Number if present (e.g., '1.1', '2.3')",
    "question": "The question text",
    "answer": "The answer text"
  }
]

EXTRACTION RULES:
1. Look for patterns like "Question... Answer:", numbered questions, or Q&A sections
2. Capture the FULL answer text, not just the first line
3. Group questions under their section headers
4. Skip table of contents entries (just topic + page number)
5. Skip instructions on how to fill out the form
6. Include all actual Q&A content even if answers are "Yes", "No", or "confidential"

Return ONLY the JSON array, no other text.`;

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: prompt
      }]
    }),
  });

  try {
    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const responseText = responseBody.content[0].text;

    // Parse JSON response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('  No JSON array found in Claude response');
      return [];
    }

    const items = JSON.parse(jsonMatch[0]) as Array<{
      section: string;
      questionNumber?: string;
      question: string;
      answer: string;
    }>;

    // Add IDs
    return items.map((item, index) => ({
      id: `qa_${index + 1}`,
      ...item
    }));

  } catch (error) {
    console.error('  Claude Q&A parsing failed:', error);
    return [];
  }
}

/**
 * Simple regex-based Q&A extraction (fallback)
 */
function parseQAWithRegex(text: string): ExtractedQA[] {
  const items: ExtractedQA[] = [];
  let currentSection = 'General';

  // Split into lines
  const lines = text.split('\n');

  let currentQuestion = '';
  let currentAnswer = '';
  let questionNumber = '';
  let inAnswer = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect section headers (all caps or specific patterns)
    if (/^[A-Z][a-z]+ and [A-Z][a-z]+$/.test(line) ||
        /^[A-Z][a-z]+, [A-Z][a-z]+ and [A-Z][a-z]+/.test(line) ||
        /^(Organisation|Quality|Technical|Sustainability|Environment)/.test(line)) {
      // Check if next line is NOT a number (to avoid TOC)
      if (i + 1 < lines.length && !/^\d+\./.test(lines[i + 1].trim())) {
        currentSection = line;
      }
      continue;
    }

    // Detect numbered question (e.g., "1.1 Question text")
    const questionMatch = line.match(/^(\d+\.\d+)\s+(.+)/);
    if (questionMatch) {
      // Save previous Q&A if exists
      if (currentQuestion && currentAnswer) {
        items.push({
          id: `qa_${items.length + 1}`,
          section: currentSection,
          questionNumber,
          question: currentQuestion,
          answer: currentAnswer.trim()
        });
      }

      questionNumber = questionMatch[1];
      currentQuestion = questionMatch[2];
      currentAnswer = '';
      inAnswer = false;
      continue;
    }

    // Detect "Answer:" line
    if (line.startsWith('Answer:')) {
      currentAnswer = line.replace('Answer:', '').trim();
      inAnswer = true;
      continue;
    }

    // Continue answer on next lines
    if (inAnswer && line && !line.match(/^\d+\.\d+/)) {
      currentAnswer += ' ' + line;
    }
  }

  // Don't forget last item
  if (currentQuestion && currentAnswer) {
    items.push({
      id: `qa_${items.length + 1}`,
      section: currentSection,
      questionNumber,
      question: currentQuestion,
      answer: currentAnswer.trim()
    });
  }

  return items;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Extract Q&A pairs from a text-based questionnaire PDF
 */
export async function extractTextQA(filepath: string): Promise<TextQAResult> {
  console.log('  Extracting text from PDF...');
  const text = await extractTextFromPdf(filepath);
  const pageCount = await getPdfPageCount(filepath);

  console.log(`  Extracted ${text.length} characters from ${pageCount} pages`);

  // Try Claude first for better accuracy
  console.log('  Parsing Q&A with Claude...');
  let items = await parseQAWithClaude(text, filepath.split('/').pop() || 'document');

  // Fallback to regex if Claude fails
  if (items.length === 0) {
    console.log('  Falling back to regex parsing...');
    items = parseQAWithRegex(text);
  }

  // Extract unique sections
  const sections = [...new Set(items.map(item => item.section))];

  console.log(`  Found ${items.length} Q&A pairs in ${sections.length} sections`);

  return {
    items,
    sections,
    pageCount,
    extractionMethod: items.length > 0 ? 'claude_vision' : 'pdftotext'
  };
}
