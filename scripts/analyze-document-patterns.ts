#!/usr/bin/env npx tsx
/**
 * Document Pattern Analyzer
 *
 * Analyzes questionnaire structures to identify:
 * 1. Section patterns (headers, groupings)
 * 2. Content types (tables, forms, free text, checkboxes)
 * 3. Q&A patterns (how questions and answers are structured)
 * 4. Extraction challenges per pattern type
 *
 * Usage:
 *   npx tsx scripts/analyze-document-patterns.ts <customer> [--detailed]
 */

import { readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Content type classifications
type ContentType =
  | 'table_qa'           // Standard Q&A in table format
  | 'table_checklist'    // Checkboxes/checkmarks in table
  | 'table_matrix'       // Matrix with multiple columns of answers
  | 'form_fields'        // Label: Value pairs
  | 'free_text'          // Paragraph/narrative text
  | 'header_only'        // Section header without content
  | 'signature_block'    // Signature/date fields
  | 'unknown';

interface CellAnalysis {
  hasCheckbox: boolean;
  hasYesNo: boolean;
  isNumeric: boolean;
  isDate: boolean;
  isEmail: boolean;
  isPhone: boolean;
  isUrl: boolean;
  isMultiline: boolean;
  isEmpty: boolean;
  wordCount: number;
  hasQuestionMark: boolean;
}

interface RowPattern {
  rowIndex: number;
  columnCount: number;
  labelColumn?: string;
  valueColumn?: string;
  pattern: string;  // e.g., "L|V" (label|value), "Q|Y|N|C" (question|yes|no|comment)
  cellAnalysis: Record<string, CellAnalysis>;
}

interface SectionAnalysis {
  title: string;
  startRow: number;
  endRow: number;
  rowCount: number;
  contentType: ContentType;
  patterns: RowPattern[];
  characteristics: {
    hasCheckboxes: boolean;
    hasYesNoQuestions: boolean;
    hasNumericData: boolean;
    hasDates: boolean;
    hasMultilineText: boolean;
    averageColumnsPerRow: number;
    dominantPattern: string;
  };
  extractionStrategy: string;
  challenges: string[];
}

interface DocumentAnalysis {
  filename: string;
  documentType: string;
  totalRows: number;
  totalSections: number;
  sections: SectionAnalysis[];
  overallPatterns: {
    contentTypes: Record<ContentType, number>;
    commonChallenges: string[];
    suggestedStrategies: string[];
  };
}

// Analyze a single cell
function analyzeCell(value: string | null | undefined): CellAnalysis {
  const v = value || '';

  return {
    hasCheckbox: /[☒☐✓✗✔✘□■◻◼⬜⬛]/.test(v),
    hasYesNo: /\b(yes|no|ja|nein|oui|non|n\/a)\b/i.test(v),
    isNumeric: /^\s*[\d,.]+\s*$/.test(v) && v.length < 20,
    isDate: /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/.test(v) ||
            /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d/i.test(v),
    isEmail: /@[a-z0-9.-]+\.[a-z]{2,}/i.test(v),
    isPhone: /[\+]?[\d\s\-\(\)]{10,}/.test(v) && !/[a-z]{3,}/i.test(v),
    isUrl: /https?:\/\/|www\./i.test(v),
    isMultiline: v.includes('\n') || v.length > 200,
    isEmpty: v.trim() === '',
    wordCount: v.split(/\s+/).filter(w => w.length > 0).length,
    hasQuestionMark: v.includes('?'),
  };
}

// Detect row pattern (e.g., Label|Value, Question|Yes|No|Comment)
function detectRowPattern(cells: Record<string, { value?: string }>): string {
  const cols = Object.keys(cells).sort();
  const patterns: string[] = [];

  for (const col of cols) {
    const v = cells[col]?.value || '';
    const analysis = analyzeCell(v);

    if (analysis.isEmpty) {
      patterns.push('_');
    } else if (analysis.hasCheckbox) {
      patterns.push('☐');
    } else if (analysis.hasYesNo && analysis.wordCount < 5) {
      patterns.push('Y/N');
    } else if (analysis.hasQuestionMark || analysis.wordCount > 5) {
      patterns.push('Q');
    } else if (analysis.wordCount <= 3) {
      patterns.push('V');
    } else {
      patterns.push('T');  // Text
    }
  }

  return patterns.join('|');
}

// Classify content type based on patterns
function classifyContentType(patterns: RowPattern[]): ContentType {
  if (patterns.length === 0) return 'header_only';

  const patternCounts: Record<string, number> = {};
  let checkboxCount = 0;
  let yesNoCount = 0;
  let multiColumnCount = 0;

  for (const p of patterns) {
    patternCounts[p.pattern] = (patternCounts[p.pattern] || 0) + 1;

    if (p.pattern.includes('☐')) checkboxCount++;
    if (p.pattern.includes('Y/N')) yesNoCount++;
    if (p.columnCount > 3) multiColumnCount++;
  }

  // Checklist pattern
  if (checkboxCount > patterns.length * 0.3) {
    return 'table_checklist';
  }

  // Yes/No questions
  if (yesNoCount > patterns.length * 0.3) {
    return 'table_qa';
  }

  // Matrix (many columns)
  if (multiColumnCount > patterns.length * 0.5) {
    return 'table_matrix';
  }

  // Simple form fields (mostly 2 columns)
  const twoColPatterns = patterns.filter(p => p.columnCount === 2);
  if (twoColPatterns.length > patterns.length * 0.7) {
    return 'form_fields';
  }

  // Default to table Q&A
  return 'table_qa';
}

// Suggest extraction strategy
function suggestStrategy(contentType: ContentType, characteristics: SectionAnalysis['characteristics']): string {
  switch (contentType) {
    case 'table_checklist':
      return 'Checkbox detection: Map ☒→Yes, ☐→No. Group with parent question. Look for column headers.';

    case 'table_qa':
      if (characteristics.hasYesNoQuestions) {
        return 'Q&A extraction: Col A = Question, Col B+ = Answers. Handle Yes/No/N/A patterns. Watch for follow-up questions.';
      }
      return 'Q&A extraction: Identify label vs value columns. Handle merged cells.';

    case 'table_matrix':
      return 'Matrix extraction: First row/col are headers. Each cell is a data point. Preserve row/col context.';

    case 'form_fields':
      return 'Form extraction: Simple label:value pairs. Watch for multi-line values and continuation rows.';

    case 'free_text':
      return 'Text extraction: Parse as narrative. Look for implicit Q&A patterns or key-value mentions.';

    case 'signature_block':
      return 'Signature extraction: Capture name, title, date, signature indicator. Usually metadata.';

    default:
      return 'Manual review needed to determine pattern.';
  }
}

// Identify challenges for a section
function identifyChallenges(patterns: RowPattern[], characteristics: SectionAnalysis['characteristics']): string[] {
  const challenges: string[] = [];

  if (characteristics.hasCheckboxes) {
    challenges.push('Checkbox symbols need conversion to Yes/No');
  }

  if (characteristics.hasMultilineText) {
    challenges.push('Multi-line values may span multiple rows');
  }

  // Check for inconsistent patterns
  const uniquePatterns = new Set(patterns.map(p => p.pattern));
  if (uniquePatterns.size > 3) {
    challenges.push('Inconsistent row patterns - may need row-by-row handling');
  }

  // Check for empty label columns
  const emptyLabelRows = patterns.filter(p => {
    const firstCol = Object.values(p.cellAnalysis)[0];
    return firstCol?.isEmpty && !Object.values(p.cellAnalysis).every(c => c.isEmpty);
  });
  if (emptyLabelRows.length > 2) {
    challenges.push('Rows with empty labels - likely sub-items or continuations');
  }

  // Check for "Yes No N/A" in value cells
  const yesNoInValue = patterns.filter(p => {
    return Object.values(p.cellAnalysis).some(c =>
      c.hasYesNo && c.wordCount >= 2 && c.wordCount <= 4
    );
  });
  if (yesNoInValue.length > 0) {
    challenges.push('Answer options appearing in value cells instead of actual answers');
  }

  return challenges;
}

// Analyze a structure file
async function analyzeStructure(filePath: string): Promise<DocumentAnalysis> {
  const content = await readFile(filePath, 'utf-8');
  const structure = JSON.parse(content);

  const filename = structure.source?.filename || filePath.split('/').pop();
  const documentType = structure.source?.documentType || 'unknown';

  const sections: SectionAnalysis[] = [];
  let currentSection: SectionAnalysis | null = null;

  // Process all rows
  const sheet = structure.sheets?.[0];
  if (!sheet?.rows) {
    return {
      filename,
      documentType,
      totalRows: 0,
      totalSections: 0,
      sections: [],
      overallPatterns: {
        contentTypes: {} as Record<ContentType, number>,
        commonChallenges: [],
        suggestedStrategies: [],
      },
    };
  }

  const rows = sheet.rows;
  let sectionStart = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.cells || {};
    const cellKeys = Object.keys(cells);

    // Skip empty rows
    const nonEmptyCells = cellKeys.filter(k => cells[k]?.value?.trim());
    if (nonEmptyCells.length === 0) continue;

    // Check if this is a section header (single cell, possibly bold/larger)
    const firstCell = cells[cellKeys[0]];
    const isLikelyHeader = nonEmptyCells.length === 1 &&
                          firstCell?.value?.length < 100 &&
                          !firstCell?.value?.includes('?') &&
                          (firstCell?.role === 'columnHeader' || /^\d+[\.\)]?\s*[A-Z]/.test(firstCell?.value || ''));

    if (isLikelyHeader && i > sectionStart + 2) {
      // Save previous section
      if (currentSection && currentSection.patterns.length > 0) {
        currentSection.endRow = i - 1;
        currentSection.rowCount = currentSection.endRow - currentSection.startRow + 1;
        currentSection.contentType = classifyContentType(currentSection.patterns);
        currentSection.characteristics = {
          hasCheckboxes: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.hasCheckbox)),
          hasYesNoQuestions: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.hasYesNo)),
          hasNumericData: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isNumeric)),
          hasDates: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isDate)),
          hasMultilineText: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isMultiline)),
          averageColumnsPerRow: currentSection.patterns.reduce((s, p) => s + p.columnCount, 0) / currentSection.patterns.length,
          dominantPattern: findDominantPattern(currentSection.patterns),
        };
        currentSection.extractionStrategy = suggestStrategy(currentSection.contentType, currentSection.characteristics);
        currentSection.challenges = identifyChallenges(currentSection.patterns, currentSection.characteristics);
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        title: firstCell?.value || `Section ${sections.length + 1}`,
        startRow: i,
        endRow: i,
        rowCount: 0,
        contentType: 'unknown',
        patterns: [],
        characteristics: {} as SectionAnalysis['characteristics'],
        extractionStrategy: '',
        challenges: [],
      };
      sectionStart = i;
      continue;
    }

    // Initialize first section if needed
    if (!currentSection) {
      currentSection = {
        title: 'Document Start',
        startRow: 0,
        endRow: 0,
        rowCount: 0,
        contentType: 'unknown',
        patterns: [],
        characteristics: {} as SectionAnalysis['characteristics'],
        extractionStrategy: '',
        challenges: [],
      };
    }

    // Analyze this row
    const cellAnalysis: Record<string, CellAnalysis> = {};
    for (const k of cellKeys) {
      cellAnalysis[k] = analyzeCell(cells[k]?.value);
    }

    currentSection.patterns.push({
      rowIndex: i,
      columnCount: nonEmptyCells.length,
      pattern: detectRowPattern(cells),
      cellAnalysis,
    });
  }

  // Don't forget last section
  if (currentSection && currentSection.patterns.length > 0) {
    currentSection.endRow = rows.length - 1;
    currentSection.rowCount = currentSection.endRow - currentSection.startRow + 1;
    currentSection.contentType = classifyContentType(currentSection.patterns);
    currentSection.characteristics = {
      hasCheckboxes: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.hasCheckbox)),
      hasYesNoQuestions: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.hasYesNo)),
      hasNumericData: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isNumeric)),
      hasDates: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isDate)),
      hasMultilineText: currentSection.patterns.some(p => Object.values(p.cellAnalysis).some(c => c.isMultiline)),
      averageColumnsPerRow: currentSection.patterns.reduce((s, p) => s + p.columnCount, 0) / currentSection.patterns.length,
      dominantPattern: findDominantPattern(currentSection.patterns),
    };
    currentSection.extractionStrategy = suggestStrategy(currentSection.contentType, currentSection.characteristics);
    currentSection.challenges = identifyChallenges(currentSection.patterns, currentSection.characteristics);
    sections.push(currentSection);
  }

  // Aggregate overall patterns
  const contentTypes: Record<ContentType, number> = {} as Record<ContentType, number>;
  const allChallenges: string[] = [];
  const allStrategies: string[] = [];

  for (const section of sections) {
    contentTypes[section.contentType] = (contentTypes[section.contentType] || 0) + 1;
    allChallenges.push(...section.challenges);
    if (section.extractionStrategy) allStrategies.push(section.extractionStrategy);
  }

  // Dedupe challenges and strategies
  const uniqueChallenges = [...new Set(allChallenges)];
  const uniqueStrategies = [...new Set(allStrategies)];

  return {
    filename,
    documentType,
    totalRows: rows.length,
    totalSections: sections.length,
    sections,
    overallPatterns: {
      contentTypes,
      commonChallenges: uniqueChallenges,
      suggestedStrategies: uniqueStrategies,
    },
  };
}

