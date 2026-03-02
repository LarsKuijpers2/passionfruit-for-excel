import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { getValidAccessToken } from '../src/config/token-manager';
import { getApiBaseUrl } from '../src/config/environments';

const duplicates = JSON.parse(readFileSync('customers/numidia/duplicate-candidates.json', 'utf-8'));

// Topics to skip (not real duplicates, just different yes/no questions)
const skipTopics = new Set(['other']);

// For each topic group, pick the best question and mark others for deletion
interface ConsolidationPlan {
  topic: string;
  keep: { id: number; question: string };
  delete: { id: number; question: string }[];
}

const plan: ConsolidationPlan[] = [];

for (const group of duplicates) {
  if (skipTopics.has(group.topic)) continue;
  if (group.items.length < 2) continue;

  // Sort by question length (prefer shorter, clearer questions)
  // But also prefer questions without parentheticals
  const sorted = [...group.items].sort((a, b) => {
    const aHasParens = a.question.includes('(');
    const bHasParens = b.question.includes('(');
    if (aHasParens !== bHasParens) return aHasParens ? 1 : -1;
    return a.question.length - b.question.length;
  });

  const keep = sorted[0];
  const toDelete = sorted.slice(1);

  plan.push({
    topic: group.topic,
    keep: { id: keep.id, question: keep.question },
    delete: toDelete.map((d: any) => ({ id: d.id, question: d.question }))
  });
}

// Show the plan
console.log('=== CONSOLIDATION PLAN ===\n');
let totalToDelete = 0;

for (const item of plan) {
  console.log(`\n📦 ${item.topic.toUpperCase()}`);
  console.log(`   KEEP: [${item.keep.id}] ${item.keep.question}`);
  console.log(`   DELETE (${item.delete.length}):`);
  item.delete.forEach(d => {
    console.log(`      - [${d.id}] ${d.question}`);
  });
  totalToDelete += item.delete.length;
}

console.log(`\n\n=== SUMMARY ===`);
console.log(`Topics to consolidate: ${plan.length}`);
console.log(`Items to delete: ${totalToDelete}`);
console.log(`Items to keep: ${plan.length}`);

// Save plan
writeFileSync('customers/numidia/consolidation-plan.json', JSON.stringify(plan, null, 2));
console.log(`\nSaved plan to customers/numidia/consolidation-plan.json`);

// Ask to proceed
const idsToDelete = plan.flatMap(p => p.delete.map(d => d.id));
writeFileSync('customers/numidia/ids-to-delete.json', JSON.stringify(idsToDelete, null, 2));
console.log(`IDs to delete saved to customers/numidia/ids-to-delete.json`);
console.log(`\nRun 'npx tsx scripts/delete-duplicates.ts' to execute deletions.`);
