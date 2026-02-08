/**
 * Interactive Review CLI
 *
 * Provides a terminal-based interface for reviewing questionnaire extractions.
 * Opens visual preview in browser, shows items in terminal for feedback.
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import type { IndexedQuestionnaire, IndexedSection, IndexedItem } from './questionnaire-indexer.js';
import type { QuestionnaireStructure } from './excel-structure.js';
import { ScreenshotGenerator } from './screenshot-generator.js';
import { FeedbackManager, type WrongReason } from './feedback-store.js';

const execAsync = promisify(exec);

// =============================================================================
// COLORS FOR TERMINAL
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function c(color: keyof typeof colors, text: string): string {
  return colors[color] + text + colors.reset;
}

// =============================================================================
// REVIEW CLI
// =============================================================================

export class ReviewCLI {
  private indexedDir: string;
  private questionnairesDir: string;
  private reviewDir: string;
  private feedback: FeedbackManager;
  private rl: readline.Interface;

  constructor(
    indexedDir: string = './indexed',
    questionnairesDir: string = './questionnaires',
    reviewDir: string = './review'
  ) {
    this.indexedDir = indexedDir;
    this.questionnairesDir = questionnairesDir;
    this.reviewDir = reviewDir;
    this.feedback = new FeedbackManager('./feedback/feedback.yaml');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start review session
   */
  async start(): Promise<void> {
    console.log('\n' + c('bright', '═══════════════════════════════════════════════════════════'));
    console.log(c('bright', '  QUESTIONNAIRE REVIEW'));
    console.log(c('bright', '═══════════════════════════════════════════════════════════') + '\n');

    // Show stats
    const stats = await this.feedback.getStats();
    console.log(c('dim', 'Previously reviewed: ' + stats.totalReviewed + ' items'));
    console.log(c('dim', '  Correct: ' + stats.correct + '  Wrong: ' + stats.wrong + '  Edited: ' + stats.edited + '\n'));

    // List available questionnaires
    const files = await readdir(this.indexedDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));

    if (yamlFiles.length === 0) {
      console.log(c('yellow', 'No indexed questionnaires found.'));
      console.log('Run: npx tsx src/pipeline-v2/cli.ts index <file>');
      this.rl.close();
      return;
    }

    console.log('Available questionnaires:\n');
    yamlFiles.forEach((f, i) => {
      console.log('  ' + c('cyan', '[' + (i + 1) + ']') + ' ' + f.replace('.yaml', ''));
    });

    const choice = await this.prompt('\nSelect questionnaire (number) or "q" to quit: ');

    if (choice.toLowerCase() === 'q') {
      this.rl.close();
      return;
    }

    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= yamlFiles.length) {
      console.log(c('red', 'Invalid selection.'));
      this.rl.close();
      return;
    }

    await this.reviewQuestionnaire(yamlFiles[idx]);
    this.rl.close();
  }

  /**
   * Review a specific questionnaire
   */
  async reviewQuestionnaire(filename: string): Promise<void> {
    console.log('\n' + c('bright', 'Loading: ' + filename) + '\n');

    // Load indexed questionnaire
    const indexedPath = join(this.indexedDir, filename);
    const indexed: IndexedQuestionnaire = parseYaml(await readFile(indexedPath, 'utf-8'));

    // Load original structure for visual preview
    const jsonName = filename.replace('.yaml', '.json');
    const structurePath = join(this.questionnairesDir, jsonName);
    let structure: QuestionnaireStructure | null = null;

    try {
      structure = JSON.parse(await readFile(structurePath, 'utf-8'));
    } catch {
      console.log(c('yellow', 'Original structure not found. Visual preview unavailable.'));
    }

    // Generate visual preview
    if (structure) {
      console.log('Generating visual preview...');
      const generator = new ScreenshotGenerator(this.reviewDir);
      const indexPath = await generator.generatePreview(structure);
      console.log(c('green', 'Preview generated: ' + indexPath));

      const openPreview = await this.prompt('Open preview in browser? (y/n): ');
      if (openPreview.toLowerCase() === 'y') {
        await this.openInBrowser(indexPath);
      }
    }

    // Choose review mode
    console.log('\nReview mode:');
    console.log('  ' + c('cyan', '[1]') + ' Review sections');
    console.log('  ' + c('cyan', '[2]') + ' Review items by section');
    console.log('  ' + c('cyan', '[3]') + ' Review all items');

    const mode = await this.prompt('\nSelect mode: ');

    switch (mode) {
      case '1':
        await this.reviewSections(indexed);
        break;
      case '2':
        await this.reviewBySection(indexed);
        break;
      case '3':
        await this.reviewAll(indexed);
        break;
      default:
        console.log(c('yellow', 'Invalid selection.'));
    }
  }

  /**
   * Review sections
   */
  async reviewSections(indexed: IndexedQuestionnaire): Promise<void> {
    console.log('\n' + c('bright', '=== SECTION REVIEW ===') + '\n');
    console.log(c('dim', 'Review detected sections. Are the boundaries correct?\n'));

    for (let i = 0; i < indexed.sections.length; i++) {
      const section = indexed.sections[i];

      console.log('-'.repeat(60));
      console.log('Section ' + c('cyan', (i + 1) + '/' + indexed.sections.length));
      console.log('');
      console.log('  ' + c('bright', 'Title:') + ' ' + section.title);
      console.log('  ' + c('bright', 'Topic:') + ' ' + section.topic);
      console.log('  ' + c('bright', 'Rows:') + ' ' + section.rows);
      console.log('  ' + c('bright', 'Items:') + ' ' + section.items.length);
      console.log('');

      // Show first few items
      console.log(c('dim', '  Sample items:'));
      for (const item of section.items.slice(0, 3)) {
        const hasValue = item.value ? c('green', '[OK]') : c('yellow', '[  ]');
        const typeTag = c('dim', '[' + item.type + ']');
        console.log('    ' + hasValue + ' ' + typeTag + ' ' + item.label.substring(0, 45));
      }
      if (section.items.length > 3) {
        console.log(c('dim', '    ... and ' + (section.items.length - 3) + ' more'));
      }
      console.log('');

      // Get feedback
      console.log('  ' + c('green', '[c]') + ' Correct  ' + c('red', '[w]') + ' Wrong  ' + c('yellow', '[e]') + ' Edit  ' + c('dim', '[s]') + ' Skip  ' + c('dim', '[q]') + ' Quit');
      const action = await this.prompt('  > ');

      switch (action.toLowerCase()) {
        case 'c':
          await this.feedback.addSectionFeedback({
            source: { file: indexed.source, sheet: section.title },
            detected: {
              title: section.title,
              rows: section.rows,
              topic: section.topic,
            },
            verdict: 'correct',
          });
          console.log(c('green', '  Marked as correct\n'));
          break;

        case 'w':
          const reason = await this.promptWrongReason('section');
          await this.feedback.addSectionFeedback({
            source: { file: indexed.source, sheet: section.title },
            detected: {
              title: section.title,
              rows: section.rows,
              topic: section.topic,
            },
            verdict: 'wrong',
            wrongReason: reason as any,
          });
          console.log(c('red', '  Marked as wrong\n'));
          break;

        case 'e':
          const corrected = await this.promptSectionEdit(section);
          await this.feedback.addSectionFeedback({
            source: { file: indexed.source, sheet: section.title },
            detected: {
              title: section.title,
              rows: section.rows,
              topic: section.topic,
            },
            verdict: 'edited',
            corrected,
          });
          console.log(c('yellow', '  Saved with edits\n'));
          break;

        case 's':
          console.log(c('dim', '  Skipped\n'));
          break;

        case 'q':
          return;
      }
    }

    console.log(c('green', '\nSection review complete!\n'));
  }

  /**
   * Review items by section
   */
  async reviewBySection(indexed: IndexedQuestionnaire): Promise<void> {
    console.log('\n' + c('bright', '=== ITEM REVIEW (by section) ===') + '\n');

    console.log('Sections:\n');
    indexed.sections.forEach((s, i) => {
      console.log('  ' + c('cyan', '[' + (i + 1) + ']') + ' ' + s.title + ' (' + s.items.length + ' items)');
    });

    const choice = await this.prompt('\nSelect section (number) or "q" to quit: ');

    if (choice.toLowerCase() === 'q') return;

    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= indexed.sections.length) {
      console.log(c('red', 'Invalid selection.'));
      return;
    }

    await this.reviewItemsInSection(indexed, indexed.sections[idx]);
  }

  /**
   * Review all items
   */
  async reviewAll(indexed: IndexedQuestionnaire): Promise<void> {
    console.log('\n' + c('bright', '=== ITEM REVIEW (all) ===') + '\n');

    // Collect all items with section context
    const allItems: Array<{ item: IndexedItem; section: IndexedSection }> = [];
    for (const section of indexed.sections) {
      for (const item of section.items) {
        allItems.push({ item, section });
      }
    }

    let reviewed = 0;
    const total = allItems.length;

    for (const { item, section } of allItems) {
      reviewed++;

      const cellRef = item.lCell || item.ref || '';
      const isReviewed = await this.feedback.isReviewed(
        indexed.source,
        section.title,
        cellRef
      );

      if (isReviewed) {
        continue;
      }

      const shouldContinue = await this.reviewItem(indexed, item, section, reviewed, total);
      if (!shouldContinue) break;
    }
  }

  /**
   * Review items in a section
   */
  async reviewItemsInSection(indexed: IndexedQuestionnaire, section: IndexedSection): Promise<void> {
    console.log('\n' + c('bright', 'Section: ' + section.title) + '\n');

    let reviewed = 0;
    const total = section.items.length;

    for (const item of section.items) {
      reviewed++;

      const shouldContinue = await this.reviewItem(indexed, item, section, reviewed, total);
      if (!shouldContinue) break;
    }
  }

  /**
   * Review a single item
   */
  async reviewItem(
    indexed: IndexedQuestionnaire,
    item: IndexedItem,
    section: IndexedSection,
    current: number,
    total: number
  ): Promise<boolean> {
    console.log('-'.repeat(60));
    console.log('Item ' + c('cyan', current + '/' + total));
    console.log('');

    // Cell reference
    if (item.lCell && item.vCell) {
      console.log('  ' + c('bright', 'Cells:') + ' ' + item.lCell + ' -> ' + item.vCell);
    } else if (item.ref) {
      console.log('  ' + c('bright', 'Ref:') + ' ' + item.ref);
    }

    console.log('  ' + c('bright', 'Type:') + ' ' + item.type);
    console.log('  ' + c('bright', 'Section:') + ' ' + section.title);
    console.log('  ' + c('bright', 'Topic:') + ' ' + section.topic);
    console.log('  ' + c('bright', 'Level:') + ' ' + item.level);
    if (item.lang) {
      console.log('  ' + c('bright', 'Language:') + ' ' + item.lang);
    }
    console.log('');
    console.log('  ' + c('cyan', 'Label:') + ' ' + item.label);
    console.log('');
    if (item.value) {
      console.log('  ' + c('green', 'Value:') + ' ' + item.value);
    } else {
      console.log('  ' + c('yellow', 'Value:') + ' (empty)');
    }
    console.log('');

    console.log('  ' + c('green', '[c]') + ' Correct  ' + c('red', '[w]') + ' Wrong  ' + c('yellow', '[e]') + ' Edit  ' + c('dim', '[s]') + ' Skip  ' + c('dim', '[q]') + ' Quit');
    const action = await this.prompt('  > ');

    const cellRef = item.lCell || item.ref || '';

    switch (action.toLowerCase()) {
      case 'c':
        await this.feedback.addExtractionFeedback({
          source: {
            file: indexed.source,
            sheet: section.title,
            cells: cellRef,
          },
          extracted: {
            type: item.type,
            label: item.label,
            value: item.value,
            topic: section.topic,
            level: item.level,
          },
          verdict: 'correct',
        });
        console.log(c('green', '  Marked as correct\n'));
        break;

      case 'w':
        const reason = await this.promptWrongReason('extraction');
        await this.feedback.addExtractionFeedback({
          source: {
            file: indexed.source,
            sheet: section.title,
            cells: cellRef,
          },
          extracted: {
            type: item.type,
            label: item.label,
            value: item.value,
            topic: section.topic,
            level: item.level,
          },
          verdict: 'wrong',
          wrongReason: reason,
        });
        console.log(c('red', '  Marked as wrong\n'));
        break;

      case 'e':
        const corrected = await this.promptItemEdit(item, section);
        await this.feedback.addExtractionFeedback({
          source: {
            file: indexed.source,
            sheet: section.title,
            cells: cellRef,
          },
          extracted: {
            type: item.type,
            label: item.label,
            value: item.value,
            topic: section.topic,
            level: item.level,
          },
          verdict: 'edited',
          corrected,
        });
        console.log(c('yellow', '  Saved with edits\n'));
        break;

      case 's':
        console.log(c('dim', '  Skipped\n'));
        break;

      case 'q':
        return false;
    }

    return true;
  }

  /**
   * Prompt for wrong reason
   */
  async promptWrongReason(type: 'section' | 'extraction'): Promise<WrongReason> {
    console.log('\n  Why is this wrong?');

    if (type === 'section') {
      console.log('    ' + c('cyan', '[1]') + ' Wrong boundaries');
      console.log('    ' + c('cyan', '[2]') + ' Not a section');
      console.log('    ' + c('cyan', '[3]') + ' Should merge with other');
      console.log('    ' + c('cyan', '[4]') + ' Should be split');
      console.log('    ' + c('cyan', '[5]') + ' Other');
    } else {
      console.log('    ' + c('cyan', '[1]') + ' Not a valid item');
      console.log('    ' + c('cyan', '[2]') + ' Wrong pairing (label matched to wrong value)');
      console.log('    ' + c('cyan', '[3]') + ' Should be part of a table');
      console.log('    ' + c('cyan', '[4]') + ' Wrong topic');
      console.log('    ' + c('cyan', '[5]') + ' Wrong level (standard/narrative/product)');
      console.log('    ' + c('cyan', '[6]') + ' Wrong type (field/text/yesno/etc)');
      console.log('    ' + c('cyan', '[7]') + ' Duplicate');
      console.log('    ' + c('cyan', '[8]') + ' Irrelevant');
      console.log('    ' + c('cyan', '[9]') + ' Other');
    }

    const choice = await this.prompt('  > ');

    if (type === 'section') {
      const reasons: WrongReason[] = ['wrong_boundaries', 'not_a_question', 'duplicate', 'wrong_boundaries', 'other'];
      return reasons[parseInt(choice, 10) - 1] || 'other';
    } else {
      const reasons: WrongReason[] = [
        'not_a_question', 'wrong_pairing', 'should_be_table', 'wrong_topic',
        'wrong_level', 'wrong_type', 'duplicate', 'irrelevant', 'other'
      ];
      return reasons[parseInt(choice, 10) - 1] || 'other';
    }
  }

  /**
   * Prompt for section edit
   */
  async promptSectionEdit(section: IndexedSection): Promise<{ title?: string; rows?: string; topic?: string }> {
    console.log('\n  Edit section (press Enter to keep current):');

    const title = await this.prompt('    Title [' + section.title + ']: ');
    const rows = await this.prompt('    Rows [' + section.rows + ']: ');
    const topic = await this.prompt('    Topic [' + section.topic + ']: ');

    return {
      ...(title && { title }),
      ...(rows && { rows }),
      ...(topic && { topic }),
    };
  }

  /**
   * Prompt for item edit
   */
  async promptItemEdit(item: IndexedItem, section: IndexedSection): Promise<{ label?: string; value?: string; topic?: string; level?: string; type?: string }> {
    console.log('\n  Edit item (press Enter to keep current):');

    const label = await this.prompt('    Label [keep]: ');
    const value = await this.prompt('    Value [keep]: ');
    const topic = await this.prompt('    Topic [' + section.topic + ']: ');
    const level = await this.prompt('    Level [' + item.level + '] (s=standard, n=narrative, p=product): ');
    const type = await this.prompt('    Type [' + item.type + '] (field/text/yesno/table/date/signature): ');

    const levelMap: Record<string, string> = { s: 'standard', n: 'narrative', p: 'product' };

    return {
      ...(label && { label }),
      ...(value && { value }),
      ...(topic && { topic }),
      ...(level && { level: levelMap[level] || level }),
      ...(type && { type }),
    };
  }

  /**
   * Simple prompt
   */
  private prompt(question: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Open file in browser
   */
  private async openInBrowser(path: string): Promise<void> {
    try {
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      await execAsync(cmd + ' "' + path + '"');
    } catch (e) {
      console.log(c('yellow', 'Could not open browser. Open manually: ' + path));
    }
  }
}
