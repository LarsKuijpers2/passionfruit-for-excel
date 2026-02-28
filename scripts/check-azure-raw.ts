import 'dotenv/config';
import { writeFileSync } from 'fs';
import { extractPdfWithAzure } from '../src/services/extractors/azure.js';

async function main() {
  console.log('Extracting PDF with Azure DI...');
  const result = await extractPdfWithAzure('./customers/Doehler SVZ/incoming/211216 Self assessment questionnaire Almonte.pdf');

  // Check for selection marks in raw response
  const raw = result.raw as any;

  console.log('\nAvailable fields in raw response:');
  console.log(Object.keys(raw));

  if (raw.pages?.[0]) {
    console.log('\nPage 0 fields:', Object.keys(raw.pages[0]));

    if (raw.pages[0].selectionMarks) {
      console.log('\nSelection marks found:', raw.pages[0].selectionMarks.length);
      console.log('First 5 selection marks:');
      for (const mark of raw.pages[0].selectionMarks.slice(0, 5)) {
        console.log('  State:', mark.state, '| Confidence:', mark.confidence?.toFixed(2), '| Polygon:', mark.polygon?.slice(0, 4).map((n: number) => n.toFixed(2)).join(', '));
      }
    } else {
      console.log('\nNo selectionMarks field in page data');
    }
  }

  // Check table structure
  console.log('\nTables detected:', result.tables.length);
  for (let i = 0; i < Math.min(3, result.tables.length); i++) {
    const table = result.tables[i];
    console.log(`  Table ${i}: ${table.rowCount} rows x ${table.columnCount} columns`);
  }

  // Save raw response for analysis
  writeFileSync('/tmp/azure-raw-response.json', JSON.stringify(raw, null, 2));
  console.log('\nFull raw response saved to /tmp/azure-raw-response.json');
}

main().catch(console.error);
