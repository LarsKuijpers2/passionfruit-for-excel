/**
 * Group Related Items
 *
 * Finds parent-child relationships in aggregated data:
 * - Yes/No questions with "Which...", "Specify...", "Comment..." follow-ups
 * - Bilingual questions (German/English) with comment fields
 * - Merges related items into single entries with notes
 */

import * as fs from 'fs';
import type { AggregatedCustomerData, AggregatedItem } from './aggregate-customer-data.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GroupedItem extends AggregatedItem {
  /** Full label with section context */
  fullLabel: string;
  /** Related follow-up items merged into this one */
  followUps?: {
    label: string;
    value: string;
    relationship: 'comment' | 'specify' | 'conditional' | 'details';
  }[];
  /** Combined answer with context */
  combinedAnswer?: string;
  /** Whether this item was absorbed into another */
  absorbed?: boolean;
}

export interface GroupedCustomerData extends AggregatedCustomerData {
  answerLibrary: {
    total: number;
    unique: number;
    duplicates: number;
    grouped: number;
    items: GroupedItem[];
  };
}

// =============================================================================
// RELATIONSHIP DETECTION
// =============================================================================

/** Patterns that indicate a follow-up question */
const FOLLOW_UP_PATTERNS = [
  { pattern: /^(comment|bemerkung|précis)/i, type: 'comment' as const },
  { pattern: /\(comment[s]?\)/i, type: 'comment' as const },
  { pattern: /^which\s/i, type: 'specify' as const },
  { pattern: /^welche\s/i, type: 'specify' as const },
  { pattern: /^specify/i, type: 'specify' as const },
  { pattern: /^details/i, type: 'details' as const },
  { pattern: /^if (no|yes|not)/i, type: 'conditional' as const },
  { pattern: /^wenn (nein|ja)/i, type: 'conditional' as const },
  { pattern: /for wann planen/i, type: 'conditional' as const },
  { pattern: /when do you plan/i, type: 'conditional' as const },
];

/** Check if an item is a follow-up type question */
function getFollowUpType(label: string): 'comment' | 'specify' | 'conditional' | 'details' | null {
  for (const { pattern, type } of FOLLOW_UP_PATTERNS) {
    if (pattern.test(label)) {
      return type;
    }
  }
  return null;
}

/** Check if an item has a yes/no/N/A value (potential parent) */
function isYesNoAnswer(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return ['yes', 'no', 'n/a', 'ja', 'nein', 'oui', 'non', 'ja-yes', 'nein-no'].includes(normalized);
}

