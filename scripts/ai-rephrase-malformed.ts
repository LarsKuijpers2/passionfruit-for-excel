import { readFileSync, writeFileSync } from 'fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Load data
const apiAnswers = JSON.parse(readFileSync('customers/numidia/api-answers.json', 'utf-8'));

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'eu-central-1' });

// Check if malformed
function isMalformed(q: string): boolean {
  if (!q) return false;
  return /^Do you have .+ - /.test(q) ||
         /\([^)]*for\)\??$/.test(q) ||
         /^Do you have Do you have/.test(q) ||
         !q.endsWith('?');
}

// Get malformed questions
const malformed = apiAnswers.filter((a: any) => isMalformed(a.question || ''));
console.log(`Found ${malformed.length} malformed questions to rephrase\n`);

// Batch rephrase with Claude
async function rephraseWithAI(items: any[]): Promise<Map<number, string>> {
  const results = new Map<number, string>();

  // Process in batches of 15
  const BATCH_SIZE = 15;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const prompt = `You are rephrasing malformed questionnaire questions to make them clear and self-explanatory.

These questions come from supplier assessment questionnaires in the food industry. They were extracted from matrix-style forms where row labels got awkwardly combined with column headers.

For each question, I'll give you:
- The malformed question
- The answer (to help you understand what's being asked)
- The section it came from (provides context)

Rephrase each into a clear, natural question that:
1. Is self-explanatory (someone can understand it without seeing the original form)
2. Matches the answer type (Yes/No questions for Yes/No answers)
3. Keeps the same meaning
4. Sounds professional

QUESTIONS TO REPHRASE:
${batch.map((item, idx) => `
${idx + 1}.
   Malformed: "${item.question}"
   Answer: "${item.answer}"
   Section: "${item.note || 'Unknown'}"
`).join('\n')}

Return ONLY a JSON array with the rephrased questions in order:
["Rephrased question 1?", "Rephrased question 2?", ...]`;

    try {
      const response = await client.send(new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      }));

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content[0].text;

      // Parse JSON array
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const rephrased = JSON.parse(jsonMatch[0]) as string[];
        batch.forEach((item, idx) => {
          if (rephrased[idx]) {
            results.set(item.id, rephrased[idx]);
          }
        });
      }

      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)}`);
    } catch (error) {
      console.error(`Error processing batch:`, error);
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

async function main() {
  const rephrased = await rephraseWithAI(malformed);

  console.log(`\nSuccessfully rephrased: ${rephrased.size}/${malformed.length}\n`);

  // Build updates
  const updates = malformed
    .filter(item => rephrased.has(item.id))
    .map(item => ({
      id: item.id,
      oldQuestion: item.question,
      newQuestion: rephrased.get(item.id),
      answer: item.answer
    }));

  // Show samples
  console.log('=== SAMPLE REPHRASES ===\n');
  updates.slice(0, 15).forEach((u, i) => {
    console.log(`${i + 1}. ID ${u.id}`);
    console.log(`   OLD: ${u.oldQuestion}`);
    console.log(`   NEW: ${u.newQuestion}`);
    console.log(`   ANS: ${u.answer}`);
    console.log('');
  });

  // Save
  writeFileSync('customers/numidia/ai-rephrased-updates.json', JSON.stringify(updates, null, 2));
  console.log(`\nSaved ${updates.length} updates to customers/numidia/ai-rephrased-updates.json`);
}

main().catch(console.error);
