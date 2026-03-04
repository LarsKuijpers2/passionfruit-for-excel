import 'dotenv/config';
import { PassionfruitAPIClient } from '../src/services/sync/api-client.js';

async function main() {
  const client = new PassionfruitAPIClient();
  const answers = await client.listAnswers();

  console.log('Searching for ISO and certification questions...\n');

  const found = answers.filter(a =>
    a.question.toLowerCase().includes('iso') ||
    a.question.toLowerCase().includes('ifs') ||
    a.question.toLowerCase().includes('certif') ||
    a.question.toLowerCase().includes('license')
  );

  found.forEach(a => {
    console.log(`ID ${a.id}:`);
    console.log(`  Q: ${a.question}`);
    console.log(`  A: ${a.answer.slice(0, 60)}...`);
    console.log('');
  });

  console.log(`Found ${found.length} matching questions.`);
}

main().catch(console.error);
