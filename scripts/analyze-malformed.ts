import { readFileSync } from 'fs';

const apiAnswers = JSON.parse(readFileSync('customers/numidia/api-answers.json', 'utf-8'));
const localAnswers = JSON.parse(readFileSync('customers/numidia/curated-library-final.json', 'utf-8'));

// Extract topics from malformed API questions
function extractTopic(q: string): string {
  let topic = q;
  topic = topic.replace(/^Do you have (Do you have )?(in Place\? - |Document Control.*? - |programs for.*? - |verification procedures.*? - )?/gi, '');
  topic = topic.replace(/\s*\([^)]*\)\??$/g, '');
  const parts = topic.split(' - ');
  if (parts.length >= 2 && parts[0].trim() === parts[1].trim()) {
    topic = parts[0].trim();
  } else if (parts.length >= 2) {
    topic = parts[parts.length - 1].trim();
  }
  return topic.replace(/\?+$/g, '').trim();
}

// Check if malformed
function isMalformed(q: string): boolean {
  return /^Do you have .+ - /.test(q) ||
         /\([^)]*for\)\??$/.test(q) ||
         /^Do you have Do you have/.test(q);
}

// Get all malformed API questions
const malformed = apiAnswers.filter((a: any) => isMalformed(a.question || ''));

console.log(`Total malformed: ${malformed.length}\n`);

// Extract unique topics
const topics = new Set<string>();
for (const a of malformed) {
  topics.add(extractTopic(a.question));
}

console.log('=== UNIQUE TOPICS IN MALFORMED QUESTIONS ===');
Array.from(topics).sort().forEach((t, i) => console.log(`${i + 1}. ${t}`));

// Check which we have locally
console.log('\n=== MATCHING LOCAL QUESTIONS ===');
for (const topic of topics) {
  const localMatch = localAnswers.items.find((item: any) =>
    item.question.toLowerCase().includes(topic.toLowerCase())
  );
  if (localMatch) {
    console.log(`✓ "${topic}" -> "${localMatch.question}"`);
  } else {
    console.log(`✗ "${topic}" -> NO MATCH`);
  }
}
