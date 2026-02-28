/**
 * Find duplicate answers in the indexed Version 7 questionnaire
 * Exports results to Excel-compatible TSV
 */

import { readFile, writeFile } from 'fs/promises';

interface Item {
  id: string;
  label: string;
  value: string;
  note?: string;
  section: string;
}

interface DuplicateGroup {
  items: Item[];
  similarity: number;
}

// Simple similarity score based on common words
function calculateSimilarity(q1: string, q2: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const words1 = new Set(normalize(q1));
  const words2 = new Set(normalize(q2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;
}

// Check if questions are semantically similar
function areSimilar(q1: string, q2: string, threshold = 0.5): boolean {
  if (q1.toLowerCase().trim() === q2.toLowerCase().trim()) return true;
  return calculateSimilarity(q1, q2) >= threshold;
}

async function analyzeDuplicates() {
  // Load indexed questionnaire
  const indexedPath = './customers/Doehler Oosterhout/indexed/Version_7_Standard_Questionnaire_for_Customers_Oosterhout__1_.json';
  const data = JSON.parse(await readFile(indexedPath, 'utf-8'));

  console.log('\nAnalyzing duplicates in Version 7 questionnaire...\n');

  // Collect all Q&A items
  const items: Item[] = [];
  for (const section of data.sections) {
    for (const item of section.items) {
      if (item.label && item.value) {
        items.push({
          id: item.id,
          label: item.label,
          value: item.value,
          note: item.note,
          section: section.title,
        });
      }
    }
  }

  console.log(`Total items: ${items.length}\n`);

  // Find potential duplicates
  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    if (processed.has(items[i].id)) continue;

    const group: Item[] = [items[i]];
    processed.add(items[i].id);

    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(items[j].id)) continue;

      if (areSimilar(items[i].label, items[j].label)) {
        group.push(items[j]);
        processed.add(items[j].id);
      }
    }

    if (group.length > 1) {
      duplicateGroups.push({
        items: group,
        similarity: calculateSimilarity(group[0].label, group[1].label),
      });
    }
  }

  console.log(`Found ${duplicateGroups.length} groups of potential duplicates\n`);

  // Sort by number of duplicates (descending)
  duplicateGroups.sort((a, b) => b.items.length - a.items.length);

  // Show summary
  for (const group of duplicateGroups.slice(0, 10)) {
    console.log(`Group (${group.items.length} items, similarity: ${(group.similarity * 100).toFixed(0)}%):`);
    for (const item of group.items) {
      console.log(`  [${item.section}] ${item.label.slice(0, 60)}...`);
      console.log(`       → ${item.value.slice(0, 50)}...`);
    }
    console.log('');
  }

  if (duplicateGroups.length > 10) {
    console.log(`... and ${duplicateGroups.length - 10} more groups\n`);
  }

  // Export to TSV for Excel
  const tsvRows: string[] = [];
  tsvRows.push(['Group', 'Section', 'Question', 'Answer', 'Similarity', 'Action'].join('\t'));

  let groupNum = 1;
  for (const group of duplicateGroups) {
    for (const item of group.items) {
      tsvRows.push([
        groupNum.toString(),
        item.section,
        item.label.replace(/\t/g, ' ').replace(/\n/g, ' '),
        item.value.replace(/\t/g, ' ').replace(/\n/g, ' '),
        (group.similarity * 100).toFixed(0) + '%',
        '', // Action column for user to fill
      ].join('\t'));
    }
    groupNum++;
  }

  // Add unique items
  const duplicateIds = new Set(duplicateGroups.flatMap(g => g.items.map(i => i.id)));
  const unique = items.filter(i => !duplicateIds.has(i.id));

  for (const item of unique) {
    tsvRows.push([
      'unique',
      item.section,
      item.label.replace(/\t/g, ' ').replace(/\n/g, ' '),
      item.value.replace(/\t/g, ' ').replace(/\n/g, ' '),
      '-',
      '',
    ].join('\t'));
  }

  const tsvPath = './customers/Doehler Oosterhout/duplicate-analysis.tsv';
  await writeFile(tsvPath, tsvRows.join('\n'));
  console.log(`\nExported to: ${tsvPath}`);
  console.log('(Tab-separated file - open in Excel)\n');

  // Summary stats
  console.log('Summary:');
  console.log(`  Total answers: ${items.length}`);
  console.log(`  Duplicate groups: ${duplicateGroups.length}`);
  console.log(`  Answers in duplicate groups: ${duplicateGroups.reduce((sum, g) => sum + g.items.length, 0)}`);
  console.log(`  Unique answers: ${unique.length}`);
}

analyzeDuplicates().catch(console.error);
