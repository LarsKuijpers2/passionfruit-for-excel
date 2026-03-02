import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('customers/numidia/curated-library-final.json', 'utf-8'));

// Mapping of section patterns to proper question formats
const sectionToFormat: Record<string, (topic: string) => string> = {
  '4.1 Do you have in Place?': (topic) => `Do you have ${topic} in place?`,
  '4.2 Do you have Document Control and Records?': (topic) => `Do you have document control and records for ${topic}?`,
  '4.3. Do you have Specifications and Product Development for?': (topic) => `Do you have specifications and product development for ${topic}?`,
  '4.4 Do you have programs for Attaining Food Safety?': (topic) => `Do you have programs for attaining food safety regarding ${topic}?`,
  '4.5 Do you have verification procedures in place for?': (topic) => `Do you have verification procedures in place for ${topic}?`,
  '4.6 Do you have Product Identification, Trace, Withdrawal and Recall Policies?': (topic) => `Do you have product identification, trace, withdrawal and recall policies for ${topic}?`,
  '4.7 Do you have Site Security for?': (topic) => `Do you have site security measures for ${topic}?`,
};

let fixedCount = 0;

data.items = data.items.map((item: any) => {
  const q = item.question;
  const section = item.section;

  // Check if this is a malformed question
  const isMalformed = /^Do you have .+ - /.test(q) || /\(.*for\)?\?\s*$/.test(q);
  if (!isMalformed) {
    return item;
  }

  // Extract the actual topic from the messy question
  let topic = q;

  // Remove 'Do you have' prefix
  topic = topic.replace(/^Do you have\s+/, '');

  // Remove duplicate section prefixes like 'Do you have in Place? -'
  topic = topic.replace(/^Do you have (in Place|Document Control|programs for|verification procedures).*?\s*-\s*/i, '');

  // Remove trailing parenthetical like '(verification procedures in place for)?'
  topic = topic.replace(/\s*\([^)]*for\)\??\s*$/, '');

  // Remove duplicate topic like 'Food Safety Fundamentals - Food Safety Fundamentals'
  const parts = topic.split(' - ');
  if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
    topic = parts[0].trim();
  } else if (parts.length === 2) {
    // Keep the more descriptive part
    topic = parts[1].trim() || parts[0].trim();
  }

  // Clean up any remaining artifacts
  topic = topic.replace(/^\[.*?\]\s*/, ''); // Remove [4.8 Do you identity...] prefixes
  topic = topic.trim();

  // Find the formatter for this section
  let newQuestion: string | null = null;
  for (const [sectionPattern, formatter] of Object.entries(sectionToFormat)) {
    if (section && section.includes(sectionPattern.substring(0, 20))) {
      newQuestion = formatter(topic);
      break;
    }
  }

  if (newQuestion && newQuestion !== item.question) {
    console.log('FIXED:');
    console.log('  Old:', item.question);
    console.log('  New:', newQuestion);
    console.log('');
    item.question = newQuestion;
    fixedCount++;
  }

  return item;
});

console.log(`\n=== Fixed ${fixedCount} malformed questions ===`);

// Save
data.generatedAt = new Date().toISOString();
writeFileSync('customers/numidia/curated-library-final.json', JSON.stringify(data, null, 2));
console.log('Saved to customers/numidia/curated-library-final.json');
