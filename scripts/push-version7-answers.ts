/**
 * Push Version 7 answers to Passionfruit API
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

const EVIDENCE_ID = 1852;

async function pushAnswers() {
  const client = new PassionfruitAPIClient();

  // Load indexed questionnaire
  const indexedPath = './customers/Doehler Oosterhout/indexed/Version_7_Standard_Questionnaire_for_Customers_Oosterhout__1_.json';
  const data = JSON.parse(await readFile(indexedPath, 'utf-8'));

  console.log('\nPushing Version 7 answers to Passionfruit API');
  console.log('Evidence ID:', EVIDENCE_ID);
  console.log('Environment:', client.environment);
  console.log('');

  // Collect all Q&A items
  const items: Array<{ question: string; answer: string; note?: string }> = [];
  for (const section of data.sections) {
    for (const item of section.items) {
      if (item.label && item.value) {
        items.push({
          question: item.label,
          answer: item.value,
          note: item.note || undefined,
        });
      }
    }
  }

  console.log('Total items to push:', items.length);
  console.log('');

  let created = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      await client.createAnswer({
        question: item.question,
        answer: item.answer,
        note: item.note,
        entities: [],
        evidences: [EVIDENCE_ID],
      });
      created++;
      if ((i + 1) % 25 === 0) {
        console.log('  Progress:', i + 1, '/', items.length);
      }
    } catch (err: any) {
      failed++;
      console.error('  Failed:', item.question.slice(0, 50), '-', err.message);
    }
  }

  console.log('');
  console.log('Done!');
  console.log('  Created:', created);
  console.log('  Failed:', failed);
}

pushAnswers().catch(console.error);
