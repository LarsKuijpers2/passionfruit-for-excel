/**
 * Prepare Answers for Sync
 *
 * Extracts answers from answer library and prepares for API sync.
 * Checks existing answers in API to determine create vs update actions.
 * Translates non-English answers to English, preserving original in notes.
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PassionfruitAPIClient, type AnswerResponse } from './api-client.js';
import { loadSyncLog } from './sync-log.js';
import type { AnswerLibrary, HarvestedItem } from '../answer-harvester.js';

// Bedrock client for translations
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'eu-central-1',
});

interface PreparedAnswer {
  action: 'create' | 'update';
  existingId?: number;
  localId: string;
  question: string;
  answer: string;
  note: string;
  source: {
    file: string;
    lCell: string;
    vCell: string;
    harvestedAt: string;
  };
  metadata: {
    type: string;
    level: string;
    topic: string;
    lang?: string;
  };
}

interface PreparedAnswersOutput {
  summary: {
    total: number;
    toCreate: number;
    toUpdate: number;
    skipped: number;
  };
  answers: PreparedAnswer[];
  skipped: Array<{
    localId: string;
    question: string;
    reason: string;
  }>;
}

async function loadAnswerLibrary(path: string = './answer-library.yaml'): Promise<AnswerLibrary> {
  const content = await readFile(path, 'utf-8');
  return parseYaml(content);
}

/**
 * Translate text to English using Claude via Bedrock
 */
async function translateToEnglish(text: string, fromLang: string): Promise<string> {
  // Skip if already English or very short
  if (fromLang === 'en' || text.length < 3) {
    return text;
  }

  // Skip if it looks like a simple yes/no or code
  if (/^(ja|nein|yes|no|ja-yes|nein-no)$/i.test(text.trim())) {
    return text.toLowerCase().includes('ja') ? 'Yes' : 'No';
  }

  const prompt = `Translate the following ${fromLang === 'nl' ? 'Dutch' : fromLang === 'de' ? 'German' : 'non-English'} text to English.
Only output the translation, nothing else. Keep it concise and professional.

Text: ${text}`;

  try {
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.content[0]?.text?.trim() || text;
  } catch (error) {
    console.warn(`  ⚠ Translation failed for: ${text.substring(0, 30)}...`);
    return text; // Return original on error
  }
}

/**
 * Batch translate multiple items
 */
async function translateBatch(items: Array<{ question: string; answer: string; lang?: string }>): Promise<Array<{ question: string; answer: string; originalQuestion?: string; originalAnswer?: string }>> {
  const results: Array<{ question: string; answer: string; originalQuestion?: string; originalAnswer?: string }> = [];

  for (const item of items) {
    const lang = item.lang || 'en';

    if (lang === 'en') {
      results.push({ question: item.question, answer: item.answer });
    } else {
      const translatedQ = await translateToEnglish(item.question, lang);
      const translatedA = await translateToEnglish(item.answer, lang);

      results.push({
        question: translatedQ,
        answer: translatedA,
        originalQuestion: item.question !== translatedQ ? item.question : undefined,
        originalAnswer: item.answer !== translatedA ? item.answer : undefined,
      });
    }
  }

  return results;
}

/**
 * Check if an answer is an entity field that should be skipped
 * (entity fields are synced to entity database, not answer library)
 */
