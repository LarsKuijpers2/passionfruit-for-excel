/**
 * Curate Doehler SVZ Location Libraries
 *
 * Creates curated answer libraries for each production location separately.
 * No merging across locations - each stays independent.
 */

import 'dotenv/config';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

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

async function invokeModel(prompt: string): Promise<string> {
  const client = getClient();

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text;
}

interface APIReadyItem {
  id: string;
  question: string;
  originalLabel: string;
  answer: string;
  topic: string;
  section: string;
  level: string;
  destination: string;
  cellRef: string;
  lang: string;
}

interface LocationAPIReady {
  location: string;
  customer: string;
  preparedAt: string;
  sourceFile: string;
  items: APIReadyItem[];
  stats: any;
}

interface CuratedQuestion {
  question: string;
  answer: string;
  status?: 'ok' | 'needs_review';
  originalLabels: string[];
  sources: string[];
}

interface CuratedTopic {
  topic: string;
  topicLabel: string;
  questions: CuratedQuestion[];
}

interface CuratedLibrary {
  customer: string;
  location: string;
  generatedAt: string;
  answer_library: CuratedTopic[];
  product: CuratedTopic[];
}

const TOPIC_LABELS: Record<string, string> = {
  allergens: 'Allergen Management',
  certifications: 'Certifications & Standards',
  cleaning: 'Cleaning & Sanitation',
  crisis: 'Crisis Management',
  equipment: 'Equipment & Maintenance',
  food_defense: 'Food Defense',
  food_fraud: 'Food Fraud Prevention',
  food_safety: 'Food Safety',
  hygiene: 'Hygiene & Personal',
  logistics: 'Logistics & Transport',
  microbiology: 'Microbiology',
  monitoring: 'Monitoring',
  other: 'Other',
  pest_control: 'Pest Control',
  premises: 'Premises & Facilities',
  quality: 'Quality Management',
  quality_systems: 'Quality Systems',
  raw_materials: 'Raw Materials',
  traceability: 'Traceability',
  training: 'Training',
  waste: 'Waste Management',
};

// Non-answers to skip
const NON_ANSWER_PATTERNS = [
  /^see (previous|above|below|prior)/i,
  /^n\.?a\.?$/i,
  /^not applicable$/i,
  /^-$/,
  /^\.$/,
  /^x$/i,
  // Internal notes in Dutch
  /moet deze vraag/i,
  /begrijp ik niet/i,
  /weet niet of/i,
  /vreemde vraag/i,
  /vreemde zinsbouw/i,
];

function isNonAnswer(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return NON_ANSWER_PATTERNS.some(pattern => pattern.test(trimmed));
}

async function curateTopicItems(
  topic: string,
  items: APIReadyItem[],
  locationName: string
): Promise<CuratedQuestion[]> {
  if (items.length === 0) return [];

  // Filter out non-answers
  const filteredItems = items.filter(item => !isNonAnswer(item.answer));
  const skipped = items.length - filteredItems.length;

  if (skipped > 0) {
    console.log(`    (skipped ${skipped} non-answers)`);
  }

  if (filteredItems.length === 0) return [];

  const itemsText = filteredItems.map((item, i) =>
    `${i + 1}. Question: "${item.question}"\n   Answer: "${item.answer}"\n   Section: ${item.section}`
  ).join('\n\n');

  const prompt = `You are processing questionnaire answers for Doehler SVZ - ${locationName} production facility.

Topic: ${TOPIC_LABELS[topic] || topic}

Here are ${filteredItems.length} items:

${itemsText}

Your task:
1. Group ONLY when questions are truly duplicates asking the exact same thing
2. When grouping Yes/No + comment pairs: combine as "Yes\\n[original comment]" or "No\\n[original comment]"
3. Translate questions AND answers to English (if in Dutch/German/French)
4. Preserve customer's tone of voice - don't rephrase or "improve" their wording

IMPORTANT RULES FOR ANSWERS:
- When combining Yes/No with a comment: "Yes\\n[exact original comment translated to English]"
- If an answer is already complete (not a Yes/No + comment pair), copy it exactly (just translate if needed)
- NEVER rephrase, expand, or editorialize the customer's answers
- Keep their exact phrasing, just translate to English if necessary

Return a JSON array:
[
  {
    "question": "Clear question in English?",
    "answer": "Yes\\nOriginal comment translated to English but preserving their wording",
    "originalLabels": ["original question 1"],
    "sourceIndices": [1]
  }
]

Rules:
- Translate to English but preserve original tone/phrasing
- When grouping Yes/No + comment: "Yes\\n[comment]" or "No\\n[comment]"
- Don't over-group - different aspects of same topic should stay separate
- Questions can be cleaned up to be clear and self-explanatory

Return ONLY the JSON array.`;

  try {
    const responseText = await invokeModel(prompt);

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');

    const parsed = JSON.parse(jsonMatch[0]);

    return parsed.map((q: any) => ({
      question: q.question,
      answer: q.answer,
      originalLabels: q.originalLabels || [],
      sources: [locationName],
    }));
  } catch (error) {
    console.error(`Error processing topic ${topic}:`, error);
    // Fallback
    return filteredItems.map(item => ({
      question: item.question,
      answer: item.answer,
      originalLabels: [item.originalLabel],
      sources: [locationName],
    }));
  }
}

