/**
 * Curate Answer Library
 *
 * 1. Translate everything to English
 * 2. Group similar questions
 * 3. Pick best answer per group
 * 4. Write proper self-explaining questions
 */

import 'dotenv/config';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getKnowledge, getKnowledgeForContent } from './knowledge-retriever.js';

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

interface LibraryItem {
  label: string;
  value: string;
  sources: string[];
}

interface TopicGroup {
  topic: string;
  items: LibraryItem[];
}

interface CuratedQuestion {
  question: string;  // Self-explaining question in English
  answer: string;    // Answer in English
  status?: 'ok' | 'needs_review';  // needs_review = conflicting data, pick one
  originalLabels: string[];  // All original labels that were grouped
  sources: string[];  // All sources
}

interface CuratedTopic {
  topic: string;
  topicLabel: string;  // Human-readable topic name
  questions: CuratedQuestion[];
}

interface CuratedLibrary {
  customer: string;
  generatedAt: string;
  company: CuratedTopic[];
  answer_library: CuratedTopic[];
}

const TOPIC_LABELS: Record<string, string> = {
  allergens: 'Allergen Management',
  certifications: 'Certifications & Standards',
  company: 'Company Information',
  contacts: 'Contact Information',
  crisis: 'Crisis Management',
  documents: 'Documentation',
  equipment: 'Equipment & Maintenance',
  financial: 'Financial Information',
  food_defense: 'Food Defense',
  food_fraud: 'Food Fraud Prevention',
  food_safety: 'Food Safety',
  hygiene: 'Hygiene & Sanitation',
  logistics: 'Logistics & Transport',
  microbiology: 'Microbiology',
  other: 'Other',
  pest_control: 'Pest Control',
  premises: 'Premises & Facilities',
  quality: 'Quality Management',
  quality_systems: 'Quality Systems',
  raw_materials: 'Raw Materials',
  traceability: 'Traceability',
  training: 'Training',
};

// Non-answers to skip
const NON_ANSWER_PATTERNS = [
  /^see (previous|above|below|prior)/i,
  /^siehe (oben|unten|vorherige)/i,
  /^zie (boven|onder|vorige)/i,
  /^n\.?a\.?$/i,
  /^not applicable$/i,
  /^-$/,
  /^\.$/,
  // Internal notes
  /will be added by/i,
  /already added/i,
  /to be (added|completed|provided)/i,
  // Questions back (not answers)
  /^which (law|regulation|standard)/i,
  /are you referring to\??$/i,
  // Skip markers
  /^ethical\s*skip$/i,
  /ethically skipped/i,
  /^skip$/i,
  /^skipped$/i,
  // Vague non-answers
  /^we are certified\.?$/i,
  /^certified\.?$/i,
  /^see attached\.?$/i,
  /^confidential\.?$/i,
];

// Meta-information labels to skip (about the questionnaire, not the company)
const META_LABEL_PATTERNS = [
  /document (creation|revision|reference|code|version)/i,
  /page (number|count|\d+\s*(of|\/)\s*\d+)/i,
  /^ref\.?\s*:?\s*[a-z0-9.-]+$/i,
  /^version\s*:?\s*\d/i,
  /created?\s*(on|le|am)/i,
  /revised?\s*(on|le|am)/i,
  /^date$/i,
  /questionnaire (version|reference|code)/i,
  // Questionnaire process questions (not company info)
  /change answer report/i,
  /actual score report/i,
  /rejected comments/i,
  /download.*report/i,
  /^if (you are |so,? )/i,  // Conditional questions
  /required to complete.*(questionnaire|full)/i,
  /please (attach|download|scan)/i,
  /accredited to a recognized/i,
];

function isNonAnswer(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return NON_ANSWER_PATTERNS.some(pattern => pattern.test(trimmed));
}

function isMetaLabel(label: string): boolean {
  return META_LABEL_PATTERNS.some(pattern => pattern.test(label));
}

