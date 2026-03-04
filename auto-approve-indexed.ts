/**
 * Auto-approve indexed items to approved format
 * Skips manual review since items were already reviewed before
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

interface IndexedItem {
  id: string;
  type: string;
  label: string;
  value: string;
  topic: string;
  level: string;
  lang?: string;
  destination: string;
  lCell: string;
  vCell?: string;
}

interface IndexedSection {
  name: string;
  topic: string;
  items: IndexedItem[];
}

interface IndexedFile {
  id: string;
  source: string;
  sections: IndexedSection[];
}

interface ApprovedItem {
  label: string;
  value: string;
  cells: string;
  section: string;
  topic: string;
  destination: string;
  source: string;
  approvedAt: string;
}

interface ApprovedFile {
  meta: {
    source: string;
    exportedAt: string;
    version: string;
  };
  items: ApprovedItem[];
}

function main() {
  const customer = process.argv[2] || 'kaas-pack';
  const indexedDir = join('./customers', customer, 'indexed');
  const approvedDir = join('./customers', customer, 'approved');

  if (!existsSync(indexedDir)) {
    console.error(`Indexed directory not found: ${indexedDir}`);
    process.exit(1);
  }

  const files = readdirSync(indexedDir).filter(f => f.endsWith('.json'));
  console.log(`Auto-approving ${files.length} questionnaires for: ${customer}\n`);

  const timestamp = new Date().toISOString();
  let totalItems = 0;

  for (const file of files) {
    const indexed: IndexedFile = JSON.parse(readFileSync(join(indexedDir, file), 'utf-8'));
    const sourceName = indexed.source || file.replace(/\.json$/, '');

    const answerLibrary: ApprovedItem[] = [];
    const entityDb: ApprovedItem[] = [];
    const productDb: ApprovedItem[] = [];

    for (const section of indexed.sections) {
      for (const item of section.items) {
        // Skip items with empty values
        if (!item.value || item.value.trim() === '' || item.value === '(empty)') {
          continue;
        }

        // Skip excluded items
        if (item.destination === 'exclude') {
          continue;
        }

        const approved: ApprovedItem = {
          label: item.label,
          value: item.value,
          cells: item.vCell ? `${item.lCell} → ${item.vCell}` : item.lCell,
          section: section.name || 'General',
          topic: item.topic || section.topic || 'other',
          destination: item.destination || 'answer_library',
          source: sourceName,
          approvedAt: timestamp,
        };

        if (item.destination === 'company' || item.destination === 'entity') {
          entityDb.push(approved);
        } else if (item.destination === 'product') {
          productDb.push(approved);
        } else {
          answerLibrary.push(approved);
        }
      }
    }

    // Create output directory
    const safeName = sourceName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const outputDir = join(approvedDir, safeName);
    mkdirSync(outputDir, { recursive: true });

    // Save answer-library.json
    const answerLibraryExport: ApprovedFile = {
      meta: {
        source: sourceName,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: answerLibrary,
    };
    writeFileSync(join(outputDir, 'answer-library.json'), JSON.stringify(answerLibraryExport, null, 2));

    // Save entity-db.json
    const entityDbExport: ApprovedFile = {
      meta: {
        source: sourceName,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: entityDb,
    };
    writeFileSync(join(outputDir, 'entity-db.json'), JSON.stringify(entityDbExport, null, 2));

    // Save product-db.json
    const productDbExport: ApprovedFile = {
      meta: {
        source: sourceName,
        exportedAt: timestamp,
        version: '1.0'
      },
      items: productDb,
    };
    writeFileSync(join(outputDir, 'product-db.json'), JSON.stringify(productDbExport, null, 2));

    const total = answerLibrary.length + entityDb.length + productDb.length;
    totalItems += total;
    console.log(`  ${safeName}:`);
    console.log(`    Answer Library: ${answerLibrary.length}`);
    console.log(`    Entity DB: ${entityDb.length}`);
    console.log(`    Product DB: ${productDb.length}`);
  }

  console.log(`\n✅ Auto-approved ${totalItems} items to: ${approvedDir}`);
}

main();
