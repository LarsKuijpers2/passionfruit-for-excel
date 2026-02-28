/**
 * AI-powered questionnaire analysis
 * Reads indexed questionnaire and generates human understanding
 */

import * as fs from 'fs';
import * as path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'eu-central-1' });
const MODEL_ID = 'eu.anthropic.claude-sonnet-4-20250514-v1:0';

interface IndexedQuestionnaire {
  source: string;
  language: string;
  sections: Array<{
    title: string;
    topic: string;
    items: Array<{
      label: string;
      value: string;
      topic: string;
      destination: string;
    }>;
  }>;
  entities: Array<{ name: string; role: string }>;
  products: Array<{ name: string }>;
  stats: { total: number; answered: number };
}

interface QuestionnaireUnderstanding {
  summary: string;            // Brief factual summary of what this questionnaire covers
  context: {
    requestedBy: string;      // Who requested this (the customer)
    suppliedBy: string;       // Who filled it out (the supplier)
    product: string | null;   // Which product is this about
    relationship: string;     // The business relationship context
  };
  topics: string[];           // Main topics covered (from our topic list)
  factsCaptured: string[];    // Key facts/data we extracted (observed, not guessed)
  needsReview: string[];      // Items that are unclear or incomplete
  industryKnowledge: string[]; // Things we need to look up about the industry
}

async function analyzeQuestionnaire(indexedPath: string): Promise<QuestionnaireUnderstanding> {
  const indexed: IndexedQuestionnaire = JSON.parse(fs.readFileSync(indexedPath, 'utf-8'));

  // Prepare summary for Claude
  const sectionSummary = indexed.sections.map(s => {
    const sampleItems = s.items.slice(0, 5).map(i => `  - ${i.label}: ${i.value?.substring(0, 100) || '(empty)'}`);
    return `## ${s.title} (${s.items.length} items, topic: ${s.topic})\n${sampleItems.join('\n')}`;
  }).join('\n\n');

  const entitySummary = indexed.entities.map(e => `- ${e.name} (${e.role})`).join('\n');
  const productSummary = indexed.products.map(p => `- ${p.name}`).join('\n') || '(none detected)';

  const prompt = `Analyze this indexed questionnaire. Be factual - only report what you observe, don't guess.

SOURCE: ${indexed.source}
LANGUAGE: ${indexed.language}
STATS: ${indexed.stats.total} total items, ${indexed.stats.answered} answered

ENTITIES DETECTED:
${entitySummary || '(none)'}

PRODUCTS DETECTED:
${productSummary}

SECTIONS:
${sectionSummary}

AVAILABLE TOPICS (use these exact names):
entity_info, entity_contacts, product_identification, product_attributes, product_composition,
product_allergens, product_nutrition, product_certifications, product_specifications, product_packaging,
quality_systems, premises, equipment, hygiene, cleaning, pest_control, monitoring, raw_materials,
traceability, logistics, certifications, audits, food_safety, food_defense, food_fraud, crisis,
origin, sustainability, environment, animal_welfare, training, documents, financial

Provide a grounded analysis:

1. SUMMARY: 1-2 sentences describing what this questionnaire covers (factual, observed)
2. CONTEXT: Who requested it, who filled it out, what product, and the business relationship
3. TOPICS: Which topics from the list above are covered (use exact topic names)
4. FACTS_CAPTURED: Key facts/data that were actually extracted (not guesses)
5. NEEDS_REVIEW: Items that are unclear, incomplete, or need human verification
6. INDUSTRY_KNOWLEDGE: Things we might need to look up about the food industry to better understand this questionnaire (e.g., specific certifications, regulations, terms)

Respond in JSON format:
{
  "summary": "...",
  "context": {
    "requestedBy": "...",
    "suppliedBy": "...",
    "product": "...",
    "relationship": "..."
  },
  "topics": ["product_allergens", "certifications", ...],
  "factsCaptured": ["...", "..."],
  "needsReview": ["...", "..."],
  "industryKnowledge": ["...", "..."]
}`;

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.content[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  return JSON.parse(jsonMatch[0]);
}

// Main
async function main() {
  const indexedPath = process.argv[2];
  if (!indexedPath) {
    console.log('Usage: npx tsx scripts/analyze-questionnaire.ts <indexed-file.json>');
    process.exit(1);
  }

  console.log(`Analyzing: ${indexedPath}\n`);

  try {
    const understanding = await analyzeQuestionnaire(indexedPath);

    console.log('=== QUESTIONNAIRE UNDERSTANDING ===\n');
    console.log('SUMMARY:');
    console.log(`  ${understanding.summary}\n`);
    console.log('CONTEXT:');
    console.log(`  Requested by: ${understanding.context.requestedBy}`);
    console.log(`  Supplied by: ${understanding.context.suppliedBy}`);
    console.log(`  Product: ${understanding.context.product || 'Not specified'}`);
    console.log(`  Relationship: ${understanding.context.relationship}\n`);
    console.log('TOPICS COVERED:');
    understanding.topics.forEach(t => console.log(`  - ${t}`));
    console.log('\nFACTS CAPTURED:');
    understanding.factsCaptured.forEach(f => console.log(`  • ${f}`));
    if (understanding.needsReview.length > 0) {
      console.log('\nNEEDS REVIEW:');
      understanding.needsReview.forEach(r => console.log(`  ⚠ ${r}`));
    }
    if (understanding.industryKnowledge.length > 0) {
      console.log('\nINDUSTRY KNOWLEDGE TO LOOK UP:');
      understanding.industryKnowledge.forEach(k => console.log(`  📚 ${k}`));
    }

    // Output JSON for pipeline integration
    console.log('\n--- JSON OUTPUT ---');
    console.log(JSON.stringify(understanding, null, 2));

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
