import { readFileSync, writeFileSync } from 'fs';

// Load both datasets
const apiAnswers = JSON.parse(readFileSync('customers/numidia/api-answers.json', 'utf-8'));
const localAnswers = JSON.parse(readFileSync('customers/numidia/curated-library-final.json', 'utf-8'));

console.log('=== COMPARISON ===');
console.log(`API answers: ${apiAnswers.length}`);
console.log(`Local answers: ${localAnswers.items.length}`);

// Check for malformed API questions
function isMalformed(q: string): { malformed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!q) return { malformed: true, reasons: ['empty'] };

  // No question mark
  if (!q.endsWith('?')) reasons.push('no_question_mark');

  // Repeated phrases "X - X"
  if (/^Do you have .+ - .+/.test(q)) reasons.push('concatenated');

  // Weird parentheticals ending
  if (/\([^)]*for\)\??$/.test(q)) reasons.push('parenthetical');

  // "Do you have Do you have" - doubled prefix
  if (/^Do you have Do you have/.test(q)) reasons.push('double_prefix');

  return { malformed: reasons.length > 0, reasons };
}

// Find malformed API questions
const malformedApi = apiAnswers.filter((a: any) => isMalformed(a.question).malformed);
console.log(`\nMalformed in API: ${malformedApi.length}`);

// Try to match by extracting the "topic" from malformed questions
// For example: "Do you have X - X (verification...)" -> topic is "X"
function extractTopic(q: string): string {
  let topic = q;

  // Remove "Do you have" prefix variations
  topic = topic.replace(/^Do you have (Do you have )?(in Place\? - |Document Control.*? - |programs for.*? - |verification procedures.*? - )?/i, '');

  // Remove trailing parentheticals
  topic = topic.replace(/\s*\([^)]*\)\??$/, '');

  // Remove duplicate "X - X" patterns
  const parts = topic.split(' - ');
  if (parts.length >= 2 && parts[0].trim() === parts[1].trim()) {
    topic = parts[0].trim();
  } else if (parts.length >= 2) {
    topic = parts[parts.length - 1].trim(); // Take the last part
  }

  // Remove question marks
  topic = topic.replace(/\?+$/, '').trim();

  return topic.toLowerCase();
}

// Build lookup for local answers by section type + topic
const localByKey = new Map<string, any>();
for (const item of localAnswers.items) {
  const q = item.question || '';

  // Extract section type from question
  let sectionType = 'unknown';
  if (q.includes('verification procedures')) sectionType = '4.5';
  else if (q.includes('specifications and product development')) sectionType = '4.3';
  else if (q.includes('programs for attaining food safety')) sectionType = '4.4';
  else if (q.includes('site security')) sectionType = '4.7';
  else if (q.includes('in place?')) sectionType = '4.1';
  else if (q.includes('document control')) sectionType = '4.2';

  // Extract topic
  const topic = extractTopic(q);

  const key = `${sectionType}:${topic}`;
  localByKey.set(key, item);
}

// Match malformed API questions to local fixes
const updates: { apiItem: any; localItem: any; apiQuestion: string; localQuestion: string }[] = [];

for (const apiItem of malformedApi) {
  const apiQ = apiItem.question || '';
  const check = isMalformed(apiQ);

  // Determine section type
  let sectionType = 'unknown';
  if (apiQ.includes('verification procedures')) sectionType = '4.5';
  else if (apiQ.includes('specifications and product development')) sectionType = '4.3';
  else if (apiQ.includes('programs for') || apiQ.includes('Attaining Food Safety')) sectionType = '4.4';
  else if (apiQ.includes('site security') || apiQ.includes('Site Security')) sectionType = '4.7';
  else if (apiQ.includes('in Place')) sectionType = '4.1';
  else if (apiQ.includes('Document Control')) sectionType = '4.2';

  const topic = extractTopic(apiQ);
  const key = `${sectionType}:${topic}`;

  const localItem = localByKey.get(key);

  if (localItem && localItem.question !== apiQ) {
    updates.push({
      apiItem,
      localItem,
      apiQuestion: apiQ,
      localQuestion: localItem.question
    });
  }
}

console.log(`\n=== UPDATES TO APPLY: ${updates.length} ===\n`);

updates.slice(0, 20).forEach((u, i) => {
  console.log(`${i + 1}. API ID: ${u.apiItem.id}`);
  console.log(`   Old: "${u.apiQuestion}"`);
  console.log(`   New: "${u.localQuestion}"`);
  console.log('');
});

if (updates.length > 20) {
  console.log(`... and ${updates.length - 20} more`);
}

// Save updates for review
writeFileSync('customers/numidia/pending-updates.json', JSON.stringify(updates, null, 2));
console.log(`\nSaved ${updates.length} pending updates to customers/numidia/pending-updates.json`);
