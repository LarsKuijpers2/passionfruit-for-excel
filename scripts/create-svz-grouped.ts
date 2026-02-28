import * as fs from 'fs';
import * as path from 'path';

const customer = 'Doehler SVZ';
const approvedDir = './customers/Doehler SVZ/approved';

interface LibraryItem {
  id: string;
  label: string;
  value: string;
  topic?: string;
  section?: string;
}

interface ApprovedFile {
  meta?: { source?: string };
  library?: LibraryItem[];
  product?: LibraryItem[];
  company?: LibraryItem[];
}

const allItems: Array<LibraryItem & { source: string; sources: string[] }> = [];
const productItems: Array<LibraryItem & { source: string }> = [];
const companyItems: Array<LibraryItem & { source: string }> = [];
const questionnaires: string[] = [];

const files = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
for (const file of files) {
  const data: ApprovedFile = JSON.parse(fs.readFileSync(path.join(approvedDir, file), 'utf-8'));
  const source = data.meta?.source || file.replace('.json', '');
  questionnaires.push(file.replace('.json', ''));

  if (data.library) {
    for (const item of data.library) {
      allItems.push({ ...item, source, sources: [source] });
    }
  }
  if (data.product) {
    for (const item of data.product) {
      productItems.push({ ...item, source });
    }
  }
  if (data.company) {
    for (const item of data.company) {
      companyItems.push({ ...item, source });
    }
  }
}

// Deduplicate by normalized label
const seen = new Map<string, any>();
for (const item of allItems) {
  const key = (item.label || '').toLowerCase().trim();
  if (!seen.has(key)) {
    seen.set(key, { ...item, fullLabel: item.label });
  } else {
    const existing = seen.get(key);
    if (!existing.sources.includes(item.source)) {
      existing.sources.push(item.source);
    }
  }
}

const grouped = {
  customer,
  aggregatedAt: new Date().toISOString(),
  questionnaires,
  answerLibrary: {
    total: allItems.length,
    unique: seen.size,
    duplicates: allItems.length - seen.size,
    items: Array.from(seen.values())
  },
  entityData: {
    total: companyItems.length,
    unique: companyItems.length,
    duplicates: 0,
    items: companyItems
  },
  stats: {
    bySource: {} as Record<string, number>
  }
};

// Count by source
for (const item of allItems) {
  grouped.stats.bySource[item.source] = (grouped.stats.bySource[item.source] || 0) + 1;
}

const outputPath = './api-ready/Doehler SVZ-grouped.json';
fs.writeFileSync(outputPath, JSON.stringify(grouped, null, 2));
console.log('Created:', outputPath);
console.log('Questionnaires:', questionnaires.length);
console.log('Library items:', grouped.answerLibrary.unique, 'unique of', grouped.answerLibrary.total);
console.log('Product items:', productItems.length);
console.log('Company items:', companyItems.length);
