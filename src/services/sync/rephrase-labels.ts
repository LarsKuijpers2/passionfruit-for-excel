/**
 * AI Label Rephrasing Service
 *
 * Uses Claude to transform short/cryptic labels into natural,
 * self-explanatory questions while preserving the original language.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// =============================================================================
// TYPES
// =============================================================================

export interface RephraseInput {
  label: string;
  section?: string;
  topic?: string;
  value?: string;
  lang?: string;
}

export interface RephraseResult {
  original: string;
  rephrased: string;
  wasChanged: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Labels that are already self-explanatory don't need rephrasing */
const QUESTION_WORDS = ['what', 'which', 'how', 'where', 'when', 'why', 'who', 'does', 'do', 'is', 'are', 'can', 'will'];
const QUESTION_WORDS_NL = ['wat', 'welke', 'hoe', 'waar', 'wanneer', 'waarom', 'wie', 'heeft', 'is', 'zijn', 'kan', 'bent'];
const QUESTION_WORDS_DE = ['was', 'welche', 'wie', 'wo', 'wann', 'warum', 'wer', 'hat', 'ist', 'sind', 'kann'];

/** Topic labels for context in prompts */
const TOPIC_LABELS: Record<string, string> = {
  certifications: 'Certifications & Standards',
  food_safety: 'Food Safety & Hygiene',
  allergens: 'Allergens & Cross-Contamination',
  company: 'Company Information',
  contacts: 'Contact Information',
  quality: 'Quality Management',
  environment: 'Environmental & Sustainability',
  logistics: 'Logistics & Supply Chain',
  product: 'Product Information',
  packaging: 'Packaging',
  food_fraud: 'Food Fraud Prevention',
  microbiology: 'Microbiology & Testing',
  audits: 'Audits & Inspections',
  traceability: 'Traceability',
  other: 'General'
};

// =============================================================================
// INITIALIZATION
// =============================================================================

let client: BedrockRuntimeClient | null = null;
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';  // Fast model for simple rephrasing

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'eu-central-1'
    });
  }
  return client;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a label is already a self-explanatory question
 */
function isAlreadyQuestion(label: string): boolean {
  const lower = label.toLowerCase().trim();

  // Already ends with question mark
  if (label.trim().endsWith('?')) return true;

  // Starts with a question word
  const firstWord = lower.split(/\s+/)[0];
  if (QUESTION_WORDS.includes(firstWord)) return true;
  if (QUESTION_WORDS_NL.includes(firstWord)) return true;
  if (QUESTION_WORDS_DE.includes(firstWord)) return true;

  // Long enough to be self-explanatory (> 50 chars with multiple words)
  if (label.length > 50 && label.split(/\s+/).length > 5) return true;

  return false;
}

/**
 * Detect the language of a label (simple heuristic)
 */
function detectLanguage(label: string): string {
  const lower = label.toLowerCase();

  // Dutch indicators
  if (/\b(van|het|een|en|de|bij|voor|naar|zijn|wordt|heeft)\b/.test(lower)) return 'nl';

  // German indicators
  if (/\b(der|die|das|und|oder|für|bei|werden|haben|ist)\b/.test(lower)) return 'de';

  // French indicators
  if (/\b(le|la|les|des|du|et|ou|pour|avec|sont|est)\b/.test(lower)) return 'fr';

  // Default to English
  return 'en';
}

/**
 * Build the prompt for Claude to rephrase a label
 */
function buildPrompt(inputs: RephraseInput[]): string {
  const items = inputs.map((input, idx) => {
    const topicLabel = TOPIC_LABELS[input.topic || 'other'] || 'General';
    const lang = input.lang || detectLanguage(input.label);
    return `${idx + 1}. Label: "${input.label}"
   Section: "${input.section || 'Unknown'}"
   Category: "${topicLabel}"
   Language: ${lang}`;
  }).join('\n\n');

  return `Transform these short labels from supplier questionnaires into natural, self-explanatory questions.

RULES:
1. Keep EACH question in its ORIGINAL language (do NOT translate)
2. Make it a clear yes/no question OR information request
3. Include context from section/category if the label is ambiguous
4. If the label is already a clear question, return it unchanged
5. Keep the same meaning - don't add or remove requirements

ITEMS TO REPHRASE:
${items}

RESPONSE FORMAT:
Return a JSON array with rephrased questions in the same order:
[
  "Rephrased question 1",
  "Rephrased question 2",
  ...
]

Only return the JSON array, nothing else.`;
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Rephrase a single label (not recommended - use batch for efficiency)
 */
export async function rephraseLabel(input: RephraseInput): Promise<RephraseResult> {
  const results = await rephraseLabels([input]);
  return results[0];
}

/**
 * Rephrase multiple labels in a single API call (batch processing)
 * More efficient than calling one at a time.
 */
export async function rephraseLabels(inputs: RephraseInput[]): Promise<RephraseResult[]> {
  // Filter out labels that are already questions
  const needsRephrasing: { idx: number; input: RephraseInput }[] = [];
  const results: RephraseResult[] = inputs.map(input => ({
    original: input.label,
    rephrased: input.label,
    wasChanged: false
  }));

  for (let i = 0; i < inputs.length; i++) {
    if (!isAlreadyQuestion(inputs[i].label)) {
      needsRephrasing.push({ idx: i, input: inputs[i] });
    }
  }

  // If nothing needs rephrasing, return early
  if (needsRephrasing.length === 0) {
    return results;
  }

  // Batch in groups of 20 to avoid token limits
  const BATCH_SIZE = 20;
  for (let batchStart = 0; batchStart < needsRephrasing.length; batchStart += BATCH_SIZE) {
    const batch = needsRephrasing.slice(batchStart, batchStart + BATCH_SIZE);
    const batchInputs = batch.map(b => b.input);

    try {
      const prompt = buildPrompt(batchInputs);

      const response = await getClient().send(new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content[0].text;

      // Parse JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const rephrased = JSON.parse(jsonMatch[0]) as string[];

        // Apply rephrased labels back to results
        for (let i = 0; i < batch.length && i < rephrased.length; i++) {
          const originalIdx = batch[i].idx;
          const newLabel = rephrased[i].trim();

          if (newLabel && newLabel !== inputs[originalIdx].label) {
            results[originalIdx].rephrased = newLabel;
            results[originalIdx].wasChanged = true;
          }
        }
      }
    } catch (error) {
      console.error('Error calling Claude for label rephrasing:', error);
      // Keep original labels on error
    }
  }

  return results;
}

/**
 * Rephrase labels for aggregated items in place
 * Adds `rephrasedQuestion` field to each item
 */
export async function rephraseAggregatedItems(items: any[]): Promise<void> {
  const inputs: RephraseInput[] = items.map(item => ({
    label: item.label,
    section: item.section,
    topic: item.topic,
    value: item.value,
    lang: item.lang
  }));

  const results = await rephraseLabels(inputs);

  // Apply results back to items
  for (let i = 0; i < items.length; i++) {
    items[i].rephrasedQuestion = results[i].rephrased;
  }
}
