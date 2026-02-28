#!/usr/bin/env npx tsx
/**
 * Extraction Quality Checker
 *
 * Analyzes indexed questionnaires to identify extraction issues,
 * categorize them, and track improvements over time.
 *
 * Usage:
 *   npx tsx scripts/extraction-quality-check.ts <customer> [--fix]
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

// Issue categories with descriptions
const ISSUE_TYPES = {
  CHECKBOX_SYMBOL: {
    id: 'checkbox_symbol',
    name: 'Checkbox symbols not converted',
    description: 'Values contain ☒, ☐, ✓, ✗ instead of Yes/No',
    severity: 'medium',
  },
  EMPTY_LABEL: {
    id: 'empty_label',
    name: 'Empty label with value',
    description: 'Row has a value but no label - likely orphan sub-item',
    severity: 'medium',
  },
  LABEL_IS_ANSWER: {
    id: 'label_is_answer',
    name: 'Label contains answer options',
    description: 'Label text includes "Yes No N/A" or similar answer choices',
    severity: 'low',
  },
  ORPHAN_SUBITEM: {
    id: 'orphan_subitem',
    name: 'Orphan sub-item',
    description: 'Value looks like a sub-option (SOPS, Standards, etc.) without parent',
    severity: 'medium',
  },
  DOC_NUMBER_STANDALONE: {
    id: 'doc_number_standalone',
    name: 'Standalone document number field',
    description: '"Doc No" or similar appears as standalone row',
    severity: 'low',
  },
  TRUNCATED_LABEL: {
    id: 'truncated_label',
    name: 'Truncated label',
    description: 'Label ends with "..." suggesting truncation',
    severity: 'low',
  },
  REPEATED_VALUE: {
    id: 'repeated_value',
    name: 'Value repeated in label',
    description: 'The value text also appears in the label',
    severity: 'low',
  },
  MULTILINE_MERGED: {
    id: 'multiline_merged',
    name: 'Multiline content merged',
    description: 'Multiple lines merged into single value with \\n',
    severity: 'info',
  },
  PLEASE_SPECIFY: {
    id: 'please_specify',
    name: 'Please Specify pattern',
    description: 'Value starts with "Please Specify:" - answer embedded in prompt',
    severity: 'low',
  },
  YES_NO_IN_VALUE: {
    id: 'yes_no_in_value',
    name: 'Yes/No options in value',
    description: 'Value contains "Yes No" as options, not actual answer',
    severity: 'medium',
  },
} as const;

type IssueType = keyof typeof ISSUE_TYPES;

interface Issue {
  type: IssueType;
  itemId: string;
  section: string;
  label: string;
  value: string;
  suggestion?: string;
}

interface IndexedItem {
  id?: string;
  label: string;
  value?: string;
  topic?: string;
  destination?: string;
  lCell?: string;
  vCell?: string;
}

interface IndexedSection {
  title: string;
  items: IndexedItem[];
}

interface IndexedQuestionnaire {
  id: string;
  source: string;
  sections: IndexedSection[];
}

interface QualityReport {
  questionnaire: string;
  analyzedAt: string;
  totalItems: number;
  issueCount: number;
  issues: Issue[];
  issuesByType: Record<string, number>;
}

// Detection functions
function detectCheckboxSymbol(item: IndexedItem): Issue | null {
  const checkboxPattern = /[☒☐✓✗✔✘□■◻◼]/;
  if (item.value && checkboxPattern.test(item.value)) {
    return {
      type: 'CHECKBOX_SYMBOL',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value,
      suggestion: item.value.replace(/[☒✓✔■◼]/g, 'Yes').replace(/[☐✗✘□◻]/g, 'No'),
    };
  }
  return null;
}

function detectEmptyLabel(item: IndexedItem): Issue | null {
  if ((!item.label || item.label.trim() === '') && item.value && item.value.trim() !== '') {
    return {
      type: 'EMPTY_LABEL',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value,
      suggestion: 'Consider merging with parent question or adding label',
    };
  }
  return null;
}

function detectLabelIsAnswer(item: IndexedItem): Issue | null {
  const answerPatterns = [
    /\bYes\s+No\s+N\/A\b/i,
    /\bYes\s+No\b(?!\s+SOP)/i,
    /\b☐\s*Yes\s*☐\s*No\b/i,
  ];
  if (item.label && answerPatterns.some(p => p.test(item.label))) {
    return {
      type: 'LABEL_IS_ANSWER',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value || '',
      suggestion: 'Extract answer options from label, keep only question text',
    };
  }
  return null;
}

function detectOrphanSubitem(item: IndexedItem): Issue | null {
  const subitemPatterns = [
    /^(SOPS?|Standards?|Work Instructions?|Batch Records?|Specifications?|Test Methods?|Logbooks?|Other:?)$/i,
    /^(Raw Materials?|Packaging|Finished Products?|Equipment|Personnel)$/i,
  ];
  if (item.value && subitemPatterns.some(p => p.test(item.value.trim()))) {
    return {
      type: 'ORPHAN_SUBITEM',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value,
      suggestion: 'Link to parent question or mark as checklist item',
    };
  }
  return null;
}

function detectDocNumberStandalone(item: IndexedItem): Issue | null {
  const docNoPatterns = [
    /^Doc\.?\s*No\.?\s*:?$/i,
    /^Document\s*(Number|No\.?)?\s*:?$/i,
    /^Ref\.?\s*(No\.?)?\s*:?$/i,
  ];
  if (item.label && docNoPatterns.some(p => p.test(item.label.trim()))) {
    return {
      type: 'DOC_NUMBER_STANDALONE',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value || '',
      suggestion: 'Merge with parent question as supporting field',
    };
  }
  return null;
}

function detectTruncatedLabel(item: IndexedItem): Issue | null {
  if (item.label && item.label.endsWith('...')) {
    return {
      type: 'TRUNCATED_LABEL',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value || '',
      suggestion: 'Retrieve full label from source document',
    };
  }
  return null;
}

function detectYesNoInValue(item: IndexedItem): Issue | null {
  // Value is exactly "Yes No" or "Yes No N/A" - not an actual answer
  const yesNoPattern = /^(Yes\s+No(\s+N\/A)?|Yes\s*\/\s*No)$/i;
  if (item.value && yesNoPattern.test(item.value.trim())) {
    return {
      type: 'YES_NO_IN_VALUE',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value,
      suggestion: 'This is answer options, not the actual answer. Need to extract real answer.',
    };
  }
  return null;
}

function detectPleaseSpecify(item: IndexedItem): Issue | null {
  if (item.value && item.value.toLowerCase().startsWith('please specify:')) {
    return {
      type: 'PLEASE_SPECIFY',
      itemId: item.id || '',
      section: '',
      label: item.label,
      value: item.value,
      suggestion: 'Extract actual answer after "Please Specify:"',
    };
  }
  return null;
}

// Analyze a single questionnaire
function analyzeQuestionnaire(data: IndexedQuestionnaire): QualityReport {
  const issues: Issue[] = [];
  let totalItems = 0;

  for (const section of data.sections) {
    for (const item of section.items) {
      totalItems++;

      // Run all detectors
      const detectors = [
        detectCheckboxSymbol,
        detectEmptyLabel,
        detectLabelIsAnswer,
        detectOrphanSubitem,
        detectDocNumberStandalone,
        detectTruncatedLabel,
        detectYesNoInValue,
        detectPleaseSpecify,
      ];

      for (const detector of detectors) {
        const issue = detector(item);
        if (issue) {
          issue.section = section.title;
          issues.push(issue);
        }
      }
    }
  }

  // Count issues by type
  const issuesByType: Record<string, number> = {};
  for (const issue of issues) {
    issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
  }

  return {
    questionnaire: data.source,
    analyzedAt: new Date().toISOString(),
    totalItems,
    issueCount: issues.length,
    issues,
    issuesByType,
  };
}

// Main
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: npx tsx scripts/extraction-quality-check.ts <customer> [--fix] [--verbose]');
    console.log('\nAnalyzes indexed questionnaires for extraction quality issues.');
    process.exit(1);
  }

  const customer = args[0];
  const verbose = args.includes('--verbose') || args.includes('-v');
  const indexedDir = join('customers', customer, 'indexed');

  if (!existsSync(indexedDir)) {
    console.error(`No indexed directory found for customer: ${customer}`);
    process.exit(1);
  }

  const files = (await readdir(indexedDir)).filter(f => f.endsWith('.json'));
  console.log(`\n📊 Analyzing ${files.length} questionnaires for ${customer}...\n`);

  const allReports: QualityReport[] = [];
  const aggregateIssues: Record<string, number> = {};

  for (const file of files) {
    const filePath = join(indexedDir, file);
    const data: IndexedQuestionnaire = JSON.parse(await readFile(filePath, 'utf-8'));
    const report = analyzeQuestionnaire(data);
    allReports.push(report);

    // Aggregate
    for (const [type, count] of Object.entries(report.issuesByType)) {
      aggregateIssues[type] = (aggregateIssues[type] || 0) + count;
    }

    if (report.issueCount > 0) {
      console.log(`📄 ${basename(file).substring(0, 50)}...`);
      console.log(`   ${report.totalItems} items, ${report.issueCount} issues`);

      if (verbose) {
        for (const issue of report.issues.slice(0, 5)) {
          const info = ISSUE_TYPES[issue.type];
          console.log(`   • [${info.name}] "${issue.label.substring(0, 40)}..."`);
          console.log(`     Value: "${(issue.value || '').substring(0, 50)}..."`);
        }
        if (report.issues.length > 5) {
          console.log(`   ... and ${report.issues.length - 5} more issues`);
        }
      }
      console.log('');
    }
  }

  // Summary
  console.log('═'.repeat(60));
  console.log('QUALITY REPORT SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Customer: ${customer}`);
  console.log(`Questionnaires analyzed: ${files.length}`);
  console.log(`Total items: ${allReports.reduce((s, r) => s + r.totalItems, 0)}`);
  console.log(`Total issues: ${allReports.reduce((s, r) => s + r.issueCount, 0)}`);
  console.log('');
  console.log('Issues by type:');

  const sortedIssues = Object.entries(aggregateIssues)
    .sort((a, b) => b[1] - a[1]);

  for (const [type, count] of sortedIssues) {
    const info = ISSUE_TYPES[type as IssueType];
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`  ${info.name.padEnd(35)} ${count.toString().padStart(4)} ${bar}`);
  }

  // Save report
  const reportPath = join('customers', customer, 'quality-report.json');
  await writeFile(reportPath, JSON.stringify({
    customer,
    analyzedAt: new Date().toISOString(),
    totalQuestionnaires: files.length,
    aggregateIssues,
    reports: allReports,
  }, null, 2));

  console.log('');
  console.log(`📝 Full report saved to: ${reportPath}`);

  // Recommendations
  console.log('');
  console.log('═'.repeat(60));
  console.log('RECOMMENDED FIXES (in priority order):');
  console.log('═'.repeat(60));

  const priorities = [
    { type: 'YES_NO_IN_VALUE', fix: 'Detect answer options vs actual answers during indexing' },
    { type: 'CHECKBOX_SYMBOL', fix: 'Convert checkbox symbols to Yes/No during display' },
    { type: 'EMPTY_LABEL', fix: 'Merge empty-label rows with parent question' },
    { type: 'ORPHAN_SUBITEM', fix: 'Group sub-items under parent questions' },
    { type: 'LABEL_IS_ANSWER', fix: 'Strip answer options from label text' },
    { type: 'DOC_NUMBER_STANDALONE', fix: 'Merge Doc No fields with parent' },
  ];

  for (const { type, fix } of priorities) {
    if (aggregateIssues[type]) {
      const info = ISSUE_TYPES[type as IssueType];
      console.log(`\n${aggregateIssues[type]}x ${info.name}`);
      console.log(`   → ${fix}`);
    }
  }
}

main().catch(console.error);
