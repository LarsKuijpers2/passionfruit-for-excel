import { readFileSync } from 'fs';

// Load both datasets
const apiAnswers = JSON.parse(readFileSync('customers/numidia/api-answers.json', 'utf-8'));
const localAnswers = JSON.parse(readFileSync('customers/numidia/curated-library-final.json', 'utf-8'));

console.log('=== COMPARISON ===');
console.log(`API answers: ${apiAnswers.length}`);
console.log(`Local answers: ${localAnswers.items.length}`);

// Build lookup by question (normalized)
function normalize(q: string): string {
  return q.toLowerCase().replace(/[?.!,]/g, '').replace(/\s+/g, ' ').trim();
}

const apiByQuestion = new Map<string, any>();
for (const a of apiAnswers) {
  apiByQuestion.set(normalize(a.question), a);
}

const localByQuestion = new Map<string, any>();
for (const a of localAnswers.items) {
  localByQuestion.set(normalize(a.question), a);
}

// Find malformed API questions that need updating
const needsUpdate: { apiItem: any; localItem: any | null; reason: string }[] = [];

for (const apiItem of apiAnswers) {
  const q = apiItem.question || '';

  // Check for malformed patterns
  const issues: string[] = [];

  // Pattern 1: No question mark at end (statements)
  if (q.length > 0 && !q.endsWith('?')) {
    issues.push('missing question mark');
  }

  // Pattern 2: Repeated phrases like "X - X"
  if (/^Do you have .+ - .+/.test(q)) {
    issues.push('concatenated labels');
  }

  // Pattern 3: Weird parentheticals
  if (/\([^)]*for\)\??$/.test(q)) {
    issues.push('malformed parenthetical');
  }

  // Pattern 4: Very short vague questions
  if (/^What is the (name|position|date)\?$/.test(q)) {
    issues.push('too vague');
  }

  if (issues.length > 0) {
    // Check if we have a better local version
    const normalizedQ = normalize(q);
    const localItem = localByQuestion.get(normalizedQ);

    needsUpdate.push({
      apiItem,
      localItem,
      reason: issues.join(', ')
    });
  }
}

console.log(`\n=== NEEDS UPDATE: ${needsUpdate.length} questions ===\n`);

// Group by reason
const byReason = new Map<string, typeof needsUpdate>();
for (const item of needsUpdate) {
  const key = item.reason;
  if (!byReason.has(key)) byReason.set(key, []);
  byReason.get(key)!.push(item);
}

for (const [reason, items] of byReason) {
  console.log(`\n--- ${reason.toUpperCase()} (${items.length}) ---`);
  items.slice(0, 5).forEach((item, i) => {
    console.log(`${i+1}. API: "${item.apiItem.question}"`);
    if (item.localItem) {
      console.log(`   Local: "${item.localItem.question}"`);
    } else {
      console.log(`   (no local match)`);
    }
  });
  if (items.length > 5) {
    console.log(`   ... and ${items.length - 5} more`);
  }
}

// Summary
console.log('\n\n=== SUMMARY ===');
console.log(`Total API answers: ${apiAnswers.length}`);
console.log(`Needs update: ${needsUpdate.length}`);
console.log(`  - With local fix available: ${needsUpdate.filter(x => x.localItem).length}`);
console.log(`  - Without local fix: ${needsUpdate.filter(x => !x.localItem).length}`);
