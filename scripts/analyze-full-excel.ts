/**
 * Analyze ALL items from Excel (not just yellow ones)
 *
 * The customer reviewed all 792 items:
 * - Yellow = they changed the answer
 * - Red = skip (uncertain)
 * - Non-colored = answer is fine, should be added
 */

import ExcelJS from 'exceljs';
import { readFile, writeFile } from 'fs/promises';

interface ExcelRow {
  id: number;
  topic: string;
  question: string;
  answer: string;
  source: string;
  inLibrary: string;
  similarTo: string | number | null;
  isYellow: boolean;
  isRed: boolean;
}

interface ExistingAnswer {
  id: number;
  question: string;
  answer: string;
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  // Read Excel with colors
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('customers/Doehler Oosterhout/Kopie van Doehler_Oosterhout-comparison.xlsx');

  const sheet = workbook.getWorksheet('Answers');
  if (!sheet) {
    console.error('No Answers sheet found');
    return;
  }

  // Extract all rows with color info
  const allRows: ExcelRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const answerCell = row.getCell(4);
    const fill = answerCell.fill as any;
    let isYellow = false;
    let isRed = false;

    if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor) {
      const argb = (fill.fgColor.argb || '').toUpperCase();
      if (argb === 'FFFFFF00') isYellow = true;
      if (argb === 'FFFF0000') isRed = true;
    }

    const id = row.getCell(1).value;
    const question = row.getCell(3).value;
    const answer = row.getCell(4).value;

    if (id && question && answer) {
      allRows.push({
        id: Number(id),
        topic: String(row.getCell(2).value || ''),
        question: String(question),
        answer: String(answer),
        source: String(row.getCell(5).value || ''),
        inLibrary: String(row.getCell(6).value || ''),
        similarTo: row.getCell(7).value as any,
        isYellow,
        isRed,
      });
    }
  });

  console.log('=== EXCEL SUMMARY ===');
  console.log(`Total rows: ${allRows.length}`);
  console.log(`Yellow (changed): ${allRows.filter(r => r.isYellow).length}`);
  console.log(`Red (skip): ${allRows.filter(r => r.isRed).length}`);
  console.log(`Non-colored: ${allRows.filter(r => !r.isYellow && !r.isRed).length}`);

  // Read existing API answers
  const existingAnswers: ExistingAnswer[] = JSON.parse(
    await readFile('customers/Doehler Oosterhout/api-answer-library.json', 'utf-8')
  );

  console.log(`\nExisting API answers: ${existingAnswers.length}`);

  // Create map by normalized question
  const apiByQuestion = new Map<string, ExistingAnswer>();
  for (const a of existingAnswers) {
    apiByQuestion.set(normalizeQuestion(a.question), a);
  }

  // Analyze each row
  const toUpdate: any[] = [];
  const toAdd: any[] = [];
  const alreadyCorrect: any[] = [];
  const skipped: any[] = [];

  for (const row of allRows) {
    // Skip red items
    if (row.isRed) {
      skipped.push(row);
      continue;
    }

    const normQ = normalizeQuestion(row.question);
    const existing = apiByQuestion.get(normQ);

    if (existing) {
      // Question exists in API
      const apiAns = existing.answer.toLowerCase().trim();
      const excelAns = row.answer.toLowerCase().trim();

      if (apiAns === excelAns) {
        alreadyCorrect.push({ apiId: existing.id, ...row });
      } else {
        toUpdate.push({
          apiId: existing.id,
          currentAnswer: existing.answer,
          newAnswer: row.answer,
          isYellow: row.isYellow,
          ...row,
        });
      }
    } else {
      // New question - needs to be added
      toAdd.push(row);
    }
  }

  console.log('\n=== ANALYSIS ===');
  console.log(`Already correct (same Q&A in API): ${alreadyCorrect.length}`);
  console.log(`Need to UPDATE (answer differs): ${toUpdate.length}`);
  console.log(`Need to ADD (new questions): ${toAdd.length}`);
  console.log(`Skipped (red): ${skipped.length}`);

  // Show update breakdown
  const yellowUpdates = toUpdate.filter(u => u.isYellow);
  const nonYellowUpdates = toUpdate.filter(u => !u.isYellow);
  console.log(`\nUpdates breakdown:`);
  console.log(`  - Yellow (customer changed): ${yellowUpdates.length}`);
  console.log(`  - Non-yellow (answer differs): ${nonYellowUpdates.length}`);

  // Show some examples of non-yellow updates (these might be older data)
  if (nonYellowUpdates.length > 0) {
    console.log('\n--- Sample NON-YELLOW updates (answer differs from API) ---');
    nonYellowUpdates.slice(0, 5).forEach((u, i) => {
      console.log(`${i + 1}. Q: ${u.question.slice(0, 60)}...`);
      console.log(`   API: "${u.currentAnswer.slice(0, 40)}..."`);
      console.log(`   Excel: "${u.newAnswer.slice(0, 40)}..."`);
    });
  }

  // Save results
  await writeFile('customers/Doehler Oosterhout/full-items-to-update.json', JSON.stringify(toUpdate, null, 2));
  await writeFile('customers/Doehler Oosterhout/full-items-to-add.json', JSON.stringify(toAdd, null, 2));
  await writeFile('customers/Doehler Oosterhout/full-already-correct.json', JSON.stringify(alreadyCorrect, null, 2));

  console.log('\nSaved:');
  console.log('  - full-items-to-update.json');
  console.log('  - full-items-to-add.json');
  console.log('  - full-already-correct.json');
}

main().catch(console.error);