function findDominantPattern(patterns: RowPattern[]): string {
  const counts: Record<string, number> = {};
  for (const p of patterns) {
    counts[p.pattern] = (counts[p.pattern] || 0) + 1;
  }

  let max = 0;
  let dominant = '';
  for (const [pattern, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      dominant = pattern;
    }
  }
  return dominant;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: npx tsx scripts/analyze-document-patterns.ts <customer> [--detailed]');
    process.exit(1);
  }

  const customer = args[0];
  const detailed = args.includes('--detailed');
  const structureDir = join('customers', customer, 'structure');

  if (!existsSync(structureDir)) {
    console.error(`No structure directory found for customer: ${customer}`);
    process.exit(1);
  }

  const files = (await readdir(structureDir)).filter(f => f.endsWith('.json'));
  console.log(`\n📊 Analyzing ${files.length} documents for ${customer}...\n`);

  const allAnalyses: DocumentAnalysis[] = [];
  const aggregateContentTypes: Record<ContentType, number> = {} as Record<ContentType, number>;
  const aggregateChallenges: Record<string, number> = {};

  for (const file of files) {
    const filePath = join(structureDir, file);
    const analysis = await analyzeStructure(filePath);
    allAnalyses.push(analysis);

    // Aggregate
    for (const [type, count] of Object.entries(analysis.overallPatterns.contentTypes)) {
      aggregateContentTypes[type as ContentType] = (aggregateContentTypes[type as ContentType] || 0) + count;
    }
    for (const challenge of analysis.overallPatterns.commonChallenges) {
      aggregateChallenges[challenge] = (aggregateChallenges[challenge] || 0) + 1;
    }

    // Print per-document summary
    console.log(`📄 ${file.substring(0, 50)}...`);
    console.log(`   ${analysis.totalRows} rows, ${analysis.totalSections} sections`);
    console.log(`   Types: ${Object.entries(analysis.overallPatterns.contentTypes).map(([t, c]) => `${t}(${c})`).join(', ')}`);

    if (detailed) {
      for (const section of analysis.sections) {
        console.log(`\n   📁 ${section.title.substring(0, 40)}...`);
        console.log(`      Type: ${section.contentType}`);
        console.log(`      Rows: ${section.startRow}-${section.endRow} (${section.rowCount})`);
        console.log(`      Pattern: ${section.characteristics.dominantPattern}`);
        if (section.challenges.length > 0) {
          console.log(`      ⚠️  Challenges: ${section.challenges.join('; ')}`);
        }
      }
    }
    console.log('');
  }

  // Summary
  console.log('═'.repeat(60));
  console.log('PATTERN ANALYSIS SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Customer: ${customer}`);
  console.log(`Documents: ${files.length}`);
  console.log(`Total sections: ${allAnalyses.reduce((s, a) => s + a.totalSections, 0)}`);
  console.log('');

  console.log('Content Types Found:');
  for (const [type, count] of Object.entries(aggregateContentTypes).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.min(count, 20));
    console.log(`  ${type.padEnd(20)} ${count.toString().padStart(3)} ${bar}`);
  }

  console.log('\nCommon Challenges:');
  for (const [challenge, count] of Object.entries(aggregateChallenges).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}x ${challenge}`);
  }

  // Save detailed report
  const reportPath = join('customers', customer, 'pattern-analysis.json');
  await writeFile(reportPath, JSON.stringify({
    customer,
    analyzedAt: new Date().toISOString(),
    summary: {
      documentCount: files.length,
      totalSections: allAnalyses.reduce((s, a) => s + a.totalSections, 0),
      contentTypes: aggregateContentTypes,
      challenges: aggregateChallenges,
    },
    documents: allAnalyses,
  }, null, 2));

  console.log(`\n📝 Detailed report saved to: ${reportPath}`);

  // Recommendations
  console.log('\n═'.repeat(60));
  console.log('EXTRACTION STRATEGY RECOMMENDATIONS');
  console.log('═'.repeat(60));

  if (aggregateContentTypes['table_qa'] > 0) {
    console.log('\n📋 TABLE Q&A (most common):');
    console.log('   Strategy: Two-column extraction (Question|Answer)');
    console.log('   Train on: 100-200 examples of Q&A pairs');
    console.log('   Test: Validate answer column detection');
  }

  if (aggregateContentTypes['table_checklist'] > 0) {
    console.log('\n☑️  CHECKLISTS:');
    console.log('   Strategy: Checkbox symbol detection + parent question linking');
    console.log('   Train on: 50-100 checkbox patterns');
    console.log('   Test: ☒/☐ → Yes/No conversion');
  }

  if (aggregateContentTypes['form_fields'] > 0) {
    console.log('\n📝 FORM FIELDS:');
    console.log('   Strategy: Label:Value pair extraction');
    console.log('   Train on: 50-100 form field examples');
    console.log('   Test: Multi-line value handling');
  }

  if (aggregateChallenges['Rows with empty labels - likely sub-items or continuations'] > 0) {
    console.log('\n⚠️  PRIORITY FIX: Empty label rows');
    console.log('   These are sub-items that need parent linking');
    console.log('   Strategy: Look at indentation/position to find parent');
  }
}

main().catch(console.error);
