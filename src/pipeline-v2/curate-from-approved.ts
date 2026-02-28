/**
 * Curate Answer Library from Approved Exports
 *
 * Takes approved exports and:
 * 1. Merges follow-up questions with parent questions
 * 2. Translates to English (preserving customer tone)
 * 3. Groups by topic
 * 4. Outputs curated library ready for API
 */

import 'dotenv/config';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

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

// =============================================================================
// TYPES
// =============================================================================

interface ApprovedItem {
  id: string;
  label: string;
  value: string;
  topic: string;
  lCell: string;
  vCell?: string;
  section: string;
}

interface ApprovedExport {
  meta: {
    questionnaire: string;
    source: string;
    customer: string;
    exportedAt: string;
  };
  company: ApprovedItem[];
  library: ApprovedItem[];
  product?: ApprovedItem[];
  questionnaire?: ApprovedItem[];
  exclude?: ApprovedItem[];
}

interface CuratedQuestion {
  question: string;
  answer: string;
  originalLabels: string[];
  sources: string[];
  topic: string;
  section: string;
}

interface CuratedLibrary {
  customer: string;
  location?: string;
  generatedAt: string;
  sourceFile: string;
  answer_library: CuratedQuestion[];
  product: CuratedQuestion[];
  stats: {
    inputItems: number;
    outputQuestions: number;
    merged: number;
  };
}

// =============================================================================
// FOLLOW-UP DETECTION
// =============================================================================

// Match follow-ups that need parent context
// Sub-questions "a)", "b)" are included so AI can see parent context to reformulate them
const FOLLOW_UP_PATTERNS = [
  /^if (yes|no)[,;:]?\s*/i,
  /^if so[,;:]?\s*/i,
  /^please (specify|explain|describe)/i,
  /comments?$/i,
  /\bcomments?$/i,
  /^[a-z]\)\s*/i,  // "a)", "b)", "c)" style sub-questions - need parent context
];

function isFollowUpQuestion(label: string): boolean {
  return FOLLOW_UP_PATTERNS.some(p => p.test(label.trim()));
}

function isCommentLabel(label: string): boolean {
  return /comments?$/i.test(label.trim());
}

// =============================================================================
// PRE-GROUPING (before AI)
// =============================================================================

interface ItemGroup {
  parent: ApprovedItem;
  followUps: ApprovedItem[];
}

/**
 * Group items by detecting parent-followup relationships
 * Based on cell references (same row) and label patterns
 */
