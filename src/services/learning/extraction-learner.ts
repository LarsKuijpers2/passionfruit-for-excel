/**
 * Extraction Learner - Self-Learning System for Extraction Quality
 *
 * Collects feedback from reviewed questionnaires, categorizes issues,
 * and generates improvement rules for the visual analyzer.
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

// =============================================================================
// TYPES
// =============================================================================

/** Categories of extraction issues */
export type IssueCategory =
  | 'strikethrough'      // Strikethrough formatting not detected
  | 'poor_extraction'    // Value/label mismatch or missing data
  | 'poor_tagging'       // Wrong topic/destination/level
  | 'questionnaire_specific' // Content that shouldn't be in library
  | 'table_structure'    // Complex table not properly parsed
  | 'merged_cells'       // Merged cell handling issues
  | 'language_detection' // Wrong language detected
  | 'value_format'       // Date/number formatting issues
  | 'checkbox'           // Checkbox/X marks not detected
  | 'handwriting'        // Handwritten text not captured
  | 'faint_text'         // Faint/grey/low contrast text missed
  | 'comments'           // Comments column text missed
  | 'scanned_quality'    // Low quality scan/OCR issues
  | 'other';

/** A single extraction issue from feedback */
export interface ExtractionIssue {
  id: string;
  category: IssueCategory;
  description: string;
  questionnaire: string;
  customer: string;
  itemId: string;
  label: string;
  value?: string;
  expectedValue?: string;
  note: string;
  cellRef?: string;
  sheet?: string;
  createdAt: string;
}

/** Aggregated issue pattern */
export interface IssuePattern {
  category: IssueCategory;
  count: number;
  description: string;
  examples: Array<{
    questionnaire: string;
    label: string;
    note: string;
  }>;
  suggestedFix?: string;
}

/** Learning database */
export interface LearningDatabase {
  version: string;
  lastUpdated: string;
  issues: ExtractionIssue[];
  patterns: IssuePattern[];
  promptImprovements: PromptImprovement[];
}

/** Suggested prompt improvement */
export interface PromptImprovement {
  id: string;
  category: IssueCategory;
  currentBehavior: string;
  suggestedBehavior: string;
  promptAddition: string;
  status: 'suggested' | 'applied' | 'rejected';
  appliedAt?: string;
}

// =============================================================================
// ISSUE CATEGORIZER
// =============================================================================

const ISSUE_PATTERNS: Array<{ pattern: RegExp; category: IssueCategory }> = [
  { pattern: /strikethrough|strip\w*\s*th\w*gh|crossed out|line through/i, category: 'strikethrough' },
  { pattern: /checkbox|check.?box|tick|x.?mark|checkmark/i, category: 'checkbox' },
  { pattern: /handwrit|hand.?writ|written by hand|manuscript/i, category: 'handwriting' },
  { pattern: /faint|grey|gray|light text|hard to read|low contrast/i, category: 'faint_text' },
  { pattern: /comment.*miss|miss.*comment|narrow column/i, category: 'comments' },
  { pattern: /scan|ocr|blurry|quality|resolution/i, category: 'scanned_quality' },
  { pattern: /poorly extracted|wrong value|missing value|extraction|not captured/i, category: 'poor_extraction' },
  { pattern: /poorly tagged|wrong topic|wrong destination/i, category: 'poor_tagging' },
  { pattern: /questionnaire.?specific|should not be saved|specific to this/i, category: 'questionnaire_specific' },
  { pattern: /table|column|row|matrix|complex layout/i, category: 'table_structure' },
  { pattern: /merged|spanning|split across/i, category: 'merged_cells' },
  { pattern: /language|dutch|german|french|wrong lang/i, category: 'language_detection' },
  { pattern: /date|number|format|currency|percentage/i, category: 'value_format' },
];

function categorizeNote(note: string): IssueCategory {
  for (const { pattern, category } of ISSUE_PATTERNS) {
    if (pattern.test(note)) {
      return category;
    }
  }
  return 'other';
}

// =============================================================================
// EXTRACTION LEARNER
// =============================================================================

export class ExtractionLearner {
  private dbPath: string;
  private db: LearningDatabase;

