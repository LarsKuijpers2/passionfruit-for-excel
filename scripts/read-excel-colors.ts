import ExcelJS from 'exceljs';
import { writeFile } from 'fs/promises';

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('customers/Doehler Oosterhout/Kopie van Doehler_Oosterhout-comparison.xlsx');

  const sheet = workbook.getWorksheet('Answers');
  if (!sheet) {
    console.error('No Answers sheet found');
    return;
  }

  const yellowRows: any[] = [];
  const redRows: any[] = [];
  const allColors: Record<string, number> = {};

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    // Check column 4 (Answer) for colors
    const answerCell = row.getCell(4);
    const fill = answerCell.fill as any;

    if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor) {
      const argb = (fill.fgColor.argb || '').toUpperCase();
      allColors[argb] = (allColors[argb] || 0) + 1;

      const rowData = {
        id: row.getCell(1).value,
        topic: row.getCell(2).value,
        question: row.getCell(3).value,
        answer: row.getCell(4).value,
        source: row.getCell(5).value,
        inLibrary: row.getCell(6).value,
        similarTo: row.getCell(7).value,
        color: argb
      };

      // Yellow: FFFFFF00
      if (argb === 'FFFFFF00') {
        yellowRows.push(rowData);
      }
      // Red shades
      else if (argb.includes('FF0000') || argb.includes('FFCCCC') || argb.includes('FF9999')) {
        redRows.push(rowData);
      }
    }
  });

  console.log('=== COLOR SUMMARY ===');
  console.log('All colors found:', allColors);
  console.log('\nYellow rows (to update):', yellowRows.length);
  console.log('Red rows (skip):', redRows.length);

  console.log('\n=== YELLOW ROWS (TO UPDATE) ===\n');
  yellowRows.forEach((r, i) => {
    console.log(`${i + 1}. ID ${r.id} [${r.topic}]`);
    console.log(`   Q: ${String(r.question).slice(0, 80)}${String(r.question).length > 80 ? '...' : ''}`);
    console.log(`   A: ${String(r.answer).slice(0, 80)}${String(r.answer).length > 80 ? '...' : ''}`);
    console.log(`   In Library: ${r.inLibrary}`);
    console.log('');
  });

  if (redRows.length > 0) {
    console.log('\n=== RED ROWS (SKIP) ===\n');
    redRows.forEach((r, i) => {
      console.log(`${i + 1}. ID ${r.id}: ${String(r.question).slice(0, 60)}...`);
    });
  }

  // Save yellow rows to JSON for processing
  await writeFile(
    'customers/Doehler Oosterhout/yellow-rows-to-update.json',
    JSON.stringify(yellowRows, null, 2)
  );
  console.log('\nSaved yellow rows to: customers/Doehler Oosterhout/yellow-rows-to-update.json');
}

main().catch(console.error);
