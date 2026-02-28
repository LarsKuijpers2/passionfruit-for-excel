/**
 * Debug script to see raw Azure DI response
 */

import 'dotenv/config';
import { extractPdfWithAzure } from '../src/services/extractors/azure.js';

async function main() {
  const filepath = process.argv[2] || './customers/Doehler SVZ/incoming/211216 Self assessment questionnaire Almonte.pdf';

  console.log(`Extracting: ${filepath}\n`);

  const result = await extractPdfWithAzure(filepath);

  // Search for "boundaries" or "fenced" in all content
  console.log('\n=== SEARCHING FOR "boundaries" ===');

  // Check markdown
  const boundariesInMarkdown = result.markdown.includes('boundaries');
  console.log(`In markdown: ${boundariesInMarkdown}`);

  // Check tables
  for (let t = 0; t < result.tables.length; t++) {
    const table = result.tables[t];
    for (const cell of table.cells) {
      if (cell.content.toLowerCase().includes('boundaries')) {
        console.log(`\nTable ${t}, Row ${cell.rowIndex}, Col ${cell.columnIndex}:`);
        console.log(`  Content: "${cell.content}"`);
        console.log(`  Spans: col=${cell.columnSpan || 1}, row=${cell.rowSpan || 1}`);

        // Print all cells in the same row
        console.log('\n  All cells in this row:');
        const rowCells = table.cells.filter(c => c.rowIndex === cell.rowIndex);
        for (const rc of rowCells.sort((a, b) => a.columnIndex - b.columnIndex)) {
          console.log(`    Col ${rc.columnIndex}: "${rc.content.slice(0, 80)}${rc.content.length > 80 ? '...' : ''}" (span: ${rc.columnSpan || 1})`);
        }
      }
    }
  }

  // Search for "fenced" specifically
  console.log('\n\n=== SEARCHING FOR "fenced" ===');
  const fencedInMarkdown = result.markdown.includes('fenced');
  console.log(`In markdown: ${fencedInMarkdown}`);

  for (let t = 0; t < result.tables.length; t++) {
    const table = result.tables[t];
    for (const cell of table.cells) {
      if (cell.content.toLowerCase().includes('fenced')) {
        console.log(`\nFound in Table ${t}, Row ${cell.rowIndex}, Col ${cell.columnIndex}: "${cell.content}"`);
      }
    }
  }

  // If not found in tables, check if it's in markdown
  if (fencedInMarkdown) {
    const lines = result.markdown.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('fenced')) {
        console.log(`\nFound in markdown line ${i + 1}: "${lines[i].slice(0, 150)}"`);
      }
    }
  }

  // Log table structure summary
  console.log('\n\n=== TABLE SUMMARY ===');
  for (let t = 0; t < result.tables.length; t++) {
    const table = result.tables[t];
    console.log(`\nTable ${t}: ${table.rowCount} rows x ${table.columnCount} cols, page ${table.pageNumber}`);
    // Show first row (header)
    const headerCells = table.cells.filter(c => c.rowIndex === 0).sort((a, b) => a.columnIndex - b.columnIndex);
    console.log(`  Headers: ${headerCells.map(c => `"${c.content.slice(0, 20)}${c.content.length > 20 ? '...' : ''}"`).join(' | ')}`);
  }

  // Check raw result for paragraphs or other content
  console.log('\n\n=== RAW RESULT STRUCTURE ===');
  const raw = result.raw as any;
  console.log('Available keys:', Object.keys(raw));

  if (raw.paragraphs) {
    console.log(`\nParagraphs: ${raw.paragraphs.length}`);
    // Search for "fenced" in paragraphs
    for (const p of raw.paragraphs) {
      if (p.content?.toLowerCase().includes('fenced')) {
        console.log(`  Found "fenced" in paragraph: "${p.content}"`);
      }
    }
  }

  if (raw.keyValuePairs) {
    console.log(`\nKey-Value Pairs: ${raw.keyValuePairs.length}`);
  }

  // Search full raw content for "fenced"
  const rawStr = JSON.stringify(raw);
  if (rawStr.toLowerCase().includes('fenced')) {
    console.log('\n"fenced" FOUND somewhere in raw response!');
    // Extract surrounding context
    const idx = rawStr.toLowerCase().indexOf('fenced');
    console.log(`Context: ...${rawStr.substring(idx - 50, idx + 100)}...`);
  } else {
    console.log('\n"fenced" NOT FOUND anywhere in raw response');
  }
}

main().catch(console.error);