  constructor(knowledgeDir: string = './knowledge') {
    this.dbPath = join(knowledgeDir, 'extraction-learning.json');
    this.db = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      issues: [],
      patterns: [],
      promptImprovements: [],
    };
  }

  /**
   * Load the learning database
   */
  async load(): Promise<void> {
    if (existsSync(this.dbPath)) {
      const content = await readFile(this.dbPath, 'utf-8');
      this.db = JSON.parse(content);
    }
  }

  /**
   * Save the learning database
   */
  async save(): Promise<void> {
    const dir = join(this.dbPath, '..');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    this.db.lastUpdated = new Date().toISOString();
    await writeFile(this.dbPath, JSON.stringify(this.db, null, 2));
  }

  /**
   * Scan all indexed questionnaires for notes and extract issues
   */
  async scanForIssues(customersDir: string = './customers'): Promise<ExtractionIssue[]> {
    const newIssues: ExtractionIssue[] = [];
    const customers = await readdir(customersDir);

    for (const customer of customers) {
      const indexedDir = join(customersDir, customer, 'indexed');
      if (!existsSync(indexedDir)) continue;

      const files = await readdir(indexedDir);
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const filePath = join(indexedDir, file);
        const content = await readFile(filePath, 'utf-8');
        const indexed = JSON.parse(content);

        // Scan all items for notes
        for (const section of indexed.sections || []) {
          for (const item of section.items || []) {
            if (item.note && item.note.trim()) {
              const issue: ExtractionIssue = {
                id: `${customer}-${file}-${item.id}`,
                category: categorizeNote(item.note),
                description: item.note,
                questionnaire: file.replace('.json', ''),
                customer,
                itemId: item.id,
                label: item.label,
                value: item.value,
                note: item.note,
                cellRef: item.lCell || item.vCell,
                sheet: section.sheet,
                createdAt: new Date().toISOString(),
              };

              // Check if issue already exists
              const exists = this.db.issues.some(i => i.id === issue.id);
              if (!exists) {
                newIssues.push(issue);
              }
            }
          }
        }
      }
    }

    // Add new issues to database
    this.db.issues.push(...newIssues);
    return newIssues;
  }

  /**
   * Analyze issues and generate patterns
   */
  analyzePatterns(): IssuePattern[] {
    const categoryMap = new Map<IssueCategory, ExtractionIssue[]>();

    for (const issue of this.db.issues) {
      const list = categoryMap.get(issue.category) || [];
      list.push(issue);
      categoryMap.set(issue.category, list);
    }

    const patterns: IssuePattern[] = [];

    for (const [category, issues] of categoryMap) {
      const pattern: IssuePattern = {
        category,
        count: issues.length,
        description: this.describeCategory(category),
        examples: issues.slice(0, 5).map(i => ({
          questionnaire: i.questionnaire,
          label: i.label,
          note: i.note,
        })),
        suggestedFix: this.suggestFix(category, issues),
      };
      patterns.push(pattern);
    }

    // Sort by count descending
    patterns.sort((a, b) => b.count - a.count);
    this.db.patterns = patterns;

    return patterns;
  }

  /**
   * Generate prompt improvements based on patterns
   */
  generatePromptImprovements(): PromptImprovement[] {
    const improvements: PromptImprovement[] = [];

    for (const pattern of this.db.patterns) {
      if (pattern.count < 2) continue; // Only suggest for recurring issues

      const improvement = this.createPromptImprovement(pattern);
      if (improvement) {
        // Check if already exists
        const exists = this.db.promptImprovements.some(
          p => p.category === improvement.category && p.status !== 'rejected'
        );
        if (!exists) {
          improvements.push(improvement);
        }
      }
    }

    this.db.promptImprovements.push(...improvements);
    return improvements;
  }

  /**
   * Get summary report
   */
  getSummary(): {
    totalIssues: number;
    byCategory: Record<IssueCategory, number>;
    topPatterns: IssuePattern[];
    pendingImprovements: PromptImprovement[];
  } {
    const byCategory: Record<string, number> = {};
    for (const issue of this.db.issues) {
      byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    }

    return {
      totalIssues: this.db.issues.length,
      byCategory: byCategory as Record<IssueCategory, number>,
      topPatterns: this.db.patterns.slice(0, 5),
      pendingImprovements: this.db.promptImprovements.filter(p => p.status === 'suggested'),
    };
  }

  /**
   * Export improvements as prompt additions for visual-analyzer.ts
   */
  exportPromptAdditions(): string {
    const applied = this.db.promptImprovements.filter(p => p.status === 'applied');
    if (applied.length === 0) {
      return '// No prompt improvements applied yet';
    }

    let output = '// Auto-generated prompt improvements from extraction learning\n';
    output += '// Last updated: ' + new Date().toISOString() + '\n\n';

    for (const imp of applied) {
      output += `// Category: ${imp.category}\n`;
      output += `// Issue: ${imp.currentBehavior}\n`;
      output += `${imp.promptAddition}\n\n`;
    }

    return output;
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private describeCategory(category: IssueCategory): string {
    const descriptions: Record<IssueCategory, string> = {
      strikethrough: 'Strikethrough text formatting not detected - answers shown with line through wrong option',
      checkbox: 'Checkbox marks (X, ✓, filled boxes) not properly detected',
      handwriting: 'Handwritten text not captured or misread',
      faint_text: 'Faint, grey, or low contrast text missed by extraction',
      comments: 'Comments column text not captured (often in narrow columns)',
      scanned_quality: 'Low quality scan or OCR issues affecting extraction',
      poor_extraction: 'Values not properly extracted or paired with wrong labels',
      poor_tagging: 'Items assigned wrong topic, destination, or level',
      questionnaire_specific: 'Content specific to questionnaire that should not be saved to library',
      table_structure: 'Complex table structures not properly parsed into individual items',
      merged_cells: 'Merged cells causing label/value misalignment',
      language_detection: 'Wrong language detected for items',
      value_format: 'Date, number, or other value formats not properly recognized',
      other: 'Other extraction issues',
    };
    return descriptions[category];
  }

  private suggestFix(category: IssueCategory, issues: ExtractionIssue[]): string {
    const fixes: Record<IssueCategory, string> = {
      strikethrough: 'Claude Vision enhancement detects strikethrough formatting (enabled by default for PDFs)',
      checkbox: 'Claude Vision enhancement detects checkbox marks including X, ✓, and filled boxes',
      handwriting: 'Claude Vision enhancement can read handwritten text in forms',
      faint_text: 'Claude Vision enhancement captures faint/grey text that Azure DI misses',
      comments: 'Claude Vision enhancement explicitly captures narrow comment columns',
      scanned_quality: 'Claude Vision provides better OCR for low-quality scans',
      poor_extraction: 'Improve cell reference tracking and value extraction logic',
      poor_tagging: 'Update topic classification rules in tag-rules.yaml',
      questionnaire_specific: 'Add pattern to detect questionnaire metadata vs actual answers',
      table_structure: 'Enhance table row/column expansion logic in visual analyzer',
      merged_cells: 'Improve merged cell range detection and value attribution',
      language_detection: 'Add more language detection heuristics',
      value_format: 'Add format-specific parsing for dates, numbers, etc.',
      other: 'Manual review required',
    };
    return fixes[category];
  }

  private createPromptImprovement(pattern: IssuePattern): PromptImprovement | null {
    const promptAdditions: Record<IssueCategory, string> = {
      strikethrough: `
NOTE: Strikethrough detection is handled by Claude Vision enhancement (automatic for PDFs).
The vision enhancer detects when YES or NO has a line through it and extracts the correct answer.`,

      checkbox: `
NOTE: Checkbox detection is handled by Claude Vision enhancement (automatic for PDFs).
Vision detects X marks, checkmarks (✓), filled boxes (☒), and circled answers.`,

      handwriting: `
NOTE: Handwritten text is handled by Claude Vision enhancement (automatic for PDFs).
Vision can read handwritten values in form fields better than Azure DI OCR.`,

      faint_text: `
NOTE: Faint/grey text is handled by Claude Vision enhancement (automatic for PDFs).
Vision captures low contrast text that Azure Document Intelligence may miss.`,

      comments: `
NOTE: Comment column capture is handled by Claude Vision enhancement (automatic for PDFs).
Vision explicitly looks for narrow comment columns and captures all text.`,

      scanned_quality: `
NOTE: Low quality scans are handled by Claude Vision enhancement (automatic for PDFs).
Vision provides better OCR interpretation for blurry or low-resolution documents.`,

      poor_extraction: `
VALUE EXTRACTION: Ensure each label is paired with the correct value cell. Check that:
   - The value cell is in the expected position relative to the label
   - Multi-line values are captured completely
   - Dropdown selections show the selected value, not placeholder text`,

      poor_tagging: '', // Handled by tag-rules.yaml, not prompt

      questionnaire_specific: `
QUESTIONNAIRE METADATA: Do NOT extract these as answer library items:
   - Document headers, page numbers, form version numbers
   - Instructions to the filler ("Please complete", "Insert by supplier")
   - Attachment/document references ("Certificate attached", "See appendix")
   - These should be tagged with destination: "questionnaire" or "exclude"`,

      table_structure: `
COMPLEX TABLES: For tables with multiple columns of answers:
   - Extract EACH cell as a separate item
   - Include the row identifier in the label (e.g., "Palm oil - Certificate", "Palm oil - Expiry date")
   - Include the column header in the label for multi-column tables
   - Never collapse table rows into a single "table" type item`,

      merged_cells: `
MERGED CELLS: When a cell spans multiple rows:
   - The value applies to all rows it spans
   - Create separate items for each logical row, reusing the merged value
   - Track the merge range to avoid duplicate extraction`,

      language_detection: `
LANGUAGE DETECTION: Detect language based on:
    - Question text language (not just value)
    - Common patterns: "Ja/Nee" = Dutch, "Oui/Non" = French, "Ja/Nein" = German
    - Default to document language if item language unclear`,

      value_format: `
VALUE FORMATS:
    - Dates: Normalize to ISO format (YYYY-MM-DD) when possible
    - Yes/No: Accept "Ja", "Oui", "Yes", "X", checkmarks as Yes; "Nee", "Non", "No" as No
    - Numbers: Preserve original format but note if it's a percentage, currency, etc.`,

      other: '',
    };

    const addition = promptAdditions[pattern.category];
    if (!addition) return null;

    return {
      id: `imp-${pattern.category}-${Date.now()}`,
      category: pattern.category,
      currentBehavior: pattern.description,
      suggestedBehavior: pattern.suggestedFix || 'Improve extraction',
      promptAddition: addition.trim(),
      status: 'suggested',
    };
  }
}