function isEntityField(item: HarvestedItem): boolean {
  // Skip entity-level fields that go into the entity database
  // Use word boundaries (\b) to avoid false matches like "Bevat" matching "vat"
  const entityFieldPatterns = [
    // Company identification
    /bedrijfsnaam/i, /company\s*name/i, /firmenname/i,
    /^adres$/i, /^address$/i, /^street$/i, /^straat$/i,
    /postcode/i, /postal\s*code/i, /^zip\b/i, /^plz\b/i,
    /^city$/i, /^plaats$/i, /^stadt$/i, /^ort$/i,
    /^country$/i, /^land$/i,

    // Contact info
    /\be-?mail\b/i, /\bemail\b/i, /e-mail.*address/i, /email.*address/i,
    /telefoon/i, /\bphone\b/i, /telefon/i, /\bmobil/i,
    /^fax$/i,
    /contactpersoon/i, /contact.*person/i, /ansprechpartner/i,
    /^functie$/i, /^function$/i, /^role$/i, /^position$/i,
    /^naam$/i, /^name$/i, // Contact/signature name (exact match only)

    // Business registration
    /eg-?nummer/i,
    /kvk/i, /chamber.*commerce/i,
    /\bbtw\b/i, /\bvat\s*(number|nummer)/i, /tax\s*number/i, /\bust\b.*id/i,
    /\biban\b/i, /\bbic\b/i, /bank\s*details/i,

    // Website
    /^website$/i, /^homepage$/i,

    // Dates (signature)
    /^datum$/i, /^date$/i,
  ];

  return entityFieldPatterns.some(p => p.test(item.label));
}

/**
 * Format questionnaire filename into a customer-facing note
 * Example: "20241112 RL14-1 Questionnaire Quality Fraude Environment_Marfo.xlsx"
 * → "Source: Questionnaire Quality Fraude Environment (Marfo)"
 */
function formatSourceNote(filename: string): string {
  // Remove extension
  let name = filename.replace(/\.(xlsx|xls|yaml)$/i, '');

  // Remove date prefix (e.g., "20241112 ")
  name = name.replace(/^\d{6,8}\s*/, '');

  // Remove code prefix (e.g., "RL14-1 ")
  name = name.replace(/^[A-Z]{1,3}\d{1,3}[-_]?\d*\s*/i, '');

  // Replace underscores with spaces, extract customer name if at end
  const parts = name.split('_');
  if (parts.length > 1) {
    const customer = parts.pop();
    const title = parts.join(' ');
    return `Source: ${title} (${customer})`;
  }

  return `Source: ${name}`;
}

/**
 * Find existing answer by matching question text
 */
function findExistingAnswer(
  question: string,
  existingAnswers: AnswerResponse[]
): AnswerResponse | null {
  // Normalize for comparison
  const normalize = (s: string) => s.toLowerCase().trim();
  const normalizedQuestion = normalize(question);

  return existingAnswers.find(a => normalize(a.question) === normalizedQuestion) || null;
}

