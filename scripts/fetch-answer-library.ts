/**
 * Fetch Answer Library from Passionfruit API
 *
 * Downloads all answers from the API and saves them to the customer folder.
 */

import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

async function fetchAnswerLibrary(customer: string) {
  const client = new PassionfruitAPIClient();

  console.log('\nFetching answers from Passionfruit API...');
  console.log('Environment:', client.environment);
  console.log('URL:', client.url);

  const answers = await client.listAnswers();

  console.log(`\nFetched ${answers.length} answers`);

  // Show first few answers
  console.log('\nFirst 5 answers:');
  for (const a of answers.slice(0, 5)) {
    console.log('  - Q:', a.question.slice(0, 60) + (a.question.length > 60 ? '...' : ''));
    console.log('    A:', a.answer.slice(0, 60) + (a.answer.length > 60 ? '...' : ''));
  }

  // Save raw API response
  const customerDir = `./customers/${customer}`;
  await mkdir(customerDir, { recursive: true });

  const outputPath = join(customerDir, 'api-answer-library.json');
  await writeFile(outputPath, JSON.stringify(answers, null, 2));
  console.log('\nSaved raw API response to:', outputPath);

  // Convert to curated library format
  const curatedLibrary = {
    customer,
    fetchedAt: new Date().toISOString(),
    source: 'passionfruit-api',
    totalAnswers: answers.length,
    answer_library: groupByTopic(answers),
  };

  const curatedPath = join(customerDir, 'curated-library.json');
  await writeFile(curatedPath, JSON.stringify(curatedLibrary, null, 2));
  console.log('Saved curated library to:', curatedPath);

  return answers;
}

interface APIAnswer {
  id: number;
  question: string;
  answer: string;
  note?: string;
  entities: number[];
  evidences: number[];
}

function groupByTopic(answers: APIAnswer[]) {
  // Group answers by detected topic from question content
  const topics: Record<string, Array<{
    id: number;
    question: string;
    answer: string;
    note?: string;
  }>> = {};

  for (const a of answers) {
    const topic = detectTopic(a.question);

    if (!topics[topic]) {
      topics[topic] = [];
    }

    topics[topic].push({
      id: a.id,
      question: a.question,
      answer: a.answer,
      note: a.note,
    });
  }

  // Convert to array format
  return Object.entries(topics).map(([topic, questions]) => ({
    topic,
    questions,
  }));
}

function detectTopic(question: string): string {
  const q = question.toLowerCase();

  if (q.includes('certif') || q.includes('audit') || q.includes('iso') || q.includes('fssc') || q.includes('brc')) {
    return 'certifications';
  }
  if (q.includes('allergen')) {
    return 'allergens';
  }
  if (q.includes('haccp') || q.includes('food safety') || q.includes('hygiene')) {
    return 'food_safety';
  }
  if (q.includes('employee') || q.includes('staff') || q.includes('worker')) {
    return 'company_information';
  }
  if (q.includes('supplier') || q.includes('vendor')) {
    return 'supplier_management';
  }
  if (q.includes('quality') || q.includes('testing') || q.includes('lab')) {
    return 'quality_systems';
  }
  if (q.includes('environment') || q.includes('sustainability') || q.includes('energy')) {
    return 'sustainability';
  }
  if (q.includes('trace') || q.includes('recall')) {
    return 'traceability';
  }
  if (q.includes('storage') || q.includes('transport') || q.includes('warehouse')) {
    return 'logistics';
  }

  return 'general';
}

// Main
const customer = process.argv[2] || 'Doehler Oosterhout';
fetchAnswerLibrary(customer).catch(console.error);