async function curateTopicItems(topic: string, items: LibraryItem[]): Promise<CuratedQuestion[]> {
  if (items.length === 0) return [];

  // Filter out non-answers and meta-information
  const filteredItems = items.filter(item => !isNonAnswer(item.value) && !isMetaLabel(item.label));
  const skippedNonAnswers = items.filter(item => isNonAnswer(item.value)).length;
  const skippedMeta = items.filter(item => isMetaLabel(item.label)).length;

  if (skippedNonAnswers > 0) {
    console.log(`    (skipped ${skippedNonAnswers} non-answers)`);
  }
  if (skippedMeta > 0) {
    console.log(`    (skipped ${skippedMeta} meta-information)`);
  }

  if (filteredItems.length === 0) return [];

  const itemsText = filteredItems.map((item, i) =>
    `${i + 1}. Label: "${item.label}"\n   Value: "${item.value}"\n   Sources: ${item.sources.join(', ')}`
  ).join('\n\n');

  // Get relevant domain knowledge for this topic and content
  const topicKnowledge = getKnowledge(topic);
  const contentKnowledge = getKnowledgeForContent(itemsText);
  const relevantKnowledge = topicKnowledge || contentKnowledge;

  const knowledgeSection = relevantKnowledge
    ? `\n## Domain Knowledge\nUse this knowledge to process the items correctly:\n\n${relevantKnowledge}\n`
    : '';

  const prompt = `You are processing questionnaire answers for a food industry company.
${knowledgeSection}

Topic: ${TOPIC_LABELS[topic] || topic}

Here are ${filteredItems.length} items from various questionnaires:

${itemsText}

Your task:
1. Group questions ONLY when they are about the EXACT SAME subject
   - GOOD grouping: Certificate number + expiry date + scope for the SAME certification → ONE answer
   - GOOD grouping: Multiple questions all asking "Is your company BRC certified?" → ONE answer
   - BAD grouping: Questions about deforestation for MILK vs deforestation for SOY → These are DIFFERENT subjects, keep separate
   - BAD grouping: Questions about different certifications just because they're all "certifications" → Keep separate
2. For each question/group, write ONE clear self-explaining question in English
3. If multiple facts for the SAME subject, combine with bullet points
4. Keep the original labels for reference

IMPORTANT: Don't over-group! If questions ask about different raw materials, different supply chains, or different specific subjects, keep them as SEPARATE questions even if they share a theme.

SPLIT LIST ANSWERS: If a label like "Other (Please state)" or "Other certifications" has a comma-separated list (e.g., "BRCGS, IFS, VLOG, Weidegang"), split it into SEPARATE questions for each item:
- "Is your company BRCGS certified?" → "Yes"
- "Is your company IFS certified?" → "Yes"
- "Is your company VLOG certified?" → "Yes"
- "Is your company Weidegang certified?" → "Yes"

Nobody asks "What other certifications do you have?" - they ask about specific certifications individually.

Return a JSON array with this structure:
[
  {
    "question": "Clear self-explaining question in English?",
    "answer": "Comprehensive answer combining all related information. Use bullet points for multiple facts:\\n- Fact 1\\n- Fact 2",
    "originalLabels": ["original label 1", "original label 2"],
    "sourceIndices": [1, 2],
    "status": "ok"
  }
]

For conflicts, create separate entries for each answer so the reviewer can pick:
[
  {
    "question": "Do you have a formal Environmental Policy?",
    "answer": "Yes, we have a formal environmental policy documented in MVO_Zelfverklaring_NEN-ISO_26000_2010_-_2021.docx.",
    "originalLabels": ["Environmental policy"],
    "sourceIndices": [1],
    "status": "needs_review"
  },
  {
    "question": "Do you have a formal Environmental Policy?",
    "answer": "No, not yet formalized.",
    "originalLabels": ["Formalized environmental policy"],
    "sourceIndices": [2],
    "status": "needs_review"
  }
]

Rules:
- Questions should be clear and self-explanatory (e.g., "Is your company BRC certified?" not just "BRC")
- Translate Dutch/German/French to English
- GROUP ONLY when items are about the EXACT SAME subject (see task instructions above)
- Keep answers factual - don't make up information
- Preserve specific details like certificate numbers, dates, scopes

ANSWER FORMAT:
- For Yes/No questions: Start with "Yes" or "No" followed by natural explanation
- Example: "Yes, our responsible purchasing policy covers environmental issues and social practices."
- Example: "Yes, the code of conduct covers employee health, working conditions, and child labor prevention."
- Example: "No, we do not have ISO 14001 certification."
- Write as a natural sentence, not bullet points
- Do NOT repeat the question in the answer
- NEVER mention customer names (Dairygold, Fude+S, TIPPAGRAL, etc.) in answers - these are generic reusable answers

CONFLICT HANDLING:
- If the same question has DIFFERENT answers from different sources, this is a CONFLICT
- For entity-level certifications (Halal, Kosher, BRC, IFS, etc.): conflicts are likely errors, not product variation
- When you detect a conflict, create SEPARATE entries for each conflicting answer:
  1. Create one entry with the first answer, mark status: "needs_review"
  2. Create another entry with the second answer, mark status: "needs_review"
  3. Both entries get the same question but different answers
- This allows the human reviewer to see both options and pick the correct one
- Example: Two sources disagree on "Do you have ISO 14001?" - create two entries:
  {"question": "Do you have ISO 14001 certification?", "answer": "Yes, certified since 2020.", "status": "needs_review", "sourceIndices": [1]}
  {"question": "Do you have ISO 14001 certification?", "answer": "No, not yet certified.", "status": "needs_review", "sourceIndices": [2]}

SKIP THESE ITEMS ENTIRELY (do not include in output):
1. **Meta/process questions**: Questions about the questionnaire itself (reports, downloads, scores, "if not accredited...")
2. **Internal notes**: Answers like "will be added by Kelly", "already added", "to be completed"
3. **Questions as answers**: Answers that ask a question back ("Which law are you referring to?")
4. **Skip markers**: "Ethical Skip", "skipped", "N/A" without useful context
5. **Vague non-answers**: "We are certified" without saying what certification
6. **Attachment-only**: Questions that just ask to attach documents without actual information

VERIFY FACTS:
- If company is IFS certified, never say "BRC certified" in other answers
- Keep certification names consistent across all answers
- If you notice a factual error (e.g., wrong certification mentioned), flag it with status: "needs_review"

Return ONLY the JSON array, no other text.`;

  try {
    const responseText = await invokeModel(prompt);

    // Parse JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Map back to full structure with sources
    return parsed.map((q: any) => {
      const result: CuratedQuestion = {
        question: q.question,
        answer: q.answer,
        originalLabels: q.originalLabels || [],
        sources: [...new Set(q.sourceIndices?.flatMap((i: number) => filteredItems[i - 1]?.sources || []) || [])] as string[],
      };
      if (q.status === 'needs_review') {
        result.status = 'needs_review';
      }
      return result;
    });
  } catch (error) {
    console.error(`Error processing topic ${topic}:`, error);
    // Fallback: return filtered items as-is
    return filteredItems.map(item => ({
      question: item.label,
      answer: item.value,
      originalLabels: [item.label],
      sources: item.sources,
    }));
  }
}