function preGroupItems(items: ApprovedItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const usedIds = new Set<string>();

  // Sort by cell reference to maintain order
  const sorted = [...items].sort((a, b) => {
    const rowA = parseInt(a.lCell.replace(/[A-Z]/g, '')) || 0;
    const rowB = parseInt(b.lCell.replace(/[A-Z]/g, '')) || 0;
    return rowA - rowB;
  });

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (usedIds.has(item.id)) continue;

    // Check if this looks like a follow-up (skip as standalone)
    if (isFollowUpQuestion(item.label) || isCommentLabel(item.label)) {
      // This is a follow-up without a parent found - keep as standalone
      groups.push({ parent: item, followUps: [] });
      usedIds.add(item.id);
      continue;
    }

    // This is a parent - find its follow-ups
    const group: ItemGroup = { parent: item, followUps: [] };
    usedIds.add(item.id);

    // Look for follow-ups in the same section with same row or adjacent rows
    const parentRow = parseInt(item.lCell.replace(/[A-Z]/g, '')) || 0;

    for (let j = i + 1; j < sorted.length; j++) {
      const candidate = sorted[j];
      if (usedIds.has(candidate.id)) continue;
      if (candidate.section !== item.section) continue;

      const candidateRow = parseInt(candidate.lCell.replace(/[A-Z]/g, '')) || 0;

      // Same row (different column) = likely a comment/detail for same question
      if (candidateRow === parentRow) {
        if (isCommentLabel(candidate.label) || candidate.lCell !== item.lCell) {
          group.followUps.push(candidate);
          usedIds.add(candidate.id);
        }
      }
      // Next row and is a follow-up pattern
      else if (candidateRow === parentRow + 1 && isFollowUpQuestion(candidate.label)) {
        group.followUps.push(candidate);
        usedIds.add(candidate.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

// =============================================================================
// AI CURATION
// =============================================================================

async function curateGroups(groups: ItemGroup[], sourceName: string): Promise<CuratedQuestion[]> {
  if (groups.length === 0) return [];

  // Process in batches
  const BATCH_SIZE = 30;
  const results: CuratedQuestion[] = [];

  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    const batch = groups.slice(i, i + BATCH_SIZE);
    console.log(`  Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(groups.length / BATCH_SIZE)}...`);

    const itemsText = batch.map((group, idx) => {
      let text = `${idx + 1}. PARENT: "${group.parent.label}" → "${group.parent.value}"`;
      // Include vCell info for column detection
      if (group.parent.vCell) {
        text += ` [vCell: ${group.parent.vCell}]`;
      }
      if (group.followUps.length > 0) {
        text += '\n   FOLLOW-UPS:';
        for (const fu of group.followUps) {
          text += `\n   - "${fu.label}" → "${fu.value || 'N/A'}"`;
          if (fu.vCell) {
            text += ` [vCell: ${fu.vCell}]`;
          }
        }
      }
      text += `\n   Section: ${group.parent.section}, Topic: ${group.parent.topic}`;
      return text;
    }).join('\n\n');

    const prompt = `You are processing approved questionnaire answers for a food industry company.

Here are ${batch.length} question groups (parent questions with their follow-ups):

${itemsText}

TASK:
1. Each parent question becomes ONE output item
2. ONLY merge follow-ups that are clearly dependent (e.g., "If yes...", "Comments", "Please specify")
3. Translate to English if needed (preserve customer's tone/phrasing)
4. For Yes/No + comment: combine as "Yes, [original comment]" or "No, [comment]"
5. If follow-up is "If yes..." but parent answer is No, skip the follow-up
6. If follow-up has no value or N/A, skip it
7. IMPORTANT: Do NOT merge standalone questions - questions starting with "Which", "What", "How", "When" are usually independent questions, not follow-ups
8. Sub-questions like "a)", "b)", "c)" should become SEPARATE self-explanatory questions in the output array.
   - Output the parent question AS-IS (without "which covers the following")
   - Output EACH sub-question as a separate item, reformulated to be self-explanatory
   Example input: Parent "Is a food defense plan in place, which covers the following:" + Sub "a) Identifies potential threats" + Sub "b) Preventive measures"
   Example output: 3 separate items:
   1. "Is a food defense plan in place?" → "Yes, [parent comment]"
   2. "Does the food defense plan identify and evaluate potential threats?" → "Yes, risk assessment."
   3. "Does the food defense plan include preventive measures for potential threats?" → "Yes, risk assessment."

RULES FOR ANSWERS:
- PRESERVE the customer's original wording - just translate if needed
- For Yes/No with comment: "Yes, [comment in lowercase starting word]." - e.g., "Yes, equipment is calibrated annually."
  - First word after comma should be lowercase (not "Yes, Equipment..." but "Yes, equipment...")
  - End with a period
- ALWAYS end with a period if:
  - Answer has more than 2 words, OR
  - Answer starts with "Yes," or "No,"
  - Simple "Yes" or "No" or "N/A" alone do NOT need a period
- Never rephrase or "improve" their answers
- Skip empty or N/A follow-ups
- SKIP section headings (all caps text like "CLEANING PLANT AND EQUIPMENT", "WATER MONITORING", "TRAINING") - these are not questions, do not include them in output

CRITICAL RULE FOR "X" ANSWERS:
- Each item includes [vCell: XX] which tells you the VALUE CELL location (column + row)
- The questionnaire uses columns: B=Yes, C=No, D=N/A, E=COMMENTS
- If the answer is "X", ":selected: X", or similar checkbox marks:
  1. CHECK THE vCell COLUMN FIRST:
     - vCell starts with "B" (e.g., B99) → "X" means "Yes"
     - vCell starts with "C" (e.g., C99) → "X" means "No"
     - vCell starts with "D" (e.g., D99) → "X" means "N/A" (Not Applicable)
  2. If vCell is not available or in column E+, fall back to question type:
     - YES/NO QUESTIONS → "X" means "Yes"
     - OPEN-ENDED QUESTIONS (Which, What, How, When, Where, Why) → set answer to "" (empty string)
- IMPORTANT: "N/A" is a valid answer! It means the question doesn't apply to this supplier's situation
- When in doubt about whether "X" is valid, prefer "N/A" if it's in column D, otherwise mark as empty

Return JSON array:
[
  {
    "question": "Clear self-explanatory question in English",
    "answer": "Yes, comment in lowercase with period at end.",
    "originalLabels": ["parent label", "followup label if merged"],
    "topic": "topic_from_parent",
    "section": "section_name"
  }
]

Return ONLY the JSON array.`;

    try {
      const response = await invokeModel(prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('  No JSON found in response, using fallback');
        // Fallback
        for (const group of batch) {
          results.push({
            question: group.parent.label,
            answer: group.followUps.length > 0 && group.followUps[0].value
              ? `${group.parent.value}\n${group.followUps[0].value}`
              : group.parent.value,
            originalLabels: [group.parent.label, ...group.followUps.map(f => f.label)],
            sources: [sourceName],
            topic: group.parent.topic,
            section: group.parent.section,
          });
        }
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      for (const item of parsed) {
        results.push({
          question: item.question,
          answer: item.answer,
          originalLabels: item.originalLabels || [],
          sources: [sourceName],
          topic: item.topic,
          section: item.section,
        });
      }
    } catch (error) {
      console.error('  Error in batch, using fallback:', error);
      // Fallback
      for (const group of batch) {
        results.push({
          question: group.parent.label,
          answer: group.parent.value,
          originalLabels: [group.parent.label],
          sources: [sourceName],
          topic: group.parent.topic,
          section: group.parent.section,
        });
      }
    }
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function curateApprovedExport(approvedPath: string): Promise<CuratedLibrary> {
  const data: ApprovedExport = JSON.parse(readFileSync(approvedPath, 'utf-8'));
  const sourceName = basename(approvedPath, '.json');

  console.log(`\nCurating: ${sourceName}`);
  console.log(`  Customer: ${data.meta.customer}`);

  // Pre-group library items
  console.log(`\n  Library items: ${data.library.length}`);
  const libraryGroups = preGroupItems(data.library);
  console.log(`  Pre-grouped into: ${libraryGroups.length} groups`);
  const mergedCount = data.library.length - libraryGroups.length;

  // Curate library
  const curatedLibrary = await curateGroups(libraryGroups, sourceName);

  // Handle product items if present
  let curatedProduct: CuratedQuestion[] = [];
  if (data.product && data.product.length > 0) {
    console.log(`\n  Product items: ${data.product.length}`);
    const productGroups = preGroupItems(data.product);
    console.log(`  Pre-grouped into: ${productGroups.length} groups`);
    curatedProduct = await curateGroups(productGroups, sourceName);
  }

  return {
    customer: data.meta.customer,
    generatedAt: new Date().toISOString(),
    sourceFile: data.meta.source,
    answer_library: curatedLibrary,
    product: curatedProduct,
    stats: {
      inputItems: data.library.length + (data.product?.length || 0),
      outputQuestions: curatedLibrary.length + curatedProduct.length,
      merged: mergedCount,
    },
  };
}

async function main() {
  const customer = process.argv[2] || 'Doehler SVZ';
  const specificFile = process.argv[3]; // Optional specific file

  const approvedDir = join('./customers', customer, 'approved');
  const outputDir = join('./customers', customer, 'curated');

  if (!existsSync(approvedDir)) {
    console.error(`No approved folder found: ${approvedDir}`);
    process.exit(1);
  }

  // Create output dir
  if (!existsSync(outputDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(outputDir, { recursive: true });
  }

  // Find approved exports
  let files = readdirSync(approvedDir).filter(f => f.endsWith('.json'));

  if (specificFile) {
    files = files.filter(f => f.includes(specificFile));
  }

  console.log(`\n=== Curating ${customer} ===`);
  console.log(`Found ${files.length} approved exports\n`);

  for (const file of files) {
    const inputPath = join(approvedDir, file);
    const outputPath = join(outputDir, file.replace('.json', '-curated.json'));

    try {
      const curated = await curateApprovedExport(inputPath);

      writeFileSync(outputPath, JSON.stringify(curated, null, 2));

      console.log(`\n✅ ${file}`);
      console.log(`   Input: ${curated.stats.inputItems} items`);
      console.log(`   Output: ${curated.stats.outputQuestions} questions`);
      console.log(`   Merged: ${curated.stats.merged} follow-ups`);
      console.log(`   Saved: ${outputPath}`);
    } catch (error) {
      console.error(`\n❌ Error processing ${file}:`, error);
    }
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
