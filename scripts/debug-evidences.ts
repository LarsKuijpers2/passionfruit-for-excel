/**
 * Debug: Check what evidences exist and which answers are linked to them
 */

import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

async function debug() {
  const client = new PassionfruitAPIClient();

  console.log('\n=== EVIDENCES ===\n');
  const evidences = await client.listEvidences();
  console.log(`Total evidences: ${evidences.length}`);
  for (const e of evidences) {
    console.log(`  [${e.id}] ${e.name} (status: ${e.status})`);
  }

  console.log('\n=== ANSWERS (sample) ===\n');
  const answers = await client.listAnswers();
  console.log(`First page answers: ${answers.length}`);

  // Check what evidences are linked
  const evidenceLinks = new Map<number, number>();
  for (const a of answers) {
    for (const evId of (a.evidences || [])) {
      evidenceLinks.set(evId, (evidenceLinks.get(evId) || 0) + 1);
    }
  }

  console.log('\nEvidence links in first page:');
  if (evidenceLinks.size === 0) {
    console.log('  No evidences linked to any answers!');
  } else {
    for (const [evId, count] of evidenceLinks) {
      console.log(`  Evidence ${evId}: ${count} answers`);
    }
  }

  // Show sample answer
  console.log('\nSample answer:');
  console.log(JSON.stringify(answers[0], null, 2));
}

debug().catch(console.error);
