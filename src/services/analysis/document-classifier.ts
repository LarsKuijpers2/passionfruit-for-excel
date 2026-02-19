/**
 * Document Classifier
 *
 * Analyzes raw document content to understand:
 * 1. What type of document is this?
 * 2. What elements are present?
 * 3. Should we extract Q&A from this?
 *
 * This runs BEFORE cell-based extraction to handle documents
 * that are pure text (no tables/cells).
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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

export type DocumentType =
  | 'questionnaire_checkbox'    // Tables with Yes/No checkboxes
  | 'questionnaire_text'        // Q&A as flowing text
  | 'questionnaire_mixed'       // Both tables and text sections
  | 'table_of_contents'         // Index/TOC referencing pages
  | 'certificate'               // ISO, FSSC, audit certificates
  | 'specification'             // Product/material specs
  | 'policy_document'           // Policies, procedures
  | 'audit_report'              // Audit findings/reports
  | 'contract'                  // Agreements, contracts
  | 'unknown';

export type ContentElement =
  | 'checkbox_table'            // Yes/No/N/A tables
  | 'data_table'                // Tables with data (not checkboxes)
  | 'text_qa'                   // Question followed by text answer
  | 'form_fields'               // Label: value pairs
  | 'section_headers'           // Numbered/titled sections
  | 'page_references'           // "See page X" type references
  | 'signatures'                // Signature blocks, dates
  | 'free_text'                 // Paragraphs of text
  | 'lists'                     // Bulleted/numbered lists
  | 'certificates_mentioned';   // References to certs

export interface SectionClassification {
  name: string;                 // Section name/identifier
  type: 'qa_checkbox' | 'qa_text' | 'form_fields' | 'data_table' | 'toc' | 'instructions' | 'metadata' | 'references' | 'signature' | 'unknown';
  shouldExtract: boolean;
  reason: string;
  rowRange?: { start: number; end: number };  // Which rows belong to this section
  pageRange?: { start: number; end: number }; // Which pages
}

export interface DocumentClassification {
  documentType: DocumentType;
  confidence: number;           // 0-1 confidence in classification
  elements: ContentElement[];   // What's in the document
  language: string;             // Detected language

  // Section-level decisions (per-part extraction)
  sections: SectionClassification[];

  // Overall extraction decision (based on sections)
  shouldExtract: boolean;       // True if ANY section should be extracted
  extractionReason: string;     // Summary of what to extract

  // Recommended extraction method
  recommendedMethod: 'table' | 'text' | 'both' | 'skip';
  methodReason: string;         // Why this method

  // Content summary
  summary: string;              // Brief description
  topics: string[];             // Main topics covered

  // Structure info
  hasTableStructure: boolean;   // Has extractable tables
  hasTextContent: boolean;      // Has significant text content
  pageCount?: number;

  // Warnings
  warnings: string[];           // Issues detected
}

// =============================================================================
// CLASSIFIER
// =============================================================================

/**
 * Classify a document based on its raw content
 *
 * @param content - Raw text/markdown content from the document
 * @param filename - Original filename for context
 * @returns Classification result
 */
