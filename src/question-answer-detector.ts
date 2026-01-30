/**
 * Question/Answer Detection for Excel Questionnaires
 *
 * This module analyzes Excel workbooks to detect question-answer pairs,
 * using multiple signals for high-accuracy detection.
 */

import { ExcelExtractor } from './excel-extractor.js';
import type {
  EnhancedWorkbookData,
  EnhancedSheetData,
  EnhancedCellData,
  DetectedQAPair,
  DetectedSection,
  QuestionnaireStructure,
  AnswerType,
} from './types.js';

/**
 * Confidence thresholds
 */
const CONFIDENCE_HIGH = 0.70;
const CONFIDENCE_LOW = 0.40;

/**
 * QuestionAnswerDetector - Analyzes Excel files to detect Q&A structure
 */
export class QuestionAnswerDetector {
  private extractor: ExcelExtractor;

  constructor() {
    this.extractor = new ExcelExtractor();
  }

  /**
   * Detect question-answer structure in an Excel file
   */
  async detect(filePath: string): Promise<QuestionnaireStructure> {
    const workbook = await this.extractor.extractEnhanced(filePath);
    return this.detectInWorkbook(workbook);
  }

  /**
   * Detect question-answer structure in an already-loaded workbook
   */
  detectInWorkbook(workbook: EnhancedWorkbookData): QuestionnaireStructure {
    const allPairs: DetectedQAPair[] = [];
    const allSections: DetectedSection[] = [];

    for (const sheet of workbook.sheets) {
      const { pairs, sections } = this.detectInSheet(sheet);
      allPairs.push(...pairs);
      allSections.push(...sections);
    }

    // Deduplicate sections - each pair should only appear in ONE section (the nearest header above it)
    const assignedPairIds = new Set<string>();
    for (const section of allSections) {
      section.pairs = section.pairs.filter(p => {
        if (assignedPairIds.has(p.id)) {
          return false;
        }
        assignedPairIds.add(p.id);
        return true;
      });
    }

    // Remove empty sections
    const nonEmptySections = allSections.filter(s => s.pairs.length > 0);

    // Separate pairs into sectioned and ungrouped
    const sectionedPairIds = new Set(
      nonEmptySections.flatMap(s => s.pairs.map(p => p.id))
    );
    const ungroupedPairs = allPairs.filter(p => !sectionedPairIds.has(p.id));

    // Calculate statistics
    const lowConfidencePairs = allPairs.filter(p => p.confidence < CONFIDENCE_LOW);
    const highConfidencePairs = allPairs.filter(p => p.confidence >= CONFIDENCE_HIGH);
    const mediumConfidencePairs = allPairs.filter(
      p => p.confidence >= CONFIDENCE_LOW && p.confidence < CONFIDENCE_HIGH
    );

    const avgConfidence = allPairs.length > 0
      ? allPairs.reduce((sum, p) => sum + p.confidence, 0) / allPairs.length
      : 0;

    return {
      sections: nonEmptySections,
      ungroupedPairs,
      stats: {
        totalPairs: allPairs.length,
        highConfidence: highConfidencePairs.length,
        mediumConfidence: mediumConfidencePairs.length,
        lowConfidence: lowConfidencePairs.length,
        averageConfidence: avgConfidence,
      },
      lowConfidencePairs,
    };
  }

