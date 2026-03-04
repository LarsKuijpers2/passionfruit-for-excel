/**
 * Fix certification QUESTIONS to be proper sentences
 */

import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

const rewrites: Array<{ search: string; newQuestion: string }> = [
  // ISO certifications as labels
  { search: '1 quality organization - certifications: sqf', newQuestion: 'Are you SQF certified?' },
  { search: '1 quality organization - certifications: iso 45000', newQuestion: 'Are you ISO 45000 certified?' },
  { search: '1 quality organization - certifications: iso 15378', newQuestion: 'Are you ISO 15378 certified?' },
  { search: '1 quality organization - certifications: gmp+', newQuestion: 'Are you GMP+ certified?' },
  { search: '1 quality organization - certifications: fami-qs', newQuestion: 'Are you FAMI-QS certified?' },
  { search: '1 quality organization - certifications: aib', newQuestion: 'Are you AIB certified?' },
  // Health certification labels
  { search: '1-6 health certification and government agencies: health certification number', newQuestion: 'What is your health certification number?' },
  // Certificate dates as labels
  { search: 'quality and food safety: expiry date of certificate', newQuestion: 'What is the expiry date of your quality and food safety certificate?' },
  { search: 'expiry date of certificate', newQuestion: 'What is the expiry date of your certificate?' },
];

async function main() {
  const client = new PassionfruitAPIClient();
  console.log('Fetching answers...');

  const answers = await client.listAnswers();
  console.log(`Found ${answers.length} answers\n`);

  let updated = 0;

  for (const { search, newQuestion } of rewrites) {
    const found = answers.find(a => a.question.toLowerCase().trim() === search);

    if (found && found.question !== newQuestion) {
      console.log(`Updating question:`);
      console.log(`  Old: "${found.question}"`);
      console.log(`  New: "${newQuestion}"`);

      try {
        await client.updateAnswer(found.id, {
          question: newQuestion,
          answer: found.answer,
          entities: [],
          evidences: [],
        });
        updated++;
        console.log(`  ✓ Updated\n`);
      } catch (e: any) {
        console.log(`  ✗ Failed: ${e.message}\n`);
      }
      await new Promise(r => setTimeout(r, 100));
    } else if (!found) {
      console.log(`Not found: "${search}"\n`);
    } else {
      console.log(`Already correct: "${search}"\n`);
    }
  }

  console.log(`\nDone. Updated ${updated} questions.`);
}

main().catch(console.error);