async function prepareAnswers(): Promise<PreparedAnswersOutput> {
  console.log('\n📋 Preparing answers for sync...\n');

  // Load answer library
  const library = await loadAnswerLibrary();
  console.log(`  Loaded ${library.total} items from answer library`);

  // Load sync log for local ID lookups
  const syncLog = await loadSyncLog();
  console.log(`  Loaded sync log with ${Object.keys(syncLog.answers).length} recorded answers`);

  // Load existing answers from API
  const client = new PassionfruitAPIClient();
  console.log(`  Checking ${client.environment} API for existing answers...`);

  const existingAnswers = await client.listAnswers();
  console.log(`  Found ${existingAnswers.length} existing answers in API`);

  // Collect items to process
  const toProcess: Array<{
    item: HarvestedItem;
    existing: AnswerResponse | null;
  }> = [];
  const skipped: PreparedAnswersOutput['skipped'] = [];

  // Process all items from all topics
  for (const [topic, items] of Object.entries(library.byTopic)) {
    for (const item of items) {
      // Skip items without values
      if (!item.value || item.value.trim() === '') {
        skipped.push({
          localId: item.id,
          question: item.label,
          reason: 'No value',
        });
        continue;
      }

      // Skip entity fields (they go to entity database)
      if (isEntityField(item)) {
        skipped.push({
          localId: item.id,
          question: item.label,
          reason: 'Entity field (synced to entity database)',
        });
        continue;
      }

      // Check sync log first (by local ID), then API (by question text)
      const logRecord = syncLog.answers[item.id];
      const existing = logRecord
        ? existingAnswers.find(a => a.id === logRecord.apiId) || null
        : findExistingAnswer(item.label, existingAnswers);
      toProcess.push({ item, existing });
    }
  }

  // Translate all items to English
  console.log(`  Translating ${toProcess.length} answers to English...`);

  const itemsToTranslate = toProcess.map(({ item }) => ({
    question: item.label,
    answer: item.value,
    lang: item.lang,
  }));

  const translated = await translateBatch(itemsToTranslate);

  // Build prepared answers with translations
  const prepared: PreparedAnswer[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const { item, existing } = toProcess[i];
    const trans = translated[i];

    // Build note with source and original text (if translated)
    let note = formatSourceNote(item.source.file);
    if (trans.originalAnswer || trans.originalQuestion) {
      const origLang = item.lang === 'nl' ? 'Dutch' : item.lang === 'de' ? 'German' : 'Original';
      if (trans.originalAnswer) {
        note += `\n${origLang}: ${trans.originalAnswer}`;
      }
    }

    // Also check for existing by translated question
    const existingByTranslated = !existing ? findExistingAnswer(trans.question, existingAnswers) : existing;

    prepared.push({
      action: existingByTranslated ? 'update' : 'create',
      existingId: existingByTranslated?.id,
      localId: item.id,
      question: trans.question,
      answer: trans.answer,
      note,
      source: {
        file: item.source.file,
        lCell: item.source.lCell,
        vCell: item.source.vCell || item.source.lCell,
        harvestedAt: item.source.harvestedAt,
      },
      metadata: {
        type: item.type,
        level: item.level,
        topic: item.topic,
        lang: item.lang,
      },
    });
  }

  const output: PreparedAnswersOutput = {
    summary: {
      total: prepared.length + skipped.length,
      toCreate: prepared.filter(a => a.action === 'create').length,
      toUpdate: prepared.filter(a => a.action === 'update').length,
      skipped: skipped.length,
    },
    answers: prepared,
    skipped,
  };

  return output;
}

async function main() {
  try {
    const output = await prepareAnswers();

    console.log('\n' + '═'.repeat(60));
    console.log('  ANSWERS PREVIEW FOR REVIEW');
    console.log('═'.repeat(60));

    console.log(`\n  Summary:`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Total items:     ${output.summary.total}`);
    console.log(`  To create:       ${output.summary.toCreate}`);
    console.log(`  To update:       ${output.summary.toUpdate}`);
    console.log(`  Skipped:         ${output.summary.skipped}`);

    if (output.answers.length > 0) {
      console.log('\n  === ANSWERS TO SYNC ===');
      console.log('  ─────────────────────────────────────────');

      for (const answer of output.answers) {
        const action = answer.action === 'create' ? '➕ CREATE' : `✏️  UPDATE #${answer.existingId}`;
        console.log(`\n  ${action}`);
        console.log(`  Q: ${answer.question.substring(0, 60)}${answer.question.length > 60 ? '...' : ''}`);
        console.log(`  A: ${answer.answer.substring(0, 60)}${answer.answer.length > 60 ? '...' : ''}`);
        console.log(`  Topic: ${answer.metadata.topic} | Type: ${answer.metadata.type} | Level: ${answer.metadata.level}`);
      }
    }

    if (output.skipped.length > 0) {
      console.log('\n  === SKIPPED ===');
      console.log('  ─────────────────────────────────────────');
      for (const skip of output.skipped) {
        console.log(`  - ${skip.question.substring(0, 40)}... (${skip.reason})`);
      }
    }

    // Save for review
    await mkdir('./api-ready', { recursive: true });
    await writeFile('./api-ready/answers-preview.yaml', stringifyYaml(output, { lineWidth: 0 }), 'utf-8');

    console.log('\n' + '═'.repeat(60));
    console.log('  Saved to: ./api-ready/answers-preview.yaml');
    console.log('  Review and run: npx tsx src/pipeline-v2/sync/sync-answers.ts');
    console.log('═'.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