  /**
   * Detect Q&A pairs and sections in a single sheet
   */
  private detectInSheet(sheet: EnhancedSheetData): {
    pairs: DetectedQAPair[];
    sections: DetectedSection[];
  } {
    const pairs: DetectedQAPair[] = [];
    const sections: DetectedSection[] = [];

    // Get all cells as array for easier iteration
    const cells = Array.from(sheet.cells.values());

    // First, detect section headers (merged cells with bold text)
    const sectionHeaders = this.detectSectionHeaders(sheet);

    // Find all label cells (potential questions)
    const labelCells = cells.filter(c => c.isLikelyLabel);

    // Find all input cells (potential answers)
    const inputCells = cells.filter(c => c.isLikelyInput);

    // Track which inputs have been linked to avoid duplicates
    const usedInputAddresses = new Set<string>();
    const usedLabelAddresses = new Set<string>();

    // Link labels to inputs - only allow one link per input
    for (const label of labelCells) {
      // Skip if this label was already used
      if (usedLabelAddresses.has(label.address)) continue;

      // Find inputs that haven't been used yet
      const availableInputs = inputCells.filter(i => !usedInputAddresses.has(i.address));
      const linkedInput = this.findLinkedInput(label, availableInputs, sheet);

      if (linkedInput) {
        const pair = this.createQAPair(label, linkedInput, sheet);
        pairs.push(pair);

        // Mark as used
        usedLabelAddresses.add(label.address);
        for (const cell of pair.answer.cells) {
          usedInputAddresses.add(cell);
        }
      }
    }

    // Group pairs into sections
    for (const header of sectionHeaders) {
      const section = this.createSection(header, pairs, sheet);
      if (section.pairs.length > 0) {
        sections.push(section);
      }
    }

    return { pairs, sections };
  }

  /**
   * Detect section headers (merged cells with bold text, often colored)
   */
  private detectSectionHeaders(sheet: EnhancedSheetData): EnhancedCellData[] {
    const headers: EnhancedCellData[] = [];

    for (const cell of sheet.cells.values()) {
      // Section headers are typically:
      // - Merged across multiple columns (or just has fill color)
      // - Bold text
      // - May have a distinctive fill color
      // - Text content (not empty, not formula)
      // - Text is all caps or has distinctive formatting
      const isText = cell.type === 'string' && cell.value;
      const isBold = cell.style?.font?.bold;
      const hasFill = cell.style?.fill && cell.style.fill !== '#FFFFFF';
      const isMergedWide = cell.mergeInfo?.isMaster && cell.mergeInfo.colSpan >= 2;
      const textValue = String(cell.value || '');
      const isAllCaps = textValue === textValue.toUpperCase() && textValue.length > 5;

      // Section header detection: must be text + (bold or fill or merged) + (all caps or bold)
      if (
        isText &&
        (isMergedWide || hasFill || (isBold && isAllCaps)) &&
        !cell.isLikelyInput
      ) {
        // Additional check: shouldn't end with colon (that's a label)
        if (!textValue.trim().endsWith(':')) {
          headers.push(cell);
        }
      }
    }

    // Sort by row number
    headers.sort((a, b) => {
      const rowA = this.getRowNumber(a.address);
      const rowB = this.getRowNumber(b.address);
      return rowA - rowB;
    });

    return headers;
  }

  /**
   * Find the input cell linked to a label cell
   */
  private findLinkedInput(
    label: EnhancedCellData,
    inputCells: EnhancedCellData[],
    sheet: EnhancedSheetData
  ): EnhancedCellData | null {
    const labelPos = this.parseAddress(label.address);

    // Pattern A: Input immediately to the right (same row)
    for (const input of inputCells) {
      const inputPos = this.parseAddress(input.address);

      // Same row, input is to the right
      if (inputPos.row === labelPos.row && inputPos.col > labelPos.col) {
        // Check if they're adjacent or close
        const colDiff = inputPos.col - labelPos.col;
        if (colDiff <= 3) {
          return input;
        }
      }
    }

    // Pattern B: Input directly below
    for (const input of inputCells) {
      const inputPos = this.parseAddress(input.address);

      // Input is below and in same column or close
      if (inputPos.row === labelPos.row + 1) {
        const colDiff = Math.abs(inputPos.col - labelPos.col);
        if (colDiff <= 1) {
          return input;
        }
      }
    }

    // Pattern C: Multi-cell input (e.g., date parts DD/MM/YYYY)
    // Look for multiple input cells in the same row to the right
    const sameRowInputs = inputCells.filter(c => {
      const pos = this.parseAddress(c.address);
      return pos.row === labelPos.row && pos.col > labelPos.col;
    });

    if (sameRowInputs.length >= 2) {
      // Return the first one; we'll handle multi-cell in createQAPair
      return sameRowInputs[0];
    }

    return null;
  }