export async function classifyDocument(
  content: string,
  filename: string
): Promise<DocumentClassification> {
  const client = getClient();

  // Truncate content if too long (keep first and last parts for context)
  const maxLength = 30000;
  let truncatedContent = content;
  if (content.length > maxLength) {
    const firstPart = content.slice(0, maxLength * 0.7);
    const lastPart = content.slice(-maxLength * 0.3);
    truncatedContent = `${firstPart}\n\n[... content truncated ...]\n\n${lastPart}`;
  }

  const prompt = `Analyze this document and classify it. The filename is: "${filename}"

DOCUMENT CONTENT:
${truncatedContent}

Analyze the document and respond with a JSON object. IMPORTANT: Classify each SECTION separately - a document may have some sections to extract and others to skip.

{
  "documentType": "<one of: questionnaire_checkbox, questionnaire_text, questionnaire_mixed, table_of_contents, certificate, specification, policy_document, audit_report, contract, unknown>",
  "confidence": <0.0-1.0>,
  "elements": ["<list of elements found: checkbox_table, data_table, text_qa, form_fields, section_headers, page_references, signatures, free_text, lists, certificates_mentioned>"],
  "language": "<detected language code, e.g., en, de, nl, fr>",
  "sections": [
    {
      "name": "<section name or description>",
      "type": "<one of: qa_checkbox, qa_text, form_fields, data_table, toc, instructions, metadata, references, signature, unknown>",
      "shouldExtract": <true/false>,
      "reason": "<why extract or skip this section>"
    }
  ],
  "shouldExtract": <true if ANY section should be extracted>,
  "extractionReason": "<summary of what sections to extract and why>",
  "recommendedMethod": "<one of: table, text, both, skip>",
  "methodReason": "<why this extraction method>",
  "summary": "<1-2 sentence description of what this document is>",
  "topics": ["<main topics covered>"],
  "hasTableStructure": <true/false - does it have tables we can extract from?>,
  "hasTextContent": <true/false - does it have significant text Q&A content?>,
  "warnings": ["<any issues or concerns>"]
}

EXTRACTION METHOD:
- table: Document has checkbox tables (Yes/No/N/A) - use Azure table extraction
- text: Document has text-based Q&A ("Question... Answer:") - use text extraction
- both: Document has both table sections AND text Q&A sections
- skip: No extractable Q&A content

SECTION TYPES:
- qa_checkbox: Yes/No/N/A questions with checkboxes → EXTRACT
- qa_text: Questions with free-text answers → EXTRACT
- form_fields: Label: value pairs (company name, address, etc.) → EXTRACT
- data_table: Tables with data (certifications, products) → EXTRACT
- toc: Table of contents, index → SKIP (just references)
- instructions: How to fill out the form → SKIP
- metadata: Document info, revision history → SKIP
- references: "See attached", page references → SKIP
- signature: Signature blocks, dates → MAY EXTRACT (for tracking)

IMPORTANT: Don't skip the whole document just because one section is a TOC or instructions. Identify EACH section and decide separately.

Return ONLY the JSON object, no other text.`;

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: prompt
      }]
    }),
  });

  try {
    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content[0].text;

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('  No JSON found in classifier response');
      return getDefaultClassification(filename);
    }

    const result = JSON.parse(jsonMatch[0]) as DocumentClassification;
    return result;

  } catch (error) {
    console.error('  Document classification failed:', error);
    return getDefaultClassification(filename);
  }
}

/**
 * Default classification when analysis fails
 */
function getDefaultClassification(filename: string): DocumentClassification {
  return {
    documentType: 'unknown',
    confidence: 0,
    elements: [],
    language: 'en',
    sections: [{
      name: 'Unknown content',
      type: 'unknown',
      shouldExtract: true,
      reason: 'Classification failed, attempting extraction anyway'
    }],
    shouldExtract: true, // Default to extracting, let later stages decide
    extractionReason: 'Classification failed, attempting extraction anyway',
    recommendedMethod: 'both',
    methodReason: 'Classification failed, trying both table and text extraction',
    summary: `Unknown document: ${filename}`,
    topics: [],
    hasTableStructure: true, // Assume yes
    hasTextContent: true,
    warnings: ['Automatic classification failed']
  };
}

/**
 * Quick check if document looks like a TOC
 * (Can be used before full classification for speed)
 */
export function quickTocCheck(content: string): boolean {
  const lines = content.split('\n').slice(0, 100); // Check first 100 lines

  let pageRefCount = 0;
  let numberedItemCount = 0;

  for (const line of lines) {
    // Count lines that look like "Topic name ... 5" or "1. Topic ... page 3"
    if (/\b\d{1,3}\s*$/.test(line.trim())) {
      pageRefCount++;
    }
    // Count numbered items like "1.", "2.", "1.1", etc.
    if (/^\s*\d+\.(\d+\.)*\s+\w/.test(line)) {
      numberedItemCount++;
    }
  }

  // If most lines are numbered items ending with page numbers, likely TOC
  const totalLines = lines.filter(l => l.trim()).length;
  return totalLines > 10 && (pageRefCount / totalLines) > 0.5;
}

/**
 * Check if document has significant text Q&A content
 */
export function hasTextQAContent(content: string): boolean {
  // Look for question patterns followed by substantial text
  const questionPatterns = [
    /\?\s*\n+[A-Z]/g,                    // Question mark followed by answer
    /^(Do|Does|Is|Are|Have|Has|What|How|When|Where|Which|Can|Could|Will|Would)\s+.+\?/gim,
    /^\d+\.\s*(Do|Does|Is|Are|What|How).+\?/gim,  // Numbered questions
  ];

  let questionCount = 0;
  for (const pattern of questionPatterns) {
    const matches = content.match(pattern);
    if (matches) questionCount += matches.length;
  }

  return questionCount > 5;
}