// =============================================================================
// CLI FUNCTIONS
// =============================================================================

export async function runLearningCycle(customersDir: string = './customers'): Promise<void> {
  console.log('\n🧠 Extraction Learning System\n');

  const learner = new ExtractionLearner();
  await learner.load();

  // Scan for new issues
  console.log('📋 Scanning questionnaires for feedback notes...');
  const newIssues = await learner.scanForIssues(customersDir);
  console.log(`   Found ${newIssues.length} new issues`);

  // Analyze patterns
  console.log('\n🔍 Analyzing issue patterns...');
  const patterns = learner.analyzePatterns();

  // Generate improvements
  console.log('\n💡 Generating prompt improvements...');
  const improvements = learner.generatePromptImprovements();
  console.log(`   Generated ${improvements.length} new suggestions`);

  // Save
  await learner.save();

  // Print summary
  const summary = learner.getSummary();

  console.log('\n' + '═'.repeat(60));
  console.log('LEARNING SUMMARY');
  console.log('═'.repeat(60));

  console.log(`\nTotal issues tracked: ${summary.totalIssues}`);

  console.log('\nIssues by category:');
  for (const [category, count] of Object.entries(summary.byCategory)) {
    console.log(`  ${category}: ${count}`);
  }

  if (summary.topPatterns.length > 0) {
    console.log('\nTop issue patterns:');
    for (const pattern of summary.topPatterns) {
      console.log(`  ${pattern.category} (${pattern.count}x): ${pattern.description.slice(0, 60)}...`);
    }
  }

  if (summary.pendingImprovements.length > 0) {
    console.log('\nPending prompt improvements:');
    for (const imp of summary.pendingImprovements) {
      console.log(`  [${imp.category}] ${imp.suggestedBehavior.slice(0, 50)}...`);
    }
  }

  console.log('\n✅ Learning database saved to knowledge/extraction-learning.json');
}
