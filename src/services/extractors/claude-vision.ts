/**
 * Claude Vision PDF Extractor
 *
 * Uses Claude's vision capabilities via AWS Bedrock to extract
 * table content from PDF files. This serves as a fallback when
 * Azure Document Intelligence misses content.
 *
 * Claude can read PDFs directly, so we pass the PDF as a document.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFile } from 'fs/promises';

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

export interface TableRow {
  question: string;
  yes: boolean | null;
  no: boolean | null;
  na: boolean | null;
  comment: string;
  fieldValue?: string; // For non-Yes/No fields
}

export interface ExtractedTable {
  section: string;
  rows: TableRow[];
}

export interface ClaudeVisionResult {
  tables: ExtractedTable[];
  pageCount: number;
}

/**
 * Extract table content from PDF using Claude Vision
 */
async function extractTablesFromPdf(pdfBuffer: Buffer): Promise<ExtractedTable[]> {
  const client = getClient();
  const base64Pdf = pdfBuffer.toString('base64');

  const prompt = `Analyze this questionnaire PDF and extract ALL content - both tables and form fields.

EXTRACT TWO TYPES OF CONTENT:

## 1. TABLE ROWS (Yes/No/N/A questions)
For tables with Yes/No columns, extract each row with:
- The question text
- Whether "Yes" is marked (X, checkbox, or circled)
- Whether "No" is marked
- Whether "N/A" is marked
- The COMMENTS column text (capture ALL text even if faint or narrow)

## 2. FORM FIELDS (label: value pairs)
For form fields like "Company Name: ____", extract:
- The label text
- The filled-in value (handwritten or typed)

CRITICAL FORMATTING RULES:

1. STRIKETHROUGH DETECTION: Some questionnaires mark the WRONG answer with strikethrough:
   - If "YES" has a line through it → answer is "No"
   - If "NO" has a line through it → answer is "Yes"
   - The option WITHOUT strikethrough is the selected answer

2. CHECKBOX DETECTION: Look for X marks, checkmarks (✓), filled boxes (☒), or circles around answers

3. HANDWRITTEN TEXT: Capture handwritten values even if slightly messy

4. FAINT/SMALL TEXT: Capture all text even if faint, grey, or in narrow columns

5. ATTACHED DOCUMENTS: Note references like "See attached", "Certificate enclosed"

Return your response as a JSON array:
[
  {
    "section": "SECTION NAME",
    "rows": [
      {
        "question": "The question or label text",
        "yes": true,
        "no": false,
        "na": false,
        "comment": "Comment text or field value",
        "fieldValue": "For non-Yes/No fields, the actual value"
      }
    ]
  }
]

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
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }]
    }),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.content[0].text;

  // Parse JSON response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('  No JSON found in Claude response');
    return [];
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.warn('  Failed to parse JSON from Claude response:', error);
    return [];
  }
}

/**
 * Extract tables from a PDF using Claude Vision
 */
export async function extractPdfWithClaudeVision(filepath: string): Promise<ClaudeVisionResult> {
  console.log('  Reading PDF file...');
  const pdfBuffer = await readFile(filepath);
  console.log(`  PDF size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  console.log('  Extracting with Claude Vision...');
  const tables = await extractTablesFromPdf(pdfBuffer);

  // Count rows to estimate pages
  let totalRows = 0;
  for (const table of tables) {
    totalRows += table.rows.length;
  }

  return {
    tables,
    pageCount: Math.ceil(totalRows / 50) || 1 // Estimate
  };
}

/**
 * Merge Claude Vision results with Azure DI extraction
 * to fill in missing comments
 */
export function mergeWithAzureResults(
  azureRows: Array<{ question: string; comment: string }>,
  visionTables: ExtractedTable[]
): Array<{ question: string; comment: string }> {
  // Create a map of questions to comments from Claude Vision
  const visionComments = new Map<string, string>();

  for (const table of visionTables) {
    for (const row of table.rows) {
      if (row.comment) {
        // Normalize question for matching
        const normalizedQ = row.question.toLowerCase().trim().replace(/[?:]/g, '');
        visionComments.set(normalizedQ, row.comment);
      }
    }
  }

  // Fill in missing comments from Azure with Claude Vision results
  return azureRows.map(row => {
    if (!row.comment || row.comment.trim() === '') {
      const normalizedQ = row.question.toLowerCase().trim().replace(/[?:]/g, '');
      const visionComment = visionComments.get(normalizedQ);
      if (visionComment) {
        return { ...row, comment: visionComment };
      }
    }
    return row;
  });
}