/** Extract base topic from a label (for matching) */
function extractBaseTopic(label: string): string {
  // Remove common suffixes like "(comments)", "/ Comment on...", etc.
  return label
    .replace(/\s*\(comment[s]?\)/gi, '')
    .replace(/\s*\/\s*(comment on|bemerkung zu).*/gi, '')
    .replace(/\s*-\s*(comment|bemerkung).*/gi, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

/** Check if two labels are related (parent-child) */
function areLabelsRelated(parentLabel: string, childLabel: string): boolean {
  const parentBase = extractBaseTopic(parentLabel);
  const childBase = extractBaseTopic(childLabel);

  // Direct topic match
  if (parentBase.includes(childBase) || childBase.includes(parentBase)) {
    return true;
  }

  // Check for keyword overlap (at least 2 significant words)
  const parentWords = parentBase.split(/\s+/).filter(w => w.length > 3);
  const childWords = childBase.split(/\s+/).filter(w => w.length > 3);
  const overlap = parentWords.filter(w => childWords.includes(w));

  return overlap.length >= 2;
}

// =============================================================================
// GROUPING LOGIC
// =============================================================================

/**
 * Group related items together
 */
export function groupRelatedItems(data: AggregatedCustomerData): GroupedCustomerData {
  const items = data.answerLibrary.items.map(item => ({ ...item } as GroupedItem));

  // Index items by section+source for efficient lookup
  const bySectionSource = new Map<string, GroupedItem[]>();
  for (const item of items) {
    const key = `${item.section}|${item.sources[0]}`;
    if (!bySectionSource.has(key)) {
      bySectionSource.set(key, []);
    }
    bySectionSource.get(key)!.push(item);
  }

  // Find parent-child relationships
  let groupedCount = 0;

  for (const [key, group] of bySectionSource) {
    // Sort by cell reference to maintain order
    group.sort((a, b) => {
      const aCell = Object.values(a.cellRefs)[0] || '';
      const bCell = Object.values(b.cellRefs)[0] || '';
      return aCell.localeCompare(bCell);
    });

    for (let i = 0; i < group.length; i++) {
      const item = group[i];
      if (item.absorbed) continue;

      const followUpType = getFollowUpType(item.label);

      // If this is a follow-up item, try to find its parent
      if (followUpType && item.value !== 'N/A' && item.value.length > 3) {
        // Look backwards for a parent (yes/no question)
        for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
          const potentialParent = group[j];
          if (potentialParent.absorbed) continue;

          if (isYesNoAnswer(potentialParent.value) &&
              (areLabelsRelated(potentialParent.label, item.label) ||
               potentialParent.topic === item.topic)) {
            // Found parent - merge this item into it
            if (!potentialParent.followUps) {
              potentialParent.followUps = [];
            }

            potentialParent.followUps.push({
              label: item.label,
              value: item.value,
              relationship: followUpType,
            });

            // Build combined answer
            const parentValue = potentialParent.value.toLowerCase();
            if (parentValue === 'no' || parentValue === 'nein' || parentValue === 'nein-no') {
              potentialParent.combinedAnswer = `No. ${item.value}`;
            } else if (parentValue === 'yes' || parentValue === 'ja' || parentValue === 'ja-yes') {
              potentialParent.combinedAnswer = `Yes. ${item.value}`;
            } else {
              potentialParent.combinedAnswer = `${potentialParent.value}. ${item.value}`;
            }

            item.absorbed = true;
            groupedCount++;
            break;
          }
        }
      }
    }
  }

  // Filter out absorbed items
  const filteredItems = items.filter(item => !item.absorbed);

  return {
    ...data,
    answerLibrary: {
      ...data.answerLibrary,
      grouped: groupedCount,
      items: filteredItems,
    },
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const customerFolder = args[0] || 'kaas-pack';
  // Use customers/<customer>/api-ready/ folder
  const apiReadyDir = `./customers/${customerFolder}/api-ready`;
  const inputPath = `${apiReadyDir}/${customerFolder}-aggregated.json`;
  const outputPath = `${apiReadyDir}/${customerFolder}-grouped.json`;

  if (!fs.existsSync(inputPath)) {
    console.error(`Aggregated data not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\nGrouping related items for: ${customerFolder}\n`);

  const data: AggregatedCustomerData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const grouped = groupRelatedItems(data);

  fs.writeFileSync(outputPath, JSON.stringify(grouped, null, 2));

  console.log('=== GROUPING SUMMARY ===\n');
  console.log(`Original items: ${data.answerLibrary.unique}`);
  console.log(`Items grouped: ${grouped.answerLibrary.grouped}`);
  console.log(`Final items: ${grouped.answerLibrary.items.length}`);

  // Show some examples of grouped items
  const withFollowUps = grouped.answerLibrary.items.filter(i => i.followUps && i.followUps.length > 0);

  console.log(`\nItems with follow-ups merged: ${withFollowUps.length}`);
  console.log('\n=== EXAMPLES OF MERGED ITEMS ===\n');

  for (const item of withFollowUps.slice(0, 10)) {
    console.log(`Q: ${item.label.substring(0, 70)}...`);
    console.log(`Original: ${item.value}`);
    console.log(`Combined: ${item.combinedAnswer?.substring(0, 80)}...`);
    console.log(`Follow-ups merged: ${item.followUps!.length}`);
    for (const fu of item.followUps!) {
      console.log(`  - [${fu.relationship}] ${fu.label.substring(0, 50)}...`);
    }
    console.log();
  }

  console.log(`\n✅ Output: ${outputPath}`);
}

// Only run main when executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
