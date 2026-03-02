import { readFileSync, writeFileSync } from 'fs';

const apiAnswers = JSON.parse(readFileSync('customers/numidia/api-answers.json', 'utf-8'));
const localAnswers = JSON.parse(readFileSync('customers/numidia/curated-library-final.json', 'utf-8'));

interface Update {
  id: number;
  oldQuestion: string;
  newQuestion: string;
  answer: string;
}

// Check if malformed
function isMalformed(q: string): boolean {
  if (!q) return false;
  return /^Do you have .+ - /.test(q) ||
         /\([^)]*for\)\??$/.test(q) ||
         /^Do you have Do you have/.test(q) ||
         !q.endsWith('?');
}

// Extract topic from question
function extractTopic(q: string): string {
  let topic = q;
  // Remove prefixes
  topic = topic.replace(/^Do you have (Do you have )?(in Place\? - |Document Control.*? - |programs for.*? - |verification procedures.*? - )?/gi, '');
  // Remove trailing parentheticals
  topic = topic.replace(/\s*\([^)]*\)\??$/g, '');
  // Handle "X - X" duplicates
  const parts = topic.split(' - ');
  if (parts.length >= 2 && parts[0].trim() === parts[1].trim()) {
    topic = parts[0].trim();
  } else if (parts.length >= 2) {
    topic = parts[parts.length - 1].trim();
  }
  return topic.replace(/\?+$/g, '').trim().toLowerCase();
}

// Detect section type from question
function detectSection(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('verification procedures in place for')) return '4.5';
  if (lower.includes('specifications and product development')) return '4.3';
  if (lower.includes('programs for attaining food safety') || lower.includes('programs for food safety')) return '4.4';
  if (lower.includes('site security')) return '4.7';
  if (lower.includes('product identification') || lower.includes('trace') || lower.includes('withdrawal') || lower.includes('recall policies')) return '4.6';
  if (lower.includes('document control and records') && !lower.includes('for ')) return '4.2';
  if (lower.includes('in place?') || lower.includes('in place for')) return '4.1';
  return 'other';
}

// Build local lookup: section + topic -> question
const localLookup = new Map<string, string>();
for (const item of localAnswers.items) {
  const q = item.question;
  const section = detectSection(q);
  const topic = extractTopic(q);
  const key = `${section}:${topic}`;
  localLookup.set(key, q);
}

// Process malformed API questions
const updates: Update[] = [];
const noMatch: any[] = [];

for (const apiItem of apiAnswers) {
  const q = apiItem.question || '';

  if (!isMalformed(q)) continue;

  const section = detectSection(q);
  const topic = extractTopic(q);
  const key = `${section}:${topic}`;

  let localQuestion = localLookup.get(key);

  // If no exact match, try just by topic
  if (!localQuestion) {
    for (const [k, v] of localLookup) {
      if (k.endsWith(':' + topic)) {
        // Check if section type matches
        const localSection = k.split(':')[0];
        if (localSection === section || section === 'other') {
          localQuestion = v;
          break;
        }
      }
    }
  }

  // Still no match? Try fuzzy topic match
  if (!localQuestion) {
    for (const [k, v] of localLookup) {
      const localTopic = k.split(':')[1];
      if (localTopic.includes(topic) || topic.includes(localTopic)) {
        const localSection = k.split(':')[0];
        if (localSection === section) {
          localQuestion = v;
          break;
        }
      }
    }
  }

  if (localQuestion && localQuestion !== q) {
    updates.push({
      id: apiItem.id,
      oldQuestion: q,
      newQuestion: localQuestion,
      answer: apiItem.answer
    });
  } else if (!localQuestion) {
    noMatch.push({ id: apiItem.id, question: q, section, topic });
  }
}

console.log('=== UPDATE SUMMARY ===');
console.log(`Malformed API questions: ${apiAnswers.filter((a: any) => isMalformed(a.question || '')).length}`);
console.log(`Updates found: ${updates.length}`);
console.log(`No match: ${noMatch.length}`);

console.log('\n=== UPDATES TO APPLY ===\n');
updates.forEach((u, i) => {
  console.log(`${i + 1}. ID ${u.id}`);
  console.log(`   OLD: ${u.oldQuestion}`);
  console.log(`   NEW: ${u.newQuestion}`);
  console.log('');
});

if (noMatch.length > 0) {
  console.log('\n=== NO MATCH FOUND ===');
  noMatch.forEach((n, i) => {
    console.log(`${i + 1}. ID ${n.id}: ${n.question}`);
    console.log(`   Section: ${n.section}, Topic: ${n.topic}`);
  });
}

// Save updates
writeFileSync('customers/numidia/updates-to-apply.json', JSON.stringify(updates, null, 2));
console.log(`\nSaved ${updates.length} updates to customers/numidia/updates-to-apply.json`);