/**
 * Post-process: Enrich umbrella questions with specific data
 * e.g., "GFSI certifications" should list the specific certs we found (IFS, BRC, etc.)
 */
function enrichUmbrellaQuestions(topics: CuratedTopic[]): void {
  // Find certification-related topics
  const certTopic = topics.find(t => t.topic === 'certifications');
  if (!certTopic) return;

  // Collect specific GFSI certifications that are confirmed "Yes"
  const gfsiCerts: string[] = [];
  const gfsiDetails: string[] = [];
  const gfsiSources: string[] = [];

  const gfsiPatterns = [
    { pattern: /\bBRC(GS)?\b/i, name: 'BRCGS' },
    { pattern: /\bIFS\s*(Food)?\b/i, name: 'IFS Food' },
    { pattern: /\bFSSC\s*22000\b/i, name: 'FSSC 22000' },
    { pattern: /\bSQF\b/i, name: 'SQF' },
    { pattern: /\bISO\s*22000\b/i, name: 'ISO 22000' },
  ];

  for (const q of certTopic.questions) {
    // Check if this is a specific GFSI certification with a Yes answer
    for (const { pattern, name } of gfsiPatterns) {
      if (pattern.test(q.question) && q.answer.toLowerCase().startsWith('yes')) {
        if (!gfsiCerts.includes(name)) {
          gfsiCerts.push(name);
          // Extract any details (COID, expiry, etc.)
          const details = q.answer.replace(/^yes,?\s*/i, '').trim();
          if (details && details.length > 10) {
            gfsiDetails.push(`${name}: ${details}`);
          }
          // Collect sources
          q.sources?.forEach(s => {
            if (!gfsiSources.includes(s)) gfsiSources.push(s);
          });
        }
      }
    }
  }

  // Find existing GFSI umbrella question or create one
  let gfsiQuestion = certTopic.questions.find(q =>
    /\bGFSI\b/i.test(q.question) && !gfsiPatterns.some(p => p.pattern.test(q.question))
  );

  // If no GFSI umbrella exists but we have GFSI certs, create one
  if (!gfsiQuestion && gfsiCerts.length > 0) {
    gfsiQuestion = {
      question: 'Does the company hold GFSI certifications?',
      answer: '',
      originalLabels: ['GFSI recognized certifications'],
      sources: gfsiSources,
    };
    certTopic.questions.unshift(gfsiQuestion); // Add at the beginning
  }

  // Update the GFSI umbrella question with aggregated certs
  if (gfsiQuestion && gfsiCerts.length > 0) {
    const certList = gfsiCerts.join(' and ');
    gfsiQuestion.answer = `Yes, the company holds ${certList} certification${gfsiCerts.length > 1 ? 's' : ''}.`;
    if (gfsiDetails.length > 0) {
      gfsiQuestion.answer += '\n' + gfsiDetails.map(d => `- ${d}`).join('\n');
    }
    // Update sources
    gfsiQuestion.sources = [...new Set([...(gfsiQuestion.sources || []), ...gfsiSources])];
  }
}

