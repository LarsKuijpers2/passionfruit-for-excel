/**
 * Find Semantic Duplicates
 *
 * Compares items to add against existing answer library
 * to identify duplicates based on subject/goal.
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: 'eu-central-1' });

interface AddItem {
  excelId: number;
  topic: string;
  question: string;
  answer: string;
}

interface ExistingAnswer {
  id: number;
  question: string;
  answer: string;
}

async function callClaude(prompt: string): Promise<string> {
  const command = new InvokeModelCommand({
    modelId: 'eu.anthropic.claude-sonnet-4-20250514-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const response = await bedrock.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.content[0].text;
}

async function findDuplicates(item: AddItem, existingAnswers: ExistingAnswer[]): Promise<{
  isDuplicate: boolean;
  matchingId?: number;
  matchingQuestion?: string;
  reason?: string;
}> {
  // First, filter existing answers to same topic area or potentially related
  const itemWords = new Set(item.question.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  // Find candidates with word overlap
  const candidates = existingAnswers
    .map(a => {
      const answerWords = new Set(a.question.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const overlap = [...itemWords].filter(w => answerWords.has(w)).length;
      return { ...a, overlap };
    })
    .filter(a => a.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 10);

  if (candidates.length === 0) {
    return { isDuplicate: false };
  }

  // Use Claude to check for semantic duplicates
  const candidateList = candidates
    .map((c, i) => `${i + 1}. [ID ${c.id}] Q: "${c.question}" A: "${c.answer}"`)
    .join('\n');

  const prompt = `You are checking for duplicate questions in an answer library for a food company questionnaire.

NEW ITEM TO ADD:
Topic: ${item.topic}
Question: "${item.question}"
Answer: "${item.answer}"

EXISTING ITEMS (potential matches):
${candidateList}

Is the NEW ITEM a duplicate of any existing item? Two questions are duplicates if they:
- Ask about the SAME subject/topic AND
- Have the SAME goal/intent (even if worded differently)

Respond in JSON format ONLY:
{
  "isDuplicate": true/false,
  "matchingNumber": <number 1-${candidates.length} if duplicate, null if not>,
  "reason": "<brief explanation>"
}

Only mark as duplicate if they're truly asking the same thing. Different questions about the same general topic are NOT duplicates.`;

  try {
    const text = await callClaude(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.isDuplicate && result.matchingNumber) {
        const match = candidates[result.matchingNumber - 1];
        return {
          isDuplicate: true,
          matchingId: match.id,
          matchingQuestion: match.question,
          reason: result.reason,
        };
      }
    }
  } catch (e) {
    console.error('Failed to check:', e);
  }

  return { isDuplicate: false };
}

async function main() {
  const toAdd: AddItem[] = JSON.parse(
    await readFile('customers/Doehler Oosterhout/full-items-to-add.json', 'utf-8')
  );
  const existingAnswers: ExistingAnswer[] = JSON.parse(
    await readFile('customers/Doehler Oosterhout/api-answer-library.json', 'utf-8')
  );

  console.log(`Checking ${toAdd.length} items against ${existingAnswers.length} existing answers...\n`);

  const duplicates: any[] = [];
  const uniqueItems: AddItem[] = [];

  for (let i = 0; i < toAdd.length; i++) {
    const item = toAdd[i];
    console.log(`[${i + 1}/${toAdd.length}] Checking: ${item.question.slice(0, 50)}...`);

    const result = await findDuplicates(item, existingAnswers);

    if (result.isDuplicate) {
      console.log(`  → DUPLICATE of ID ${result.matchingId}: ${result.reason}`);
      duplicates.push({
        item,
        matchingId: result.matchingId,
        matchingQuestion: result.matchingQuestion,
        reason: result.reason,
      });
    } else {
      console.log(`  → UNIQUE`);
      uniqueItems.push(item);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n========================================');
  console.log('  RESULTS');
  console.log('========================================');
  console.log(`Total items checked: ${toAdd.length}`);
  console.log(`Duplicates found: ${duplicates.length}`);
  console.log(`Unique items to add: ${uniqueItems.length}`);

  if (duplicates.length > 0) {
    console.log('\n--- DUPLICATES ---');
    duplicates.forEach((d, i) => {
      console.log(`\n${i + 1}. NEW: "${d.item.question.slice(0, 60)}..."`);
      console.log(`   EXISTING (ID ${d.matchingId}): "${d.matchingQuestion?.slice(0, 60)}..."`);
      console.log(`   Reason: ${d.reason}`);
    });
  }

  // Save results
  await writeFile('customers/Doehler Oosterhout/duplicates-found.json', JSON.stringify(duplicates, null, 2));
  await writeFile('customers/Doehler Oosterhout/unique-items-to-add.json', JSON.stringify(uniqueItems, null, 2));

  console.log('\nSaved:');
  console.log('  - duplicates-found.json');
  console.log('  - unique-items-to-add.json');
}

main().catch(console.error);