  /**
   * Find a nearby label for a standalone input cell
   */
  private findNearbyLabel(
    input: EnhancedCellData,
    allCells: EnhancedCellData[],
    sheet: EnhancedSheetData
  ): EnhancedCellData | null {
    const inputPos = this.parseAddress(input.address);

    // Look for text cells to the left or above
    const candidates: Array<{ cell: EnhancedCellData; distance: number }> = [];

    for (const cell of allCells) {
      if (cell.type !== 'string' || !cell.value) continue;
      if (cell.isLikelyInput) continue; // Skip other input cells

      const cellPos = this.parseAddress(cell.address);

      // To the left, same row
      if (cellPos.row === inputPos.row && cellPos.col < inputPos.col) {
        const dist = inputPos.col - cellPos.col;
        if (dist <= 5) {
          candidates.push({ cell, distance: dist });
        }
      }

      // Above, same or adjacent column
      if (cellPos.row < inputPos.row && cellPos.row >= inputPos.row - 2) {
        const colDiff = Math.abs(cellPos.col - inputPos.col);
        if (colDiff <= 1) {
          const dist = (inputPos.row - cellPos.row) + colDiff;
          candidates.push({ cell, distance: dist });
        }
      }
    }

    // Return closest candidate
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0]?.cell || null;
  }

  /**
   * Create a Q&A pair from label and input cells
   */
  private createQAPair(
    label: EnhancedCellData,
    input: EnhancedCellData,
    sheet: EnhancedSheetData
  ): DetectedQAPair {
    const id = `${sheet.name}!${label.address}->${input.address}`;
    const signals: string[] = [];

    // Determine answer cells - use merge range if available
    let answerCells: EnhancedCellData[];
    let answerRange: string | undefined;

    if (input.mergeInfo?.isMaster) {
      // Use the merge range directly
      answerCells = [input];
      answerRange = input.mergeInfo.range;
    } else {
      // Find related cells (for date parts)
      answerCells = this.findRelatedInputCells(input, sheet);
    }

    const answerType = this.determineAnswerType(input, answerCells, label);

    // Calculate confidence based on signals
    let confidence = 0;

    // Label ends with colon/question mark
    const labelText = String(label.value || '').trim();
    if (labelText.endsWith(':') || labelText.endsWith('?')) {
      confidence += 0.15;
      signals.push('label-colon-or-question');
    }

    // Input has data validation
    if (input.dataValidation && input.dataValidation.type !== 'none') {
      confidence += 0.30;
      signals.push(`validation-${input.dataValidation.type}`);
    }

    // Input has fill color
    if (input.style?.fill && input.style.fill !== '#FFFFFF') {
      confidence += 0.20;
      signals.push(`fill-${input.style.fill}`);
    }

    // Input has all-around border
    if (input.borders.all) {
      confidence += 0.15;
      signals.push('bordered');
    }

    // Input is unlocked in protected sheet
    if (sheet.isProtected && !input.protection?.locked) {
      confidence += 0.25;
      signals.push('unlocked');
    }

    // Input is empty (waiting for data)
    if (!input.value || input.value === '') {
      confidence += 0.10;
      signals.push('empty-input');
    }

    // Input is in merged cell
    if (input.mergeInfo?.isMaster) {
      confidence += 0.05;
      signals.push(`merged-${input.mergeInfo.range}`);
    }

    // Get current value
    let currentValue = input.value;
    if (answerCells.length > 1) {
      // Combine values for multi-cell answers
      currentValue = answerCells.map(c => c.value || '').join('/');
    }

    return {
      id,
      question: {
        cell: label.address,
        text: labelText,
        sheet: sheet.name,
      },
      answer: {
        cells: answerCells.map(c => c.address),
        range: answerRange,
        type: answerType,
        currentValue,
      },
      confidence: Math.min(confidence, 1.0),
      detectionSignals: signals,
    };
  }

  /**
   * Find all related input cells (e.g., DD/MM/YYYY parts)
   * For merged cells, just return the primary input (the merge covers the range)
   */
  private findRelatedInputCells(
    primaryInput: EnhancedCellData,
    sheet: EnhancedSheetData
  ): EnhancedCellData[] {
    // If the input is a merged cell, just return it (the range covers multiple cells)
    if (primaryInput.mergeInfo?.isMaster) {
      return [primaryInput];
    }

    const cells: EnhancedCellData[] = [primaryInput];
    const primaryPos = this.parseAddress(primaryInput.address);

    // Look for adjacent input cells in the same row (for split inputs like DD/MM/YYYY)
    // Only add cells that are NOT part of a merge and have SMALL column span
    for (const cell of sheet.cells.values()) {
      if (cell.address === primaryInput.address) continue;
      if (!cell.isLikelyInput) continue;
      if (cell.mergeInfo?.isMaster) continue; // Skip merged cells as separate entries

      const cellPos = this.parseAddress(cell.address);

      // Same row, adjacent columns (within 2 columns for date parts)
      if (cellPos.row === primaryPos.row) {
        const colDiff = Math.abs(cellPos.col - primaryPos.col);
        if (colDiff <= 2 && colDiff >= 1) {
          // Check if they have similar styling (same fill, same border)
          const sameFill = cell.style?.fill === primaryInput.style?.fill;
          const sameBorder = cell.borders.all === primaryInput.borders.all;
          if (sameFill && sameBorder) {
            cells.push(cell);
          }
        }
      }
    }

    // Sort by column
    cells.sort((a, b) => {
      const posA = this.parseAddress(a.address);
      const posB = this.parseAddress(b.address);
      return posA.col - posB.col;
    });

    // Limit to max 3 cells (for date parts DD/MM/YYYY)
    return cells.slice(0, 3);
  }

  /**
   * Determine the type of answer expected
   */
  private determineAnswerType(
    input: EnhancedCellData,
    allInputCells: EnhancedCellData[],
    label: EnhancedCellData
  ): AnswerType {
    // Check data validation first
    if (input.dataValidation) {
      switch (input.dataValidation.type) {
        case 'list':
          return 'dropdown';
        case 'date':
          return 'date';
        case 'whole':
        case 'decimal':
          return 'number';
      }
    }

    // Check for date parts (multiple small cells)
    if (allInputCells.length >= 2 && allInputCells.length <= 3) {
      const labelText = String(label.value || '').toLowerCase();
      if (labelText.includes('date')) {
        return 'date-parts';
      }
    }

    // Check label text for hints
    const labelText = String(label.value || '').toLowerCase();

    if (labelText.includes('signature') || labelText.includes('stamp')) {
      return 'signature';
    }

    if (labelText.includes('yes') || labelText.includes('no') || labelText.includes('check')) {
      return 'checkbox';
    }

    if (labelText.includes('date')) {
      return 'date';
    }

    if (
      labelText.includes('number') ||
      labelText.includes('amount') ||
      labelText.includes('turnover') ||
      labelText.includes('staff') ||
      labelText.includes('telephone') ||
      labelText.includes('phone')
    ) {
      return 'number';
    }

    return 'text';
  }

  /**
   * Create a section from a header and assign pairs
   */
  private createSection(
    header: EnhancedCellData,
    allPairs: DetectedQAPair[],
    sheet: EnhancedSheetData
  ): DetectedSection {
    const headerRow = this.getRowNumber(header.address);
    const headerText = String(header.value || '').trim();

    // Find the next section header row (or end of sheet)
    let nextHeaderRow = sheet.dimensions.endRow + 1;

    for (const cell of sheet.cells.values()) {
      if (cell.address === header.address) continue;
      if (
        cell.mergeInfo?.isMaster &&
        cell.mergeInfo.colSpan >= 3 &&
        cell.style?.font?.bold
      ) {
        const cellRow = this.getRowNumber(cell.address);
        if (cellRow > headerRow && cellRow < nextHeaderRow) {
          nextHeaderRow = cellRow;
        }
      }
    }

    // Find pairs that belong to this section
    const sectionPairs = allPairs.filter(pair => {
      if (pair.question.sheet !== sheet.name) return false;
      const pairRow = this.getRowNumber(pair.question.cell);
      return pairRow > headerRow && pairRow < nextHeaderRow;
    });

    return {
      id: `${sheet.name}!section-${headerRow}`,
      name: headerText,
      headerCell: header.address,
      headerRange: header.mergeInfo?.range,
      pairs: sectionPairs,
      sheet: sheet.name,
    };
  }

  /**
   * Parse cell address to row/col
   */
  private parseAddress(address: string): { row: number; col: number } {
    const match = address.match(/^([A-Z]+)(\d+)$/);
    if (!match) return { row: 1, col: 1 };

    const colStr = match[1];
    const row = parseInt(match[2], 10);

    let col = 0;
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }

    return { row, col };
  }

  /**
   * Get row number from address
   */
  private getRowNumber(address: string): number {
    const match = address.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Format detection results as readable text
   */
  formatAsText(structure: QuestionnaireStructure): string {
    const lines: string[] = [];

    lines.push('# Detected Question-Answer Structure');
    lines.push('');
    lines.push(`Total pairs detected: ${structure.stats.totalPairs}`);
    lines.push(`  High confidence (≥70%): ${structure.stats.highConfidence}`);
    lines.push(`  Medium confidence (40-69%): ${structure.stats.mediumConfidence}`);
    lines.push(`  Low confidence (<40%): ${structure.stats.lowConfidence}`);
    lines.push(`  Average confidence: ${Math.round(structure.stats.averageConfidence * 100)}%`);
    lines.push('');

    // Sections
    for (const section of structure.sections) {
      lines.push(`## Section: "${section.name}"`);
      if (section.headerRange) {
        lines.push(`   Header: ${section.headerRange}`);
      }
      lines.push('');

      if (section.pairs.length === 0) {
        lines.push('   (No Q&A pairs detected in this section)');
      } else {
        lines.push('   | Question | Answer Cell(s) | Type | Confidence |');
        lines.push('   |----------|----------------|------|------------|');

        for (const pair of section.pairs) {
          const questionShort = pair.question.text.length > 30
            ? pair.question.text.substring(0, 27) + '...'
            : pair.question.text;
          const cells = pair.answer.range || pair.answer.cells.join(', ');
          const conf = `${Math.round(pair.confidence * 100)}%`;
          const confIcon = pair.confidence >= CONFIDENCE_HIGH ? '✓' :
                          pair.confidence >= CONFIDENCE_LOW ? '○' : '⚠';

          lines.push(`   | ${questionShort.padEnd(30)} | ${cells.padEnd(14)} | ${pair.answer.type.padEnd(10)} | ${confIcon} ${conf.padStart(3)} |`);
        }
      }
      lines.push('');
    }

    // Ungrouped pairs
    if (structure.ungroupedPairs.length > 0) {
      lines.push('## Ungrouped Pairs');
      lines.push('');
      lines.push('   | Question | Answer Cell(s) | Type | Confidence |');
      lines.push('   |----------|----------------|------|------------|');

      for (const pair of structure.ungroupedPairs) {
        const questionShort = pair.question.text.length > 30
          ? pair.question.text.substring(0, 27) + '...'
          : pair.question.text;
        const cells = pair.answer.range || pair.answer.cells.join(', ');
        const conf = `${Math.round(pair.confidence * 100)}%`;
        const confIcon = pair.confidence >= CONFIDENCE_HIGH ? '✓' :
                        pair.confidence >= CONFIDENCE_LOW ? '○' : '⚠';

        lines.push(`   | ${questionShort.padEnd(30)} | ${cells.padEnd(14)} | ${pair.answer.type.padEnd(10)} | ${confIcon} ${conf.padStart(3)} |`);
      }
      lines.push('');
    }

    // Low confidence warnings
    if (structure.lowConfidencePairs.length > 0) {
      lines.push('## ⚠ Low Confidence Detections (Need Review)');
      lines.push('');

      for (const pair of structure.lowConfidencePairs) {
        lines.push(`   • "${pair.question.text}"`);
        lines.push(`     Answer cell: ${pair.answer.cells.join(', ')}`);
        lines.push(`     Confidence: ${Math.round(pair.confidence * 100)}%`);
        lines.push(`     Signals: ${pair.detectionSignals.join(', ')}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get all pairs as a flat list
   */
  getAllPairs(structure: QuestionnaireStructure): DetectedQAPair[] {
    const pairs = [...structure.ungroupedPairs];
    for (const section of structure.sections) {
      pairs.push(...section.pairs);
    }
    return pairs;
  }
}

export const detector = new QuestionAnswerDetector();
