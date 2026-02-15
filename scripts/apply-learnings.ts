#!/usr/bin/env npx tsx
/**
 * Apply Learning Improvements
 *
 * Checks which suggested improvements are already in the visual analyzer
 * and marks them as applied in the learning database.
 *
 * Usage:
 *   npx tsx scripts/apply-learnings.ts
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

interface PromptImprovement {
  id: string;
  category: string;
  currentBehavior: string;
  suggestedBehavior: string;
  promptAddition: string;
  status: 'suggested' | 'applied' | 'rejected';
  appliedAt?: string;
}

interface LearningDatabase {
  version: string;
  lastUpdated: string;
  issues: any[];
  patterns: any[];
  promptImprovements: PromptImprovement[];
}

// Key phrases to search for in visual-analyzer.ts to detect applied improvements
const IMPROVEMENT_MARKERS: Record<string, string[]> = {
  strikethrough: ['STRIKETHROUGH', 'strikethrough', 'struck through'],
  questionnaire_specific: ['QUESTIONNAIRE METADATA', 'metadata', 'Document headers'],
  poor_extraction: ['VALUE EXTRACTION', 'value cell', 'paired with'],
  table_structure: ['COMPLEX TABLES', 'table', 'multi-column'],
  merged_cells: ['MERGED CELLS', 'merge range'],
  language_detection: ['LANGUAGE DETECTION', 'Ja/Nee', 'Oui/Non'],
  value_format: ['VALUE FORMATS', 'ISO format', 'Yes/No'],
};

async function main() {
  const dbPath = './knowledge/extraction-learning.json';
  const analyzerPath = './src/services/analysis/visual-analyzer.ts';

  if (!existsSync(dbPath)) {
    console.error('Learning database not found. Run "pnpm cli learn" first.');
    process.exit(1);
  }

  if (!existsSync(analyzerPath)) {
    console.error('Visual analyzer not found.');
    process.exit(1);
  }

  // Load files
  const db: LearningDatabase = JSON.parse(await readFile(dbPath, 'utf-8'));
  const analyzerCode = await readFile(analyzerPath, 'utf-8');

  console.log('\n🔍 Checking applied improvements...\n');

  let appliedCount = 0;
  let suggestedCount = 0;

  for (const improvement of db.promptImprovements) {
    const markers = IMPROVEMENT_MARKERS[improvement.category] || [];
    const isApplied = markers.some(marker =>
      analyzerCode.includes(marker)
    );

    if (isApplied && improvement.status === 'suggested') {
      improvement.status = 'applied';
      improvement.appliedAt = new Date().toISOString();
      appliedCount++;
      console.log(`✅ ${improvement.category}: Already applied in visual-analyzer.ts`);
    } else if (improvement.status === 'suggested') {
      suggestedCount++;
      console.log(`⏳ ${improvement.category}: Still pending`);
      console.log(`   Add this to visual-analyzer.ts prompt:\n`);
      console.log(`   ${improvement.promptAddition.split('\n').join('\n   ')}\n`);
    } else if (improvement.status === 'applied') {
      console.log(`✅ ${improvement.category}: Previously applied`);
    }
  }

  // Save updated database
  db.lastUpdated = new Date().toISOString();
  await writeFile(dbPath, JSON.stringify(db, null, 2));

  console.log('\n' + '═'.repeat(50));
  console.log(`Applied: ${appliedCount} improvements`);
  console.log(`Pending: ${suggestedCount} improvements`);
  console.log('═'.repeat(50) + '\n');

  if (suggestedCount > 0) {
    console.log('💡 To apply pending improvements, add the prompt additions shown above');
    console.log('   to the visual analyzer prompt in src/services/analysis/visual-analyzer.ts\n');
  }
}

main().catch(console.error);
