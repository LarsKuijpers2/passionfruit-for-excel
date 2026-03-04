import { readFile, writeFile } from 'fs/promises';

function normalizeQuestion(q: string): string {
  return q.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const backup = JSON.parse(await readFile('customers/Doehler Oosterhout/api-answer-library.json', 'utf-8'));
  const yellow = JSON.parse(await readFile('customers/Doehler Oosterhout/yellow-rows-to-update.json', 'utf-8'));

  console.log('API answers:', backup.length);
  console.log('Yellow rows:', yellow.length);

  // Create a map of API answers by normalized question
  const apiByQuestion = new Map<string, any>();
  for (const a of backup) {
    const norm = normalizeQuestion(a.question);
    apiByQuestion.set(norm, a);
  }

  // Analyze yellow rows
  const toUpdate: any[] = [];
  const toAdd: any[] = [];
  const alreadyCorrect: any[] = [];

  for (const y of yellow) {
    const normQ = normalizeQuestion(y.question);
    const apiAnswer = apiByQuestion.get(normQ);

    if (apiAnswer) {
      // Compare answers
      const apiAns = apiAnswer.answer.toLowerCase().trim();
      const yellowAns = String(y.answer).toLowerCase().trim();

      if (apiAns === yellowAns) {
        alreadyCorrect.push({
          apiId: apiAnswer.id,
          excelId: y.id,
          question: y.question
        });
      } else {
        toUpdate.push({
          apiId: apiAnswer.id,
          excelId: y.id,
          question: y.question,
          currentAnswer: apiAnswer.answer,
          newAnswer: y.answer
        });
      }
    } else {
      toAdd.push({
        excelId: y.id,
        topic: y.topic,
        question: y.question,
        answer: y.answer
      });
    }
  }

  console.log('\n=== ANALYSIS (by question match) ===');
  console.log('Already correct (no change needed):', alreadyCorrect.length);
  console.log('Need to UPDATE (answer differs):', toUpdate.length);
  console.log('Need to ADD (not in API yet):', toAdd.length);

  if (alreadyCorrect.length > 0) {
    console.log('\n=== ALREADY CORRECT ===\n');
    alreadyCorrect.slice(0, 5).forEach((item, i) => {
      console.log(`${i + 1}. API ID ${item.apiId}: ${String(item.question).slice(0, 60)}...`);
    });
    if (alreadyCorrect.length > 5) {
      console.log(`... and ${alreadyCorrect.length - 5} more`);
    }
  }

  if (toUpdate.length > 0) {
    console.log('\n=== ITEMS TO UPDATE ===\n');
    toUpdate.forEach((item, i) => {
      console.log(`${i + 1}. API ID ${item.apiId}:`);
      console.log(`   Q: ${String(item.question).slice(0, 70)}...`);
      console.log(`   Current: "${String(item.currentAnswer).slice(0, 50)}"`);
      console.log(`   New:     "${String(item.newAnswer).slice(0, 50)}"`);
      console.log('');
    });
  }

  if (toAdd.length > 0) {
    console.log('\n=== ITEMS TO ADD (first 10) ===\n');
    toAdd.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. [${item.topic}]:`);
      console.log(`   Q: ${String(item.question).slice(0, 70)}...`);
      console.log(`   A: ${String(item.answer).slice(0, 60)}`);
      console.log('');
    });
    if (toAdd.length > 10) {
      console.log(`... and ${toAdd.length - 10} more`);
    }
  }

  // Save analysis for next step
  await writeFile('customers/Doehler Oosterhout/items-to-update.json', JSON.stringify(toUpdate, null, 2));
  await writeFile('customers/Doehler Oosterhout/items-to-add.json', JSON.stringify(toAdd, null, 2));

  console.log('\nSaved items-to-update.json and items-to-add.json');
}

main().catch(console.error);
