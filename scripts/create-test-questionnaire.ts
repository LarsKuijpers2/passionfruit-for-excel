#!/usr/bin/env tsx

/**
 * Creates a test supplier questionnaire Excel file matching the screenshot
 * Run with: npx tsx scripts/create-test-questionnaire.ts
 */

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createTestQuestionnaire(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Passionfruit Test';
  workbook.created = new Date();

  // Create main sheet
  const sheet = workbook.addWorksheet('Supplier_Questionnaire', {
    properties: { defaultColWidth: 15 }
  });

  // Define colors
  const BLUE_INPUT = 'FFD4E5F7';  // Light blue for input cells
  const GRAY_INPUT = 'FFD8D8D8';  // Gray for input cells
  const HEADER_BLUE = 'FF62B4E5'; // Header blue
  const WHITE = 'FFFFFFFF';

  // Helper to style input cells
  const inputCellStyle = (cell: ExcelJS.Cell, color: string = BLUE_INPUT): void => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
  };

  const headerStyle = (cell: ExcelJS.Cell): void => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_BLUE }
    };
    cell.font = { bold: true, size: 14 };
  };

  const labelStyle = (cell: ExcelJS.Cell): void => {
    cell.font = { size: 10 };
    cell.alignment = { vertical: 'middle' };
  };

  // Set column widths
  sheet.getColumn('E').width = 40;
  sheet.getColumn('F').width = 8;
  sheet.getColumn('G').width = 20;
  sheet.getColumn('H').width = 30;
  sheet.getColumn('I').width = 8;
  sheet.getColumn('J').width = 8;
  sheet.getColumn('K').width = 10;

  // Row 12: Product category
  sheet.getCell('E12').value = 'co-manufactured products';
  sheet.getCell('F12').value = '';
  inputCellStyle(sheet.getCell('F12'), GRAY_INPUT);

  // Row 14: Manufacturer checkbox
  sheet.getCell('E14').value = 'If you are not the manufacturer of the products supplied to Company X Group,';
  sheet.getCell('K14').value = '';
  inputCellStyle(sheet.getCell('K14'), GRAY_INPUT);

  // Row 16: Instruction text (italic)
  sheet.getCell('D16').value = 'According to the category of supplies, some questions of the questionnaire will be deleted. It\'s not necessary to answer those questions.';
  sheet.getCell('D16').font = { italic: true, size: 10 };
  sheet.mergeCells('D16:K16');

  // === FOR THE SUPPLIER SECTION ===
  sheet.getCell('G20').value = 'For the Supplier:';
  sheet.getCell('G20').font = { bold: true, underline: true };

  sheet.getCell('G22').value = 'Signatory\'s name:';
  labelStyle(sheet.getCell('G22'));
  sheet.mergeCells('H22:K22');
  inputCellStyle(sheet.getCell('H22'), GRAY_INPUT);

  sheet.getCell('G23').value = 'Function:';
  labelStyle(sheet.getCell('G23'));
  sheet.mergeCells('H23:K23');
  inputCellStyle(sheet.getCell('H23'), GRAY_INPUT);

  sheet.getCell('G25').value = 'Date:';
  labelStyle(sheet.getCell('G25'));
  sheet.getCell('I24').value = 'DD';
  sheet.getCell('I24').font = { size: 8 };
  sheet.getCell('I24').alignment = { horizontal: 'center' };
  sheet.getCell('J24').value = 'MM';
  sheet.getCell('J24').font = { size: 8 };
  sheet.getCell('J24').alignment = { horizontal: 'center' };
  sheet.getCell('K24').value = 'YYYY';
  sheet.getCell('K24').font = { size: 8 };
  sheet.getCell('K24').alignment = { horizontal: 'center' };

  inputCellStyle(sheet.getCell('I25'), GRAY_INPUT);
  inputCellStyle(sheet.getCell('J25'), GRAY_INPUT);
  inputCellStyle(sheet.getCell('K25'), GRAY_INPUT);

  sheet.getCell('G27').value = 'SIGNATURE AND COMPANY STAMP*';
  sheet.getCell('G27').font = { bold: true, underline: true, size: 10 };
  sheet.mergeCells('G28:K29');
  inputCellStyle(sheet.getCell('G28'), GRAY_INPUT);

  // === FOR THE MANUFACTURER SECTION ===
  sheet.getCell('G31').value = 'For the Manufacturer (if different from Supplier):';
  sheet.getCell('G31').font = { bold: true, underline: true };

  sheet.getCell('G33').value = 'Signatory\'s name:';
  labelStyle(sheet.getCell('G33'));
  sheet.mergeCells('H33:K33');
  inputCellStyle(sheet.getCell('H33'), GRAY_INPUT);

  sheet.getCell('G34').value = 'Function:';
  labelStyle(sheet.getCell('G34'));
  sheet.mergeCells('H34:K34');
  inputCellStyle(sheet.getCell('H34'), GRAY_INPUT);

  sheet.getCell('G36').value = 'Date:';
  labelStyle(sheet.getCell('G36'));
  sheet.getCell('I35').value = 'DD';
  sheet.getCell('I35').font = { size: 8 };
  sheet.getCell('I35').alignment = { horizontal: 'center' };
  sheet.getCell('J35').value = 'MM';
  sheet.getCell('J35').font = { size: 8 };
  sheet.getCell('J35').alignment = { horizontal: 'center' };
  sheet.getCell('K35').value = 'YYYY';
  sheet.getCell('K35').font = { size: 8 };
  sheet.getCell('K35').alignment = { horizontal: 'center' };

  inputCellStyle(sheet.getCell('I36'), GRAY_INPUT);
  inputCellStyle(sheet.getCell('J36'), GRAY_INPUT);
  inputCellStyle(sheet.getCell('K36'), GRAY_INPUT);

  sheet.getCell('G38').value = 'SIGNATURE AND COMPANY STAMP*';
  sheet.getCell('G38').font = { bold: true, underline: true, size: 10 };
  sheet.mergeCells('G39:K40');
  inputCellStyle(sheet.getCell('G39'), GRAY_INPUT);

  // === THE GROUP TO WHICH YOU BELONG ===
  sheet.getCell('E42').value = 'THE GROUP TO WHICH YOU BELONG';
  headerStyle(sheet.getCell('E42'));
  sheet.mergeCells('E42:K42');

  // Group fields with labels in E and input cells in H-K
  const groupFields = [
    { row: 43, label: 'Group name:', inputStart: 'H', inputEnd: 'K' },
    { row: 44, label: 'Address:', inputStart: 'H', inputEnd: 'K' },
    { row: 45, label: 'ZIP CODE / Town:', inputStart: 'H', inputEnd: 'K' },
    { row: 46, label: 'Country:', inputStart: 'H', inputEnd: 'K' },
    { row: 47, label: 'Telephone:', inputStart: 'H', inputEnd: 'K' },
    { row: 48, label: 'TVA / VAT number (if applicable):', inputStart: 'H', inputEnd: 'K' },
    { row: 49, label: 'Contacts (name / telephone number / e-mail address):', inputStart: null, inputEnd: null },
    { row: 50, label: '     Top management:', inputStart: 'H', inputEnd: 'K' },
    { row: 51, label: '     Sales:', inputStart: 'H', inputEnd: 'K' },
    { row: 52, label: '     Quality & Food Safety:', inputStart: 'H', inputEnd: 'K' },
    { row: 53, label: 'Total turnover (including export):', inputStart: 'H', inputEnd: 'K' },
    { row: 54, label: 'No. of Staff:', inputStart: 'H', inputEnd: 'K' },
    { row: 55, label: 'List of your Group Sites supplying Company X Group factories:', inputStart: 'H', inputEnd: 'K' },
    { row: 56, label: 'Other information about the Group to which you belong:', inputStart: 'H', inputEnd: 'K' },
  ];

  for (const field of groupFields) {
    sheet.getCell(`E${field.row}`).value = field.label;
    labelStyle(sheet.getCell(`E${field.row}`));

    if (field.inputStart && field.inputEnd) {
      sheet.mergeCells(`${field.inputStart}${field.row}:${field.inputEnd}${field.row}`);
      inputCellStyle(sheet.getCell(`${field.inputStart}${field.row}`), BLUE_INPUT);
    }
  }

  // === QUESTIONNAIRE RELATED MANUFACTURING/STORAGE/DISTRIBUTION SITE ===
  sheet.getCell('E58').value = 'QUESTIONNAIRE RELATED MANUFACTURING / STORAGE / DISTRIBUTION... SITE';
  headerStyle(sheet.getCell('E58'));
  sheet.mergeCells('E58:K58');

  const siteFields = [
    { row: 59, label: 'Company name:', inputStart: 'H', inputEnd: 'K' },
    { row: 60, label: 'Address:', inputStart: 'H', inputEnd: 'K' },
  ];

  for (const field of siteFields) {
    sheet.getCell(`E${field.row}`).value = field.label;
    labelStyle(sheet.getCell(`E${field.row}`));
    sheet.mergeCells(`${field.inputStart}${field.row}:${field.inputEnd}${field.row}`);
    inputCellStyle(sheet.getCell(`${field.inputStart}${field.row}`), BLUE_INPUT);
  }

  // Create second sheet (Packaging_Questionnaire)
  const sheet2 = workbook.addWorksheet('Packaging_Questionnaire');
  sheet2.getCell('A1').value = 'Packaging Questionnaire';
  sheet2.getCell('A1').font = { bold: true, size: 14 };
  sheet2.getCell('A3').value = 'This sheet contains packaging-specific questions.';

  // Save the workbook
  const outputPath = join(__dirname, '..', 'test-questionnaire.xlsx');
  await workbook.xlsx.writeFile(outputPath);

  console.log(`✅ Test questionnaire created: ${outputPath}`);
  console.log('\nInput cells (blue fill) to test:');
  console.log('  - H43: Group name');
  console.log('  - H44: Address');
  console.log('  - H45: ZIP CODE / Town');
  console.log('  - H46: Country');
  console.log('  - H47: Telephone');
  console.log('  - H48: TVA / VAT number');
  console.log('  - H50: Top management contact');
  console.log('  - H51: Sales contact');
  console.log('  - H52: Quality & Food Safety contact');
  console.log('  - H22: Supplier signatory name');
  console.log('  - H23: Supplier function');
  console.log('  - I25/J25/K25: Supplier date (DD/MM/YYYY)');
}

createTestQuestionnaire().catch(console.error);
