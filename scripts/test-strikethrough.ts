#!/usr/bin/env npx tsx
/**
 * Test Claude Vision strikethrough detection on Dupon PDF
 */

import { extractPdfWithClaudeVision } from '../src/services/extractors/claude-vision.js';

async function test() {
  const filepath = 'customers/Taste Strik/incoming/Dupon Biscuits_Supplier Identification_Strik signed_20260203.pdf';
  console.log('Testing Claude Vision on Dupon PDF...\n');

  const result = await extractPdfWithClaudeVision(filepath);

  console.log(`\nExtracted ${result.tables.length} sections:\n`);

  for (const table of result.tables) {
    console.log(`\n=== ${table.section} ===`);
    for (const row of table.rows.slice(0, 8)) {
      const answer = row.yes ? 'YES' : row.no ? 'NO' : row.na ? 'N/A' : '?';
      const q = row.question.length > 60 ? row.question.slice(0, 60) + '...' : row.question;
      console.log(`  [${answer}] ${q}`);
      if (row.comment) {
        const c = row.comment.length > 50 ? row.comment.slice(0, 50) + '...' : row.comment;
        console.log(`      Comment: ${c}`);
      }
    }
    if (table.rows.length > 8) {
      console.log(`  ... and ${table.rows.length - 8} more rows`);
    }
  }
}

test().catch(console.error);
