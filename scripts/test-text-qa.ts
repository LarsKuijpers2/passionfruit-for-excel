/**
 * Test the text-based Q&A extractor
 */

import { extractTextQA } from '../src/services/extractors/text-qa.js';

async function main() {
  const filepath = process.argv[2];

  if (!filepath) {
    console.log('Usage: npx tsx scripts/test-text-qa.ts <pdf-path>');
    process.exit(1);
  }

  console.log(`\nExtracting Q&A from: ${filepath}\n`);

  const result = await extractTextQA(filepath);

  console.log(`\n=== EXTRACTION RESULT ===\n`);
  console.log(`Total Q&A pairs: ${result.items.length}`);
  console.log(`Sections: ${result.sections.join(', ')}`);
  console.log(`Pages: ${result.pageCount}`);
  console.log(`Method: ${result.extractionMethod}`);

  console.log(`\n=== FIRST 10 Q&A PAIRS ===\n`);
  for (const item of result.items.slice(0, 10)) {
    console.log(`[${item.section}] ${item.questionNumber || ''}`);
    console.log(`  Q: ${item.question.slice(0, 80)}${item.question.length > 80 ? '...' : ''}`);
    console.log(`  A: ${item.answer.slice(0, 100)}${item.answer.length > 100 ? '...' : ''}`);
    console.log();
  }

  if (result.items.length > 10) {
    console.log(`... and ${result.items.length - 10} more Q&A pairs`);
  }
}

main().catch(console.error);
