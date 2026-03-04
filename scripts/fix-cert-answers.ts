/**
 * Fix certification answers to be proper sentences
 */

import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

const rewrites: Record<string, { match: string; newAnswer: string }> = {
  'License to Operate as a Food Manufacturer': {
    match: 'NVWA registered',
    newAnswer: 'Döhler Holland B.V. is registered with the NVWA (Netherlands Food and Consumer Product Safety Authority).'
  },
  'ISO 9001 - Certifying body': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 9001 certificate for certifying body details.'
  },
  'ISO 9001 - Certificate issue date': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 9001 certificate for the issue date.'
  },
  'ISO 9001 - Certificate expiry date': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 9001 certificate for the expiry date.'
  },
  'ISO 9001': {
    match: 'yes',
    newAnswer: 'Yes, Döhler Holland B.V. is ISO 9001 certified.'
  },
  'ISO 50001 - Certifying body': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 50001 certificate for certifying body details.'
  },
  'ISO 50001 - Certificate issue date': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 50001 certificate for the issue date.'
  },
  'ISO 50001 - Certificate expiry date': {
    match: 'Please see certificate',
    newAnswer: 'Please refer to the ISO 50001 certificate for the expiry date.'
  },
  'ISO 50001': {
    match: 'yes',
    newAnswer: 'Yes, Döhler Holland B.V. is ISO 50001 certified.'
  },
  'ISO 22000': {
    match: 'no',
    newAnswer: 'No, Döhler Holland B.V. is not ISO 22000 certified.'
  },
  'ISO 14001': {
    match: 'no',
    newAnswer: 'No, Döhler Holland B.V. is not ISO 14001 certified.'
  },
  'IFS': {
    match: 'no',
    newAnswer: 'No, Döhler Holland B.V. is not IFS certified.'
  },
};

async function main() {
  const client = new PassionfruitAPIClient();
  console.log('Fetching answers...');

  const answers = await client.listAnswers();
  console.log(`Found ${answers.length} answers\n`);

  let updated = 0;

  for (const [questionMatch, rewrite] of Object.entries(rewrites)) {
    // Find exact or close match
    const found = answers.find(a =>
      a.question.toLowerCase() === questionMatch.toLowerCase() ||
      a.question.toLowerCase().includes(questionMatch.toLowerCase())
    );

    if (found && found.answer.toLowerCase().trim() === rewrite.match.toLowerCase()) {
      console.log(`Updating: "${found.question}"`);
      console.log(`  Old: "${found.answer}"`);
      console.log(`  New: "${rewrite.newAnswer}"`);

      try {
        await client.updateAnswer(found.id, {
          question: found.question,
          answer: rewrite.newAnswer,
          entities: [],
          evidences: [],
        });
        updated++;
        console.log(`  ✓ Updated\n`);
      } catch (e: any) {
        console.log(`  ✗ Failed: ${e.message}\n`);
      }

      await new Promise(r => setTimeout(r, 100));
    } else if (found) {
      console.log(`Skipping "${questionMatch}" - answer doesn't match expected "${rewrite.match}"`);
      console.log(`  Current: "${found.answer}"\n`);
    } else {
      console.log(`Not found: "${questionMatch}"\n`);
    }
  }

  console.log(`\nDone. Updated ${updated} answers.`);
}

main().catch(console.error);