async function main() {
  const customer = process.argv[2] || 'Taste Strik';
  console.log(`Curating answer library for: ${customer}`);

  // Read grouped answers
  const inputPath = join('./customers', customer, 'grouped-answers.json');
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));

  const result: CuratedLibrary = {
    customer,
    generatedAt: new Date().toISOString().split('T')[0],
    company: [],
    answer_library: [],
  };

  // Process company items
  console.log('\nProcessing company items...');
  for (const topicGroup of data.company) {
    if (topicGroup.items.length === 0) continue;
    console.log(`  ${topicGroup.topic}: ${topicGroup.items.length} items`);

    const curatedQuestions = await curateTopicItems(topicGroup.topic, topicGroup.items);
    result.company.push({
      topic: topicGroup.topic,
      topicLabel: TOPIC_LABELS[topicGroup.topic] || topicGroup.topic,
      questions: curatedQuestions,
    });
  }

  // Process answer library items
  console.log('\nProcessing answer library items...');
  for (const topicGroup of data.answer_library) {
    if (topicGroup.items.length === 0) continue;
    console.log(`  ${topicGroup.topic}: ${topicGroup.items.length} items`);

    const curatedQuestions = await curateTopicItems(topicGroup.topic, topicGroup.items);
    result.answer_library.push({
      topic: topicGroup.topic,
      topicLabel: TOPIC_LABELS[topicGroup.topic] || topicGroup.topic,
      questions: curatedQuestions,
    });
  }

  // Post-process: enrich umbrella questions with specific data
  console.log('\nEnriching umbrella questions...');
  enrichUmbrellaQuestions(result.company);
  enrichUmbrellaQuestions(result.answer_library);

  // Calculate stats
  const companyQuestions = result.company.reduce((sum, t) => sum + t.questions.length, 0);
  const libraryQuestions = result.answer_library.reduce((sum, t) => sum + t.questions.length, 0);

  console.log(`\nResults:`);
  console.log(`  Company: ${companyQuestions} curated questions`);
  console.log(`  Answer Library: ${libraryQuestions} curated questions`);
  console.log(`  Total: ${companyQuestions + libraryQuestions} curated questions`);

  // Save
  const outputPath = join('./customers', customer, 'curated-library.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(console.error);