async function curateLocation(locationFile: string, locationName: string): Promise<CuratedLibrary> {
  console.log(`\nCurating ${locationName}...`);

  const data: LocationAPIReady = JSON.parse(readFileSync(locationFile, 'utf-8'));

  // Group items by topic and destination
  const answerLibraryByTopic = new Map<string, APIReadyItem[]>();
  const productByTopic = new Map<string, APIReadyItem[]>();

  for (const item of data.items) {
    const targetMap = item.destination === 'product' ? productByTopic : answerLibraryByTopic;
    if (!targetMap.has(item.topic)) {
      targetMap.set(item.topic, []);
    }
    targetMap.get(item.topic)!.push(item);
  }

  const result: CuratedLibrary = {
    customer: 'Doehler SVZ',
    location: locationName,
    generatedAt: new Date().toISOString().split('T')[0],
    answer_library: [],
    product: [],
  };

  // Process answer library topics
  console.log('  Processing answer library...');
  for (const [topic, items] of answerLibraryByTopic) {
    console.log(`    ${topic}: ${items.length} items`);
    const curated = await curateTopicItems(topic, items, locationName);
    if (curated.length > 0) {
      result.answer_library.push({
        topic,
        topicLabel: TOPIC_LABELS[topic] || topic,
        questions: curated,
      });
    }
  }

  // Process product topics
  console.log('  Processing product items...');
  for (const [topic, items] of productByTopic) {
    console.log(`    ${topic}: ${items.length} items`);
    const curated = await curateTopicItems(topic, items, locationName);
    if (curated.length > 0) {
      result.product.push({
        topic,
        topicLabel: TOPIC_LABELS[topic] || topic,
        questions: curated,
      });
    }
  }

  return result;
}

const LOCATIONS = [
  { file: 'tomaszow-api-ready.json', name: 'Tomaszow' },
  { file: 'rijkevorsel-api-ready.json', name: 'Rijkevorsel' },
  { file: 'almonte-api-ready.json', name: 'Almonte' },
];

async function main() {
  const customer = 'Doehler SVZ';
  const apiReadyDir = `./customers/${customer}/api-ready`;

  console.log(`=== Curating ${customer} Location Libraries ===`);

  for (const location of LOCATIONS) {
    const inputPath = join(apiReadyDir, location.file);

    if (!existsSync(inputPath)) {
      console.warn(`⚠️  File not found: ${inputPath}`);
      continue;
    }

    try {
      const curated = await curateLocation(inputPath, location.name);

      const outputFile = `${location.name.toLowerCase()}-curated.json`;
      const outputPath = join(apiReadyDir, outputFile);
      writeFileSync(outputPath, JSON.stringify(curated, null, 2));

      const alCount = curated.answer_library.reduce((s, t) => s + t.questions.length, 0);
      const prodCount = curated.product.reduce((s, t) => s + t.questions.length, 0);

      console.log(`\n✅ ${location.name}`);
      console.log(`   Answer Library: ${alCount} questions`);
      console.log(`   Product: ${prodCount} questions`);
      console.log(`   Saved to: ${outputPath}`);

    } catch (error) {
      console.error(`❌ Error curating ${location.name}:`, error);
    }
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
